-- Migration 004: Add is_inheritable flag to permissions table
-- Allows directory ACL entries to be marked as non-inheriting (applying only to the directory itself)
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS is_inheritable BOOLEAN NOT NULL DEFAULT TRUE;
