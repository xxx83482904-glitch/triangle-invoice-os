"""Resumable, read-only UI history traversal. Never claims account completeness.

Archive destinations are separate from live, verified send bindings. SDK IDs
are observation identifiers, not authenticated WeChat server message IDs.
"""
from collections import Counter
from dataclasses import asdict
import json

from .base import Chat, Message, now
from .plus_core import digest, PlusFailure

NOTE = ("PC版WeChatの会話一覧を巡回して保存した過去履歴です。ライブ会話とは別の読み取り専用記録です。"
        "SDKの観測IDで重複を抑止しています。時刻はSDKが画面から取得した値で、全履歴の末尾・欠落なしは保証できません。")


class PlusHistory:
    def __init__(self, store):
        self.store = store
        self.db = store.db
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS history_job(id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS history_candidates(name TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT 'pending',
                chat_id TEXT, pages INTEGER NOT NULL DEFAULT 0, saved INTEGER NOT NULL DEFAULT 0,
                stagnant INTEGER NOT NULL DEFAULT 0, error TEXT, identity TEXT);
            CREATE TABLE IF NOT EXISTS history_seen(source_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL);
        """)
        self.open_name = None
        job = self.job()
        if job and job['state'] == 'running':
            job.update(state='paused',error='interrupted')
            self.save(job)

    def job(self):
        row = self.db.execute("SELECT payload FROM history_job WHERE id=1").fetchone()
        return json.loads(row[0]) if row else None

    def save(self, job):
        job['updated_at'] = now()
        with self.db:
            self.db.execute("INSERT INTO history_job VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
                            (json.dumps(job, ensure_ascii=False),))

    def status(self):
        job = self.job()
        if not job:
            return {'state': 'idle', 'complete': False, 'discovered': 0, 'processed': 0, 'saved': 0, 'pages': 0}
        counts = dict(self.db.execute("SELECT state,COUNT(*) FROM history_candidates GROUP BY state"))
        saved, pages = self.db.execute("SELECT COALESCE(SUM(saved),0),COALESCE(SUM(pages),0) FROM history_candidates").fetchone()
        return {k: job.get(k) for k in ('state','phase','updated_at','error')} | {
            'complete': False, 'discovered': sum(counts.values()), 'processed': counts.get('partial',0)+counts.get('failed',0),
            'saved': saved, 'pages': pages, 'ambiguous': counts.get('ambiguous',0),
            'failed': counts.get('failed',0), 'discovery_pages': job.get('discovery_pages',0)}

    def command(self, action, scope, account):
        job = self.job()
        if action == 'pause':
            if job and job['state'] == 'running':
                job['state'] = 'paused'
                self.save(job)
            return self.status()
        if action not in ('start','resume'):
            raise ValueError('invalid_history_action')
        if job and job['state'] == 'running':
            return self.status()
        if action == 'resume':
            if not job or job['state'] != 'paused' or (job['scope'],job['account']) != (scope,account):
                raise ValueError('history_scope_changed')
            job.update(state='running',error=None)
            if job['phase'] == 'discovery':
                # The UI scroll position isn't a durable cursor. A fresh pass
                # avoids omitting entries after the owner moved the window.
                with self.db:
                    self.db.execute('DELETE FROM history_candidates')
                job.update(discovery_pages=0,previous=None,repeated=0)
        else:
            with self.db:
                self.db.execute('DELETE FROM history_candidates')
            job = dict(state='running',phase='discovery',scope=scope,account=account,
                       discovery_pages=0,previous=None,repeated=0,error=None)
        self.open_name = None
        self.save(job)
        return self.status()

    def step(self, sdk, scope, account):
        job = self.job()
        if not job or job['state'] != 'running':
            return
        if (job['scope'], job['account']) != (scope, account):
            job.update(state='paused',error='history_scope_changed')
            self.save(job)
            return
        if self.db.execute('SELECT COUNT(*) FROM inbox').fetchone()[0] > 400:
            return  # Backpressure: main DB must ACK before reading more UI.
        try:
            if job['phase'] == 'discovery':
                sessions = sdk.history_sessions(reset=job['discovery_pages'] == 0)
                names = [s['name'] for s in sessions]
                counts = Counter(names)
                with self.db:
                    for session in sessions:
                        name, identity = session['name'], session['identity']
                        previous = self.db.execute('SELECT identity FROM history_candidates WHERE name=?',(name,)).fetchone()
                        self.db.execute('INSERT OR IGNORE INTO history_candidates(name,identity) VALUES(?,?)',(name,identity))
                        if counts[name] > 1 or (previous and previous[0] != identity):
                            self.db.execute("UPDATE history_candidates SET state='ambiguous' WHERE name=?",(name,))
                signature = digest(names)
                job['repeated'] = job['repeated']+1 if signature == job['previous'] else 0
                job['previous'] = signature
                job['discovery_pages'] += 1
                if job['repeated'] >= 2 or job['discovery_pages'] >= 1000:
                    job.update(phase='messages',error='discovery_limit' if job['discovery_pages'] >= 1000 else None)
            else:
                row = self.db.execute("SELECT * FROM history_candidates WHERE state='pending' ORDER BY rowid LIMIT 1").fetchone()
                if not row:
                    job['state'] = 'partial'
                else:
                    name = row['name']
                    try:
                        page = sdk.history_page(name, reopen=self.open_name != name)
                        self.open_name = name
                        ident = 'wxautox4:local:history:' + digest([account, scope, name, page['type']])
                        if row['chat_id'] and row['chat_id'] != ident:
                            raise ValueError('history_destination_changed')
                        self.store.bind(Chat(ident, name, page['type'], history_note=NOTE))
                        added = 0
                        # Roll back the ENTIRE page on an observation collision.
                        # Neither the checkpoint nor seen IDs can outrun the inbox.
                        self.db.execute('BEGIN IMMEDIATE')
                        try:
                            for message in sdk.history_messages(page, ident):
                                fingerprint = digest(asdict(message))
                                old = self.db.execute('SELECT fingerprint FROM history_seen WHERE source_key=?',(message.source_key,)).fetchone()
                                if old:
                                    if old[0] != fingerprint:
                                        raise ValueError('history_identity_conflict')
                                    continue
                                self.db.execute('INSERT INTO history_seen VALUES(?,?)',(message.source_key,fingerprint))
                                self.db.execute('INSERT INTO inbox(source_key,payload) VALUES(?,?)',
                                                (message.source_key,json.dumps(asdict(message),ensure_ascii=False)))
                                added += 1
                            stagnant = 0 if added else row['stagnant']+1
                            done = stagnant >= 3 or row['pages']+1 >= 1000
                            self.db.execute("""UPDATE history_candidates SET chat_id=?,pages=pages+1,saved=saved+?,
                                stagnant=?,state=?,error=? WHERE name=?""",
                                (ident,added,stagnant,'partial' if done else 'pending',
                                 'page_limit' if row['pages']+1 >= 1000 else 'no_progress' if done else None,name))
                            self.db.commit()
                        except BaseException:
                            self.db.rollback()
                            raise
                    except (ValueError, PlusFailure) as exc:
                        code = str(exc) if str(exc) in ('unsupported_chat','history_identity_conflict','history_destination_changed') else 'history_read_failed'
                        with self.db:
                            self.db.execute("UPDATE history_candidates SET state='failed',error=? WHERE name=?",(code,name))
                        self.open_name = None
            self.save(job)
        except Exception:
            self.open_name = None
            job.update(state='paused',error='history_read_failed')
            self.save(job)

    def detach(self):
        self.open_name = None
