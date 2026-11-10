ALTER TABLE messages ADD COLUMN historical INTEGER NOT NULL DEFAULT 0 CHECK(historical IN (0,1));
CREATE INDEX messages_chronology ON messages(chat_id,COALESCE(timestamp,observed_at),id);
CREATE TABLE backup_inspections (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 inspected_at TEXT NOT NULL,
 report TEXT NOT NULL
);
