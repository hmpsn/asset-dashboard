-- 110-opportunity-events.sql
-- Opportunity-event ledger for event-driven re-ranking (PR7 · Spine B).
-- A detected opportunity event (content decay, competitor overtake, rank decline,
-- publish) raises a DECAYING timing boost on the affected page's recommendations.
-- The boost is read back by server/scoring/opportunity-timing.ts and aggregated
-- per page into OpportunityInput.timingBoost (lifting the timing multiplier in
-- computeOpportunityValue). All of this is dark while the
-- `opportunity-value-events` flag is OFF (no rows written, empty boost map).
--
-- Lockstep (CLAUDE.md DB column + mapper): migration 110 + row interface +
-- rowToOpportunityEvent + insertOpportunityEvent + listActiveOpportunityEvents
-- + Zod schema, all in server/opportunity-events.ts.

-- page_path/keyword are NOT NULL DEFAULT '' (empty = "none"/domain-level) so the
-- dedup UNIQUE index below treats them as comparable keys (SQLite UNIQUE treats
-- NULLs as distinct, which would defeat dedup). The mapper converts '' back to null.
CREATE TABLE IF NOT EXISTS opportunity_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  type TEXT NOT NULL,                      -- decay | competitor | rank_drop | publish
  page_path TEXT NOT NULL DEFAULT '',      -- slug-normalised affected page ('' = domain-level)
  keyword TEXT NOT NULL DEFAULT '',        -- the keyword the event concerns ('' = none)
  boost REAL NOT NULL,                     -- initial (undecayed) timing boost contribution
  half_life_days REAL NOT NULL,            -- decay half-life in days
  detected_at TEXT NOT NULL,               -- ISO timestamp the event was detected/written
  source TEXT,                             -- detector that wrote the event (e.g. 'decay-cron')
  payload TEXT,                            -- JSON: detector-specific evidence
  -- Dedup: one row per logical event. Re-detecting the same (workspace,type,page,keyword)
  -- REFRESHES the row (detected_at/boost) instead of stacking — so a chronically-decaying
  -- page keeps a single decaying boost rather than N rows saturating the per-page cap,
  -- and the table cannot grow unbounded from daily re-detection.
  UNIQUE (workspace_id, type, page_path, keyword)
);

CREATE INDEX IF NOT EXISTS idx_opportunity_events_workspace_id
  ON opportunity_events(workspace_id, detected_at DESC);
