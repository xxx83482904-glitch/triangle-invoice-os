CREATE TABLE IF NOT EXISTS attachments (
 id TEXT PRIMARY KEY,
 message_id INTEGER NOT NULL UNIQUE REFERENCES messages(id),
 kind TEXT NOT NULL,
 status TEXT NOT NULL,
 filename TEXT,
 mime_type TEXT,
 size_bytes INTEGER,
 storage_key TEXT,
 transcript TEXT,
 error_code TEXT,
 updated_at TEXT NOT NULL
);
