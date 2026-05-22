ALTER TABLE local_seo_markets ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_local_seo_markets_primary
  ON local_seo_markets (workspace_id, is_primary);
