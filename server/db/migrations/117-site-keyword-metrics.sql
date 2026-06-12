-- Wave 3b-i (#19b) — normalize keywordStrategy.siteKeywordMetrics[] out of the
-- workspace JSON blob into indexed rows. ADDITIVE half (table + backfill +
-- dual-write + dual-read); the blob write and the read fallbacks are KEPT here.
-- The forced strip (cut blob write + existingStrategy source + remove fallbacks)
-- is the follow-up owner-gated 3b-ii PR.
--
-- PRIMARY KEY (workspace_id, normalized_query) where
--   normalized_query = keywordComparisonKey(keyword) — the shared semantic
--   keyword normalizer used everywhere for keyword equality/joins. Stored so the
--   reconcile join (rank-tracking-reconciliation.buildTargets) can match metrics
--   to siteKeywords by normalized key without re-normalizing every row at read.

CREATE TABLE IF NOT EXISTS site_keyword_metrics (
  workspace_id TEXT NOT NULL,
  normalized_query TEXT NOT NULL, -- = keywordComparisonKey(keyword), the PK component
  keyword TEXT NOT NULL,          -- raw display keyword text
  volume REAL,
  difficulty REAL,
  PRIMARY KEY (workspace_id, normalized_query),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_site_keyword_metrics_workspace ON site_keyword_metrics(workspace_id);
