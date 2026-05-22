CREATE TABLE IF NOT EXISTS discovered_queries (
  workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  query             TEXT NOT NULL,
  first_seen        TEXT NOT NULL,
  last_seen         TEXT NOT NULL,
  best_position     REAL,
  best_impressions  INTEGER NOT NULL DEFAULT 0,
  total_impressions INTEGER NOT NULL DEFAULT 0,
  snapshot_count    INTEGER NOT NULL DEFAULT 1,
  last_snapshot_date TEXT,
  last_snapshot_impressions INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'active',
  PRIMARY KEY (workspace_id, query)
);

CREATE INDEX IF NOT EXISTS idx_discovered_queries_workspace_status
  ON discovered_queries (workspace_id, status);
