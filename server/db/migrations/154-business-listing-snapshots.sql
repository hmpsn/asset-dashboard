-- 154-business-listing-snapshots.sql
-- SEO Decision Engine P7: Google Business Profile health + reviews time series
-- (the client's own listing + local competitors). Time-series, parallel to
-- serp_snapshots / local_visibility_snapshots — never conflated. rating_value and
-- review_count are NULLable: a business with zero reviews has NO rating block (the
-- value is absent, NOT 0 — see tests/fixtures/dataforseo-business-listings.ts).
CREATE TABLE IF NOT EXISTS business_listing_snapshots (
  workspace_id        TEXT NOT NULL,
  place_id            TEXT NOT NULL,                 -- GBP place id / CID; per-listing identity
  snapshot_date       TEXT NOT NULL,
  is_owned            INTEGER,                        -- tri-state NULL/0/1 (client's own listing vs competitor)
  location_id         TEXT,                           -- FK client_locations (NULL = unmatched / workspace-level)
  market_id           TEXT,                           -- FK local_seo_markets
  title               TEXT,
  domain              TEXT,
  cid                 TEXT,
  category            TEXT,
  rating_value        REAL,                           -- star rating; NULL = no reviews yet (NEVER 0)
  review_count        INTEGER,                        -- NULL = no reviews yet (NEVER 0)
  rating_distribution TEXT,                           -- JSON {"1":..,"5":..} or NULL
  attributes          TEXT NOT NULL DEFAULT '[]',     -- JSON string[] of completeness attributes
  total_photos        INTEGER,
  claimed             INTEGER,                        -- tri-state NULL/0/1
  fetched_at          TEXT NOT NULL,
  PRIMARY KEY (workspace_id, place_id, snapshot_date),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_business_listings_owned ON business_listing_snapshots(workspace_id, is_owned, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_business_listings_market ON business_listing_snapshots(workspace_id, market_id, snapshot_date);
