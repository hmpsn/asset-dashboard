-- Add composite index for getReportForInsight(workspaceId, insightId) query performance.
-- SQLite does not support adding FOREIGN KEY constraints via ALTER TABLE without
-- recreating the table; the workspace_id FK in migration 059 covers cascade deletes.
-- This index makes the per-insight lookup O(log n) instead of a full workspace scan.
CREATE INDEX IF NOT EXISTS idx_diagnostic_reports_insight
  ON diagnostic_reports(workspace_id, insight_id);
