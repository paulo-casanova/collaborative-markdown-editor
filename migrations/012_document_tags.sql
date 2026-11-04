-- ==============================================================================
-- Migration 012: Document Tags Metadata Tracking
-- Collaborative Markdown Editor (CME)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS document_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    tag VARCHAR(128) NOT NULL,
    heading_anchor TEXT,
    line_number INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_doc_tag UNIQUE (document_id, tag, heading_anchor, line_number)
);

CREATE INDEX IF NOT EXISTS idx_doc_tags_tag ON document_tags(tag);
CREATE INDEX IF NOT EXISTS idx_doc_tags_doc ON document_tags(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_tags_doc_tag ON document_tags(document_id, tag);
