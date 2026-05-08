-- Dedicated quick_wins table — normalizes keywordStrategy.quickWins[] out of
-- workspaces.keyword_strategy JSON blob into indexed rows.

CREATE TABLE IF NOT EXISTS quick_wins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  page_path TEXT NOT NULL,
  current_keyword TEXT,
  action TEXT NOT NULL,
  estimated_impact TEXT NOT NULL CHECK (estimated_impact IN ('high', 'medium', 'low')),
  rationale TEXT NOT NULL,
  roi_score REAL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quick_wins_workspace ON quick_wins(workspace_id);
CREATE INDEX IF NOT EXISTS idx_quick_wins_roi ON quick_wins(workspace_id, roi_score);
