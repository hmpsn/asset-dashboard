-- Migration 015: Keyword pre-assignment tracking on content briefs
-- Tracks whether a brief's keyword was pre-locked from a template/matrix
-- and stores SEMRush validation data.

ALTER TABLE content_briefs ADD COLUMN keyword_locked INTEGER DEFAULT 0;
ALTER TABLE content_briefs ADD COLUMN keyword_source TEXT;
ALTER TABLE content_briefs ADD COLUMN keyword_validation TEXT;
ALTER TABLE content_briefs ADD COLUMN template_id TEXT;
