-- ==============================================================================
-- Migration 016: Session Token Metadata
-- Adds name/description, token_prefix, and last_used_at to sessions table
-- ==============================================================================

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS name VARCHAR(128) NOT NULL DEFAULT 'Personal Access Token';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS token_prefix VARCHAR(16);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sessions_last_used_at ON sessions(last_used_at);
