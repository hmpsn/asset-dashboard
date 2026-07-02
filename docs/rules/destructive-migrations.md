# Destructive Migrations Contract

A migration that permanently destroys data (dropping a table, dropping a column via table
rebuild, truncating a store) is the highest-risk change class in this codebase: it cannot be
undone by a code revert, and this project's migration runner is **forward-only** (see
"Migration runner semantics" below) — there is no down-migration path. This doc defines the
contract every destructive migration must follow, and the mechanized rule that enforces it.

---

## The contract: rename-to-archive, then drop one PR later

**A new migration must never `DROP TABLE` directly.** Instead:

1. **PR N — rename or copy to archive.** Rename the table to an `_archive` (or similarly named)
   copy, or copy its rows into an explicitly-columned archive table. The live code path stops
   reading/writing the original name in this same PR.
2. **Staging verify + one retention window.** Deploy PR N to staging, confirm the application
   behaves correctly with the table renamed away, and let at least one backup retention window
   elapse (see `BACKUP_RETENTION_DAYS` / `BACKUP_S3_RETENTION_DAYS` in `server/backup.ts`) so a
   restore is available if something was missed.
3. **PR N+1 — the actual `DROP TABLE`.** Only after step 2 passes does a follow-up migration drop
   the archived table for real.

This gives every destructive change a recoverable rollback window: if PR N turns out to be wrong,
the archived table still exists and can be renamed back. If PR N+1 (the drop) is wrong, the most
recent backup — local or off-site — covers it (see `docs/workflows/data-integrity-recovery.md`).

### Distinguishing this from the same-transaction table-rebuild pattern

SQLite doesn't support `ALTER TABLE ... ADD CONSTRAINT` or many other schema changes in place, so
this codebase has an established **same-transaction rebuild** pattern (see migration
`019-cascade-workspace-delete.sql`): create a `<table>_new` with the desired schema, copy rows
with `INSERT OR IGNORE INTO <table>_new SELECT * FROM <table>`, `DROP TABLE <table>`, then
`ALTER TABLE <table>_new RENAME TO <table>`. This is **not** the two-PR rename-to-archive pattern
above — it's a single-migration structural rebuild where the DROP and the replacement happen
atomically in the same transaction, so there is no window where data is only reachable under the
archive name. Both patterns are legitimate; the difference is whether the DROP is destroying data
permanently (rename-to-archive contract applies) or immediately replacing it with an
equivalent, fully-copied table in the same statement block (rebuild pattern, still gated by the
pr-check rule below but expected to carry a hatch — see "Baseline and escape hatch").

## Baseline and escape hatch

`scripts/pr-check.ts` enforces this contract with the rule **"New migration DROP TABLE without
rename-to-archive contract"**: any `server/db/migrations/*.sql` file containing `DROP TABLE`
(bare or `IF EXISTS`) fails unless:

- the file is in the **baseline** (`data/drop-table-migration-baseline.json`) — the 6 migrations
  that shipped before this contract existed (`019-cascade-workspace-delete.sql`,
  `029-keyword-requested.sql`, `037-analytics-insights-fix-unique.sql`,
  `049-client-signals-v2.sql`, `091-retire-feedback-table.sql`,
  `119-strategy-history-fk.sql`), matched by filename; or
- the `DROP TABLE` line itself carries an **inline** hatch: `-- drop-table-ok: <reason>`.

**The hatch is inline-only.** Unlike several other pr-check rules in this codebase, a hatch
comment on the line *above* the `DROP TABLE` statement is deliberately **not** honoured. A
destructive DROP deserves a hatch that cannot be silently separated from the statement by a later
edit reordering or inserting lines above it.

Use the hatch for the legitimate PR N+1 delayed-drop case once PR N has verified on staging and
the retention window has elapsed — reference the PR that did the rename-to-archive step and the
date the retention window cleared, e.g.:

```sql
DROP TABLE legacy_recommendation_sets_archive; -- drop-table-ok: rename-to-archive shipped in #1234 (2026-06-01), retention window cleared 2026-07-01
```

Do not add new entries to the baseline file — it is closed to migrations that predate this
contract. Every new destructive migration goes through the two-PR flow or carries a justified
inline hatch.

## Migration runner semantics

Accurately describing `server/db/index.ts`'s `runMigrations()` matters because the contract above
assumes forward-only, no-rollback semantics:

- **Forward-only.** There is no down-migration mechanism. The only way to undo a migration's
  effect is a new forward migration (or a full database restore).
- **Lexicographic ordering.** Migration files in `server/db/migrations/` are sorted
  lexicographically (`file.sort()`) and applied in that order — the numeric filename prefix
  (`019-`, `164-`, etc.) is what determines apply order, not creation date or git history. This
  is why the plan renumbers migration files to the next free slot at merge time when multiple
  in-flight PRs mint migrations concurrently.
- **Single IMMEDIATE transaction, `foreign_keys` OFF.** The entire check-and-apply loop for all
  pending migrations runs inside one `db.transaction(...).immediate()` call, with
  `PRAGMA foreign_keys = OFF` for the duration (SQLite forbids toggling this pragma inside a
  transaction) and restored to `ON` in a `finally` block. This serializes concurrent server starts
  against the same database file — only one process holds the write lock while migrations run;
  others block (up to `busy_timeout`) and then see all migrations already applied.
- **`MIGRATION_RENAMES` bridge.** When a migration file is renamed after already shipping to some
  environment, `MIGRATION_RENAMES` maps `[oldName, newName]` so the `_migrations` tracking table
  (keyed by filename) recognizes the renamed file as already-applied rather than re-running its
  SQL. This bridge runs before the applied set is loaded, so it is the only place a rename alias
  can take effect. Entries are never removed once added.
- **Per-statement fallback for `ADD COLUMN` / `RENAME COLUMN`.** Migrations containing
  `ALTER TABLE ... ADD COLUMN` or `RENAME COLUMN` are split into individual statements and applied
  one at a time so `"duplicate column name"` / `"no such column"` errors (from a partially-applied
  migration on some environments) are tolerated as already-done rather than aborting the whole
  migration.

Because there is no rollback path, the rename-to-archive contract is the only recoverable
mechanism available for destructive schema changes short of a full restore-from-backup — which is
why A1 (backup safety) and this contract land together: neither is a complete safety net alone.

## Archive-twin schema generation (R11-T7)

Two tables in this codebase have a hand-maintained "archive twin" that receives rows aged out of
the live table by a retention sweep: `tracked_actions` → `tracked_actions_archive` and
`action_outcomes` → `action_outcomes_archive`. A twin's contract is: **exactly the live table's
columns, in the live table's declared order, plus one trailing `archived_at` column.**

This contract is easy to violate silently. SQLite's `ALTER TABLE ... ADD COLUMN` always appends
the new column at the END of a table — but the live table and its twin do not necessarily gain
columns in the same relative order, because the twin already has a trailing `archived_at` column
the live table lacks. A column added to both tables via `ALTER` in the same migration lands
*before* `archived_at` on the live table's logical end, but *after* `archived_at` physically on the
twin. A positional `INSERT ... SELECT *` copy would then silently swap that column's value with the
archive timestamp — migrations `106-action-outcome-value.sql` and
`116-tracked-action-predicted-emv.sql` both document a near-miss of exactly this shape.

`server/db/archive-twin.ts` closes this out permanently:

- `getTableColumns(table)` reads the canonical column list via `PRAGMA table_info()`.
- `assertArchiveTwinParity(liveTable, twinTable)` throws if the twin isn't exactly
  `[...liveColumns, 'archived_at']`. Called at boot (`server/index.ts`, right after
  `runMigrations()`) via `assertKnownArchiveTwinsAtBoot()` — a drifted twin crashes boot rather
  than silently corrupting the next archive sweep.
- `buildArchiveColumnList()` / `buildArchiveInsertSql()` generate the explicit, name-matched
  column list `server/outcome-tracking.ts`'s `archiveOld` / `archiveOldOutcomes` statements use —
  replacing the hand-copied lists that used to be the only thing preventing drift. Because both the
  live and twin column lists are read from the same PRAGMA call at the same call site, they cannot
  silently diverge.

**Mechanized rule:** `scripts/pr-check.ts`'s "Live+twin ALTER lockstep" rule fails any migration
that contains `ALTER TABLE tracked_actions ADD COLUMN` or `ALTER TABLE action_outcomes ADD COLUMN`
without a matching `ALTER TABLE <table>_archive ADD COLUMN <same column>` in the **same file**.
Like the `drop-table-ok` hatch above, the escape hatch is **inline-only** —
`-- twin-alter-ok: <reason>` must sit on the live-table ALTER line itself, for a column that is
genuinely live-only and must never be archived.

Migration `164-archive-twin-rebuild.sql` is the one-time rename-to-archive rebuild that put both
twins into the canonical column order this generator assumes: it renames the drifted twins aside to
`*_r11_old` (not dropped — the delayed drop is a separate follow-up migration per the contract
above) and recreates them with columns in live-table order plus a trailing `archived_at`.

## Related

- `docs/workflows/data-integrity-recovery.md` — the integrity report + restore drill this contract
  assumes is available before any PR N+1 drop merges.
- `docs/rules/pr-check-rule-authoring.md` — general pr-check rule conventions (hatch format,
  baseline-file pattern) this rule follows.
- `server/backup.ts` — local + off-site backup retention (`BACKUP_RETENTION_DAYS` /
  `BACKUP_S3_RETENTION_DAYS`) that bounds how far back a restore can reach.
