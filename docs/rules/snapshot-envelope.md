# Snapshot Table Registry Contract

Reconcile R11-T5 (Task C1). This doc is the deep-dive reference for `server/db/snapshot-registry.ts` and the contract test that enforces it, `tests/contract/snapshot-envelope-registry.test.ts`.

---

## Background

This codebase has 13 `*_snapshots` tables — time-series stores that capture a point-in-time observation (an SEO audit, a SERP position, a GBP listing's review count, a weekly metrics rollup) so trends and deltas can be computed later. 10 of the 13 were designed workspace-first: `workspace_id NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`, deleting a workspace cleanly removes its history.

Three tables predate that convention: `audit_snapshots`, `performance_snapshots`, and `redirect_snapshots` were built when the codebase was site-centric, keyed only on `site_id` — which in practice holds `workspaces.webflow_site_id` (a Webflow site id), not `workspaces.id`. They had no workspace linkage at all until migration `167-audit-snapshots-workspace-id.sql`.

## The registry

`server/db/snapshot-registry.ts` exports `SNAPSHOT_TABLE_REGISTRY`, a `SnapshotTableDescriptor[]` census of all 13 tables:

```ts
interface SnapshotTableDescriptor {
  name: string;
  workspaceScoped: boolean;
  hasForeignKeyCascade: boolean;
  captureColumn: string;
  writerModule: string;
  note: string;
}
```

Use `getSnapshotTableDescriptor(name)` for a single lookup, or `SNAPSHOT_TABLE_NAMES` (a `Set<string>`) for membership checks.

### The one exception: `workspace_metrics_snapshots`

Every registered table has `hasForeignKeyCascade: true` **except** `workspace_metrics_snapshots` (migration 080). It has a `NOT NULL workspace_id` column — it IS workspace-scoped — but no `REFERENCES workspaces(id) ON DELETE CASCADE` constraint, because migration 080 predates the FK-CASCADE convention and has not been retrofitted. This table already has a 90-day rolling retention sweep (`pruneOld()` in `server/workspace-metrics-snapshots.ts`) that bounds orphan accumulation, so the risk is low, but the registry documents the gap rather than claiming false parity. The contract test asserts this exception matches reality via a live `PRAGMA foreign_key_list` check — don't "fix" the registry entry without either adding the FK in a new migration or you'll break that test.

## Migration 167: the retrofit

`server/db/migrations/167-audit-snapshots-workspace-id.sql` follows the **rename-to-`_r11_old`, explicit-column rebuild** pattern established by migration `164-archive-twin-rebuild.sql` (itself following `docs/rules/destructive-migrations.md`'s rename-to-archive contract):

1. `ALTER TABLE <table> RENAME TO <table>_r11_old`.
2. `CREATE TABLE <table>` with the new schema (adds `workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE`, nullable — not `NOT NULL`, because orphan rows are quarantined out rather than blocking the migration).
3. `INSERT INTO <table> ... SELECT ... FROM <table>_r11_old AS o JOIN (SELECT webflow_site_id, MIN(id) AS workspace_id FROM workspaces WHERE webflow_site_id IS NOT NULL AND webflow_site_id != '' GROUP BY webflow_site_id HAVING COUNT(*) = 1) AS w1 ON w1.webflow_site_id = o.site_id` — only rows whose `site_id` maps to **exactly one** workspace land in the rebuilt live table, with `workspace_id` populated. The `HAVING COUNT(*) = 1` is load-bearing (the CV-1 fix): `workspaces.webflow_site_id` has no UNIQUE constraint, so a naive `JOIN workspaces ON webflow_site_id` would emit one row per matching workspace and — on a duplicated site_id — collide on the snapshot PK and **abort the whole migration**. Resolving only unambiguous 1:1 mappings guarantees exactly one output row per input row.
4. `CREATE TABLE <table>_orphaned` (no `workspace_id` column — orphans by definition don't have one) and insert every row from `<table>_r11_old` whose `site_id` is **not** in that exactly-one-workspace set, via `WHERE o.site_id NOT IN (SELECT webflow_site_id FROM workspaces WHERE webflow_site_id IS NOT NULL AND webflow_site_id != '' GROUP BY webflow_site_id HAVING COUNT(*) = 1)`. This quarantines **both** zero-match (unresolvable) and ambiguous (>1-workspace) site_ids — an ambiguous site_id is a non-resolution, never guessed to an arbitrary workspace. The `WHERE webflow_site_id IS NOT NULL` guard inside the subquery is required for `NOT IN` NULL-safety: a single NULL in a `NOT IN` list makes the whole predicate return no rows, which would silently drop every orphan. Do **not** "simplify" this to a plain `JOIN`/`NOT EXISTS` against `workspaces` — that reintroduces the CV-1 abort.
5. Indexes are recreated under **new names** (`idx_audit_snapshots_site_v2`, not `idx_audit_snapshots_site`) — see the gotcha below.
6. `<table>_r11_old` is **not dropped**. A follow-up migration drops it after staging verify + one backup retention window, per the destructive-migrations contract.

### Gotcha: `ALTER TABLE ... RENAME TO` carries index names with it

`ALTER TABLE audit_snapshots RENAME TO audit_snapshots_r11_old` also renames every index defined on that table to now belong to `audit_snapshots_r11_old` — but the index's **own name** (e.g. `idx_audit_snapshots_site`) does not change. If the rebuild then does `CREATE INDEX IF NOT EXISTS idx_audit_snapshots_site ON audit_snapshots(...)`, SQLite sees that name is already taken (by the index now attached to `_r11_old`) and the `IF NOT EXISTS` guard silently no-ops — the **rebuilt live table ends up with no index on `site_id` at all**, and nothing errors. This was caught by testing migration 167 against a live copy of the dev DB and diffing `sqlite_master` before/after; it would not have been caught by a typecheck, build, or a test that only checks row counts. Any future migration using this rebuild pattern must give recreated indexes new names (a `_v2` suffix, or better) rather than reusing the pre-rebuild name.

### Why `site_id` is not removed

`workspace_id` is **additive only** in this migration. Every live read path for these three tables is still keyed by `site_id` (the Webflow site id), resolved by the caller via `workspace.webflowSiteId`:

- `server/reports.ts` — all `audit_snapshots` reads (`getSnapshot`, `listSnapshots`, `getLatestSnapshot`, etc.) take `siteId`.
- `server/performance-store.ts` — all `performance_snapshots` reads (`getPageWeight`, `getPageSpeed`, `getLinkCheck`, `getInternalLinks`, etc.) take `siteId`.
- `server/redirect-store.ts` — `getRedirectSnapshot(siteId)`.
- `server/intelligence/site-health-slice.ts` and `server/intelligence/page-profile-slice.ts` call all of the above with `workspace.webflowSiteId`, never `workspace.id`.

Repointing those readers to `workspace_id` is out of scope for this ticket — it would be a larger, riskier change touching five modules' read paths simultaneously. `workspace_id` exists today for: (a) satisfying the registry/workspace-scoping contract, (b) FK CASCADE cleanup on workspace deletion, and (c) any future read path that wants to join by workspace directly. A follow-up ticket may migrate the readers and drop `site_id`, following the same destructive-migration contract.

### `performance_snapshots`: an overloaded key, not just a legacy one

`performance_snapshots.site_id` is not always a Webflow site id. `server/performance-store.ts` reuses the `site_id` column as a general-purpose composite key depending on `sub`:

- `sub = 'pagespeed-single'`: `site_id = '${webflowSiteId}_${pageKey}'` (see `saveSinglePageSpeed`).
- `sub = 'competitor'`: `site_id` is a URL-derived comparison key with no workspace at all (see `competitorKey()` / `saveCompetitorCompare`).
- All other `sub` values: `site_id` is a real `webflowSiteId`.

Migration 167 does an **exact-match** join against `workspaces.webflow_site_id` — it deliberately does not attempt prefix-matching the composite `pagespeed-single` keys back to a workspace, because that would be a heuristic guess, not a resolution. Composite/URL-keyed rows fall through to `performance_snapshots_orphaned` along with genuinely-unlinked rows. As observed on the dev DB at migration-authoring time, this produced exactly 2 orphan rows (`pagespeed-single` sub, `<webflowSiteId>_home_desktop` / `_home_mobile` site_id) out of 8 total — both real, resolvable-in-principle-but-not-by-exact-join rows, safely quarantined rather than dropped or mis-attributed.

## Orphan quarantine, never deletion

Per owner decision (R11-T5), rows that don't resolve to a workspace are **quarantined, never deleted**. Three `_orphaned` tables exist: `audit_snapshots_orphaned`, `redirect_snapshots_orphaned`, `performance_snapshots_orphaned`. Each carries the full original row shape (minus `workspace_id`, which by definition an orphan lacks) plus `quarantined_at` and `quarantine_reason` columns. Nothing is ever dropped — even the renamed-aside `_r11_old` originals persist until a delayed-drop follow-up migration.

## The contract test

`tests/contract/snapshot-envelope-registry.test.ts` asserts, against a live migrated DB:

1. Every `*_snapshots` table in `sqlite_master` (excluding `_orphaned` and `_r11_old` bookkeeping tables) is registered in `SNAPSHOT_TABLE_REGISTRY`.
2. No registry entry references a table that no longer exists.
3. Every registered table is `workspaceScoped: true` and actually has a `workspace_id` column.
4. The registry covers exactly 13 tables (catches silent over/under-registration).
5. **Falsifiability check**: a hand-added rogue table (`CREATE TABLE rogue_test_snapshots_<uuid>`) is asserted to appear in the "unregistered" list — proving the census actually fails on missing registration, not just claiming to.
6. `hasForeignKeyCascade` claims are verified against a live `PRAGMA foreign_key_list()` call, not just trusted from the registry data.
7. Migration 167's quarantine tables exist with the right shape (no `workspace_id`, has `quarantine_reason`/`quarantined_at`).
8. The `_r11_old` rename-aside originals still exist (delayed-drop contract).
9. FK CASCADE actually deletes a `redirect_snapshots` row when its owning workspace is deleted (toggling `foreign_keys = ON` for the assertion, since the test process runs with FK enforcement OFF globally — see `tests/db-setup.ts`).

## pr-check rule

`scripts/pr-check.ts` includes a customCheck rule, **"New migration creates a `_snapshots` table without a matching registry entry"**, that scans new/changed `server/db/migrations/*.sql` files for `CREATE TABLE ... <name>_snapshots` and fails if `<name>_snapshots` (or its exact table name) is not present as a `name:` entry in `server/db/snapshot-registry.ts`. See `docs/rules/automated-rules.md` for the generated entry and hatch.

## Related

- `docs/rules/destructive-migrations.md` — the rename-to-archive contract this migration follows, and the archive-twin rebuild pattern (`164-archive-twin-rebuild.sql`) it mirrors.
- `server/db/archive-twin.ts` — a parallel "generate columns from PRAGMA, assert parity at boot" pattern for a different table pair; not used directly here but the same philosophy (derive from the live schema, don't hand-maintain a parallel list).
- `server/db/snapshot-registry.ts` — the registry itself.
- `tests/contract/snapshot-envelope-registry.test.ts` — the enforcing contract test.
