-- 169-outcome-coverage-provenance.sql
-- Reconcile R9 (Task B15) — ADMIN-ONLY outcome coverage funnel: adds a `provenance`
-- column to action_outcomes recording how far an outcome's VALUE got / how it was
-- derived (funnel stages: tracked / measured / reconciled), backing
-- computeOutcomeCoverage() (server/outcome-coverage.ts) and an admin-only funnel
-- display. This is UNRELATED to the existing client-facing `OutcomeProvenance`
-- shared type (shared/types/outcome-tracking.ts) — that type is a WORKSPACE-level,
-- computed-at-read-time confidence tier for The Issue's GA4/conversion-tracking
-- maturity (estimate_ga4 / measured_action / actual_reconciled), never persisted as
-- a column. This migration's `provenance` is a PER-ROW, PERSISTED admin coverage
-- signal on action_outcomes. The two concepts intentionally share the
-- 'estimate_ga4' legacy-default vocabulary (per the audit) but are modeled as
-- separate TypeScript types (OutcomeCoverageProvenance vs OutcomeProvenance) to
-- avoid confusing the two call sites — see shared/types/outcome-tracking.ts.
--
-- ADDITIVE + nullable: legacy rows (recorded before this column existed) are
-- NULL. computeOutcomeCoverage() treats a NULL provenance as the 'estimate_ga4'
-- read-fallback (the funnel's base tracked/measured stage) — never dropped from
-- the funnel, never miscounted as 'reconciled'.
--
-- ARCHIVE TWIN (the load-bearing half) + COLUMN-ORDER HAZARD
-- ──────────────────────────────────────────────────────────────────────────
-- action_outcomes_archive is already in CANONICAL order (id … measured_at,
-- attributed_value, value_basis, archived_at — trailing archived_at, per migration
-- 164's rebuild). SQLite's ADD COLUMN always appends at the END, so an ADD-COLUMN
-- on the twin would land `provenance` AFTER `archived_at`, producing
-- [..., archived_at, provenance] — the exact drift class migrations 106/116 first
-- hit and migration 164 rebuilt both twins to close. server/db/archive-twin.ts's
-- assertArchiveTwinParity() (called at boot) requires the twin to be EXACTLY
-- [...liveColumns, archived_at] with archived_at LAST — an ADD-COLUMN twin here
-- would CRASH boot.
--
-- THEREFORE: the live table gets an additive ADD COLUMN (append is fine — no
-- trailing sentinel column on the live side), and the twin is REBUILT in canonical
-- column order (live order + the new column + trailing archived_at), following
-- migration 165's rename-to-archive pattern. The `-- twin-alter-ok:` hatch on the
-- live ADD COLUMN line documents that the twin IS updated (the column IS
-- archived) — just via a canonical-order rebuild rather than an ADD COLUMN, so
-- `archived_at` stays trailing for the parity contract.
-- (Prose here deliberately avoids the literal add-column / rename-column ALTER
-- phrasing in non-executing comments so server/db/index.ts's per-statement-split
-- regex keys only on the real executable statements below.)
--
-- DB column + mapper lockstep (CLAUDE.md): this migration ships in the SAME
-- commit as ActionOutcomeRow.provenance + rowToActionOutcome mapper
-- (server/db/outcome-mappers.ts), ActionOutcome.provenance?
-- (shared/types/outcome-tracking.ts), the recordOutcome insert column-list/VALUES
-- (server/outcome-tracking.ts), computeOutcomeCoverage()
-- (server/outcome-coverage.ts), and the OutcomeCoverageProvenance enum
-- (server/schemas/outcome-schemas.ts).

-- ── Live table: additive column (append-at-end is safe) ──────────────────
-- FRAGILE INVARIANT — DO NOT reformat the ALTER line below. Because this file
-- contains ADD COLUMN, server/db/index.ts runs it per-statement: it strips whole
-- `--` comment LINES, then splits on `;`. The trailing inline `-- twin-alter-ok`
-- comment therefore GLUES to the FOLLOWING statement as a leading `--` line
-- (which SQLite ignores up to the newline, then executes the real statement).
-- This is verified-correct but order-sensitive: keep the hatch INLINE on the
-- ALTER line (line-above is NOT honoured by the pr-check lockstep rule), and do
-- not move it to its own line or reorder these statements — either would break
-- the `;`-split.
ALTER TABLE action_outcomes ADD COLUMN provenance TEXT; -- twin-alter-ok: twin gains this column via the canonical-order REBUILD below (not an ADD COLUMN), so archived_at stays trailing for assertArchiveTwinParity()

-- ── Archive twin: canonical-order REBUILD (164/165's rename-to-archive pattern) ──
-- Rename the current twin aside (NOT dropped — the delayed DROP is a separate
-- follow-up migration after staging verify + one backup retention window, per
-- docs/rules/destructive-migrations.md R0 contract) and recreate it with columns
-- in live-table order (id … value_basis, provenance) + trailing archived_at.
-- Every copy uses an EXPLICIT column list — never SELECT * — so the rename-aside
-- old twin's physical column order (…, value_basis, archived_at) cannot
-- positionally corrupt the copy.
ALTER TABLE action_outcomes_archive RENAME TO action_outcomes_archive_r9_old;

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
  provenance TEXT,
  archived_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Explicit column list on BOTH sides. The old twin has no provenance column, so
-- it is simply absent from the copy (lands NULL on the new rows — correct:
-- pre-existing archived outcomes were recorded before this column existed).
INSERT INTO action_outcomes_archive
  (id, action_id, checkpoint_days, metrics_snapshot, score, early_signal, delta_summary,
   competitor_context, measured_at, attributed_value, value_basis, archived_at)
SELECT
  id, action_id, checkpoint_days, metrics_snapshot, score, early_signal, delta_summary,
  competitor_context, measured_at, attributed_value, value_basis, archived_at
FROM action_outcomes_archive_r9_old;

CREATE INDEX IF NOT EXISTS idx_action_outcomes_archive_action ON action_outcomes_archive(action_id);

-- ── Delayed drop (NOT this migration) ───────────────────────────────────
-- action_outcomes_archive_r9_old is intentionally left in place. A follow-up
-- migration drops it only after staging verify + one backup retention window has
-- elapsed, per docs/rules/destructive-migrations.md. Do not add a DROP TABLE
-- statement to this file.
