-- ==============================================================================
-- Migration 017: Soft Delete Support for Comments
-- Collaborative Markdown Editor (CME)
-- ==============================================================================

-- Update comments status check constraint to include 'DELETED'
ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_status_check;
ALTER TABLE comments ADD CONSTRAINT comments_status_check CHECK (status IN ('OPEN', 'RESOLVED', 'ARCHIVED', 'DELETED'));
