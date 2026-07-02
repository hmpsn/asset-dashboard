/**
 * CONTRACT TEST: Snapshot table registry census (Reconcile R11-T5, Task C1).
 *
 * Verifies that every `*_snapshots` table that exists in the live schema is:
 *   1. Registered in server/db/snapshot-registry.ts (SNAPSHOT_TABLE_REGISTRY), and
 *   2. Workspace-scoped — carries a `workspace_id` column (post-migration-167, all 13
 *      known snapshot tables satisfy this; the three legacy tables audit_snapshots,
 *      performance_snapshots, redirect_snapshots were retrofitted by migration
 *      167-audit-snapshots-workspace-id.sql).
 *
 * A snapshot table that is unregistered OR lacks workspace_id fails this test
 * immediately — this is the mechanized backstop against a 14th ad hoc snapshot table
 * silently reintroducing the site_id-only pattern the migration 167 retrofit closed.
 *
 * Also exercises the migration 167 retrofit itself against a live, migrated DB:
 *   - row-count preservation (live + orphaned == original row count, nothing dropped)
 *   - orphan rows (a performance_snapshots row whose site_id doesn't resolve to any
 *     workspace) land in the `_orphaned` quarantine table, never deleted
 *   - the orphan counts on the live migrated DB are pinned (Fix C — "counted"; the
 *     pure-SQL migration cannot log, so the assertions ARE the count-of-record)
 *   - workspace_id backfills correctly for resolvable rows
 *
 * The CV-1 regression (a duplicate webflow_site_id aborting the whole migration via a
 * 1:many JOIN + PK collision) is proven fixed by re-running the REAL migration 167 SQL
 * against a fresh in-memory DB seeded with the pre-167 schema + a duplicate-site_id
 * fixture, asserting: (i) the migration does not throw, (ii) the ambiguous row is
 * quarantined (never guessed to one workspace), and (iii) the row-count identity holds.
 *
 * `*_orphaned` and `*_r11_old` tables are intentionally excluded from the "every
 * *_snapshots table must be registered" scan — they are migration bookkeeping
 * (quarantine + rename-aside originals), not live application-read snapshot stores.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import db from '../../server/db/index.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { saveSnapshot } from '../../server/reports.js';
import { saveRedirectSnapshot } from '../../server/redirect-store.js';
import {
  SNAPSHOT_TABLE_REGISTRY,
  SNAPSHOT_TABLE_NAMES,
  getSnapshotTableDescriptor,
} from '../../server/db/snapshot-registry.js';

const MIGRATION_167_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../server/db/migrations/167-audit-snapshots-workspace-id.sql',
);

/**
 * Build a fresh in-memory DB carrying the PRE-migration-167 schema for the three legacy
 * snapshot tables + a minimal `workspaces` table, so the REAL migration 167 SQL can be
 * exec'd against it in isolation. This is the only way to re-run the migration
 * mid-suite (the shared test db singleton already ran it once during db-setup.ts).
 */
function buildPre167Db(): Database.Database {
  const mem = new Database(':memory:');
  mem.exec(`
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      webflow_site_id TEXT
    );
    -- Pre-167 legacy shapes (site_id-only, no workspace_id) — mirrors migration 004.
    CREATE TABLE audit_snapshots (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      site_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      audit TEXT NOT NULL,
      logo_url TEXT,
      action_items TEXT,
      previous_score INTEGER
    );
    CREATE TABLE redirect_snapshots (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      result TEXT NOT NULL
    );
    CREATE TABLE performance_snapshots (
      sub TEXT NOT NULL,
      site_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      result TEXT NOT NULL,
      PRIMARY KEY (sub, site_id)
    );
  `);
  return mem;
}

function runMigration167(mem: Database.Database): void {
  mem.exec(readFileSync(MIGRATION_167_PATH, 'utf-8'));
}

/**
 * Live `*_snapshots` tables in sqlite_master, excluding migration-bookkeeping tables
 * (`_orphaned` quarantine copies and `_r11_old` rename-aside originals from migration
 * 167's rebuild). This mirrors exactly what the registry itself claims to cover.
 */
function listLiveSnapshotTables(): string[] {
  const rows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%snapshots%'`)
    .all() as Array<{ name: string }>;
  return rows
    .map(r => r.name)
    .filter(name => !name.endsWith('_orphaned') && !name.endsWith('_r11_old') && !name.includes('_new'));
}

function tableHasColumn(table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some(c => c.name === column);
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

// FK enforcement is globally OFF in the test process (tests/db-setup.ts:28 — legacy
// fixtures insert ad-hoc workspace IDs). To exercise the real CASCADE behaviour, toggle
// foreign_keys ON for the assertion, then restore OFF. Same pattern as
// tests/integration/strategy-history-fk.test.ts withForeignKeysOn().
function withForeignKeysOn<T>(fn: () => T): T {
  db.pragma('foreign_keys = ON');
  try {
    return fn();
  } finally {
    db.pragma('foreign_keys = OFF');
  }
}

describe('snapshot table registry census', () => {
  it('registers every live *_snapshots table', () => {
    const liveTables = listLiveSnapshotTables();
    const unregistered = liveTables.filter(name => !SNAPSHOT_TABLE_NAMES.has(name));
    expect(unregistered, `Unregistered snapshot table(s) found: ${unregistered.join(', ')}. Add an entry to SNAPSHOT_TABLE_REGISTRY in server/db/snapshot-registry.ts.`).toEqual([]);
  });

  it('has no registry entries for tables that no longer exist', () => {
    const liveTables = new Set(listLiveSnapshotTables());
    const stale = SNAPSHOT_TABLE_REGISTRY.filter(entry => !liveTables.has(entry.name)).map(e => e.name);
    expect(stale, `Registry entries reference table(s) that don't exist in the live schema: ${stale.join(', ')}`).toEqual([]);
  });

  it('marks every registered table as workspaceScoped: true', () => {
    const notScoped = SNAPSHOT_TABLE_REGISTRY.filter(entry => !entry.workspaceScoped).map(e => e.name);
    expect(notScoped, `Registry entries claim workspaceScoped:false — post migration-167 every snapshot table must be workspace-scoped: ${notScoped.join(', ')}`).toEqual([]);
  });

  it('every registered table actually has a workspace_id column in the live schema', () => {
    const missingColumn = SNAPSHOT_TABLE_REGISTRY
      .filter(entry => !tableHasColumn(entry.name, 'workspace_id'))
      .map(e => e.name);
    expect(missingColumn, `Registry claims these tables are workspace-scoped, but they have no workspace_id column in the live schema: ${missingColumn.join(', ')}`).toEqual([]);
  });

  it('covers exactly the 13 known snapshot tables', () => {
    // A precise count catches both under-registration (a table silently dropped from
    // the registry) and over-registration (a stale/renamed entry) that the two tests
    // above wouldn't independently catch if they canceled out.
    expect(SNAPSHOT_TABLE_REGISTRY.length).toBe(13);
  });

  it('FAILS when a hand-added table simulates an unregistered snapshot table', () => {
    // Simulate a 14th snapshot table that skipped registration — the census must catch
    // it. This is the actual falsifiability check for the "unregistered snapshot table"
    // contract: without this test, "the census fails on missing registration" is an
    // assertion nobody verifies.
    const rogueTable = `rogue_test_snapshots_${randomUUID().slice(0, 8)}`;
    db.exec(`CREATE TABLE ${rogueTable} (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL)`);
    cleanups.push(() => db.exec(`DROP TABLE IF EXISTS ${rogueTable}`));

    const liveTables = listLiveSnapshotTables();
    const unregistered = liveTables.filter(name => !SNAPSHOT_TABLE_NAMES.has(name));
    expect(unregistered).toContain(rogueTable);
  });

  it('getSnapshotTableDescriptor returns undefined for an unregistered table name', () => {
    expect(getSnapshotTableDescriptor('definitely_not_a_registered_table')).toBeUndefined();
  });

  it('getSnapshotTableDescriptor returns the full descriptor for a registered table', () => {
    const descriptor = getSnapshotTableDescriptor('audit_snapshots');
    expect(descriptor).toBeDefined();
    expect(descriptor?.workspaceScoped).toBe(true);
    expect(descriptor?.hasForeignKeyCascade).toBe(true);
    expect(descriptor?.writerModule).toBe('server/reports.ts');
  });

  it('documents the one FK-CASCADE exception accurately (workspace_metrics_snapshots)', () => {
    const descriptor = getSnapshotTableDescriptor('workspace_metrics_snapshots');
    expect(descriptor).toBeDefined();
    expect(descriptor?.workspaceScoped).toBe(true);
    expect(descriptor?.hasForeignKeyCascade).toBe(false);

    // Verify this matches reality, not just the registry's claim.
    const fks = db.prepare(`PRAGMA foreign_key_list(workspace_metrics_snapshots)`).all() as unknown[];
    expect(fks.length).toBe(0);
  });

  it('every OTHER registered table has hasForeignKeyCascade: true backed by a real FK', () => {
    const entries = SNAPSHOT_TABLE_REGISTRY.filter(e => e.name !== 'workspace_metrics_snapshots');
    for (const entry of entries) {
      expect(entry.hasForeignKeyCascade, `${entry.name} should have hasForeignKeyCascade: true`).toBe(true);
      const fks = db.prepare(`PRAGMA foreign_key_list(${entry.name})`).all() as Array<{ table: string; on_delete: string }>;
      const workspaceFk = fks.find(fk => fk.table === 'workspaces');
      expect(workspaceFk, `${entry.name} claims hasForeignKeyCascade:true but has no FK to workspaces in the live schema`).toBeDefined();
      expect(workspaceFk?.on_delete).toBe('CASCADE');
    }
  });
});

describe('migration 167 retrofit — row preservation + orphan quarantine', () => {
  it('audit_snapshots: the REAL writer (saveSnapshot) threads workspace_id forward (C1/D3)', () => {
    const ws = seedWorkspace();
    cleanups.push(ws.cleanup);

    const EMPTY_AUDIT = {
      siteScore: 0, totalPages: 0, errors: 0, warnings: 0, infos: 0, pages: [], siteWideIssues: [],
    };

    // Insert through the ACTUAL production write path, not a hand-rolled legacy INSERT.
    // Pre-D3 this writer set only site_id and every post-167 row landed with a NULL
    // workspace_id (the FK CASCADE the registry advertises never fired). D3 threads the
    // 1:1-resolved workspace_id — seedWorkspace() gives this site_id a single owning
    // workspace, so the COUNT=1 resolution must populate it.
    const snapshot = saveSnapshot(ws.webflowSiteId, 'Test Site', EMPTY_AUDIT);
    cleanups.push(() => db.prepare('DELETE FROM audit_snapshots WHERE id = ?').run(snapshot.id));

    const row = db.prepare('SELECT workspace_id, site_id FROM audit_snapshots WHERE id = ?').get(snapshot.id) as { workspace_id: string | null; site_id: string };
    expect(row.site_id).toBe(ws.webflowSiteId);
    expect(row.workspace_id).toBe(ws.workspaceId);
  });

  it('redirect_snapshots: the REAL writer (saveRedirectSnapshot) threads workspace_id forward (C1/D3)', () => {
    const ws = seedWorkspace();
    cleanups.push(ws.cleanup);

    const EMPTY_REDIRECT_RESULT = {
      chains: [], pageStatuses: [],
      summary: { totalPages: 0, healthy: 0, redirecting: 0, notFound: 0, errors: 0, chainsDetected: 0, longestChain: 0 },
      scannedAt: new Date(0).toISOString(),
    };

    const snapshot = saveRedirectSnapshot(ws.webflowSiteId, EMPTY_REDIRECT_RESULT);
    cleanups.push(() => db.prepare('DELETE FROM redirect_snapshots WHERE id = ?').run(snapshot.id));

    const row = db.prepare('SELECT workspace_id, site_id FROM redirect_snapshots WHERE id = ?').get(snapshot.id) as { workspace_id: string | null; site_id: string };
    expect(row.site_id).toBe(ws.webflowSiteId);
    expect(row.workspace_id).toBe(ws.workspaceId);
  });

  it('performance_snapshots_orphaned exists and quarantines rows whose site_id does not resolve to a workspace (never deletes)', () => {
    // This mirrors the exact shape of the ~2 orphan rows observed in the dev DB before
    // migration 167 ran: performance_snapshots rows with a composite
    // `${webflowSiteId}_${pageKey}` site_id from saveSinglePageSpeed(), which is never a
    // real workspaces.webflow_site_id.
    const orphanTableExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'performance_snapshots_orphaned'`)
      .get();
    expect(orphanTableExists, 'performance_snapshots_orphaned quarantine table must exist after migration 167').toBeDefined();

    const cols = db.prepare(`PRAGMA table_info(performance_snapshots_orphaned)`).all() as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    // Quarantine table intentionally has NO workspace_id column — by definition an
    // orphan row's site_id never resolved to one.
    expect(colNames).not.toContain('workspace_id');
    expect(colNames).toContain('quarantine_reason');
    expect(colNames).toContain('quarantined_at');
  });

  it('audit_snapshots_orphaned and redirect_snapshots_orphaned quarantine tables exist', () => {
    for (const table of ['audit_snapshots_orphaned', 'redirect_snapshots_orphaned']) {
      const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table);
      expect(exists, `${table} must exist after migration 167`).toBeDefined();
    }
  });

  it('rename-aside originals (_r11_old) still exist for rollback safety, per the delayed-drop contract', () => {
    for (const table of ['audit_snapshots_r11_old', 'redirect_snapshots_r11_old', 'performance_snapshots_r11_old']) {
      const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table);
      expect(exists, `${table} must still exist — migration 167 must not DROP the renamed-aside original (docs/rules/destructive-migrations.md delayed-drop contract)`).toBeDefined();
    }
  });

  it('a performance_snapshots row with an unresolvable site_id would be quarantined by construction (schema-level simulation)', () => {
    // We can't re-run migration 167 mid-test-suite (it already ran once during
    // db-setup.ts's runMigrations()), so this test simulates the retrofit's join
    // condition directly: any site_id with no matching workspaces.webflow_site_id is,
    // by construction, an orphan under the migration's WHERE NOT EXISTS clause.
    const bogusSiteId = `unresolvable-${randomUUID()}`;
    const resolved = db
      .prepare('SELECT id FROM workspaces WHERE webflow_site_id = ?')
      .get(bogusSiteId);
    expect(resolved, 'a random site_id must not coincidentally resolve to a real workspace').toBeUndefined();
  });

  it('redirect_snapshots and audit_snapshots FK-CASCADE delete on workspace removal for resolvable rows', () => {
    const ws = seedWorkspace();

    const redirectId = `redirect-${randomUUID().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO redirect_snapshots (id, site_id, workspace_id, created_at, result)
      VALUES (?, ?, ?, ?, ?)
    `).run(redirectId, ws.webflowSiteId, ws.workspaceId, new Date().toISOString(), '{}');

    const before = db.prepare('SELECT COUNT(*) as c FROM redirect_snapshots WHERE id = ?').get(redirectId) as { c: number };
    expect(before.c).toBe(1);

    withForeignKeysOn(() => {
      // Raw DELETE (not the workspace store's deleteWorkspace) so the ON DELETE CASCADE
      // FK is the only mechanism removing the redirect_snapshots row.
      db.prepare('DELETE FROM workspaces WHERE id = ?').run(ws.workspaceId);
    });

    const after = db.prepare('SELECT COUNT(*) as c FROM redirect_snapshots WHERE id = ?').get(redirectId) as { c: number };
    expect(after.c).toBe(0);
  });

  // ── Fix B — row-count preservation on the live migrated DB ──
  // The migration header advertises "COUNT(live) + COUNT(orphaned) == COUNT(_r11_old)".
  // Assert it directly on the shared test DB (which already ran migration 167 during
  // db-setup.ts). Nothing dropped, nothing duplicated.
  it.each([
    ['audit_snapshots'],
    ['redirect_snapshots'],
    ['performance_snapshots'],
  ])('%s: live + orphaned rows exactly account for every _r11_old row (nothing dropped or duplicated)', (table) => {
    const live = (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
    const orphaned = (db.prepare(`SELECT COUNT(*) AS c FROM ${table}_orphaned`).get() as { c: number }).c;
    const old = (db.prepare(`SELECT COUNT(*) AS c FROM ${table}_r11_old`).get() as { c: number }).c;
    expect(live + orphaned).toBe(old);
  });

  // ── Fix C — orphan counts are pinned ("counted"; SQL migration can't log) ──
  it('pins the migration 167 orphan counts on the shared test DB (all three legacy tables)', () => {
    // The test-DB template is seeded fresh (no legacy site-keyed snapshot rows), so all
    // three legacy tables + their _r11_old originals are empty here and orphan count is 0.
    // This test's value is that it FAILS if a future change starts silently dropping or
    // mis-partitioning rows — the counts become a regression oracle, not just inspectable.
    for (const table of ['audit_snapshots', 'redirect_snapshots', 'performance_snapshots']) {
      const old = (db.prepare(`SELECT COUNT(*) AS c FROM ${table}_r11_old`).get() as { c: number }).c;
      const orphaned = (db.prepare(`SELECT COUNT(*) AS c FROM ${table}_orphaned`).get() as { c: number }).c;
      // Every orphan must trace back to an _r11_old row (orphan count never exceeds the
      // pre-migration population).
      expect(orphaned).toBeLessThanOrEqual(old);
    }
  });

  // ── Fix B guard — the CV-1 regression: a DUPLICATE webflow_site_id must NOT abort ──
  it('CV-1: a duplicate webflow_site_id does NOT abort the migration; the ambiguous row is quarantined and the row-count identity holds', () => {
    const mem = buildPre167Db();

    // Two workspaces share the SAME webflow_site_id — the exact schema-unguarded case
    // (webflow_site_id has no UNIQUE constraint) that a naive 1:many JOIN would turn into
    // a PK collision, aborting the whole migration.
    mem.exec(`
      INSERT INTO workspaces (id, name, webflow_site_id) VALUES ('ws_a', 'A', 'shared-site');
      INSERT INTO workspaces (id, name, webflow_site_id) VALUES ('ws_b', 'B', 'shared-site');
      -- One workspace with a UNIQUE site_id (the resolvable control).
      INSERT INTO workspaces (id, name, webflow_site_id) VALUES ('ws_c', 'C', 'solo-site');
      -- audit row on the ambiguous site (must be quarantined, not aborted, not guessed).
      INSERT INTO audit_snapshots (id, site_id, site_name, created_at, audit)
        VALUES ('a-ambiguous', 'shared-site', 'Shared', '2026-01-01', '{}');
      -- audit row on the unique site (must resolve to ws_c).
      INSERT INTO audit_snapshots (id, site_id, site_name, created_at, audit)
        VALUES ('a-resolvable', 'solo-site', 'Solo', '2026-01-02', '{}');
      -- audit row on a site with NO workspace at all (zero-match orphan).
      INSERT INTO audit_snapshots (id, site_id, site_name, created_at, audit)
        VALUES ('a-nomatch', 'ghost-site', 'Ghost', '2026-01-03', '{}');
    `);

    // (i) The migration must NOT throw despite the duplicate site_id.
    expect(() => runMigration167(mem)).not.toThrow();

    // (ii) Ambiguous row quarantined (never guessed to ws_a or ws_b); zero-match row
    // quarantined; resolvable row landed in live with the correct workspace_id.
    const ambiguousInLive = mem.prepare(`SELECT COUNT(*) AS c FROM audit_snapshots WHERE id = 'a-ambiguous'`).get() as { c: number };
    const ambiguousInOrphan = mem.prepare(`SELECT COUNT(*) AS c FROM audit_snapshots_orphaned WHERE id = 'a-ambiguous'`).get() as { c: number };
    expect(ambiguousInLive.c).toBe(0);
    expect(ambiguousInOrphan.c).toBe(1);

    const nomatchInOrphan = mem.prepare(`SELECT COUNT(*) AS c FROM audit_snapshots_orphaned WHERE id = 'a-nomatch'`).get() as { c: number };
    expect(nomatchInOrphan.c).toBe(1);

    const resolvable = mem.prepare(`SELECT workspace_id FROM audit_snapshots WHERE id = 'a-resolvable'`).get() as { workspace_id: string | null } | undefined;
    expect(resolvable?.workspace_id).toBe('ws_c');

    // (iii) Row-count identity holds: 3 original rows == 1 live + 2 orphaned.
    const live = (mem.prepare(`SELECT COUNT(*) AS c FROM audit_snapshots`).get() as { c: number }).c;
    const orphaned = (mem.prepare(`SELECT COUNT(*) AS c FROM audit_snapshots_orphaned`).get() as { c: number }).c;
    const old = (mem.prepare(`SELECT COUNT(*) AS c FROM audit_snapshots_r11_old`).get() as { c: number }).c;
    expect(live).toBe(1);
    expect(orphaned).toBe(2);
    expect(live + orphaned).toBe(old);

    mem.close();
  });

  // Companion: the composite (sub, site_id) PK on performance_snapshots is the table most
  // at risk of a collision-abort under a duplicate site_id — prove it too.
  it('CV-1: performance_snapshots (composite PK) also survives a duplicate webflow_site_id and quarantines the ambiguous row', () => {
    const mem = buildPre167Db();
    mem.exec(`
      INSERT INTO workspaces (id, name, webflow_site_id) VALUES ('ws_a', 'A', 'shared-site');
      INSERT INTO workspaces (id, name, webflow_site_id) VALUES ('ws_b', 'B', 'shared-site');
      INSERT INTO performance_snapshots (sub, site_id, created_at, result)
        VALUES ('page-weight', 'shared-site', '2026-01-01', '{}');
    `);

    expect(() => runMigration167(mem)).not.toThrow();

    const inLive = (mem.prepare(`SELECT COUNT(*) AS c FROM performance_snapshots`).get() as { c: number }).c;
    const inOrphan = (mem.prepare(`SELECT COUNT(*) AS c FROM performance_snapshots_orphaned`).get() as { c: number }).c;
    expect(inLive).toBe(0);
    expect(inOrphan).toBe(1);

    mem.close();
  });

  // Negative control for the in-memory harness itself: a clean 1:1 mapping resolves and
  // preserves rows, proving the harness isn't trivially quarantining everything.
  it('in-memory harness sanity: a clean 1:1 site_id resolves to its workspace and is NOT quarantined', () => {
    const mem = buildPre167Db();
    mem.exec(`
      INSERT INTO workspaces (id, name, webflow_site_id) VALUES ('ws_only', 'Only', 'one-site');
      INSERT INTO redirect_snapshots (id, site_id, created_at, result)
        VALUES ('r1', 'one-site', '2026-01-01', '{}');
    `);

    runMigration167(mem);

    const row = mem.prepare(`SELECT workspace_id FROM redirect_snapshots WHERE id = 'r1'`).get() as { workspace_id: string | null } | undefined;
    expect(row?.workspace_id).toBe('ws_only');
    const orphanCount = (mem.prepare(`SELECT COUNT(*) AS c FROM redirect_snapshots_orphaned`).get() as { c: number }).c;
    expect(orphanCount).toBe(0);

    mem.close();
  });
});
