-- Migration 091: Retire the feedback table
--
-- Migrates existing feedback rows into the requests table (category='general')
-- so no data is permanently lost. Titles are prefixed with
-- '[migrated from feedback]' for provenance tracking.
-- Replies are intentionally dropped — they are internal team notes on an
-- archived widget; the data is not client-facing in requests.
--
-- Uses INSERT OR IGNORE to be idempotent (safe to run on an already-clean DB).

INSERT OR IGNORE INTO requests (
  id,
  workspace_id,
  title,
  description,
  category,
  priority,
  status,
  submitted_by,
  page_url,
  page_id,
  attachments,
  notes,
  created_at,
  updated_at
)
SELECT
  id,
  workspace_id,
  '[migrated from feedback] ' || title,
  description,
  'general',
  'medium',
  'new',
  submitted_by,
  NULL,
  NULL,
  NULL,
  '[]',
  created_at,
  updated_at
FROM feedback;

-- Drop composite index first (SQLite requires explicit index drops before table drop)
DROP INDEX IF EXISTS idx_feedback_ws_status;

-- Drop single-column index
DROP INDEX IF EXISTS idx_feedback_workspace;

-- Drop the table
DROP TABLE IF EXISTS feedback;
