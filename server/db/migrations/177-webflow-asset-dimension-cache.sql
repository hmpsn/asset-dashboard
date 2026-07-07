-- 177-webflow-asset-dimension-cache.sql
-- SB-022 (UI-rebuild W2 asset-manager) — cache of lazily-derived Webflow asset
-- dimensions (width × height).
--
-- The Webflow list-assets payload carries no original w×h (probes.md Probe 1), so
-- the asset-manager surface derives them in the background (batched image-metadata
-- probes) and stores the result here rather than blocking the list render or firing
-- an N+1 per-asset fetch. This is a regenerable cache keyed by the EXTERNAL Webflow
-- (site_id, asset_id) pair — it holds no durable business data and no workspace
-- envelope, so it is intentionally NOT a snapshot-registry table. It replaces the
-- module's former runtime `CREATE TABLE IF NOT EXISTS`, bringing the table under the
-- migration runner like every other feature table (the only runtime-created table is
-- the `_migrations` tracker itself).
CREATE TABLE IF NOT EXISTS webflow_asset_dimension_cache (
  site_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  derived_at TEXT,
  failed_at TEXT,
  next_retry_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (site_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_webflow_asset_dimension_cache_retry
  ON webflow_asset_dimension_cache (site_id, next_retry_at);
