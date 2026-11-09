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
           (SELECT delivery_status FROM messages WHERE chat_id=c.id ORDER BY id DESC LIMIT 1) AS last_delivery_status
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
            cur = self.conn.execute("""INSERT OR IGNORE INTO messages
             (chat_id,external_message_id,dedupe_key,sender_id,sender_name,direction,content,message_type,timestamp,observed_at,timestamp_quality,delivery_status,identity_quality)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""", (chat["id"], message.external_message_id, self.fingerprint(message), message.sender_id, message.sender_name, message.direction, message.content, message.message_type, message.timestamp, stamp, message.timestamp_quality, "received" if message.direction == "incoming" else "confirmed", "external" if message.external_message_id else "fingerprint"))
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
