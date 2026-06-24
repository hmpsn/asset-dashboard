-- 153-serp-snapshots.sql
-- SEO Decision Engine P6: true national SERP rank + SERP-feature time series.
-- Parallel to rank_snapshots (GSC average position); the two are NEVER conflated.
-- clicks/impressions/ctr deliberately live in rank_snapshots (GSC source) — join on
-- (workspace_id, date, query) at read time (rate-display single-source rule).
-- position/matched_url are NULLable: a keyword can show SERP features (AI Overview,
-- featured snippet) while the client domain does not rank for it.
CREATE TABLE IF NOT EXISTS serp_snapshots (
  workspace_id        TEXT NOT NULL,
  date                TEXT NOT NULL,
  query               TEXT NOT NULL,                 -- normalized via keywordComparisonKey
  position            INTEGER,                        -- client true SERP rank (1-based); NULL = not ranking
  matched_url         TEXT,                           -- client URL that ranks; NULL = not ranking
  features            TEXT NOT NULL DEFAULT '[]',     -- JSON string[] of SERP feature labels
  ai_overview_cited   INTEGER,                        -- tri-state NULL/0/1 (owner domain in ai_overview.references)
  ai_overview_present INTEGER,                        -- tri-state NULL/0/1 (ai_overview block present at all)
  PRIMARY KEY (workspace_id, date, query),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_serp_snapshots_query ON serp_snapshots(workspace_id, query);
