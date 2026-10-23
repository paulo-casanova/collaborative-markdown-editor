-- Migration 007: Allow EVERYONE grantee type in permissions table
-- Allows permissions to be granted to all authenticated users ('EVERYONE') without requiring a specific grantee_id

ALTER TABLE permissions DROP CONSTRAINT IF EXISTS permissions_grantee_type_check;
ALTER TABLE permissions ADD CONSTRAINT permissions_grantee_type_check CHECK (grantee_type IN ('USER', 'TEAM', 'EVERYONE'));

ALTER TABLE permissions ALTER COLUMN grantee_id DROP NOT NULL;

ALTER TABLE permissions DROP CONSTRAINT IF EXISTS chk_grantee_spec;
ALTER TABLE permissions ADD CONSTRAINT chk_grantee_spec CHECK (
    (grantee_type IN ('USER', 'TEAM') AND grantee_id IS NOT NULL) OR
    (grantee_type = 'EVERYONE')
);
