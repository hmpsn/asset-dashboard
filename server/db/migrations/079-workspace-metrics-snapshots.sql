-- Phase 2.5c — weekly metrics snapshots per workspace.
--
-- Drives "best week since X" anchors in briefing dataReceipt lines. Written
-- once per workspace per week by the briefing cron (piggyback on the existing
-- weekly tick — no new cron). 90-day rolling retention enforced at write time
-- by the snapshots module (`pruneOld`).
--
-- Design notes:
--   - `snapshot_date` is YYYY-MM-DD (Monday UTC, matches BriefingDraft.weekOf
--     so anchors and briefing rows align by date).
--   - All metric columns are nullable: a workspace may have GSC but not GA4
--     for a given week, or audit data may be stale. Snapshots record what's
--     observable; null means "not measured" not "zero".
--   - UNIQUE(workspace_id, snapshot_date) lets `recordSnapshot` use
--     INSERT … ON CONFLICT DO UPDATE for idempotent writes if the cron fires
--     twice in the same week.
-- The UNIQUE(workspace_id, snapshot_date) constraint below implicitly
-- creates an index covering the (workspace_id, snapshot_date) range scans
-- used by listRecent / listInWindow / pruneBefore. No explicit index
-- needed — Devin caught a redundant `CREATE INDEX wms_workspace_date` in
-- the original draft of this migration.
CREATE TABLE workspace_metrics_snapshots (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id          TEXT NOT NULL,
  snapshot_date         TEXT NOT NULL,           -- YYYY-MM-DD (Monday UTC)
  total_clicks          INTEGER,
  total_impressions     INTEGER,
  avg_position          REAL,
  audit_score           INTEGER,
  organic_traffic_value REAL,
  computed_at           INTEGER NOT NULL,
  UNIQUE(workspace_id, snapshot_date)
);
