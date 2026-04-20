-- 066-content-briefs-status.sql
-- Add status column to content_briefs for lifecycle tracking.
-- Existing briefs default to 'draft' (already generated, awaiting use).
-- Values: draft | ai_generated | in_review | approved
ALTER TABLE content_briefs ADD COLUMN status TEXT NOT NULL DEFAULT 'draft';
CREATE INDEX IF NOT EXISTS idx_content_briefs_status ON content_briefs(workspace_id, status);
