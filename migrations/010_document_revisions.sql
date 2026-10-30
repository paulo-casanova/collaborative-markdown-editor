-- ==============================================================================
-- Migration 010: Document Revisions & Historical Snapshot Tracking
-- Collaborative Markdown Editor (CME)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS document_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    revision_number INT NOT NULL,
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    author_name VARCHAR(128) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb,
    CONSTRAINT uq_doc_revision UNIQUE (document_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_doc_revisions_doc ON document_revisions(document_id, revision_number DESC);
CREATE INDEX IF NOT EXISTS idx_doc_revisions_created_at ON document_revisions(created_at);
