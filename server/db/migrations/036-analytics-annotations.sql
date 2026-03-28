CREATE TABLE IF NOT EXISTS analytics_annotations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  date TEXT NOT NULL,
  label TEXT NOT NULL,
  category TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_annotations_workspace ON analytics_annotations(workspace_id, date);
