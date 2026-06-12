-- Wave 3c-i (#12) — promote rank_tracking_config.tracked_keywords (one JSON blob
-- per workspace) into the indexed `tracked_keywords` row table. ADDITIVE SHADOW
-- half: table + backfill + DUAL-WRITE only. READS STAY ON THE BLOB (zero behavior
-- change). The read-switch + blob strip are later owner-gated PRs (3c-ii). The
-- provenance columns source_page_id / source_gap_key are created here (additive,
-- nullable) but POPULATED later in 3d — they are left NULL this PR.
--
-- NOTE on the name collision: this TABLE `tracked_keywords` is distinct from the
-- existing COLUMN `rank_tracking_config.tracked_keywords` (the JSON blob it
-- shadows). The blob column is intentionally KEPT — this is shadow, not strip.
--
-- PRIMARY KEY (workspace_id, normalized_query) where
--   normalized_query = keywordComparisonKey(query) — the shared semantic keyword
--   normalizer used everywhere for keyword equality/dedup/joins. JS dedup (keep
--   FIRST, drop blanks) runs BEFORE the per-row writes in withTrackedKeywordsTxn,
--   so PK conflicts cannot occur on valid data; the writer still uses ON CONFLICT
--   DO UPDATE defensively.

CREATE TABLE IF NOT EXISTS tracked_keywords (
  workspace_id          TEXT NOT NULL,
  normalized_query      TEXT NOT NULL,          -- = keywordComparisonKey(query), the PK component
  query                 TEXT NOT NULL,          -- raw display text
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
  source_page_id        TEXT,                   -- #6/#7 provenance (additive, populated in 3d)
  source_gap_key        TEXT,                   -- #6/#7 provenance (additive, populated in 3d)
  PRIMARY KEY (workspace_id, normalized_query),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tracked_keywords_workspace ON tracked_keywords(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tracked_keywords_status    ON tracked_keywords(workspace_id, status);
