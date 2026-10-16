-- Migration 003: Document-level header numbering metadata
ALTER TABLE documents
ADD COLUMN IF NOT EXISTS number_headers BOOLEAN NOT NULL DEFAULT FALSE;
