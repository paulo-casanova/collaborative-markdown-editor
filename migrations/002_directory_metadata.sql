-- Directory Metadata & Ownership Registry
CREATE TABLE IF NOT EXISTS directory_metadata (
    directory_path TEXT PRIMARY KEY,
    owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    owner_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_directory_metadata_path ON directory_metadata(directory_path);
CREATE INDEX IF NOT EXISTS idx_directory_metadata_owner_user ON directory_metadata(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_directory_metadata_owner_team ON directory_metadata(owner_team_id);
