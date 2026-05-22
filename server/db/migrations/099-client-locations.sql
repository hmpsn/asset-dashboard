-- client_locations: multi-location business identity for workspace match detection.
-- Full future-shaped schema: future per-location strategy fields are nullable until
-- the per-location strategy sprint wires them up.
CREATE TABLE IF NOT EXISTS client_locations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  domain TEXT,
  phone TEXT,
  street_address TEXT,
  city TEXT,
  state_or_region TEXT,
  country TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'needs_review',
  gbp_place_id TEXT,
  -- Future per-location strategy fields (unused until per-location strategy sprint)
  primary_market_id TEXT,
  page_target_path TEXT,
  page_target_keyword_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_client_locations_workspace
  ON client_locations(workspace_id);

-- Nullable: pre-backfill snapshots have NULL until locations are configured.
ALTER TABLE local_visibility_snapshots
  ADD COLUMN matched_location_id TEXT;

ALTER TABLE local_visibility_snapshots
  ADD COLUMN matched_location_name TEXT;

-- Raw local pack results before client-owned locations are scrubbed from top_competitors.
-- Used by repeated historical backfills so match evidence is not destroyed.
ALTER TABLE local_visibility_snapshots
  ADD COLUMN raw_results TEXT;
