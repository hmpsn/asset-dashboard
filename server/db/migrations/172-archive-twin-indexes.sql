-- 172-archive-twin-indexes.sql
-- Reconcile C4 closeout (D1) — restore the missing indexes on the REBUILT archive
-- twins tracked_actions_archive / action_outcomes_archive.
--
-- WHY THIS MIGRATION EXISTS — the rename-carries-the-index-name hazard
-- ──────────────────────────────────────────────────────────────────────────
-- SQLite's `ALTER TABLE ... RENAME TO <new>` carries the OLD table's index NAMES
-- along with the table when it is renamed aside — the indexes now belong to the
-- renamed-aside `_<tag>_old` copy, not to the freshly recreated live table. The
-- archive-twin rebuilds did exactly this:
--   * migration 164 first created idx_tracked_actions_archive_workspace and
--     idx_action_outcomes_archive_action on the rebuilt twins.
--   * migration 165 then renamed tracked_actions_archive aside (to
--     tracked_actions_archive_r6_old, carrying idx_tracked_actions_archive_workspace
--     onto that old copy) and recreated the live twin. Its trailing
--     `CREATE INDEX IF NOT EXISTS idx_tracked_actions_archive_workspace ...` then
--     silently NO-OPPED — the name was already taken by the renamed-aside table —
--     leaving the live tracked_actions_archive UNINDEXED on workspace_id.
--   * migration 169 did the same to action_outcomes_archive (renamed aside to
--     action_outcomes_archive_r9_old), so its trailing
--     `CREATE INDEX IF NOT EXISTS idx_action_outcomes_archive_action ...` no-opped
--     too — leaving the live action_outcomes_archive UNINDEXED on action_id.
--
-- Net result at HEAD: both rebuilt archive twins carry NO usable index, so every
-- read that filters by workspace_id (archive scans) or joins by action_id
-- (archived-outcome lookups) falls back to a full table scan.
--
-- THE FIX — fresh `_v2`-named indexes (migration 167's pattern for this exact trap)
-- ──────────────────────────────────────────────────────────────────────────
-- Re-using the ORIGINAL index names here would collide again with the names now
-- pinned to the `_r6_old` / `_r9_old` renamed-aside copies, so `CREATE INDEX IF
-- NOT EXISTS <original name>` would no-op a THIRD time. Migration 167 solved the
-- identical hazard for the snapshot-table rebuild by minting `_v2` names
-- (idx_audit_snapshots_site_v2, idx_redirect_snapshots_site_v2). Follow that
-- precedent: distinct `_v2` names cannot collide with the renamed-aside copies, so
-- these CREATE INDEX statements actually land on the live twins.
--
-- Idempotent: `IF NOT EXISTS` on distinct `_v2` names is a natural no-op on any DB
-- that has already applied this migration.
--
-- NOTE: this file contains ONLY CREATE INDEX statements — no column-shape changes.
-- It must run as ONE atomic db.exec (server/db/index.ts only splits per-statement
-- when a migration mutates a column's shape), so this file deliberately contains
-- none of that column-mutation phrasing in its prose either.

-- ── tracked_actions_archive: workspace_id index (164's name no-opped in 165) ──
CREATE INDEX IF NOT EXISTS idx_tracked_actions_archive_workspace_v2
  ON tracked_actions_archive(workspace_id);

-- ── action_outcomes_archive: action_id index (164's name no-opped in 169) ──
CREATE INDEX IF NOT EXISTS idx_action_outcomes_archive_action_v2
  ON action_outcomes_archive(action_id);
