/**
 * Archive-twin parity generator tests (Reconcile R11-T7 / Task B10).
 *
 * server/db/archive-twin.ts replaces the hand-maintained EXPLICIT column
 * lists in server/outcome-tracking.ts's archiveOld / archiveOldOutcomes with
 * a schema-generated equivalent, and adds a boot-time drift assertion. These
 * tests exercise the generator against:
 *
 *   1. Synthetic in-memory fixture tables (fast, isolated — proves the
 *      generic algorithm: parity pass, drift-by-missing-column fail,
 *      drift-by-order fail, drift-by-extra-column fail).
 *   2. The REAL migrated tracked_actions/action_outcomes twins on the shared
 *      test db singleton (proves the actual production schema is currently
 *      in parity — this is the regression oracle for any future un-twinned
 *      ALTER).
 */
import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import {
  getTableColumns,
  assertArchiveTwinParity,
  buildArchiveColumnList,
  buildArchiveInsertSql,
  assertKnownArchiveTwinsAtBoot,
} from '../../server/db/archive-twin.js';
import db from '../../server/db/index.js';

// ── 1. Synthetic fixture tables (in-memory, isolated from the real schema) ──

describe('getTableColumns', () => {
  it('returns columns in declared order for a fixture table', () => {
    const mem = new Database(':memory:');
    mem.exec(`CREATE TABLE widgets (id TEXT, name TEXT, color TEXT)`);

    expect(getTableColumns('widgets', mem)).toEqual(['id', 'name', 'color']);
  });

  it('throws for a table that does not exist', () => {
    const mem = new Database(':memory:');
    expect(() => getTableColumns('does_not_exist', mem)).toThrow(/does not exist/);
  });
});

describe('assertArchiveTwinParity — fixture drift scenarios', () => {
  it('passes when the twin is exactly live columns + trailing archived_at', () => {
    const mem = new Database(':memory:');
    mem.exec(`
      CREATE TABLE widgets (id TEXT, name TEXT, color TEXT);
      CREATE TABLE widgets_archive (id TEXT, name TEXT, color TEXT, archived_at TEXT);
    `);

    expect(() => assertArchiveTwinParity('widgets', 'widgets_archive', mem)).not.toThrow();
  });

  it('fails when the live table gains a column the twin lacks (the core drift hazard)', () => {
    const mem = new Database(':memory:');
    mem.exec(`
      CREATE TABLE widgets (id TEXT, name TEXT, color TEXT);
      CREATE TABLE widgets_archive (id TEXT, name TEXT, color TEXT, archived_at TEXT);
    `);
    // Simulate a future ALTER on the live table that forgot to touch the twin.
    mem.exec(`ALTER TABLE widgets ADD COLUMN weight REAL`);

    expect(() => assertArchiveTwinParity('widgets', 'widgets_archive', mem)).toThrow(
      /archive-twin parity check failed/,
    );
    expect(() => assertArchiveTwinParity('widgets', 'widgets_archive', mem)).toThrow(/weight/);
  });

  it('fails when the twin has a column in the wrong order relative to live (the P4/106 hazard, reproduced)', () => {
    const mem = new Database(':memory:');
    // Live table: id, name, extra (extra added LAST via ALTER, as SQLite always appends).
    mem.exec(`
      CREATE TABLE widgets (id TEXT, name TEXT);
      ALTER TABLE widgets ADD COLUMN extra TEXT;
    `);
    // Twin table: archived_at was added BEFORE extra existed, so extra lands
    // AFTER archived_at on the twin — the exact positional-corruption shape
    // documented in migrations 106/116.
    mem.exec(`
      CREATE TABLE widgets_archive (id TEXT, name TEXT, archived_at TEXT);
      ALTER TABLE widgets_archive ADD COLUMN extra TEXT;
    `);

    expect(() => assertArchiveTwinParity('widgets', 'widgets_archive', mem)).toThrow(
      /archive-twin parity check failed/,
    );
  });

  it('fails when the twin has an unexpected extra column beyond archived_at', () => {
    const mem = new Database(':memory:');
    mem.exec(`
      CREATE TABLE widgets (id TEXT, name TEXT);
      CREATE TABLE widgets_archive (id TEXT, name TEXT, archived_at TEXT, mystery_column TEXT);
    `);

    expect(() => assertArchiveTwinParity('widgets', 'widgets_archive', mem)).toThrow(/mystery_column/);
  });

  it('fails when the twin is simply missing the archived_at column', () => {
    const mem = new Database(':memory:');
    mem.exec(`
      CREATE TABLE widgets (id TEXT, name TEXT);
      CREATE TABLE widgets_archive (id TEXT, name TEXT);
    `);

    expect(() => assertArchiveTwinParity('widgets', 'widgets_archive', mem)).toThrow(
      /archive-twin parity check failed/,
    );
  });
});

describe('buildArchiveColumnList — generated, order-independent list', () => {
  it('returns live columns (in live order) that also exist on the twin, excluding archived_at', () => {
    const mem = new Database(':memory:');
    mem.exec(`
      CREATE TABLE widgets (id TEXT, name TEXT, color TEXT);
      CREATE TABLE widgets_archive (id TEXT, name TEXT, color TEXT, archived_at TEXT);
    `);

    expect(buildArchiveColumnList('widgets', 'widgets_archive', mem)).toEqual(['id', 'name', 'color']);
  });

  it('reflects an added live column immediately once the twin also has it — no hand-editing needed', () => {
    const mem = new Database(':memory:');
    mem.exec(`
      CREATE TABLE widgets (id TEXT, name TEXT);
      CREATE TABLE widgets_archive (id TEXT, name TEXT, archived_at TEXT);
    `);
    mem.exec(`ALTER TABLE widgets ADD COLUMN weight REAL`);
    mem.exec(`ALTER TABLE widgets_archive ADD COLUMN weight REAL`);

    // weight lands after archived_at physically on the twin, but the generated
    // list is name-matched against the LIVE order, not physical twin order —
    // this is exactly what makes the copy order-independent/safe.
    expect(buildArchiveColumnList('widgets', 'widgets_archive', mem)).toEqual(['id', 'name', 'weight']);
  });
});

describe('buildArchiveInsertSql — generated INSERT...SELECT never uses *', () => {
  it('builds an explicit-column INSERT...SELECT with datetime(now) for archived_at', () => {
    const mem = new Database(':memory:');
    mem.exec(`
      CREATE TABLE widgets (id TEXT, name TEXT, color TEXT);
      CREATE TABLE widgets_archive (id TEXT, name TEXT, color TEXT, archived_at TEXT);
      INSERT INTO widgets VALUES ('w1', 'Widget One', 'red');
    `);

    const sql = buildArchiveInsertSql('widgets', 'widgets_archive', `id = 'w1'`, mem);

    expect(sql).not.toMatch(/SELECT\s+\*/i);
    expect(sql).toContain('INSERT INTO widgets_archive (id, name, color, archived_at)');
    expect(sql).toContain("SELECT id, name, color, datetime('now')");

    mem.prepare(sql).run();
    const row = mem.prepare(`SELECT * FROM widgets_archive WHERE id = 'w1'`).get() as Record<string, unknown>;
    expect(row.name).toBe('Widget One');
    expect(row.color).toBe('red');
    expect(typeof row.archived_at).toBe('string');
  });

  it('round-trips correctly even when a column was added to live AFTER archived_at existed on the twin', () => {
    // Reproduces the exact P4/migration-116 scenario end-to-end: predicted_emv
    // added to both tables via ALTER, landing after archived_at physically on
    // the twin. A SELECT * copy would misalign; the generated list must not.
    const mem = new Database(':memory:');
    mem.exec(`
      CREATE TABLE ta (id TEXT, name TEXT);
      CREATE TABLE ta_archive (id TEXT, name TEXT, archived_at TEXT);
    `);
    mem.exec(`ALTER TABLE ta ADD COLUMN predicted_emv REAL`);
    mem.exec(`ALTER TABLE ta_archive ADD COLUMN predicted_emv REAL`);
    mem.exec(`INSERT INTO ta VALUES ('t1', 'Row One', 42.5)`);

    const sql = buildArchiveInsertSql('ta', 'ta_archive', `id = 't1'`, mem);
    mem.prepare(sql).run();

    const row = mem.prepare(`SELECT * FROM ta_archive WHERE id = 't1'`).get() as Record<string, unknown>;
    // Pre-fix (positional SELECT *) would have written the datetime string
    // into predicted_emv and left archived_at holding the REAL 42.5 value.
    expect(typeof row.predicted_emv).toBe('number');
    expect(row.predicted_emv).toBe(42.5);
    expect(typeof row.archived_at).toBe('string');
    expect(isNaN(new Date(row.archived_at as string).getTime())).toBe(false);
  });
});

// ── 2. The REAL migrated schema — regression oracle for future drift ──

describe('assertKnownArchiveTwinsAtBoot — real migrated schema is currently in parity', () => {
  it('tracked_actions / tracked_actions_archive are in parity on the live migrated db', () => {
    expect(() => assertArchiveTwinParity('tracked_actions', 'tracked_actions_archive', db)).not.toThrow();
  });

  it('action_outcomes / action_outcomes_archive are in parity on the live migrated db', () => {
    expect(() => assertArchiveTwinParity('action_outcomes', 'action_outcomes_archive', db)).not.toThrow();
  });

  it('assertKnownArchiveTwinsAtBoot (the boot wiring entry point) does not throw', () => {
    expect(() => assertKnownArchiveTwinsAtBoot(db)).not.toThrow();
  });
});

afterAll(() => {
  // No persistent rows written to the shared db singleton by this file —
  // all fixture tables are in-memory Database instances that are garbage
  // collected with their local `mem` bindings. Nothing to clean up.
});
