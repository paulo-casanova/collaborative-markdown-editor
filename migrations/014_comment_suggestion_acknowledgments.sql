-- ==============================================================================
-- Migration 014: Comment and Suggestion User Acknowledgements
-- Collaborative Markdown Editor (CME)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS comment_user_acks (
    comment_id UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (comment_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_comment_user_acks_user ON comment_user_acks(user_id);

CREATE TABLE IF NOT EXISTS suggestion_user_acks (
    suggestion_id UUID NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (suggestion_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_suggestion_user_acks_user ON suggestion_user_acks(user_id);
