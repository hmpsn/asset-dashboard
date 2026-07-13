-- K3b: additive Unicode identity compatibility. The legacy v1 tables remain
-- intact as rollback projections and readable aliases until a later retirement
-- PR. SQLite cannot compute NFKC; the operator-run TypeScript backfill populates
-- these stores after deployment. No boot-time data mutation is authorized.

CREATE TABLE tracked_keywords_v2_compat (
  workspace_id          TEXT NOT NULL,
  normalized_query_v2   TEXT NOT NULL CHECK(normalized_query_v2 <> ''),
  normalized_query_v1   TEXT NOT NULL,
  query                 TEXT NOT NULL CHECK(query <> ''),
  pinned                INTEGER NOT NULL DEFAULT 0,
  added_at              TEXT NOT NULL,
  source                TEXT,
  status                TEXT,
  page_path             TEXT,
  page_title            TEXT,
  strategy_generated_at TEXT,
  last_strategy_seen_at TEXT,
  intent                TEXT,
  volume                REAL,
  difficulty            REAL,
  cpc                   REAL,
  authority_posture     TEXT,
  baseline_position     REAL,
  baseline_clicks       REAL,
  baseline_impressions  REAL,
  replaced_by           TEXT,
  deprecated_at         TEXT,
  source_page_id        TEXT,
  source_gap_key_v1     TEXT,
  source_gap_key_v2     TEXT,
  strategy_owned        INTEGER,
  sort_order            INTEGER,
  is_canonical          INTEGER NOT NULL CHECK(is_canonical IN (0, 1)),
  write_order           INTEGER NOT NULL CHECK(write_order > 0),
  UNIQUE (workspace_id, write_order),
  PRIMARY KEY (workspace_id, normalized_query_v2, query),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_tracked_keywords_v2_one_canonical
  ON tracked_keywords_v2_compat(workspace_id, normalized_query_v2)
  WHERE is_canonical = 1;
CREATE INDEX idx_tracked_keywords_v2_v1
  ON tracked_keywords_v2_compat(workspace_id, normalized_query_v1);
CREATE INDEX idx_tracked_keywords_v2_status
  ON tracked_keywords_v2_compat(workspace_id, is_canonical, status);
CREATE INDEX idx_tracked_keywords_v2_sort
  ON tracked_keywords_v2_compat(workspace_id, is_canonical, sort_order);

CREATE TABLE site_keyword_metrics_v2_compat (
  workspace_id        TEXT NOT NULL,
  normalized_query_v2 TEXT NOT NULL CHECK(normalized_query_v2 <> ''),
  normalized_query_v1 TEXT NOT NULL,
  keyword             TEXT NOT NULL CHECK(keyword <> ''),
  volume              REAL,
  difficulty          REAL,
  is_canonical        INTEGER NOT NULL CHECK(is_canonical IN (0, 1)),
  write_order         INTEGER NOT NULL CHECK(write_order > 0),
  UNIQUE (workspace_id, write_order),
  PRIMARY KEY (workspace_id, normalized_query_v2, keyword),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_site_keyword_metrics_v2_one_canonical
  ON site_keyword_metrics_v2_compat(workspace_id, normalized_query_v2)
  WHERE is_canonical = 1;
CREATE INDEX idx_site_keyword_metrics_v2_v1
  ON site_keyword_metrics_v2_compat(workspace_id, normalized_query_v1);

ALTER TABLE local_visibility_snapshots
  ADD COLUMN normalized_keyword_v2 TEXT;

CREATE INDEX idx_local_visibility_snapshots_workspace_keyword_v2
  ON local_visibility_snapshots(workspace_id, normalized_keyword_v2, captured_at DESC);
CREATE INDEX idx_local_visibility_snapshots_market_keyword_v2
  ON local_visibility_snapshots(market_id, normalized_keyword_v2, captured_at DESC);
CREATE INDEX idx_local_visibility_snapshots_workspace_market_keyword_v2
  ON local_visibility_snapshots(
    workspace_id,
    market_id,
    normalized_keyword_v2,
    device,
    language_code,
    captured_at DESC
  );

CREATE TABLE keyword_feedback_v2_compat (
  workspace_id  TEXT NOT NULL,
  keyword_v2    TEXT NOT NULL CHECK(keyword_v2 <> ''),
  raw_keyword   TEXT NOT NULL COLLATE BINARY CHECK(raw_keyword <> ''),
  keyword_v1    TEXT NOT NULL,
  status        TEXT NOT NULL CHECK(status IN ('approved', 'declined', 'requested')),
  reason        TEXT,
  source        TEXT,
  declined_by   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  write_order   INTEGER NOT NULL CHECK(write_order > 0),
  UNIQUE (workspace_id, write_order),
  PRIMARY KEY (workspace_id, keyword_v2),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX idx_keyword_feedback_v2_updated
  ON keyword_feedback_v2_compat(workspace_id, write_order DESC, updated_at DESC);
CREATE INDEX idx_keyword_feedback_v2_status
  ON keyword_feedback_v2_compat(workspace_id, status);
CREATE INDEX idx_keyword_feedback_v2_v1
  ON keyword_feedback_v2_compat(workspace_id, keyword_v1);

CREATE TABLE keyword_feedback_v2_aliases (
  workspace_id TEXT NOT NULL,
  keyword_v2   TEXT NOT NULL,
  keyword_v1   TEXT NOT NULL,
  raw_keyword  TEXT NOT NULL COLLATE BINARY CHECK(raw_keyword <> ''),
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  PRIMARY KEY (workspace_id, keyword_v2, raw_keyword),
  FOREIGN KEY (workspace_id, keyword_v2)
    REFERENCES keyword_feedback_v2_compat(workspace_id, keyword_v2)
    ON DELETE CASCADE
);

CREATE INDEX idx_keyword_feedback_v2_aliases_v1
  ON keyword_feedback_v2_aliases(workspace_id, keyword_v1);

CREATE TABLE content_gap_votes_v2_compat (
  workspace_id TEXT NOT NULL,
  keyword_v2   TEXT NOT NULL CHECK(keyword_v2 <> ''),
  raw_keyword  TEXT NOT NULL COLLATE BINARY CHECK(raw_keyword <> ''),
  keyword_v1   TEXT NOT NULL,
  vote         TEXT NOT NULL CHECK(vote IN ('up', 'down')),
  voted_by     TEXT,
  updated_at   TEXT NOT NULL,
  write_order  INTEGER NOT NULL CHECK(write_order > 0),
  UNIQUE (workspace_id, write_order),
  PRIMARY KEY (workspace_id, keyword_v2),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX idx_content_gap_votes_v2_updated
  ON content_gap_votes_v2_compat(workspace_id, write_order DESC, updated_at DESC);
CREATE INDEX idx_content_gap_votes_v2_v1
  ON content_gap_votes_v2_compat(workspace_id, keyword_v1);

CREATE TABLE content_gap_vote_v2_aliases (
  workspace_id TEXT NOT NULL,
  keyword_v2   TEXT NOT NULL,
  keyword_v1   TEXT NOT NULL,
  raw_keyword  TEXT NOT NULL COLLATE BINARY CHECK(raw_keyword <> ''),
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  PRIMARY KEY (workspace_id, keyword_v2, raw_keyword),
  FOREIGN KEY (workspace_id, keyword_v2)
    REFERENCES content_gap_votes_v2_compat(workspace_id, keyword_v2)
    ON DELETE CASCADE
);

CREATE INDEX idx_content_gap_vote_v2_aliases_v1
  ON content_gap_vote_v2_aliases(workspace_id, keyword_v1);

CREATE TABLE serp_snapshots_v2_compat (
  workspace_id        TEXT NOT NULL,
  date                TEXT NOT NULL,
  query_v2            TEXT NOT NULL CHECK(query_v2 <> ''),
  raw_query           TEXT NOT NULL COLLATE BINARY CHECK(raw_query <> ''),
  query_v1            TEXT NOT NULL,
  observed_at         TEXT NOT NULL,
  position            INTEGER,
  matched_url         TEXT,
  features            TEXT NOT NULL DEFAULT '[]', -- json-array-column-ok: bounded string labels stay atomic with one SERP observation
  ai_overview_cited   INTEGER,
  ai_overview_present INTEGER,
  PRIMARY KEY (workspace_id, date, query_v2, raw_query),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX idx_serp_snapshots_v2_query
  ON serp_snapshots_v2_compat(workspace_id, query_v2, date DESC, observed_at DESC);
CREATE INDEX idx_serp_snapshots_v2_v1
  ON serp_snapshots_v2_compat(workspace_id, query_v1, date DESC);

CREATE TABLE keyword_metrics_cache_v2 (
  identity_version TEXT NOT NULL DEFAULT 'v2' CHECK(identity_version = 'v2'),
  identity_key     TEXT NOT NULL CHECK(identity_key <> ''),
  raw_keyword     TEXT NOT NULL COLLATE BINARY CHECK(raw_keyword <> ''),
  database_region TEXT NOT NULL DEFAULT 'us',
  volume          INTEGER NOT NULL DEFAULT 0,
  difficulty      REAL NOT NULL DEFAULT 0,
  cpc             REAL NOT NULL DEFAULT 0,
  competition     REAL NOT NULL DEFAULT 0,
  results         INTEGER NOT NULL DEFAULT 0,
  trend           TEXT NOT NULL DEFAULT '[]', -- json-array-column-ok: fixed 12-month provider series is one cache value
  cached_at       TEXT NOT NULL,
  PRIMARY KEY (identity_version, identity_key, database_region)
);

CREATE INDEX idx_keyword_metrics_cache_v2_cached_at
  ON keyword_metrics_cache_v2(cached_at);
