/**
 * P3 CRITICAL GATE — Strategy keyword set durability.
 *
 * Asserts the managed set survives BOTH mutation paths that threatened to clobber it:
 *
 * Path A — strategy regen (reconcileStrategyKeywordSet, wired inside
 *   persistKeywordStrategy's writeKeywordStrategy transaction):
 *   - Seed a workspace, add/keep keywords via domain fns.
 *   - Run a strategy regen via persistKeywordStrategy.
 *   - Assert active + kept rows persist; kept_at is intact; soft-removed rows stay
 *     removed and are NOT resurrected by the reconciler.
 *
 * Path B — rank-tracking sync (replaceAllTrackedKeywordRows deleteAll clobber):
 *   - After the above, call replaceAllTrackedKeywordRows() (the tracked-keywords-store.ts:184
 *     "deleteAll → fixed-column reinsert" pattern used by the rank-tracking sync job).
 *   - Assert the strategy_keyword_set rows are UNTOUCHED (dedicated-table isolation).
 *
 * This is the single most important test in P3: it is the regression guard for the
 * verified-clobber pattern that drove the dedicated `strategy_keyword_set` table design.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { persistKeywordStrategy } from '../../server/keyword-strategy-persistence.js';
import type { PersistKeywordStrategyOptions } from '../../server/keyword-strategy-persistence.js';
import {
  getStrategyKeywordSet,
  addStrategyKeyword,
  removeStrategyKeyword,
  keepStrategyKeyword,
} from '../../server/domains/strategy/managed-keyword-set.js';
import { replaceAllTrackedKeywordRows } from '../../server/tracked-keywords-store.js';
import { setBroadcast } from '../../server/broadcast.js';
import db from '../../server/db/index.js';
import type { Workspace } from '../../shared/types/workspace.js';
import type { StrategyOutput } from '../../server/keyword-strategy-ai-synthesis.js';

const ctx = createEphemeralTestContext(import.meta.url, { contextName: 'durability' });

const workspaceIdsToCleanup: string[] = [];

beforeAll(async () => {
  await ctx.startServer();
}, 60_000);

afterAll(async () => {
  for (const id of workspaceIdsToCleanup) deleteWorkspace(id);
  await ctx.stopServer();
});

beforeEach(() => {
  // persistKeywordStrategy broadcasts after the write — stub so tests don't error on missing socket.
  setBroadcast(vi.fn(), vi.fn());
});

function makeWorkspace(label: string): Workspace {
  const ws = createWorkspace(`Durability ${label} ${Date.now()}`);
  workspaceIdsToCleanup.push(ws.id);
  return ws;
}

/** Minimal PersistKeywordStrategyOptions with a controlled siteKeywords list. */
function makePersistOptions(
  ws: Workspace,
  siteKeywords: string[],
  overrides: Partial<PersistKeywordStrategyOptions> = {},
): PersistKeywordStrategyOptions {
  const strategy = {
    siteKeywords,
    opportunities: ['local seo', 'technical seo audit'],
    contentGaps: [
      {
        topic: 'Technical SEO Guide',
        targetKeyword: 'technical seo guide',
        intent: 'informational',
        priority: 'high',
        rationale: 'High volume, no dedicated page',
        opportunityScore: 72,
      },
    ],
    quickWins: [],
    pageMap: [],
  } as unknown as StrategyOutput;

  return {
    ws,
    strategy,
    strategyMode: 'full',
    pagesToAnalyze: [],
    siteKeywordMetrics: [],
    keywordGaps: [],
    competitorKeywordData: [],
    topicClusters: [],
    cannibalization: [],
    questionKeywords: [],
    businessContext: '',
    seoDataMode: 'none',
    seoDataStatus: { mode: 'none', status: 'disabled' },
    searchData: {
      deviceBreakdown: [],
      countryBreakdown: [],
      periodComparison: null,
      organicLandingPages: [],
      organicOverview: null,
    },
    ...overrides,
  };
}

/** Read ALL rows (including soft-removed) from strategy_keyword_set for a workspace. */
function allRows(workspaceId: string) {
  return db
    .prepare('SELECT * FROM strategy_keyword_set WHERE workspace_id = ? ORDER BY slot_order ASC, id ASC')
    .all(workspaceId) as Array<{
      id: number;
      workspace_id: string;
      keyword: string;
      source: string;
      kept_at: string | null;
      removed_at: string | null;
      slot_order: number;
      created_at: string;
    }>;
}

// ─── Path A: strategy regen durability ───────────────────────────────────────

describe('Path A — strategy regen via persistKeywordStrategy', () => {
  it('reconciler seeds siteKeywords on first regen', () => {
    const ws = makeWorkspace('regen-seed');
    const opts = makePersistOptions(ws, ['seo agency', 'web analytics', 'content strategy']);
    persistKeywordStrategy(opts);

    const active = getStrategyKeywordSet(ws.id);
    const keywords = active.map(r => r.keyword);
    expect(keywords).toContain('seo agency');
    expect(keywords).toContain('web analytics');
    expect(keywords).toContain('content strategy');
    // Assert the seeded rows carry the expected source (not removedAt — that's guaranteed by getStrategyKeywordSet's WHERE clause)
    expect(active[0]?.source).toBe('regen_computed');
  });

  it('active rows survive a second regen with the same keywords', () => {
    const ws = makeWorkspace('regen-survive-active');
    const opts = makePersistOptions(ws, ['seo agency', 'web analytics']);
    persistKeywordStrategy(opts);

    const before = getStrategyKeywordSet(ws.id);
    expect(before).toHaveLength(2);

    // Second regen — same siteKeywords.
    persistKeywordStrategy(makePersistOptions(makeWorkspace('throw-away'), ['seo agency', 'web analytics'], { ws }));

    const after = getStrategyKeywordSet(ws.id);
    expect(after).toHaveLength(2);
    expect(after.map(r => r.keyword)).toContain('seo agency');
    expect(after.map(r => r.keyword)).toContain('web analytics');
  });

  it('kept_at is intact after regen — kept row survives with its original stamp', () => {
    const ws = makeWorkspace('regen-kept-at');
    // First regen seeds three keywords.
    persistKeywordStrategy(makePersistOptions(ws, ['seo agency', 'web analytics', 'content strategy']));

    // Operator keeps "seo agency" explicitly.
    keepStrategyKeyword(ws.id, 'seo agency');
    const keptRow = allRows(ws.id).find(r => r.keyword === 'seo agency');
    expect(keptRow?.kept_at).not.toBeNull();
    const originalKeptAt = keptRow!.kept_at;

    // Second regen — "seo agency" is already in the set; reconciler skips it.
    persistKeywordStrategy(makePersistOptions(ws, ['seo agency', 'web analytics', 'content strategy']));

    const afterRegen = allRows(ws.id).find(r => r.keyword === 'seo agency');
    expect(afterRegen?.kept_at).toBe(originalKeptAt); // unchanged
    expect(afterRegen?.removed_at).toBeNull();         // still active
  });

  it('soft-removed row stays removed after regen — reconciler does NOT resurrect it', () => {
    const ws = makeWorkspace('regen-removed-stays-removed');
    persistKeywordStrategy(makePersistOptions(ws, ['seo agency', 'web analytics']));

    // Operator removes "web analytics".
    removeStrategyKeyword(ws.id, 'web analytics');
    const removedBefore = allRows(ws.id).find(r => r.keyword === 'web analytics');
    expect(removedBefore?.removed_at).not.toBeNull();

    // Regen with the SAME siteKeywords — "web analytics" is still in siteKeywords.
    persistKeywordStrategy(makePersistOptions(ws, ['seo agency', 'web analytics']));

    const removedAfter = allRows(ws.id).find(r => r.keyword === 'web analytics');
    expect(removedAfter?.removed_at).not.toBeNull(); // still removed — NOT resurrected
    expect(removedAfter?.keyword).toBe('web analytics');

    // The active set should only contain "seo agency".
    const active = getStrategyKeywordSet(ws.id);
    expect(active.map(r => r.keyword)).toContain('seo agency');
    expect(active.map(r => r.keyword)).not.toContain('web analytics');
  });

  it('auto-replenish fills one slot per removed row from the opportunity pool', () => {
    const ws = makeWorkspace('regen-replenish');
    persistKeywordStrategy(makePersistOptions(ws, ['seo agency', 'web analytics']));

    // Remove one keyword — the reconciler should replenish one slot from contentGaps/opportunities.
    removeStrategyKeyword(ws.id, 'seo agency');

    // Regen — the contentGaps[0].targetKeyword ("technical seo guide") should enter the set.
    persistKeywordStrategy(makePersistOptions(ws, ['seo agency', 'web analytics']));

    const active = getStrategyKeywordSet(ws.id);
    const keywords = active.map(r => r.keyword);
    // "seo agency" stays removed; the slot was replenished from the pool.
    expect(keywords).not.toContain('seo agency');
    // Replenish candidate is contentGaps[0].targetKeyword (highest opportunityScore=72).
    expect(keywords).toContain('technical seo guide');
    // Exactly 2 active rows: "web analytics" (survived) + "technical seo guide" (replenished). No over-replenish.
    expect(active).toHaveLength(2);
  });

  it('multiple regen runs are idempotent — row count stays stable', () => {
    const ws = makeWorkspace('regen-idempotent');
    persistKeywordStrategy(makePersistOptions(ws, ['seo agency', 'web analytics']));
    const countAfterFirst = allRows(ws.id).length;

    // Three more regens with the same inputs.
    for (let i = 0; i < 3; i++) {
      persistKeywordStrategy(makePersistOptions(ws, ['seo agency', 'web analytics']));
    }
    const countAfterFour = allRows(ws.id).length;
    expect(countAfterFour).toBe(countAfterFirst);
  });
});

// ─── Path B: rank-tracking sync clobber isolation ────────────────────────────

describe('Path B — rank-tracking sync (replaceAllTrackedKeywordRows) does NOT clobber strategy_keyword_set', () => {
  it('replaceAllTrackedKeywordRows deleteAll leaves strategy_keyword_set rows untouched', () => {
    const ws = makeWorkspace('clobber-isolation');

    // Seed the managed keyword set via a regen.
    persistKeywordStrategy(makePersistOptions(ws, ['seo agency', 'web analytics', 'content strategy']));

    // Operator mutations before the sync.
    addStrategyKeyword(ws.id, 'enterprise seo', 'manual_add');
    keepStrategyKeyword(ws.id, 'seo agency');
    removeStrategyKeyword(ws.id, 'web analytics');

    const beforeSync = allRows(ws.id);
    expect(beforeSync.length).toBeGreaterThanOrEqual(3); // 3 seeded + 1 manual

    // Simulate the rank-tracking sync: deleteAll + reinsert into tracked_keywords.
    replaceAllTrackedKeywordRows(ws.id, [
      {
        query: 'seo agency',
        pinned: false,
        addedAt: new Date().toISOString(),
      },
    ]);

    // strategy_keyword_set must be entirely unchanged.
    const afterSync = allRows(ws.id);
    expect(afterSync.length).toBe(beforeSync.length);

    for (const before of beforeSync) {
      const after = afterSync.find(r => r.id === before.id);
      expect(after, `row id=${before.id} keyword="${before.keyword}" should still exist after sync`).toBeDefined();
      expect(after!.keyword).toBe(before.keyword);
      expect(after!.kept_at).toBe(before.kept_at);
      expect(after!.removed_at).toBe(before.removed_at);
      expect(after!.source).toBe(before.source);
    }
  });

  it('kept rows in the managed set are not affected by tracked_keywords deleteAll', () => {
    const ws = makeWorkspace('clobber-kept-intact');
    persistKeywordStrategy(makePersistOptions(ws, ['seo agency']));
    keepStrategyKeyword(ws.id, 'seo agency');

    const beforeKeptAt = (allRows(ws.id).find(r => r.keyword === 'seo agency'))?.kept_at;
    expect(beforeKeptAt).not.toBeNull();

    // Simulate rank-tracking sync.
    replaceAllTrackedKeywordRows(ws.id, []);

    const afterKeptAt = (allRows(ws.id).find(r => r.keyword === 'seo agency'))?.kept_at;
    expect(afterKeptAt).toBe(beforeKeptAt); // kept_at unchanged
  });

  it('soft-removed rows in managed set survive the rank-tracking sync', () => {
    const ws = makeWorkspace('clobber-removed-intact');
    persistKeywordStrategy(makePersistOptions(ws, ['seo agency', 'web analytics']));
    removeStrategyKeyword(ws.id, 'web analytics');

    const removedAtBefore = (allRows(ws.id).find(r => r.keyword === 'web analytics'))?.removed_at;
    expect(removedAtBefore).not.toBeNull();

    replaceAllTrackedKeywordRows(ws.id, []);

    const removedAtAfter = (allRows(ws.id).find(r => r.keyword === 'web analytics'))?.removed_at;
    expect(removedAtAfter).toBe(removedAtBefore); // unchanged
  });

  it('both paths back-to-back: regen then sync, managed set is stable throughout', () => {
    const ws = makeWorkspace('both-paths');

    // Step 1: first regen.
    persistKeywordStrategy(makePersistOptions(ws, ['seo agency', 'web analytics']));
    addStrategyKeyword(ws.id, 'local seo services', 'manual_add');
    keepStrategyKeyword(ws.id, 'seo agency');
    removeStrategyKeyword(ws.id, 'web analytics');

    // Step 2: rank-tracking sync.
    replaceAllTrackedKeywordRows(ws.id, [
      { query: 'seo agency', pinned: false, addedAt: new Date().toISOString() },
    ]);

    // Step 3: second regen — same siteKeywords.
    persistKeywordStrategy(makePersistOptions(ws, ['seo agency', 'web analytics']));

    const finalRows = allRows(ws.id);
    // "seo agency" kept — must still be active with kept_at set.
    const kept = finalRows.find(r => r.keyword === 'seo agency');
    expect(kept?.removed_at).toBeNull();
    expect(kept?.kept_at).not.toBeNull();

    // "web analytics" removed — must still be soft-removed, NOT resurrected by either path.
    const removed = finalRows.find(r => r.keyword === 'web analytics');
    expect(removed?.removed_at).not.toBeNull();

    // "local seo services" (manual_add) — must still be active.
    const manual = finalRows.find(r => r.keyword === 'local seo services');
    expect(manual?.removed_at).toBeNull();
    expect(manual?.source).toBe('manual_add');
  });
});
