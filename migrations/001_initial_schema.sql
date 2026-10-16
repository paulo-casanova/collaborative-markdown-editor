-- ==============================================================================
-- Migration 001: Initial Relational Schema
-- Collaborative Markdown Editor (CME)
-- Note: gen_random_uuid() is built-in to PostgreSQL core (>= pg 13).
-- ==============================================================================

-- Migration tracking table
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Identity & Access Control: Users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(64) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(128) NOT NULL,
    avatar_color VARCHAR(7) NOT NULL DEFAULT '#3b82f6',
    is_system_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Identity & Access Control: Teams
CREATE TABLE IF NOT EXISTS teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(128) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Team Memberships (Users belonging to Teams)
CREATE TABLE IF NOT EXISTS team_members (
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(32) NOT NULL DEFAULT 'member',
    PRIMARY KEY (team_id, user_id)
);

-- Multi-Parent Team Hierarchies (Directed Acyclic Graph - DAG)
-- Allows a child team to inherit from multiple parent teams
CREATE TABLE IF NOT EXISTS team_parents (
    parent_team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    child_team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    PRIMARY KEY (parent_team_id, child_team_id),
    CONSTRAINT chk_no_self_parent CHECK (parent_team_id <> child_team_id)
);

-- Document Registry (maps filesystem paths to immutable UUIDs)
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fs_path TEXT UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    owner_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Granular Permissions (Document & Directory ACLs)
CREATE TABLE IF NOT EXISTS permissions (
    id BIGSERIAL PRIMARY KEY,
    target_type VARCHAR(16) NOT NULL CHECK (target_type IN ('DOCUMENT', 'DIRECTORY')),
    target_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    directory_path TEXT,
    grantee_type VARCHAR(16) NOT NULL CHECK (grantee_type IN ('USER', 'TEAM')),
    grantee_id UUID NOT NULL,
    access_level VARCHAR(16) NOT NULL CHECK (access_level IN ('READ', 'COMMENT', 'EDIT', 'ADMIN')),
    CONSTRAINT chk_target_spec CHECK (
        (target_type = 'DOCUMENT' AND target_id IS NOT NULL) OR
        (target_type = 'DIRECTORY' AND directory_path IS NOT NULL)
    )
);

-- Review Subsystem: Threaded Comments
CREATE TABLE IF NOT EXISTS comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
    anchor JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Review Subsystem: Inline Edit Suggestions
CREATE TABLE IF NOT EXISTS suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
    original_text TEXT NOT NULL,
    suggested_text TEXT NOT NULL,
    anchor JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

-- Review Subsystem: Action Item Tasks
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    comment_id UUID REFERENCES comments(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    due_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- User Sessions & API Tokens
CREATE TABLE IF NOT EXISTS sessions (
    token_hash VARCHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address INET,
    user_agent TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_team_parents_child ON team_parents(child_team_id);
CREATE INDEX IF NOT EXISTS idx_team_parents_parent ON team_parents(parent_team_id);
CREATE INDEX IF NOT EXISTS idx_documents_fs_path ON documents(fs_path);
CREATE INDEX IF NOT EXISTS idx_permissions_doc ON permissions(target_id) WHERE target_type = 'DOCUMENT';
CREATE INDEX IF NOT EXISTS idx_permissions_dir ON permissions(directory_path) WHERE target_type = 'DIRECTORY';
CREATE INDEX IF NOT EXISTS idx_permissions_grantee ON permissions(grantee_type, grantee_id);
CREATE INDEX IF NOT EXISTS idx_comments_document_id ON comments(document_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_document_id ON suggestions(document_id);
CREATE INDEX IF NOT EXISTS idx_tasks_document_id ON tasks(document_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_id ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
