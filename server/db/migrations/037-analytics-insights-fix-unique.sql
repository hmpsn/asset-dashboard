-- Fix analytics_insights unique constraint: replace the inline
-- UNIQUE(workspace_id, page_id, insight_type) — which treats NULL page_ids
-- as distinct — with an expression-based index using COALESCE so that
-- workspace-level insights (null page_id) are correctly deduplicated.
--
-- SQLite doesn't support DROP CONSTRAINT, so we recreate the table.

CREATE TABLE analytics_insights_new (
  id           TEXT NOT NULL PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  page_id      TEXT,
  insight_type TEXT NOT NULL,
  data         TEXT NOT NULL,
  severity     TEXT NOT NULL,
  computed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO analytics_insights_new SELECT * FROM analytics_insights;

DROP TABLE analytics_insights;

ALTER TABLE analytics_insights_new RENAME TO analytics_insights;

CREATE UNIQUE INDEX idx_insights_unique
  ON analytics_insights(workspace_id, COALESCE(page_id, '__workspace__'), insight_type);

CREATE INDEX idx_insights_workspace
  ON analytics_insights(workspace_id, insight_type);
