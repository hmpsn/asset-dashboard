/**
 * Archive-twin schema generator (Reconcile R11-T7).
 *
 * `server/outcome-tracking.ts` hand-maintains EXPLICIT column lists for the
 * archive copy of `tracked_actions` → `tracked_actions_archive` and
 * `action_outcomes` → `action_outcomes_archive`. Those lists exist because a
 * positional `INSERT ... SELECT *` is unsafe here: `ALTER TABLE ... ADD COLUMN`
 * always appends the new column at the END of a table, but the live table and
 * its archive twin do NOT gain columns in the same physical order relative to
 * each other. `archived_at` was added to the twin BEFORE later live-table
 * columns existed (e.g. `predicted_emv`), so on the twin those later columns
 * land AFTER `archived_at`, while on the live table they land before nothing
 * (append-at-end, no trailing sentinel column). A `SELECT *` copy would
 * silently map `predicted_emv` → `archived_at` and vice versa — exactly the
 * near-miss documented in migrations 106 and 116.
 *
 * This module removes the hand-maintained lists as a source of drift: the
 * column list is generated from `PRAGMA table_info()` at first-use (after
 * migrations have run — see the lazy-init note below), and a boot-time
 * assertion (`assertArchiveTwinParity`) fails loudly the moment a future
 * ALTER on the live table is not mirrored onto the twin.
 *
 * Twin contract: a twin table's columns must be EXACTLY the live table's
 * columns, in the live table's declared order, plus exactly one trailing
 * `archived_at` column. Nothing else. This mirrors the shape both existing
 * twins have held since migration 041 plus every additive ALTER since.
 *
 * Lazy-init requirement: like `createStmtCache()` (server/db/stmt-cache.ts),
 * every function here reads the schema via `PRAGMA table_info()`, which only
 * reflects reality AFTER `runMigrations()` has run. Callers must not invoke
 * these functions at module-eval time on a database handle that predates
 * migrations — the existing `stmts()` lazy-cache pattern in
 * server/outcome-tracking.ts already satisfies this (statements are built on
 * first call, not at import time), and this module extends that guarantee to
 * the generated column lists themselves.
 */
import type Database from 'better-sqlite3';
import db from './index.js';

const ARCHIVED_AT_COLUMN = 'archived_at';

interface PragmaColumn {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

/**
 * Returns the column names of `table`, in DB-declared order, via
 * `PRAGMA table_info()`. Throws if the table does not exist (an empty pragma
 * result set is indistinguishable from "no such table" — surfacing loudly
 * here is deliberate: a silent empty list would make every downstream check
 * vacuously pass).
 */
export function getTableColumns(table: string, database: Database.Database = db): string[] {
  const rows = database.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as PragmaColumn[];
  if (rows.length === 0) {
    throw new Error(`archive-twin: table "${table}" does not exist or has no columns`);
  }
  return rows.map((r) => r.name);
}

/**
 * SQLite identifiers can't be parameter-bound in PRAGMA statements. Table
 * names in this module are always internal literals (never user input), but
 * double-quote them defensively so a stray reserved word doesn't break the
 * PRAGMA call.
 */
function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * Asserts that `twinTable` is a structurally valid archive twin of
 * `liveTable`: same columns, in the same order, plus exactly one trailing
 * `archived_at` column and nothing else.
 *
 * Throws (does not return a boolean) so callers — in particular the boot-time
 * wiring in server/index.ts — fail loudly and immediately rather than
 * continuing to run against a table pair that would silently corrupt data on
 * the next archive sweep.
 */
export function assertArchiveTwinParity(
  liveTable: string,
  twinTable: string,
  database: Database.Database = db,
): void {
  const liveColumns = getTableColumns(liveTable, database);
  const twinColumns = getTableColumns(twinTable, database);

  const expectedTwinColumns = [...liveColumns, ARCHIVED_AT_COLUMN];

  const mismatch = !arraysEqual(twinColumns, expectedTwinColumns);
  if (mismatch) {
    const missingFromTwin = liveColumns.filter((c) => !twinColumns.includes(c));
    const extraOnTwin = twinColumns.filter((c) => c !== ARCHIVED_AT_COLUMN && !liveColumns.includes(c));
    const orderMismatch =
      missingFromTwin.length === 0 && extraOnTwin.length === 0
        ? ' Columns present on both sides but in a different order than expected.'
        : '';

    throw new Error(
      `archive-twin parity check failed for "${liveTable}" → "${twinTable}": ` +
        `twin must be exactly [${liveColumns.join(', ')}, ${ARCHIVED_AT_COLUMN}] but is ` +
        `[${twinColumns.join(', ')}].` +
        (missingFromTwin.length > 0 ? ` Missing from twin: ${missingFromTwin.join(', ')}.` : '') +
        (extraOnTwin.length > 0 ? ` Unexpected extra columns on twin: ${extraOnTwin.join(', ')}.` : '') +
        orderMismatch +
        ' Every ALTER on the live table must add the matching column to the twin in the same migration ' +
        '(see docs/rules/destructive-migrations.md and the archive-twin header comment in server/outcome-tracking.ts).',
    );
  }
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((val, i) => val === b[i]);
}

/**
 * Generates the shared, order-independent column list used to copy rows from
 * `liveTable` into `twinTable`. Returns the live-table columns (in live
 * order) that also exist on the twin — i.e. everything except `archived_at`,
 * which callers supply separately (typically `datetime('now')`).
 *
 * This is the single source of truth `archiveOld` / `archiveOldOutcomes` in
 * server/outcome-tracking.ts consume instead of a hand-copied list, so the
 * live and twin lists can never silently diverge: both are derived from the
 * SAME PRAGMA read at the SAME call site.
 *
 * Does NOT itself assert parity — call `assertArchiveTwinParity` first (or
 * rely on the boot-time assertion) if you need a hard guarantee the twin has
 * no unexpected extra/missing columns. This function only computes the safe
 * intersection so archival never throws for a merely-in-progress twin.
 */
export function buildArchiveColumnList(
  liveTable: string,
  twinTable: string,
  database: Database.Database = db,
): string[] {
  const liveColumns = getTableColumns(liveTable, database);
  const twinColumns = new Set(getTableColumns(twinTable, database));
  return liveColumns.filter((c) => twinColumns.has(c));
}

/**
 * Builds a full `INSERT INTO <twinTable> (<cols>, archived_at) SELECT <cols>,
 * datetime('now') FROM <liveTable> WHERE <whereClause>` statement using the
 * generated, order-independent column list. This is the shape both
 * `archiveOld` and `archiveOldOutcomes` need; centralizing it here means the
 * INSERT column list and the SELECT column list are always generated from
 * the exact same array (order-independent, name-matched — never `SELECT *`).
 */
export function buildArchiveInsertSql(
  liveTable: string,
  twinTable: string,
  whereClause: string,
  database: Database.Database = db,
): string {
  const columns = buildArchiveColumnList(liveTable, twinTable, database);
  const columnList = columns.join(', ');
  return `
    INSERT INTO ${twinTable} (${columnList}, ${ARCHIVED_AT_COLUMN})
    SELECT ${columnList}, datetime('now')
    FROM ${liveTable}
    WHERE ${whereClause}
  `;
}

/**
 * Boot-time drift assertion for the two known archive-twin pairs in this
 * codebase. Called once from server/index.ts, immediately after
 * runMigrations(), before anything else touches tracked_actions or
 * action_outcomes. Throws (crashing boot) if either twin has drifted from
 * its live table — this is intentional: an archive sweep against a drifted
 * twin corrupts data (see the module header), so refusing to boot is safer
 * than booting into a corruption-capable state.
 */
export function assertKnownArchiveTwinsAtBoot(database: Database.Database = db): void {
  assertArchiveTwinParity('tracked_actions', 'tracked_actions_archive', database);
  assertArchiveTwinParity('action_outcomes', 'action_outcomes_archive', database);
}
