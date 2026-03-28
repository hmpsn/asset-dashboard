-- Migration 030: Strategy history for diff tracking
-- Stores previous strategy snapshots so we can show "What Changed" between generations.

CREATE TABLE IF NOT EXISTS strategy_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  strategy_json TEXT NOT NULL,
  page_map_json TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_strategy_history_ws ON strategy_history(workspace_id);
