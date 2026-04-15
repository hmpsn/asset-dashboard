-- Phase 5: llms.txt freshness tracking
CREATE TABLE IF NOT EXISTS llms_txt_freshness (
  workspace_id TEXT PRIMARY KEY,
  last_generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  trigger TEXT
);
