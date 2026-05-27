CREATE TABLE IF NOT EXISTS eeat_assets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  content TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_eeat_assets_workspace
  ON eeat_assets(workspace_id);

CREATE INDEX IF NOT EXISTS idx_eeat_assets_workspace_type
  ON eeat_assets(workspace_id, asset_type);

ALTER TABLE page_keywords
  ADD COLUMN missing_trust_signals TEXT;

ALTER TABLE page_keywords
  ADD COLUMN eeat_asset_recommendations TEXT;
