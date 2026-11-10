CREATE TABLE IF NOT EXISTS push_subscriptions (
 id TEXT PRIMARY KEY,
 endpoint TEXT NOT NULL UNIQUE,
 p256dh TEXT NOT NULL,
 auth TEXT NOT NULL,
 session_hash TEXT NOT NULL,
 origin TEXT NOT NULL,
 created_at TEXT NOT NULL,
 last_status TEXT NOT NULL DEFAULT 'registered'
);
CREATE TABLE IF NOT EXISTS notification_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 message_id INTEGER NOT NULL UNIQUE REFERENCES messages(id),
 chat_id TEXT NOT NULL REFERENCES chats(id),
 created_at TEXT NOT NULL,
 processed_at TEXT
);
