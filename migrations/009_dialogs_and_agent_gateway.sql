-- ==============================================================================
-- Migration 009: Dialogs, User-Document Preferences, Messages & Agent Tokens
-- Collaborative Markdown Editor (CME)
-- ==============================================================================

-- 1. First-class conversational dialog threads (private to each user)
CREATE TABLE IF NOT EXISTS dialogs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL DEFAULT 'New Dialog',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dialogs_user_id ON dialogs(user_id);
CREATE INDEX IF NOT EXISTS idx_dialogs_updated_at ON dialogs(updated_at);

-- 2. User-to-document dialog preference tracking
-- Remembers the dialog last selected by a user when viewing a document
CREATE TABLE IF NOT EXISTS user_document_dialogs (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    last_dialog_id UUID REFERENCES dialogs(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_user_doc_dialogs_last_dialog_id ON user_document_dialogs(last_dialog_id);

-- 3. Chronological message history within a dialog
CREATE TABLE IF NOT EXISTS dialog_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dialog_id UUID NOT NULL REFERENCES dialogs(id) ON DELETE CASCADE,
    role VARCHAR(16) NOT NULL,
    content TEXT NOT NULL,
    context_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dialog_messages_dialog_id ON dialog_messages(dialog_id);
CREATE INDEX IF NOT EXISTS idx_dialog_messages_created_at ON dialog_messages(created_at);

-- 4. User local agent pairing tokens
CREATE TABLE IF NOT EXISTS agent_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(128) NOT NULL DEFAULT 'Default Local Agent',
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_tokens_user_id ON agent_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_tokens_token_hash ON agent_tokens(token_hash);
