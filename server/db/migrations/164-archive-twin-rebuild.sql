-- 164-archive-twin-rebuild.sql
-- Reconcile R11-T7 (Task B10) — rebuild the tracked_actions/action_outcomes
-- archive twins in canonical column order, closing the drift the generated
-- archive-twin helper (server/db/archive-twin.ts) now asserts against at boot.
--
-- WHY THIS MIGRATION EXISTS
-- ──────────────────────────────────────────────────────────────────────────
-- tracked_actions_archive and action_outcomes_archive were created in
-- migration 041 with `archived_at` as their LAST column. Later migrations
-- (106, 116) added new columns to BOTH the live table and its twin via
-- a column-add ALTER, which always appends at the end of a table.
-- (Prose in this file deliberately avoids the literal add-column / rename-column
-- ALTER phrasing: server/db/index.ts:151-153 regex-tests the WHOLE migration file
-- text, comments included, to decide single-atomic-exec vs per-statement split.
-- This rebuild must run as one atomic db.exec — see the "PATTERN" note below — so
-- no comment here may match those add-column / rename-column ALTER regexes.)
-- On the LIVE tables those columns landed after every other live column
-- (there is no trailing sentinel). On the TWIN tables they landed AFTER the
-- pre-existing `archived_at` column. The result, verified via PRAGMA at HEAD:
--
--   tracked_actions        (...) created_at, updated_at, predicted_emv
--   tracked_actions_archive(...) created_at, updated_at, archived_at, predicted_emv
--
--   action_outcomes        (...) measured_at, attributed_value, value_basis
--   action_outcomes_archive(...) measured_at, archived_at, attributed_value, value_basis
--
-- Neither twin currently satisfies the archive-twin contract (twin columns
-- == live columns in live order, plus exactly one TRAILING archived_at).
-- server/outcome-tracking.ts already works around this today with hand-
-- maintained EXPLICIT column lists (the load-bearing comments this migration
-- doesn't touch), but the generated copy-list helper (archive-twin.ts) and
-- its boot-time assertion require the physical column order to match the
-- contract going forward — otherwise every future PRAGMA-driven consumer of
-- these tables (row-mapper completeness tests, migration-preservation tests,
-- ad-hoc admin tooling) inherits the same positional-corruption trap that
-- migrations 106/116 already had one near-miss with.
--
-- PATTERN: RENAME-TO-ARCHIVE, NOT same-transaction rebuild
-- ──────────────────────────────────────────────────────────────────────────
-- Per docs/rules/destructive-migrations.md, this is NOT the same-transaction
-- `_new` → DROP → RENAME rebuild pattern (migration 019) — that pattern is
-- for structural changes where the OLD table is immediately, fully replaced
-- by an equivalent table in the same statement block with no data ever only
-- reachable under a soon-to-vanish name. Here the OLD archive tables
-- themselves ARE the destructive-migration subject: this PR renames them
-- aside (`_r11_old`) instead of dropping them, so a restore is possible if
-- anything was missed. The actual `DROP TABLE tracked_actions_archive_r11_old`
-- / `action_outcomes_archive_r11_old` is a SEPARATE follow-up migration after
-- staging verify + one backup retention window (R0 contract) — DO NOT add
-- those DROPs here.
--
-- COLUMN ORDER RATIONALE
-- ──────────────────────────────────────────────────────────────────────────
-- New tracked_actions_archive column order = tracked_actions' CURRENT live
-- column order (id … updated_at, predicted_emv) + trailing archived_at.
-- New action_outcomes_archive column order = action_outcomes' CURRENT live
-- column order (id … measured_at, attributed_value, value_basis) + trailing
-- archived_at. This is exactly what assertArchiveTwinParity() requires and
-- exactly what buildArchiveColumnList()/buildArchiveInsertSql() in
-- server/db/archive-twin.ts generate from PRAGMA table_info() at runtime —
-- there is no independent "canonical order" choice being made here beyond
-- "match the live table, then append archived_at".
--
-- EVERY COPY BELOW USES AN EXPLICIT COLUMN LIST — NEVER `SELECT *`.
-- A positional `SELECT *` from the old twin (whose physical column order
-- does NOT match the new twin's order) would silently swap `archived_at`
-- with `predicted_emv` / `attributed_value` / `value_basis` — the exact
-- corruption class this whole migration exists to close out.

-- ── tracked_actions_archive rebuild ─────────────────────────────────────

ALTER TABLE tracked_actions_archive RENAME TO tracked_actions_archive_r11_old;

CREATE TABLE tracked_actions_archive (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  page_url TEXT,
  target_keyword TEXT,
  baseline_snapshot TEXT NOT NULL DEFAULT '{}',
  trailing_history TEXT NOT NULL DEFAULT '{}',
  attribution TEXT NOT NULL DEFAULT 'not_acted_on',
  measurement_window INTEGER NOT NULL DEFAULT 90,
  measurement_complete INTEGER NOT NULL DEFAULT 0,
  source_flag TEXT NOT NULL DEFAULT 'live',
  baseline_confidence TEXT NOT NULL DEFAULT 'exact',
  context TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  predicted_emv REAL,
  archived_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Explicit column list on BOTH sides (INSERT + SELECT) — order-independent,
-- migration-safe copy. Source is the just-renamed old twin, whose physical
-- column order is (..., updated_at, archived_at, predicted_emv) — naming
-- every column makes this copy correct regardless of that order.
INSERT INTO tracked_actions_archive
  (id, workspace_id, action_type, source_type, source_id, page_url, target_keyword,
   baseline_snapshot, trailing_history, attribution, measurement_window, measurement_complete,
   source_flag, baseline_confidence, context, created_at, updated_at, predicted_emv, archived_at)
SELECT
  id, workspace_id, action_type, source_type, source_id, page_url, target_keyword,
  baseline_snapshot, trailing_history, attribution, measurement_window, measurement_complete,
  source_flag, baseline_confidence, context, created_at, updated_at, predicted_emv, archived_at
FROM tracked_actions_archive_r11_old;

CREATE INDEX IF NOT EXISTS idx_tracked_actions_archive_workspace ON tracked_actions_archive(workspace_id);

-- ── action_outcomes_archive rebuild ─────────────────────────────────────

ALTER TABLE action_outcomes_archive RENAME TO action_outcomes_archive_r11_old;

CREATE TABLE action_outcomes_archive (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL,
  checkpoint_days INTEGER NOT NULL,
  metrics_snapshot TEXT NOT NULL DEFAULT '{}',
  score TEXT,
  early_signal TEXT,
  delta_summary TEXT NOT NULL DEFAULT '{}',
  competitor_context TEXT NOT NULL DEFAULT '{}',
  measured_at TEXT NOT NULL,
  attributed_value REAL,
  value_basis TEXT,
  archived_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Source (action_outcomes_archive_r11_old) physical order is
-- (..., measured_at, archived_at, attributed_value, value_basis); explicit
-- column list makes the copy correct regardless.
INSERT INTO action_outcomes_archive
  (id, action_id, checkpoint_days, metrics_snapshot, score, early_signal, delta_summary,
   competitor_context, measured_at, attributed_value, value_basis, archived_at)
SELECT
  id, action_id, checkpoint_days, metrics_snapshot, score, early_signal, delta_summary,
  competitor_context, measured_at, attributed_value, value_basis, archived_at
FROM action_outcomes_archive_r11_old;

CREATE INDEX IF NOT EXISTS idx_action_outcomes_archive_action ON action_outcomes_archive(action_id);

-- ── Delayed drop (NOT this migration) ───────────────────────────────────
-- tracked_actions_archive_r11_old and action_outcomes_archive_r11_old are
-- intentionally left in place. A follow-up migration drops them only after
-- staging verify + one backup retention window has elapsed, per
-- docs/rules/destructive-migrations.md. Do not add DROP TABLE statements to
-- this file.
