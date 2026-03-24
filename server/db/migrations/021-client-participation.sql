-- Migration 021: Client strategy participation
-- Stores client business priorities and content gap votes
-- to put clients in the driver's seat for strategy generation.

CREATE TABLE IF NOT EXISTS client_business_priorities (
  workspace_id TEXT PRIMARY KEY,
  priorities TEXT NOT NULL DEFAULT '[]',  -- JSON array of {text, category}
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS content_gap_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  keyword TEXT NOT NULL,
  vote TEXT NOT NULL CHECK(vote IN ('up', 'down')),
  voted_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(workspace_id, keyword)
);

CREATE INDEX IF NOT EXISTS idx_content_gap_votes_ws ON content_gap_votes(workspace_id);
