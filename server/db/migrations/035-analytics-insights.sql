-- Analytics intelligence snapshots computed from GSC/GA4 data.
-- One row per (workspace, page, insight_type). Upserted on each refresh.
CREATE TABLE IF NOT EXISTS analytics_insights (
  id           TEXT NOT NULL PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  page_id      TEXT,              -- NULL for workspace-level insights
  insight_type TEXT NOT NULL,     -- page_health | quick_win | content_decay | cannibalization | keyword_cluster | competitor_gap | conversion_attribution
  data         TEXT NOT NULL,     -- JSON blob
  severity     TEXT NOT NULL,     -- critical | warning | opportunity | positive
  computed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Use COALESCE so that NULL page_id values are treated as equal for uniqueness.
-- (SQLite treats bare NULLs as distinct in UNIQUE constraints.)
CREATE UNIQUE INDEX IF NOT EXISTS idx_insights_unique
  ON analytics_insights(workspace_id, COALESCE(page_id, '__workspace__'), insight_type);

CREATE INDEX IF NOT EXISTS idx_insights_workspace
  ON analytics_insights(workspace_id, insight_type);
