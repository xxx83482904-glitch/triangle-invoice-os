import hashlib
import json
import sqlite3
import threading
from dataclasses import asdict
from pathlib import Path
from uuid import NAMESPACE_URL, uuid4, uuid5

from .adapters.base import Chat, Message, now


class Database:
    def __init__(self, path: Path, mode: str):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.conn.execute("PRAGMA busy_timeout=5000")
        self.conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)")
        for migration in sorted((Path(__file__).parent.parent / "migrations").glob("*.sql")):
            if not self.one("SELECT version FROM schema_migrations WHERE version=?", (migration.name,)):
                # DDL and migration record commit together; an interrupted migration is replayable.
                sql = migration.read_text(encoding="utf-8")
                self.conn.executescript("BEGIN IMMEDIATE;\n" + sql + "\nINSERT INTO schema_migrations VALUES ('" + migration.name.replace("'", "''") + "', '" + now() + "');\nCOMMIT;")
        existing = self.one("SELECT value FROM metadata WHERE key='adapter'")
        if existing and existing["value"] != mode:
            self.close()
            raise ValueError("Use a separate database for each adapter")
        with self.lock, self.conn:
            self.conn.execute("INSERT OR IGNORE INTO metadata VALUES ('adapter', ?)", (mode,))
            self.conn.execute("UPDATE messages SET delivery_status='unknown' WHERE id IN (SELECT message_id FROM send_queue WHERE status='sending')")
            self.conn.execute("UPDATE send_queue SET status='unknown', error_message='interrupted_during_send', processed_at=? WHERE status='sending'", (now(),))

    def close(self):
        self.conn.close()

    def one(self, query, values=()):
        with self.lock:
            row = self.conn.execute(query, values).fetchone()
            return dict(row) if row else None

    def all(self, query, values=()):
        with self.lock:
            return [dict(r) for r in self.conn.execute(query, values).fetchall()]

    def upsert_chat(self, chat: Chat):
        ident = str(uuid5(NAMESPACE_URL, chat.external_id))
        with self.lock, self.conn:
            self.conn.execute("""INSERT INTO chats(id,external_id,name,type,sync_status,history_note,member_count)
                VALUES(?,?,?,?,?,?,?) ON CONFLICT(external_id) DO UPDATE SET
                name=excluded.name,type=excluded.type,sync_status=excluded.sync_status,
                history_note=excluded.history_note,member_count=excluded.member_count""",
                (ident, chat.external_id, chat.name, chat.type, chat.sync_status, chat.history_note, chat.member_count))
            self.conn.execute("INSERT OR IGNORE INTO sync_state(chat_id,connection_status) VALUES(?, 'connected')", (ident,))
        return ident

    def chats(self):
        return self.all("""SELECT c.*, s.last_sync_at,s.connection_status,s.error_message,
           (SELECT content FROM messages WHERE chat_id=c.id ORDER BY id DESC LIMIT 1) AS last_message,
           (SELECT delivery_status FROM messages WHERE chat_id=c.id ORDER BY id DESC LIMIT 1) AS last_delivery_status,
           (SELECT identity_quality FROM messages WHERE chat_id=c.id ORDER BY id DESC LIMIT 1) AS last_identity_quality,
           (SELECT timestamp_quality FROM messages WHERE chat_id=c.id ORDER BY id DESC LIMIT 1) AS last_timestamp_quality
           FROM chats c LEFT JOIN sync_state s ON s.chat_id=c.id ORDER BY c.last_message_at DESC, c.name""")

    def chat(self, ident):
        return self.one("SELECT * FROM chats WHERE id=?", (ident,))

    def messages(self, ident, before=None, limit=100):
        return list(reversed(self.all("SELECT * FROM messages WHERE chat_id=? AND id<? ORDER BY id DESC LIMIT ?", (ident, before or 9223372036854775807, limit))))

    @staticmethod
    def fingerprint(message: Message):
        if message.external_message_id:
            return "external:" + message.external_message_id
        raw = [message.chat_id, message.sender_id, message.direction, message.content, message.message_type, message.timestamp, message.occurrence]
        return "fingerprint:" + hashlib.sha256(json.dumps(raw, ensure_ascii=False).encode()).hexdigest()

    def ingest(self, message: Message):
        chat = self.one("SELECT id FROM chats WHERE external_id=?", (message.chat_id,))
        if not chat:
            return False
        stamp = now()
        with self.lock, self.conn:
            if message.source_key:
                previous = self.one("SELECT content,direction,sender_name,message_type FROM messages WHERE chat_id=? AND source_key=?", (chat["id"], message.source_key))
                if previous:
                    if tuple(previous[k] for k in ("content", "direction", "sender_name", "message_type")) != (message.content, message.direction, message.sender_name, message.message_type):
                        raise ValueError("source_observation_conflict")
                    return False
            cur = self.conn.execute("""INSERT OR IGNORE INTO messages
             (chat_id,external_message_id,dedupe_key,sender_id,sender_name,direction,content,message_type,timestamp,observed_at,timestamp_quality,delivery_status,identity_quality,source_key)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", (chat["id"], message.external_message_id, self.fingerprint(message), message.sender_id, message.sender_name, message.direction, message.content, message.message_type, message.timestamp, stamp, message.timestamp_quality, message.delivery_status or ("received" if message.direction == "incoming" else "confirmed"), message.identity_quality or ("external" if message.external_message_id else "fingerprint"), message.source_key))
            if cur.rowcount:
                self.conn.execute("UPDATE chats SET last_message_at=MAX(COALESCE(last_message_at,''),?),unread_count=unread_count+? WHERE id=?", (message.timestamp or stamp, int(message.direction == "incoming"), chat["id"]))
        return bool(cur.rowcount)

    def sync_complete(self, ident, cursor=None):
        with self.lock, self.conn:
            self.conn.execute("UPDATE sync_state SET last_sync_at=?,sync_cursor=?,connection_status='connected',error_message=NULL WHERE chat_id=?", (now(), cursor, ident))

    def connection(self, state, error=None):
        with self.lock, self.conn:
            self.conn.execute("UPDATE sync_state SET connection_status=?,error_message=?", (state, error))

    def mark_read(self, ident, through_id):
        with self.lock, self.conn:
            # Do not mark arrivals newer than the client's rendered snapshot as read.
            latest = self.one("SELECT MAX(id) AS n FROM messages WHERE chat_id=?", (ident,))["n"] or 0
            self.conn.execute("UPDATE chats SET read_through_id=MAX(read_through_id,?) WHERE id=?", (min(through_id, latest), ident))
            self.conn.execute("UPDATE chats SET unread_count=(SELECT COUNT(*) FROM messages WHERE chat_id=? AND direction='incoming' AND id>chats.read_through_id) WHERE id=?", (ident, ident))

    def enqueue(self, chat, content, request_id, expected_id, expected_name):
        with self.lock, self.conn:
            existing = self.one("SELECT * FROM send_queue WHERE client_request_id=?", (request_id,))
            if existing:
                if (existing["chat_id"], existing["content"], existing["expected_external_id"], existing["expected_name"]) != (chat["id"], content, expected_id, expected_name):
                    raise ValueError("idempotency_conflict")
                return existing
            if chat["external_id"] != expected_id or chat["name"] != expected_name:
                raise ValueError("destination_mismatch")
            if self.one("SELECT COUNT(*) AS n FROM send_queue WHERE status IN ('pending','sending')")["n"] >= 10:
                raise ValueError("queue_full")
            ident, stamp = str(uuid4()), now()
            cur = self.conn.execute("""INSERT INTO messages(chat_id,dedupe_key,sender_id,sender_name,direction,content,timestamp,observed_at,delivery_status,identity_quality)
              VALUES(?,?,'self','自分','outgoing',?,?,?,'pending','local')""", (chat["id"], "queue:" + ident, content, stamp, stamp))
            self.conn.execute("""INSERT INTO send_queue(id,client_request_id,chat_id,message_id,expected_external_id,expected_name,content,status,created_at)
              VALUES(?,?,?,?,?,?,?,'pending',?)""", (ident, request_id, chat["id"], cur.lastrowid, expected_id, expected_name, content, stamp))
            self.conn.execute("UPDATE chats SET last_message_at=? WHERE id=?", (stamp, chat["id"]))
            return self.one("SELECT * FROM send_queue WHERE id=?", (ident,))

    def claim(self):
        with self.lock, self.conn:
            row = self.one("SELECT * FROM send_queue WHERE status='pending' ORDER BY created_at,id LIMIT 1")
            if row:
                self.conn.execute("UPDATE send_queue SET status='sending' WHERE id=?", (row["id"],))
                self.conn.execute("UPDATE messages SET delivery_status='sending' WHERE id=?", (row["message_id"],))
            return row

    def finish(self, item, status, error=None, message=None):
        with self.lock, self.conn:
            self.conn.execute("UPDATE send_queue SET status=?,processed_at=?,error_message=? WHERE id=?", (status, now(), error, item["id"]))
            self.conn.execute("UPDATE messages SET delivery_status=? WHERE id=?", (status, item["message_id"]))
            if message:
                # Reconcile a watcher echo that arrived before the send receipt.
                self.conn.execute("DELETE FROM messages WHERE chat_id=? AND external_message_id=? AND id<>?", (item["chat_id"], message.external_message_id, item["message_id"]))
                self.conn.execute("UPDATE messages SET external_message_id=?,dedupe_key=?,timestamp=?,timestamp_quality=?,identity_quality=? WHERE id=?", (message.external_message_id, self.fingerprint(message), message.timestamp, message.timestamp_quality, "external" if message.external_message_id else "fingerprint", item["message_id"]))

    def queue(self):
        return self.all("SELECT q.*,c.name AS chat_name FROM send_queue q JOIN chats c ON c.id=q.chat_id ORDER BY q.created_at DESC LIMIT 100")

    def search(self, query, limit=100):
        escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        return self.all("SELECT m.*,c.name AS chat_name,c.type AS chat_type FROM messages m JOIN chats c ON c.id=m.chat_id WHERE m.content LIKE ? ESCAPE '\\' ORDER BY m.id DESC LIMIT ?", ("%" + escaped + "%", limit))

    def set_priority(self, chat_id, priority):
        with self.lock, self.conn:
            if priority == "auto":
                self.conn.execute("DELETE FROM chat_priorities WHERE chat_id=?", (chat_id,))
            else:
                self.conn.execute("INSERT INTO chat_priorities VALUES(?,?) ON CONFLICT(chat_id) DO UPDATE SET priority=excluded.priority", (chat_id, priority))

    def tasks(self):
        return self.all("""SELECT t.*, c.name AS chat_name, m.content AS source_content
          FROM tasks t JOIN chats c ON c.id=t.chat_id JOIN messages m ON m.id=t.source_message_id
          ORDER BY t.status='done', t.due_date IS NULL, t.due_date, t.created_at DESC, t.id""")

    def create_task(self, chat_id, source_id, title, due_date, request_id):
        with self.lock, self.conn:
            existing = self.one("SELECT * FROM tasks WHERE client_request_id=?", (request_id,))
            if existing:
                if (existing["chat_id"], existing["source_message_id"], existing["title"], existing["due_date"]) != (chat_id, source_id, title, due_date):
                    raise ValueError("idempotency_conflict")
                return existing
            source = self.one("SELECT * FROM messages WHERE id=? AND chat_id=? AND direction='incoming'", (source_id, chat_id))
            if not source:
                raise ValueError("source_mismatch")
            if self.one("SELECT id FROM tasks WHERE source_message_id=?", (source_id,)):
                raise ValueError("task_already_exists")
            ident, stamp = str(uuid4()), now()
            self.conn.execute("INSERT INTO tasks(id,client_request_id,chat_id,source_message_id,title,due_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)", (ident, request_id, chat_id, source_id, title, due_date, stamp, stamp))
            return self.one("SELECT * FROM tasks WHERE id=?", (ident,))

    def set_task_state(self, ident, state):
        with self.lock, self.conn:
            self.conn.execute("UPDATE tasks SET status=?,updated_at=? WHERE id=?", (state, now(), ident))
            return self.one("SELECT * FROM tasks WHERE id=?", (ident,))

    def ocr_receipt(self, request_id, payload_hash):
        row = self.one("SELECT * FROM ocr_requests WHERE request_id=?", (request_id,))
        if row:
            if row["payload_hash"] != payload_hash:
                raise ValueError("idempotency_conflict")
            return {"chat_id": row["chat_id"], "message_id": row["message_id"], "duplicate": True}

    def import_ocr(self, body, payload_hash, source_key, observed_at):
        """Commit reviewed content, provenance and retry receipt atomically."""
        with self.lock, self.conn:
            previous = self.ocr_receipt(body["client_request_id"], payload_hash)
            if previous:
                return previous
            existing = body.get("chat_id")
            if existing:
                chat = self.chat(existing)
                if not chat or not chat["external_id"].startswith("ocr:") or (chat["external_id"], chat["name"], chat["type"]) != (body["expected_external_id"], body["chat_name"], body["chat_type"]):
                    raise ValueError("destination_mismatch")
                ident = existing
            else:
                external = "ocr:" + body["client_request_id"]
                ident = str(uuid5(NAMESPACE_URL, external))
                self.conn.execute("""INSERT INTO chats(id,external_id,name,type,sync_status,history_note)
                  VALUES(?,?,?,?,'partial',?)""", (ident, external, body["chat_name"], body["chat_type"], "画面OCRを確認して手動保存した範囲のみ。自動同期ではありません。会話・送信者・方向は手動指定で、WeChat ID・日時・配信結果は未取得です。"))
                self.conn.execute("INSERT INTO sync_state(chat_id,connection_status) VALUES(?,'limited')", (ident,))
            source = self.one("SELECT message_id FROM ocr_sources WHERE chat_id=? AND source_key=?", (ident, source_key))
            duplicate = source is not None
            if source:
                message_id = source["message_id"]
                saved = self.one("SELECT content,direction,sender_name FROM messages WHERE id=?", (message_id,))
                if (saved["content"], saved["direction"], saved["sender_name"]) != (body["content"], body["direction"], body["sender_name"]):
                    raise ValueError("ocr_source_already_imported")
            else:
                incoming = body["direction"] == "incoming"
                message = self.conn.execute("""INSERT INTO messages(chat_id,dedupe_key,sender_id,sender_name,direction,content,message_type,timestamp,observed_at,timestamp_quality,delivery_status,identity_quality)
                  VALUES(?,?,'unverified',?,?,?,'ocr_text',NULL,?,'unavailable',?,'ocr_reviewed')""", (ident, "ocr:" + source_key, body["sender_name"], body["direction"], body["content"], observed_at, "received" if incoming else "unknown"))
                message_id = message.lastrowid
                self.conn.execute("INSERT INTO ocr_sources VALUES(?,?,?)", (ident, source_key, message_id))
                self.conn.execute("UPDATE chats SET last_message_at=MAX(COALESCE(last_message_at,''),?),unread_count=unread_count+? WHERE id=?", (observed_at, int(incoming), ident))
                self.conn.execute("UPDATE sync_state SET last_sync_at=?,connection_status='limited' WHERE chat_id=?", (observed_at, ident))
            self.conn.execute("INSERT INTO ocr_requests VALUES(?,?,?,?,?)", (body["client_request_id"], payload_hash, ident, message_id, now()))
            return {"chat_id": ident, "message_id": message_id, "duplicate": duplicate}
