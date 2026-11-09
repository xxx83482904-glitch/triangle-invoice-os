CREATE TABLE ai_jobs (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id),
    operation TEXT NOT NULL CHECK(operation IN ('translate','reply','summarize','tasks')),
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    source_message_ids TEXT NOT NULL,
    source_draft TEXT,
    context_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('processing','completed','failed','unknown')),
    result TEXT,
    error_code TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT
);
CREATE INDEX ai_jobs_chat_created ON ai_jobs(chat_id, created_at DESC);
