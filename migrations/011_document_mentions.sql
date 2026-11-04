-- ==============================================================================
-- Migration 011: Document Mentions & Notification Tracking
-- Collaborative Markdown Editor (CME)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS document_mentions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    heading_anchor TEXT,
    context_snippet TEXT NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'UNREAD' CHECK (status IN ('UNREAD', 'SEEN', 'ACKNOWLEDGED')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    CONSTRAINT uq_doc_mention_fingerprint UNIQUE (document_id, recipient_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_doc_mentions_recipient ON document_mentions(recipient_id, status);
CREATE INDEX IF NOT EXISTS idx_doc_mentions_doc ON document_mentions(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_mentions_created ON document_mentions(created_at DESC);
