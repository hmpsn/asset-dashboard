CREATE TABLE IF NOT EXISTS competitor_snapshots (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  competitor_domain TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  keyword_count INTEGER,
  organic_traffic INTEGER,
  top_keywords TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_competitor_snapshots_ws_domain_date
  ON competitor_snapshots(workspace_id, competitor_domain, snapshot_date);
