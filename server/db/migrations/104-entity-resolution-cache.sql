CREATE TABLE IF NOT EXISTS entity_resolution_cache (
  cache_key TEXT PRIMARY KEY,
  entity_label TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('Thing', 'Place')),
  wikidata_qid TEXT,
  wikidata_label TEXT,
  wikidata_description TEXT,
  wikidata_same_as TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('resolved', 'unresolved', 'error')),
  error_message TEXT,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entity_resolution_cache_expires_at
  ON entity_resolution_cache (expires_at);
