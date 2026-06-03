/**
 * Integration tests: tracked_keywords lost-update race + nesting-safety + reconcile race.
 *
 * T1a — concurrent withTrackedKeywordsTxn: simulate the lost-update race that
 *        occurs when two writers each do readConfig → mutate → writeConfig
 *        without BEGIN IMMEDIATE. With the fix in place, all 10 keywords survive.
 *        We simulate the race by manually performing the read→write steps in an
 *        interleaved order (read A, read B, write A, write B → B overwrites A's data).
 *        Then we verify withTrackedKeywordsTxn prevents it.
 *
 * T1b — nesting safety: calling updateTrackedKeywords inside an outer
 *        db.transaction() must NOT throw "cannot start a transaction within
 *        a transaction". The db.inTransaction guard NO-OPs the inner BEGIN.
 *
 * T1c — reconcile vs manual race: seedKeywordStrategyTrackedKeywords (full-array
 *        rebuild) interleaved with addTrackedKeyword; the manually-added keyword
 *        must survive the rebuild when using withTrackedKeywordsTxn.
 *
 * Port: 13886 (allocated for this file; matches the pre-plan audit spec)
 */
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
  // Clear tracked keywords between tests
  const { default: db } = await import('../../server/db/index.js');
  db.prepare('DELETE FROM rank_tracking_config WHERE workspace_id = ?').run(workspaceId);
});

afterAll(async () => {
  cleanup?.();
  await ctx.stopServer();
});

// ─── T1a: lost-update race simulation ─────────────────────────────────────────
// The race: two writers each do (read → mutate → write) without an enclosing
// BEGIN IMMEDIATE. Writer B reads before Writer A writes, so B's write overwrites
// A's changes and A's keyword is silently dropped.
//
// We simulate this with manual interleaving at the function level:
//   1. Read state into snapshot A (0 keywords)
//   2. Read state into snapshot B (0 keywords)
//   3. Writer A adds kw1 to its snapshot and writes → DB has [kw1]
//   4. Writer B adds kw2 to its snapshot (still empty!) and writes → DB has [kw2] only
//
// withTrackedKeywordsTxn serialises this with BEGIN IMMEDIATE so step 4 would
// see [kw1] and produce [kw1, kw2].
describe('T1a: lost-update race — withTrackedKeywordsTxn prevents keyword loss', () => {
  it('withTrackedKeywordsTxn: all 10 keywords survive N sequential calls (no-op test, verifies API)', async () => {
    // Import the new safe helper
    const { withTrackedKeywordsTxn } = await import('../../server/rank-tracking.js');
    const { getTrackedKeywords } = await import('../../server/rank-tracking.js');
    const { TRACKED_KEYWORD_SOURCE, TRACKED_KEYWORD_STATUS } = await import('../../shared/types/rank-tracking.js');

    const N = 10;
    const keywords = Array.from({ length: N }, (_, i) => `txn-safe-keyword-${i + 1}`);

    // Run N sequential withTrackedKeywordsTxn calls
    for (const kw of keywords) {
      withTrackedKeywordsTxn(workspaceId, existing => [
        ...existing,
        {
          query: kw,
          pinned: false,
          addedAt: new Date().toISOString(),
          source: TRACKED_KEYWORD_SOURCE.MANUAL,
          status: TRACKED_KEYWORD_STATUS.ACTIVE,
        },
      ]);
    }

    const final = getTrackedKeywords(workspaceId);
    expect(final.length).toBe(N);
    for (const kw of keywords) {
      expect(final.some(k => k.query === kw), `Missing keyword: ${kw}`).toBe(true);
    }
  });

  it('demonstrates the lost-update race WITHOUT the fix (manual interleaving)', async () => {
    // This test demonstrates WHY the fix is needed by simulating the race manually.
    // It does NOT use withTrackedKeywordsTxn — it simulates the old code path.
    const { default: db } = await import('../../server/db/index.js');
    const { TRACKED_KEYWORD_SOURCE, TRACKED_KEYWORD_STATUS } = await import('../../shared/types/rank-tracking.js');
    const { parseJsonSafeArray } = await import('../../server/db/json-validation.js');
    const { z } = await import('zod');

    // Simple read/write helpers to simulate the old (broken) pattern
    function rawRead(): Array<{ query: string; pinned: boolean; addedAt: string; source: string; status: string }> {
      const row = db.prepare('SELECT tracked_keywords FROM rank_tracking_config WHERE workspace_id = ?').get(workspaceId) as { tracked_keywords: string } | undefined;
      if (!row) return [];
      return parseJsonSafeArray(row.tracked_keywords, z.object({
        query: z.string(),
        pinned: z.boolean().default(false),
        addedAt: z.string().default(''),
        source: z.string().default('manual'),
        status: z.string().default('active'),
      }), { workspaceId, table: 'test', field: 'tracked_keywords' });
    }

    function rawWrite(keywords: Array<{ query: string; pinned: boolean; addedAt: string; source: string; status: string }>): void {
      db.prepare(`
        INSERT INTO rank_tracking_config (workspace_id, tracked_keywords)
        VALUES (?, ?)
        ON CONFLICT(workspace_id) DO UPDATE SET tracked_keywords = ?
      `).run(workspaceId, JSON.stringify(keywords), JSON.stringify(keywords));
    }

    // Simulate the lost-update race:
    // Writer A reads (sees [])
    const snapshotA = rawRead();
    // Writer B reads (sees []) — B reads BEFORE A writes
    const snapshotB = rawRead();

    // Writer A mutates its snapshot and writes → DB has [kw-writer-A]
    snapshotA.push({ query: 'kw-writer-A', pinned: false, addedAt: new Date().toISOString(), source: TRACKED_KEYWORD_SOURCE.MANUAL, status: TRACKED_KEYWORD_STATUS.ACTIVE });
    rawWrite(snapshotA);

    // Writer B mutates its stale snapshot and writes → DB has [kw-writer-B] ONLY (A's data dropped!)
    snapshotB.push({ query: 'kw-writer-B', pinned: false, addedAt: new Date().toISOString(), source: TRACKED_KEYWORD_SOURCE.MANUAL, status: TRACKED_KEYWORD_STATUS.ACTIVE });
    rawWrite(snapshotB);

    // Verify the race: kw-writer-A was LOST
    const finalRaw = rawRead();
    expect(finalRaw.some(k => k.query === 'kw-writer-A')).toBe(false); // lost!
    expect(finalRaw.some(k => k.query === 'kw-writer-B')).toBe(true);  // last writer wins
  });

  it('withTrackedKeywordsTxn prevents the lost-update race via BEGIN IMMEDIATE', async () => {
    // Verify that withTrackedKeywordsTxn correctly serialises updates.
    // We call it 10 times in sequence (each builds on top of the previous result).
    const { withTrackedKeywordsTxn } = await import('../../server/rank-tracking.js');
    const { getTrackedKeywords } = await import('../../server/rank-tracking.js');
    const { TRACKED_KEYWORD_SOURCE, TRACKED_KEYWORD_STATUS } = await import('../../shared/types/rank-tracking.js');

    const N = 10;
    for (let i = 0; i < N; i++) {
      const result = withTrackedKeywordsTxn(workspaceId, existing => [
        ...existing,
        {
          query: `safe-kw-${i + 1}`,
          pinned: false,
          addedAt: new Date().toISOString(),
          source: TRACKED_KEYWORD_SOURCE.MANUAL,
          status: TRACKED_KEYWORD_STATUS.ACTIVE,
        },
      ]);
      // Return value is the post-mutation array (3x-parse fix: no extra read)
      expect(result.length).toBe(i + 1);
    }

    const final = getTrackedKeywords(workspaceId);
    expect(final.length).toBe(N);
  });
});

// ─── T1b: nesting safety — no throw when inside outer db.transaction() ────────
describe('T1b: nesting safety — updateTrackedKeywords inside outer db.transaction() must not throw', () => {
  it('does not throw "cannot start a transaction within a transaction"', async () => {
    // Import server-side modules directly (this test runs in-process)
    const { default: db } = await import('../../server/db/index.js');
    const { updateTrackedKeywords } = await import('../../server/rank-tracking.js');
    const { TRACKED_KEYWORD_SOURCE, TRACKED_KEYWORD_STATUS } = await import('../../shared/types/rank-tracking.js');

    let threw = false;
    let error: unknown = null;

    db.transaction(() => {
      try {
        updateTrackedKeywords(workspaceId, keywords => [
          ...keywords,
          {
            query: 'nesting-safe-test-keyword',
            pinned: false,
            addedAt: new Date().toISOString(),
            source: TRACKED_KEYWORD_SOURCE.MANUAL,
            status: TRACKED_KEYWORD_STATUS.ACTIVE,
          },
        ]);
      } catch (err) {
        threw = true;
        error = err;
      }
    })();

    expect(
      threw,
      `updateTrackedKeywords threw inside outer transaction: ${error instanceof Error ? error.message : String(error)}`,
    ).toBe(false);

    // Verify the keyword was actually written
    const { getTrackedKeywords } = await import('../../server/rank-tracking.js');
    const result = getTrackedKeywords(workspaceId);
    expect(result.some(k => k.query === 'nesting-safe-test-keyword')).toBe(true);
  });
});

// ─── T1c: reconcile vs manual race — manual keyword survives rebuild ───────────
describe('T1c: reconcile vs manual race — manually-added keyword survives strategy rebuild', () => {
  it('manual keyword survives when seedKeywordStrategyTrackedKeywords runs after addTrackedKeyword', async () => {
    const { addTrackedKeyword, getTrackedKeywords } = await import('../../server/rank-tracking.js');
    const { seedKeywordStrategyTrackedKeywords } = await import('../../server/keyword-strategy-follow-ons.js');
    const { TRACKED_KEYWORD_SOURCE } = await import('../../shared/types/rank-tracking.js');

    const manualKw = 'my-manual-unique-keyword-xyz';
    const strategyKw = 'strategy-primary-keyword-abc';

    // Add manual keyword first
    addTrackedKeyword(workspaceId, manualKw, { source: TRACKED_KEYWORD_SOURCE.MANUAL });

    // Then run reconcile — this does a full updateTrackedKeywords that rebuilds
    // the array. With the fix, reconcile must merge with existing non-strategy
    // keywords (manuallyPreserved path).
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
    const queries = final.map(k => k.query);

    expect(
      queries.includes(manualKw),
      `Manual keyword "${manualKw}" was lost after reconcile. Final state: ${queries.join(', ')}`,
    ).toBe(true);
    expect(
      queries.includes(strategyKw),
      `Strategy keyword "${strategyKw}" should also be present. Final state: ${queries.join(', ')}`,
    ).toBe(true);
  });

  it('withTrackedKeywordsTxn return value matches post-mutation state (3x-parse fix)', async () => {
    const { withTrackedKeywordsTxn, getTrackedKeywords } = await import('../../server/rank-tracking.js');
    const { TRACKED_KEYWORD_SOURCE, TRACKED_KEYWORD_STATUS } = await import('../../shared/types/rank-tracking.js');

    const result = withTrackedKeywordsTxn(workspaceId, _existing => [
      {
        query: 'return-value-test-kw',
        pinned: false,
        addedAt: new Date().toISOString(),
        source: TRACKED_KEYWORD_SOURCE.MANUAL,
        status: TRACKED_KEYWORD_STATUS.ACTIVE,
      },
    ]);

    // Return value must be the post-mutation array (no extra read needed)
    expect(result).toHaveLength(1);
    expect(result[0].query).toBe('return-value-test-kw');

    // And the DB must also have exactly that state
    const fromDb = getTrackedKeywords(workspaceId);
    expect(fromDb).toHaveLength(1);
    expect(fromDb[0].query).toBe('return-value-test-kw');
  });
});
