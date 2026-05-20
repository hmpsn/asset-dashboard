CREATE TABLE IF NOT EXISTS local_seo_workspace_settings (
  workspace_id TEXT PRIMARY KEY,
  posture TEXT NOT NULL DEFAULT 'unknown',
  posture_source TEXT NOT NULL DEFAULT 'unknown',
  suggested_posture TEXT,
  suggestion_reasons TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS local_seo_markets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  label TEXT NOT NULL,
  city TEXT NOT NULL,
  state_or_region TEXT,
  country TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  provider_location_code INTEGER,
  provider_location_name TEXT,
  source TEXT NOT NULL DEFAULT 'unknown',
  status TEXT NOT NULL DEFAULT 'needs_review',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_local_seo_markets_workspace_status
  ON local_seo_markets(workspace_id, status);

CREATE TABLE IF NOT EXISTS local_visibility_snapshots (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  keyword TEXT NOT NULL,
  normalized_keyword TEXT NOT NULL,
  market_id TEXT NOT NULL,
  market_label TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  local_pack_present INTEGER NOT NULL DEFAULT 0,
  business_found INTEGER NOT NULL DEFAULT 0,
  business_match_confidence TEXT NOT NULL DEFAULT 'unknown',
  business_match_reason TEXT,
  local_rank INTEGER,
  top_competitors TEXT NOT NULL DEFAULT '[]',
  source_endpoint TEXT NOT NULL,
  provider TEXT NOT NULL,
  device TEXT NOT NULL DEFAULT 'desktop',
  language_code TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL DEFAULT 'success',
  degraded_reason TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (market_id) REFERENCES local_seo_markets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_local_visibility_snapshots_workspace_keyword
  ON local_visibility_snapshots(workspace_id, normalized_keyword, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_local_visibility_snapshots_market_keyword
  ON local_visibility_snapshots(market_id, normalized_keyword, captured_at DESC);
