-- Migration 015: Markdown Tasks Support
-- Extends tasks table to store tasks parsed from Markdown documents

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'review';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS line_number INT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS raw_line TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS heading_anchor VARCHAR(255);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS fingerprint VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks(source);
CREATE INDEX IF NOT EXISTS idx_tasks_doc_source ON tasks(document_id, source);
CREATE INDEX IF NOT EXISTS idx_tasks_fingerprint ON tasks(fingerprint);
