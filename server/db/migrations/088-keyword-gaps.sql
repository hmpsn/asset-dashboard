-- Dedicated keyword_gaps table — normalizes keywordStrategy.keywordGaps[] out of
-- the workspace JSON blob into indexed rows.

CREATE TABLE IF NOT EXISTS keyword_gaps (
  workspace_id TEXT NOT NULL,
  keyword TEXT NOT NULL,
  volume REAL NOT NULL,
  difficulty REAL NOT NULL,
  competitor_position INTEGER NOT NULL,
  competitor_domain TEXT NOT NULL,
  PRIMARY KEY (workspace_id, keyword),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_keyword_gaps_workspace ON keyword_gaps(workspace_id);
CREATE INDEX IF NOT EXISTS idx_keyword_gaps_volume ON keyword_gaps(workspace_id, volume);
