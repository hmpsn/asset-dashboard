-- Global keyword metrics cache — shared across all workspaces.
-- Keyword volume/difficulty/CPC is not workspace-specific, so caching per-workspace
-- wastes SEMRush credits when multiple clients are in the same industry.
-- This table acts as a global L1 cache checked before the per-workspace file cache.

CREATE TABLE IF NOT EXISTS keyword_metrics_cache (
  keyword TEXT NOT NULL,
  database_region TEXT NOT NULL DEFAULT 'us',
  volume INTEGER NOT NULL DEFAULT 0,
  difficulty REAL NOT NULL DEFAULT 0,
  cpc REAL NOT NULL DEFAULT 0,
  competition REAL NOT NULL DEFAULT 0,
  results INTEGER NOT NULL DEFAULT 0,
  trend TEXT NOT NULL DEFAULT '[]',   -- JSON array of 12 monthly volumes
  cached_at TEXT NOT NULL,
  PRIMARY KEY (keyword, database_region)
);

CREATE INDEX IF NOT EXISTS idx_kw_metrics_cached_at ON keyword_metrics_cache(cached_at);
