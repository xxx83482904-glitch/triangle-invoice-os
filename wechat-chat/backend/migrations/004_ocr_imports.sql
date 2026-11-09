CREATE TABLE ocr_sources (
 chat_id TEXT NOT NULL REFERENCES chats(id),
 source_key TEXT NOT NULL,
 message_id INTEGER NOT NULL REFERENCES messages(id),
 PRIMARY KEY(chat_id, source_key)
);
CREATE TABLE ocr_requests (
 request_id TEXT PRIMARY KEY,
 payload_hash TEXT NOT NULL,
 chat_id TEXT NOT NULL REFERENCES chats(id),
 message_id INTEGER NOT NULL REFERENCES messages(id),
 created_at TEXT NOT NULL
);
