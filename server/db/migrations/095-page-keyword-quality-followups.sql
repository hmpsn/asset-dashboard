-- Output quality follow-ups:
-- 1. URL-level provider keywords for page-specific keyword assignment.
-- 2. Append-only optimization score history for Page Intelligence trends.

ALTER TABLE page_keywords ADD COLUMN url_level_keywords TEXT;
ALTER TABLE page_keywords ADD COLUMN url_level_keyword_source TEXT;

CREATE TABLE IF NOT EXISTS page_keyword_score_history (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  page_path TEXT NOT NULL,
  optimization_score INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'unknown',
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_page_keyword_score_history_workspace_page
  ON page_keyword_score_history(workspace_id, page_path, recorded_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_page_keyword_score_history_unique_snapshot
  ON page_keyword_score_history(workspace_id, page_path, recorded_at, optimization_score);
