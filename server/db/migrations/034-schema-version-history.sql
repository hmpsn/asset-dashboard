-- Track every schema publish event for version history and rollback
CREATE TABLE IF NOT EXISTS schema_publish_history (
  id           TEXT NOT NULL PRIMARY KEY,
  site_id      TEXT NOT NULL,
  page_id      TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  schema_json  TEXT NOT NULL,
  published_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sph_site_page
  ON schema_publish_history (site_id, page_id, published_at DESC);
