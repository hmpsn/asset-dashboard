/**
 * Integration tests: tracked_keywords transaction-safety + nesting behavior + reconcile preservation.
 *
 * ── Honesty note on what is (and isn't) reproducible in-process ──────────────
 * better-sqlite3 is SYNCHRONOUS and this app uses a SINGLE connection, so two
 * writers in the same process CANNOT interleave at the JS level — an in-process
 * `Promise.all` over two writers will never reproduce a lost update. The genuine,
 * real property that `withTrackedKeywordsTxn`'s `.immediate()` provides is the
 * deferred→IMMEDIATE SQLITE_BUSY_SNAPSHOT defense (PR #1030): a *deferred*
 * transaction that reads first takes a read snapshot, and if a SECOND connection
 * commits a write before it writes, its write fails with SQLITE_BUSY_SNAPSHOT.
 * `BEGIN IMMEDIATE` takes the write lock upfront and avoids this. To exercise the
 * real property we therefore open a SECOND raw better-sqlite3 connection to the
 * same WAL database file.
 *
 * T1a — IMMEDIATE vs deferred (the real justification for `.immediate()`):
 *        (1) a SQL-level demonstration using two raw connections, and
 *        (2) a helper-tied regression that drives the REAL withTrackedKeywordsTxn
 *            with a second-connection write interposed between its read and write,
 *            asserting it does NOT throw SQLITE_BUSY_SNAPSHOT. This regresses
 *            (throws SQLITE_BUSY_SNAPSHOT) if the production line is reverted to
 *            a deferred / non-immediate transaction.
 * T1b — nesting behavior: calling updateTrackedKeywords inside an outer
 *        db.transaction() persists the keyword and the outer commit includes it.
 *        (better-sqlite3 wrapped txns downgrade to a SAVEPOINT and do NOT throw on
 *        nesting — only a raw `db.prepare('BEGIN IMMEDIATE')` throws. We assert the
 *        OBSERVABLE persistence, not a throw.)
 * T1c — reconcile merge-preservation: a manually-added keyword survives a strategy
 *        reconcile (NOT a race test — a behavioral preservation assertion).
 *
 * Port: 13886 (allocated for this file; matches the pre-plan audit spec)
 */
import path from 'path';
import BetterSqlite3, { type Database as BetterSqlite3Database } from 'better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

vi.mock('../../server/email.js', () => ({
  notifyTeamActionApproved: vi.fn(),
  notifyTeamContentRequest: vi.fn(),
  notifyTeamChangesRequested: vi.fn(),
}));

const noopMiddleware = (_req: unknown, _res: unknown, next: () => void) => next();
vi.mock('../../server/middleware.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/middleware.js')>();
  return {
    ...original,
    publicWriteLimiter: noopMiddleware,
    publicApiLimiter: noopMiddleware,
    globalPublicLimiter: noopMiddleware,
  };
});

// ─── Test context ─────────────────────────────────────────────────────────────
const PORT = 13886;
const ctx = createTestContext(PORT);

let workspaceId: string;
let cleanup: () => void;

beforeAll(async () => {
  await ctx.startServer();
  const seeded = seedWorkspace({ tier: 'premium' });
  workspaceId = seeded.workspaceId;
  cleanup = seeded.cleanup;
}, 40_000);

beforeEach(async () => {
  // Clear tracked keywords between tests — both the (now kept-but-empty) config row
  // and the tracked_keywords TABLE (the SOLE store post-strip / the contended writer).
  const { default: db } = await import('../../server/db/index.js');
  db.prepare('DELETE FROM rank_tracking_config WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM tracked_keywords WHERE workspace_id = ?').run(workspaceId);
});

afterAll(async () => {
  cleanup?.();
  await ctx.stopServer();
});

/**
 * Open a SECOND raw better-sqlite3 connection to the SAME database file the
 * server's `db` singleton uses. This is the only way to reproduce real
 * cross-connection write contention (SQLITE_BUSY / SQLITE_BUSY_SNAPSHOT) in a
 * single-process test — the app's own `db` is one synchronous connection and
 * cannot contend with itself.
 *
 * busy_timeout is set to 0 so contention surfaces immediately as an error
 * instead of blocking (a blocking second connection would deadlock the single
 * JS thread when interposed inside the helper's synchronous updater).
 */
async function openSecondConnection(): Promise<BetterSqlite3Database> {
  const dataDir = process.env.DATA_DIR;
  if (!dataDir) throw new Error('DATA_DIR not set — test infra should have set it');
  const conn = new BetterSqlite3(path.join(dataDir, 'dashboard.db'));
  conn.pragma('busy_timeout = 0');
  return conn;
}

// Wave 3c-iii-b: the contended writer is now the tracked_keywords TABLE (the SOLE
// store — the blob is `'[]'` and no longer read). Retarget the raw read/write helpers
// (used to interpose a second-connection write between the real helper's read and
// write) to the TABLE so the contention is on the genuinely-contended row, keeping
// the deferred→IMMEDIATE SQLITE_BUSY_SNAPSHOT regression faithful to production.
function readKeywordsRaw(conn: BetterSqlite3Database, ws: string): { query: string }[] {
  return conn
    .prepare('SELECT query FROM tracked_keywords WHERE workspace_id = ? ORDER BY sort_order ASC, added_at ASC')
    .all(ws) as { query: string }[];
}

function writeKeywordsRaw(conn: BetterSqlite3Database, ws: string, keywords: Array<{ query: string }>): void {
  // Delete-then-reinsert (mirrors replaceAllTrackedKeywordRows) so a second-connection
  // write is a real contended write against the same workspace's rows.
  const del = conn.prepare('DELETE FROM tracked_keywords WHERE workspace_id = ?');
  const ins = conn.prepare(`
    INSERT INTO tracked_keywords (workspace_id, normalized_query, query, pinned, added_at, source, status, sort_order)
    VALUES (?, ?, ?, 0, ?, 'manual', 'active', ?)
    ON CONFLICT(workspace_id, normalized_query) DO UPDATE SET query = excluded.query, sort_order = excluded.sort_order
  `);
  del.run(ws);
  const now = new Date().toISOString();
  keywords.forEach((k, i) => {
    const normalized = k.query.trim().toLowerCase();
    if (!normalized) return;
    ins.run(ws, normalized, k.query, now, i);
  });
}

// ─── T1a: IMMEDIATE vs deferred — the real justification for `.immediate()` ─────
describe('T1a: deferred→IMMEDIATE SQLITE_BUSY_SNAPSHOT defense (PR #1030)', () => {
  it('SQL-level demonstration: deferred read→(other-conn write)→write throws SQLITE_BUSY_SNAPSHOT; IMMEDIATE serializes cleanly', async () => {
    // This is a SQL-level DEMONSTRATION of the property `.immediate()` relies on.
    // It does NOT route through the helper — it proves the underlying SQLite
    // semantics directly with two raw connections (connA = the server `db`
    // singleton, connB = a second raw connection to the same WAL file).
    const { default: connA } = await import('../../server/db/index.js');
    const connB = await openSecondConnection();
    try {
      // ── DEFERRED: A reads (takes a read snapshot), B writes+commits on the
      //    other connection, then A writes against its now-stale snapshot. ──
      writeKeywordsRaw(connA, workspaceId, []);
      let deferredError: { code?: string } | null = null;
      try {
        connA.transaction(() => {
          const snapA = readKeywordsRaw(connA, workspaceId); // read snapshot
          writeKeywordsRaw(connB, workspaceId, [...readKeywordsRaw(connB, workspaceId), { query: 'B-kw' }]); // other conn commits
          writeKeywordsRaw(connA, workspaceId, [...snapA, { query: 'A-kw' }]); // A writes against stale snapshot → conflict
        }).deferred();
      } catch (err) {
        deferredError = err as { code?: string };
      }
      expect(
        deferredError?.code,
        'deferred read→(other-conn write)→write must fail with SQLITE_BUSY_SNAPSHOT',
      ).toBe('SQLITE_BUSY_SNAPSHOT');

      // ── IMMEDIATE: A takes the write lock upfront. The other connection
      //    serializes AFTER A commits; both writes survive, no error. ──
      writeKeywordsRaw(connA, workspaceId, []);
      let immediateError: { code?: string } | null = null;
      try {
        connA.transaction(() => {
          const snapA = readKeywordsRaw(connA, workspaceId); // A already holds the write lock
          writeKeywordsRaw(connA, workspaceId, [...snapA, { query: 'A-kw' }]);
        }).immediate();
        // B serializes after A's commit, reads fresh, and appends.
        writeKeywordsRaw(connB, workspaceId, [...readKeywordsRaw(connB, workspaceId), { query: 'B-kw' }]);
      } catch (err) {
        immediateError = err as { code?: string };
      }
      expect(immediateError, 'IMMEDIATE-first path must not error').toBeNull();
      const queries = readKeywordsRaw(connA, workspaceId).map((k) => (k as { query: string }).query);
      expect(queries).toContain('A-kw');
      expect(queries).toContain('B-kw');
    } finally {
      connB.close();
    }
  });

  it('helper-tied regression: real withTrackedKeywordsTxn does NOT throw SQLITE_BUSY_SNAPSHOT when a second connection writes between its read and write', async () => {
    // This drives the REAL withTrackedKeywordsTxn. We interpose a second-connection
    // write to the tracked_keywords TABLE (the SOLE store post-strip) inside the
    // updater (which the helper runs between its table read and its table write).
    // Under the real `.immediate()` wiring, the helper holds the write lock from the
    // start, so the second connection's write fails fast with SQLITE_BUSY
    // (busy_timeout=0) and the helper commits cleanly. If the production line is
    // reverted to a deferred / non-immediate transaction, the second connection's
    // write SUCCEEDS and commits before the helper writes — and the helper's table
    // write then throws SQLITE_BUSY_SNAPSHOT.
    //
    // PROVEN regression (temporarily reverting `.immediate()` → `.deferred()` in
    // server/rank-tracking.ts and running this test):
    //   AssertionError: real withTrackedKeywordsTxn must not surface SQLITE_BUSY_SNAPSHOT
    //   Expected: null
    //   Received: { code: 'SQLITE_BUSY_SNAPSHOT', ... }
    const { withTrackedKeywordsTxn, getTrackedKeywords } = await import('../../server/rank-tracking.js');
    const { TRACKED_KEYWORD_SOURCE, TRACKED_KEYWORD_STATUS } = await import('../../shared/types/rank-tracking.js');
    const connB = await openSecondConnection();
    try {
      writeKeywordsRaw((await import('../../server/db/index.js')).default, workspaceId, []);

      let helperError: { code?: string } | null = null;
      try {
        withTrackedKeywordsTxn(workspaceId, (existing) => {
          // Interpose a second-connection write between the helper's read and write.
          // Under IMMEDIATE this throws SQLITE_BUSY (busy_timeout=0) and is swallowed;
          // under deferred it succeeds and commits, poisoning the helper's snapshot.
          try {
            writeKeywordsRaw(connB, workspaceId, [
              ...readKeywordsRaw(connB, workspaceId),
              { query: 'interloper-from-second-connection' },
            ]);
          } catch {
            // Expected under IMMEDIATE: the helper holds the write lock.
          }
          return [
            ...existing,
            {
              query: 'helper-written-keyword',
              pinned: false,
              addedAt: new Date().toISOString(),
              source: TRACKED_KEYWORD_SOURCE.MANUAL,
              status: TRACKED_KEYWORD_STATUS.ACTIVE,
            },
          ];
        });
      } catch (err) {
        helperError = err as { code?: string };
      }

      expect(
        helperError,
        `real withTrackedKeywordsTxn must not surface SQLITE_BUSY_SNAPSHOT (got: ${helperError?.code ?? 'none'})`,
      ).toBeNull();

      // The helper's own write must have landed.
      const final = getTrackedKeywords(workspaceId, { includeInactive: true });
      expect(final.some((k) => k.query === 'helper-written-keyword')).toBe(true);
    } finally {
      connB.close();
    }
  });
});

// ─── T1b: nesting behavior — observable persistence inside an outer txn ─────────
describe('T1b: updateTrackedKeywords inside an outer db.transaction() persists', () => {
  it('persists the keyword and the outer commit includes it', async () => {
    // better-sqlite3 WRAPPED transactions (db.transaction(fn)()) downgrade to a
    // SAVEPOINT when nested and do NOT throw "cannot start a transaction within a
    // transaction" — only a raw `db.prepare('BEGIN IMMEDIATE').run()` throws. So we
    // assert the OBSERVABLE behavior: the inner write commits with the outer txn.
    const { default: db } = await import('../../server/db/index.js');
    const { updateTrackedKeywords, getTrackedKeywords } = await import('../../server/rank-tracking.js');
    const { TRACKED_KEYWORD_SOURCE, TRACKED_KEYWORD_STATUS } = await import('../../shared/types/rank-tracking.js');

    db.transaction(() => {
      updateTrackedKeywords(workspaceId, (keywords) => [
        ...keywords,
        {
          query: 'nesting-safe-test-keyword',
          pinned: false,
          addedAt: new Date().toISOString(),
          source: TRACKED_KEYWORD_SOURCE.MANUAL,
          status: TRACKED_KEYWORD_STATUS.ACTIVE,
        },
      ]);
    })();

    // After the outer commit, the keyword written by the nested call is present.
    const result = getTrackedKeywords(workspaceId);
    expect(result.some((k) => k.query === 'nesting-safe-test-keyword')).toBe(true);
  });

  it('a rolled-back outer transaction discards the nested write (nested call inherits the outer txn)', async () => {
    // Corollary that PROVES the nested call really inherits the outer transaction
    // rather than committing independently: if the outer txn throws (rolls back),
    // the nested write must NOT persist.
    //
    // Honesty note: this does NOT regress against the trivial break of removing the
    // `db.inTransaction` guard — better-sqlite3 wrapped txns nest as a SAVEPOINT that
    // still rolls back with the outer txn, so that break is harmless. It DOES regress
    // (the keyword survives the rollback) if the helper escapes the outer txn by
    // writing through an independent / eagerly-committing connection — the genuinely
    // harmful failure mode this assertion guards against. PROVEN by patching the
    // helper to write via a fresh auto-committing connection when db.inTransaction:
    //   AssertionError: expected true to be false (rolled-back-keyword persisted)
    const { default: db } = await import('../../server/db/index.js');
    const { updateTrackedKeywords, getTrackedKeywords } = await import('../../server/rank-tracking.js');
    const { TRACKED_KEYWORD_SOURCE, TRACKED_KEYWORD_STATUS } = await import('../../shared/types/rank-tracking.js');

    expect(() => {
      db.transaction(() => {
        updateTrackedKeywords(workspaceId, (keywords) => [
          ...keywords,
          {
            query: 'rolled-back-keyword',
            pinned: false,
            addedAt: new Date().toISOString(),
            source: TRACKED_KEYWORD_SOURCE.MANUAL,
            status: TRACKED_KEYWORD_STATUS.ACTIVE,
          },
        ]);
        throw new Error('force outer rollback');
      })();
    }).toThrow('force outer rollback');

    const result = getTrackedKeywords(workspaceId, { includeInactive: true });
    expect(result.some((k) => k.query === 'rolled-back-keyword')).toBe(false);
  });
});

// ─── T1c: reconcile merge-preservation (NOT a race test) ───────────────────────
describe('T1c: reconcile merge-preservation — manual keyword survives strategy rebuild', () => {
  it('a manually-added keyword survives seedKeywordStrategyTrackedKeywords (reconcile preserve path)', async () => {
    // This is a behavioral preservation assertion, NOT a concurrency/race test.
    // reconcileStrategyRankTracking rebuilds the full tracked_keywords array; the
    // non-strategy (manual) keyword must survive via the `manuallyPreserved` path
    // (server/rank-tracking-reconciliation.ts: `next.push(existing)` for
    // non-strategy-owned rows). PROVEN regression: deleting that `next.push(existing)`
    // line drops the manual keyword and this assertion fails.
    const { addTrackedKeyword, getTrackedKeywords } = await import('../../server/rank-tracking.js');
    const { seedKeywordStrategyTrackedKeywords } = await import('../../server/keyword-strategy-follow-ons.js');
    const { TRACKED_KEYWORD_SOURCE } = await import('../../shared/types/rank-tracking.js');

    const manualKw = 'my-manual-unique-keyword-xyz';
    const strategyKw = 'strategy-primary-keyword-abc';

    addTrackedKeyword(workspaceId, manualKw, { source: TRACKED_KEYWORD_SOURCE.MANUAL });

    seedKeywordStrategyTrackedKeywords({
      workspaceId,
      workspaceName: 'Test Workspace',
      keywordStrategy: {
        siteKeywords: [strategyKw],
        siteKeywordMetrics: [],
        generatedAt: new Date().toISOString(),
      },
      pageMap: [],
    });

    const final = getTrackedKeywords(workspaceId, { includeInactive: true });
    const queries = final.map((k) => k.query);

    expect(
      queries.includes(manualKw),
      `Manual keyword "${manualKw}" was lost after reconcile. Final state: ${queries.join(', ')}`,
    ).toBe(true);
    expect(
      queries.includes(strategyKw),
      `Strategy keyword "${strategyKw}" should also be present. Final state: ${queries.join(', ')}`,
    ).toBe(true);
  });

  it('withTrackedKeywordsTxn returns the post-mutation array (3x-parse fix: no extra read)', async () => {
    // Behavioral assertion: the helper returns the post-mutation state directly so
    // callers do not need a second getTrackedKeywords() read. Regresses if the
    // helper stops returning config.trackedKeywords.
    const { withTrackedKeywordsTxn, getTrackedKeywords } = await import('../../server/rank-tracking.js');
    const { TRACKED_KEYWORD_SOURCE, TRACKED_KEYWORD_STATUS } = await import('../../shared/types/rank-tracking.js');

    const result = withTrackedKeywordsTxn(workspaceId, () => [
      {
        query: 'return-value-test-kw',
        pinned: false,
        addedAt: new Date().toISOString(),
        source: TRACKED_KEYWORD_SOURCE.MANUAL,
        status: TRACKED_KEYWORD_STATUS.ACTIVE,
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].query).toBe('return-value-test-kw');

    const fromDb = getTrackedKeywords(workspaceId);
    expect(fromDb).toHaveLength(1);
    expect(fromDb[0].query).toBe('return-value-test-kw');
  });
});
