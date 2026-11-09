CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chats (
 id TEXT PRIMARY KEY, external_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 type TEXT NOT NULL CHECK(type IN ('individual','group')),
 last_message_at TEXT, sync_status TEXT NOT NULL DEFAULT 'partial',
 history_note TEXT NOT NULL, member_count INTEGER,
 unread_count INTEGER NOT NULL DEFAULT 0 CHECK(unread_count >= 0)
);
CREATE TABLE IF NOT EXISTS messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL REFERENCES chats(id),
 external_message_id TEXT, dedupe_key TEXT NOT NULL,
 sender_id TEXT NOT NULL, sender_name TEXT NOT NULL,
 direction TEXT NOT NULL CHECK(direction IN ('incoming','outgoing')),
 content TEXT NOT NULL, message_type TEXT NOT NULL DEFAULT 'text',
 timestamp TEXT, observed_at TEXT NOT NULL, timestamp_quality TEXT NOT NULL DEFAULT 'exact',
 delivery_status TEXT NOT NULL CHECK(delivery_status IN ('received','pending','sending','confirmed','unknown','failed')),
 identity_quality TEXT NOT NULL,
 UNIQUE(chat_id, external_message_id), UNIQUE(chat_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS messages_chat_time ON messages(chat_id, id);
CREATE TABLE IF NOT EXISTS send_queue (
 id TEXT PRIMARY KEY, client_request_id TEXT NOT NULL UNIQUE,
 chat_id TEXT NOT NULL REFERENCES chats(id), message_id INTEGER NOT NULL REFERENCES messages(id),
 expected_external_id TEXT NOT NULL, expected_name TEXT NOT NULL, content TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','sending','confirmed','unknown','failed')),
 retry_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, processed_at TEXT, error_message TEXT
);
CREATE INDEX IF NOT EXISTS queue_status ON send_queue(status, created_at);
CREATE TABLE IF NOT EXISTS sync_state (
 chat_id TEXT PRIMARY KEY REFERENCES chats(id), last_sync_at TEXT, sync_cursor TEXT,
 connection_status TEXT NOT NULL, error_message TEXT
);
