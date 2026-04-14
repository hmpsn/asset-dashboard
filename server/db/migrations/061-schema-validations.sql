CREATE TABLE IF NOT EXISTS schema_validations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  status TEXT NOT NULL,          -- valid | warnings | errors
  rich_results TEXT,             -- JSON: array of detected rich result types
  errors TEXT,                   -- JSON: array of error objects
  warnings TEXT,                 -- JSON: array of warning objects
  validated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(workspace_id, page_id)
);
