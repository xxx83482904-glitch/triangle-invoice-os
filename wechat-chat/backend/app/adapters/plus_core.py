"""SDK-independent Plus supervisor. No automatic replies or authentication.

Only an explicit queue command can reach the sender. The SDK runs in a separate
process; this module is also exercised with a synthetic SDK on every platform.
"""
from collections import Counter
from dataclasses import asdict
import hashlib
import json
from pathlib import Path
import sqlite3
import time

from .base import Chat, Message, Receipt


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


class PlusFailure(Exception):
    """Only allowlisted codes, never SDK exceptions, cross the process boundary."""


DETAILS = {
    "ready": "Plusで登録済みの会話を監視しています。取得範囲は部分的です。",
    "activation_required": "Plusの購入・このPCでのライセンス認証が必要です。",
    "dependency_missing": "Plusの隔離環境をセットアップしてください。",
    "unsupported_os": "Plus連携にはWindowsが必要です。",
    "connecting": "Plusの接続とログイン状態を確認しています。",
    "not_running": "WeChatの起動を待っています。起動・本人のログイン後に再接続します。",
    "login_required": "正規WeChatで本人のログインが必要です。認証は自動操作しません。",
    "account_unavailable": "ログイン中のアカウントIDを確認できないため停止しています。",
    "account_mismatch": "登録したアカウントと一致しません。別アカウントの履歴は取り込みません。",
    "binding_unavailable": "会話の宛先・画面情報を照合できないため監視を停止しました。実機での互換性確認が必要です。",
    "sdk_unavailable": "Plusに接続できません。ライセンスとWeChatの対応版を確認してください。",
    "worker_timeout": "Plusの応答が時間内に完了しませんでした。間隔を空けて再接続します。",
    "buffer_full": "未保存の受信が上限に達しました。完全同期とは扱わず再接続します。",
    "paused": "Plusの監視を停止しています。",
}
HISTORY = ("Plusで開いた会話ウィンドウから取得した範囲のみ。監視外・画面外・切断中の履歴は未取得です。"
           "宛先とメッセージのIDはUI部品から作る内部IDです。WeChatの再起動や部品再生成後は別の会話として保持し、同名だけで結合しません。")


class PlusStore:
    """Private, durable account pin, inbox and at-most-once send ledger."""
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            PRAGMA journal_mode=WAL;
            PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, receipt TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS inbox(id INTEGER PRIMARY KEY AUTOINCREMENT, source_key TEXT UNIQUE NOT NULL, payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS bindings(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        """)

    def pin(self, account):
        if not isinstance(account, str) or not account.strip():
            raise PlusFailure("account_unavailable")
        key = digest(["account", account])
        row = self.db.execute("SELECT value FROM meta WHERE key='account'").fetchone()
        if row and row[0] != key:
            raise PlusFailure("account_mismatch")
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO meta VALUES('account',?)", (key,))
        return key

    def bind(self, chat):
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO bindings VALUES(?,?)", (chat.external_id, json.dumps(asdict(chat), ensure_ascii=False)))

    def chats(self):
        return [json.loads(r[0]) for r in self.db.execute("SELECT payload FROM bindings ORDER BY id")]

    def ingest(self, message):
        if not message.source_key:
            raise PlusFailure("sdk_unavailable")
        payload = json.dumps(asdict(message), ensure_ascii=False)
        with self.db:
            previous = self.db.execute("SELECT payload FROM inbox WHERE source_key=?", (message.source_key,)).fetchone()
            if previous:
                if previous[0] != payload:
                    raise PlusFailure("sdk_unavailable")
                return
            if self.db.execute("SELECT COUNT(*) FROM inbox").fetchone()[0] >= 2000:
                raise PlusFailure("buffer_full")
            self.db.execute("INSERT INTO inbox(source_key,payload) VALUES(?,?)", (message.source_key, payload))

    def inbox(self):
        return [{"sequence": r[0], "message": json.loads(r[1])} for r in self.db.execute("SELECT id,payload FROM inbox ORDER BY id LIMIT 100")]

    def ack(self, sequences):
        with self.db:
            self.db.executemany("DELETE FROM inbox WHERE id=?", ((s,) for s in sequences))

    def previous(self, request_id, fingerprint):
        row = self.db.execute("SELECT fingerprint,receipt FROM attempts WHERE id=?", (request_id,)).fetchone()
        if not row:
            return None
        if row[0] != fingerprint:
            return Receipt("failed", error="idempotency_conflict")
        data = json.loads(row[1])
        if data.get("message"):
            data["message"] = Message(**data["message"])
        return Receipt(**data)

    def record(self, request_id, fingerprint, receipt):
        with self.db:
            self.db.execute("INSERT INTO attempts VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET receipt=excluded.receipt",
                            (request_id, fingerprint, json.dumps(asdict(receipt), ensure_ascii=False)))

    def close(self):
        self.db.close()


class PlusSupervisor:
    def __init__(self, factory, store, *, send_enabled=False, max_listeners=8, clock=time.monotonic):
        self.factory, self.store, self.clock = factory, store, clock
        self.send_enabled = send_enabled
        self.max_listeners = min(32, max(1, max_listeners))
        self.sdk = None
        self.state, self.scope, self.account, self.version = "connecting", None, None, None
        self.targets = {}
        self.discovered, self.ambiguous, self.failed = 0, 0, 0
        self.next_connect = self.next_discover = self.next_register = 0.0
        self.backoff, self.reconnects = 5, 0
        self.candidates = []
        self.attempted = set()

    def close(self):
        if self.sdk is not None:
            try:
                self.sdk.close()  # StopListening only; never close WeChat itself.
            except Exception:
                pass
        self.sdk, self.targets, self.candidates = None, {}, []
        self.attempted.clear()

    def _failed(self, code):
        self.close()
        self.state = code if code in DETAILS else "sdk_unavailable"
        self.next_connect = self.clock() + self.backoff
        self.backoff = min(120, self.backoff * 2)

    def tick(self):
        try:
            if self.sdk is None:
                if self.clock() < self.next_connect or self.state in ("account_mismatch", "binding_unavailable"):
                    return
                self.sdk = self.factory()
                self.scope, account, self.version = self.sdk.connect()
                self.account = self.store.pin(account)
                self.reconnects += 1
                self.next_discover = 0
            if self.sdk.check_scope() != self.scope:
                raise PlusFailure("not_running")
            if self.clock() >= self.next_discover:
                sessions = self.sdk.sessions()
                counts = Counter(sessions)
                self.discovered = len(sessions)
                self.ambiguous = sum(n for n in counts.values() if n > 1)
                self.candidates = [name for name, n in counts.items() if n == 1]
                self.attempted.clear()
                self.next_discover = self.clock() + 60
            # At most one new window every ten seconds. Resource limits are
            # reported as missing coverage, never silently called "all chats".
            if len(self.targets) < self.max_listeners and self.clock() >= self.next_register:
                names = [n for n in self.candidates if n not in self.attempted and n not in {t['name'] for t in self.targets.values()}]
                if names:
                    name = names[0]
                    self.attempted.add(name)
                    self.next_register = self.clock() + 10
                    try:
                        target = self.sdk.listen(name)
                        if target["name"] != name or target["type"] not in ("individual", "group") or not target["binding"]:
                            raise ValueError()
                        ident = "wxautox4:local:" + digest([self.account, self.scope, target["binding"], name, target["type"]])
                        target["id"] = ident
                        history = self.sdk.history(target)
                        self.store.bind(Chat(ident, name, target["type"], history_note=HISTORY, member_count=target.get("member_count")))
                        for message in history:
                            self.store.ingest(message)
                        self.targets[ident] = target
                    except PlusFailure:
                        raise
                    except Exception:
                        self.failed += 1
                        raise PlusFailure("binding_unavailable") from None
            for message in self.sdk.drain(self.targets):
                self.store.ingest(message)
            self.state = "ready"
            self.backoff = 5
        except PlusFailure as exc:
            self._failed(str(exc))
        except Exception:
            self._failed("sdk_unavailable")

    def snapshot(self):
        return {"state": self.state, "version": self.version,
                "can_send": self.state == "ready" and self.send_enabled and bool(self.targets),
                "chats": self.store.chats(), "events": self.store.inbox(),
                "monitoring": {"registered": len(self.targets), "discovered": self.discovered,
                               "ambiguous": self.ambiguous, "registration_failures": self.failed,
                               "limit": self.max_listeners, "reconnections": max(0, self.reconnects - 1),
                               "scope": "visible_sessions", "complete": False,
                               "active_chat_ids": list(self.targets)}}

    def send(self, request_id, chat_id, text):
        fingerprint = digest([chat_id, text])
        previous = self.store.previous(request_id, fingerprint)
        if previous:
            return previous
        if not self.send_enabled or self.state != "ready" or self.sdk is None:
            return Receipt("failed", error="sending_unavailable")
        target = self.targets.get(chat_id)
        if not target:
            return Receipt("failed", error="destination_mismatch")
        try:
            if self.sdk.check_scope() != self.scope:
                raise PlusFailure("not_running")
            if self.store.pin(self.sdk.account_id()) != self.account:
                raise PlusFailure("account_mismatch")
            # A live window binding and an empty draft are required. No name-only
            # search, implicit recipient selection or clearing the user's draft.
            self.sdk.verify(target)
            before = self.sdk.history(target)
            self.sdk.verify(target)
        except PlusFailure as exc:
            self._failed(str(exc))
            return Receipt("failed", error="destination_mismatch")
        except Exception:
            return Receipt("failed", error="destination_mismatch")
        receipt = Receipt("unknown", error="send_result_unavailable")
        # Commit BEFORE the SDK can press Send. A crash after this point cannot
        # cause the same request to invoke SendMsg again, even across processes.
        self.store.record(request_id, fingerprint, receipt)
        try:
            result = self.sdk.send_once(target, text)
            after = self.sdk.history(target)
            old_keys = {m.source_key for m in before}
            echoes = [m for m in after if m.source_key and m.source_key not in old_keys and m.chat_id == chat_id
                      and m.content == text and m.direction == "outgoing"]
            if result is True and len(echoes) == 1 and self.sdk.check_scope() == self.scope:
                self.sdk.verify(target)
                receipt = Receipt("confirmed", echoes[0])
        except Exception:
            pass
        self.store.record(request_id, fingerprint, receipt)
        return receipt
