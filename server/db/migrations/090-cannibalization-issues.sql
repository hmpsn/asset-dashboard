-- Dedicated cannibalization_issues table — normalizes
-- keywordStrategy.cannibalization[] out of the workspace JSON blob into
-- indexed rows.

CREATE TABLE IF NOT EXISTS cannibalization_issues (
  workspace_id TEXT NOT NULL,
  keyword TEXT NOT NULL,
  pages_json TEXT NOT NULL, -- JSON array of { path, position?, impressions?, clicks?, source }
  severity TEXT NOT NULL, -- high | medium | low
  recommendation TEXT NOT NULL,
  PRIMARY KEY (workspace_id, keyword),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cannibalization_issues_workspace
  ON cannibalization_issues(workspace_id);
CREATE INDEX IF NOT EXISTS idx_cannibalization_issues_severity
  ON cannibalization_issues(workspace_id, severity);
