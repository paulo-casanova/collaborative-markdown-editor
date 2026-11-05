-- ==============================================================================
-- Migration 013: Document Checkouts & Binary Revision History
-- Collaborative Markdown Editor (CME)
-- ==============================================================================

-- 1. Document Checkouts / Exclusive Locks (for binary/non-markdown files)
CREATE TABLE IF NOT EXISTS document_checkouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    fs_path TEXT UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    checked_out_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_checkouts_user ON document_checkouts(user_id);
CREATE INDEX IF NOT EXISTS idx_checkouts_path ON document_checkouts(fs_path);

-- 2. Binary Document Historical Revisions
CREATE TABLE IF NOT EXISTS binary_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    fs_path TEXT NOT NULL,
    revision_number INT NOT NULL,
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    author_name VARCHAR(128) NOT NULL,
    storage_path TEXT NOT NULL,
    byte_size BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    change_summary TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    CONSTRAINT uq_binary_revision UNIQUE (fs_path, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_binary_revisions_path ON binary_revisions(fs_path, revision_number DESC);
CREATE INDEX IF NOT EXISTS idx_binary_revisions_doc ON binary_revisions(document_id, revision_number DESC);
