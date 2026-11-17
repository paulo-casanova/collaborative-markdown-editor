-- ==============================================================================
-- Migration 018: Document Links Index
-- Collaborative Markdown Editor (CME)
-- Caches outbound hyperlinks/wikilinks per document for fast backlink lookup
-- and O(1) file/folder rename performance.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS document_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_doc_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    target_raw TEXT NOT NULL,
    target_norm TEXT NOT NULL,
    target_stem TEXT NOT NULL,
    link_type VARCHAR(16) NOT NULL DEFAULT 'WIKILINK',
    is_embed BOOLEAN NOT NULL DEFAULT FALSE,
    line_number INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_doc_link_unique UNIQUE (source_doc_id, target_norm, target_stem, is_embed, line_number)
);

CREATE INDEX IF NOT EXISTS idx_doc_links_source ON document_links(source_doc_id);
CREATE INDEX IF NOT EXISTS idx_doc_links_target_norm ON document_links(target_norm);
CREATE INDEX IF NOT EXISTS idx_doc_links_target_stem ON document_links(target_stem);
CREATE INDEX IF NOT EXISTS idx_doc_links_type ON document_links(link_type);
