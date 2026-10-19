-- Migration 005: Allow ARCHIVED status for comments and suggestions
ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_status_check;
ALTER TABLE comments ADD CONSTRAINT comments_status_check CHECK (status IN ('OPEN', 'RESOLVED', 'ARCHIVED'));

ALTER TABLE suggestions DROP CONSTRAINT IF EXISTS suggestions_status_check;
ALTER TABLE suggestions ADD CONSTRAINT suggestions_status_check CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'ARCHIVED'));
