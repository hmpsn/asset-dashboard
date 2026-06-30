-- F1 (2026-06-24 delta audit): the hot getLatestSerpSnapshots read computes
-- MAX(date) GROUP BY query WHERE workspace_id = ? on every call (analytics-
-- intelligence, keyword-command-center, recommendations, local-seo slice). The
-- original index idx_serp_snapshots_query(workspace_id, query) omits `date`, so
-- the per-query max cannot be index-served. Replace it with a composite that
-- leads with the same (workspace_id, query) prefix AND covers `date`, so the
-- aggregate is satisfied from the index. Also supports the new retention prune
-- (DELETE ... date NOT IN (most recent N distinct dates)).

DROP INDEX IF EXISTS idx_serp_snapshots_query;

CREATE INDEX IF NOT EXISTS idx_serp_snapshots_query_date
  ON serp_snapshots(workspace_id, query, date);
