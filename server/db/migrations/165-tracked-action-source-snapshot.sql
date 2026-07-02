-- 165-tracked-action-source-snapshot.sql
-- Reconcile R6-PR1 (Task B11) — snapshot-on-write EXPAND for the outcome ledger.
--
-- WHY THIS MIGRATION EXISTS
-- ──────────────────────────────────────────────────────────────────────────
-- A tracked_actions row records that we did something (published a post, applied
-- a meta change, deployed schema, etc.) sourced from an EPHEMERAL producer — a
-- recommendation, brief, content-request, approval item, or a page/keyword ref.
-- Those producers are regenerated on every audit/regen: recommendation sets are
-- rebuilt (buildMergeKey does NOT preserve the old blob), briefs/posts are edited,
-- approval items are re-minted. When the source is regenerated or deleted, the
-- outcome's `resolveWinTitle`-style live-lookup (server/routes/outcomes.ts) can no
-- longer resolve the source's real title, so the client-facing "We Called It" wins
-- degrade to a GENERIC per-action-type label ("Published new content") instead of the
-- real title ("How to choose a local plumber"). Outcomes are DESIGNED to outlive their
-- sources (the ledger is the durable record), so the fix is to snapshot the source's
-- identity AT WRITE TIME onto the durable row — the same "ephemeral-source snapshot ref"
-- pattern predicted_emv already uses (migration 116). See docs/adr/0008-ephemeral-source-snapshot-ref.md.
--
-- ADDITIVE + nullable: two columns, default NULL, never feature-gated.
--   source_label    TEXT  — the resolved human title snapshotted at record time
--                           (e.g. the rec/brief/post title). NULL when the write site
--                           had no title in scope (page-ref/self-ref sources: schema,
--                           strategy, content_decay, brand_voice, internal_link).
--   source_snapshot TEXT  — JSON { title?, type?, page? } identity blob, parsed on read
--                           via parseJsonSafe (server/db/outcome-mappers.ts). NULL when
--                           no source was threaded (call sites are back-compatible).
-- A row with no `source` threaded is fully valid (both columns NULL) — this keeps the
-- change expand-only across all ~20 recordAction call sites + ~30 pinning test files.
--
-- ARCHIVE TWIN (the load-bearing half) + COLUMN-ORDER HAZARD
-- ──────────────────────────────────────────────────────────────────────────
-- The archive twin (tracked_actions_archive) MUST also gain both columns, or archived
-- rows could not hold the snapshot at all. BUT the twin already has a TRAILING
-- `archived_at` column the live table lacks (added in migration 041). SQLite's
-- ADD COLUMN always appends at the END, so an ADD-COLUMN on the twin would land the new
-- columns AFTER `archived_at`, producing [..., archived_at, source_label, source_snapshot].
-- server/db/archive-twin.ts's assertArchiveTwinParity() (called at boot since Task B10 /
-- migration 164) requires the twin to be EXACTLY [...liveColumns, archived_at] with
-- archived_at LAST — an ADD-COLUMN twin would CRASH boot. Migration 116 got away with an
-- ADD-COLUMN-both because the parity assert did not exist yet; migration 164 then had to
-- REBUILD both twins into canonical order to close that drift. Re-introducing an
-- ADD-COLUMN-both here would re-open exactly the drift 164 just fixed.
--
-- THEREFORE: the live table gets an additive ADD COLUMN (append is fine — no trailing
-- sentinel column), and the twin is REBUILT in canonical column order (live order + the
-- two new columns + trailing archived_at), following migration 164's rename-to-archive
-- pattern. The `-- twin-alter-ok:` hatch on each live ADD COLUMN line below documents that
-- the twin IS updated (the column IS archived) — just via a canonical-order rebuild rather
-- than an ADD COLUMN, precisely so `archived_at` stays trailing for the parity contract.
-- (Prose here deliberately avoids the literal add-column / rename-column ALTER phrasing in
-- non-executing comments so server/db/index.ts's per-statement-split regex keys only on the
-- real executable statements below.)
--
-- DB column + mapper lockstep (CLAUDE.md): this migration ships in the SAME commit as
-- TrackedActionRow.source_label/source_snapshot + rowToTrackedAction mapper
-- (server/db/outcome-mappers.ts), TrackedAction.sourceLabel?/sourceSnapshot?
-- (shared/types/outcome-tracking.ts), the recordAction insert column-list/VALUES/payload +
-- RecordActionParams.source? (server/outcome-tracking.ts), the threaded write sites, and the
-- trackedActionSourceSnapshotSchema (server/schemas/outcome-schemas.ts).

-- ── Live table: additive columns (append-at-end is safe) ─────────────────
-- FRAGILE INVARIANT — DO NOT reformat the two ALTER lines below. Because this file
-- contains ADD COLUMN, server/db/index.ts runs it per-statement: it strips whole
-- `--` comment LINES, then splits on `;`. The trailing inline `-- twin-alter-ok`
-- comment therefore GLUES to the FOLLOWING statement as a leading `--` line (which
-- SQLite ignores up to the newline, then executes the real statement). This is
-- verified-correct but order-sensitive: keep each hatch INLINE on its ALTER line
-- (line-above is NOT honoured by the pr-check lockstep rule), and do not move it to
-- its own line or reorder these statements — either would break the `;`-split.
ALTER TABLE tracked_actions ADD COLUMN source_label TEXT; -- twin-alter-ok: twin gains this column via the canonical-order REBUILD below (not an ADD COLUMN), so archived_at stays trailing for assertArchiveTwinParity()
ALTER TABLE tracked_actions ADD COLUMN source_snapshot TEXT; -- twin-alter-ok: twin gains this column via the canonical-order REBUILD below (not an ADD COLUMN), so archived_at stays trailing for assertArchiveTwinParity()

-- ── Archive twin: canonical-order REBUILD (164's rename-to-archive pattern) ──
-- Rename the current twin aside (NOT dropped — the delayed DROP is a separate
-- follow-up migration after staging verify + one backup retention window, per
-- docs/rules/destructive-migrations.md R0 contract) and recreate it with columns in
-- live-table order (id … predicted_emv, source_label, source_snapshot) + trailing
-- archived_at. Every copy uses an EXPLICIT column list — never SELECT * — so the
-- rename-aside old twin's physical column order (…, updated_at, archived_at,
-- predicted_emv) cannot positionally corrupt the copy.
ALTER TABLE tracked_actions_archive RENAME TO tracked_actions_archive_r6_old;

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
  source_label TEXT,
  source_snapshot TEXT,
  archived_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Explicit column list on BOTH sides. The old twin has no source_label/source_snapshot,
-- so those two columns are simply absent from the copy (they land NULL on the new rows —
-- correct: pre-existing archived rows were recorded before snapshots existed).
INSERT INTO tracked_actions_archive
  (id, workspace_id, action_type, source_type, source_id, page_url, target_keyword,
   baseline_snapshot, trailing_history, attribution, measurement_window, measurement_complete,
   source_flag, baseline_confidence, context, created_at, updated_at, predicted_emv, archived_at)
SELECT
  id, workspace_id, action_type, source_type, source_id, page_url, target_keyword,
  baseline_snapshot, trailing_history, attribution, measurement_window, measurement_complete,
  source_flag, baseline_confidence, context, created_at, updated_at, predicted_emv, archived_at
FROM tracked_actions_archive_r6_old;

CREATE INDEX IF NOT EXISTS idx_tracked_actions_archive_workspace ON tracked_actions_archive(workspace_id);

-- ── Delayed drop (NOT this migration) ───────────────────────────────────
-- tracked_actions_archive_r6_old is intentionally left in place. A follow-up migration
-- drops it only after staging verify + one backup retention window has elapsed, per
-- docs/rules/destructive-migrations.md. Do not add a DROP TABLE statement to this file.
