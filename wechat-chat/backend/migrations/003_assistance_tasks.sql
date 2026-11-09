CREATE TABLE chat_priorities (
 chat_id TEXT PRIMARY KEY REFERENCES chats(id),
 priority TEXT NOT NULL CHECK(priority IN ('high','normal','low'))
);
CREATE TABLE tasks (
 id TEXT PRIMARY KEY,
 client_request_id TEXT NOT NULL UNIQUE,
 chat_id TEXT NOT NULL REFERENCES chats(id),
 source_message_id INTEGER NOT NULL UNIQUE REFERENCES messages(id),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 due_date TEXT,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done')),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX tasks_status_due ON tasks(status, due_date);
