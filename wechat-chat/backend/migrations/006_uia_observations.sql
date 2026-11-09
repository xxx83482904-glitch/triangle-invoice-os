ALTER TABLE messages ADD COLUMN source_key TEXT;
CREATE UNIQUE INDEX messages_source_observation ON messages(chat_id, source_key) WHERE source_key IS NOT NULL;
