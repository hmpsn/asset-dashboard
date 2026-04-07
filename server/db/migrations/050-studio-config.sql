-- Studio-level configuration key-value store.
-- Holds settings that apply globally across all workspaces (e.g. booking URL).
CREATE TABLE IF NOT EXISTS studio_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
