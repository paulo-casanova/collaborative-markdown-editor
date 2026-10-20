-- Migration 006: Instance lease table for single-instance protection
CREATE TABLE IF NOT EXISTS instance_lease (
    lease_name VARCHAR(64) PRIMARY KEY,
    holder_id VARCHAR(128) NOT NULL,
    acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    renewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);
