/**
 * Producer test for the Strategy v2 Rankings-tab "Position movements" card.
 *
 * The card (StrategyRankingsTab) is gated on `(improved + declined + lost) > 0`,
 * computed in useStrategyMetrics from each page's `currentPosition` vs
 * `previousPosition`. Before this fix `previous_position` was a dead column —
 * never carried a meaningful prior value — so the card stayed hidden in
 * production even after multiple strategy refreshes.
 *
 * This exercises the SAME read path the frontend uses:
 *   GET /api/webflow/keyword-strategy/:wsId  →  assembleStoredKeywordStrategy →
 *   listPageKeywords → serialized `pageMap`
 * across TWO consecutive `persistKeywordStrategy` refreshes, and asserts each
 * page's `previousPosition` reflects its `currentPosition` from the prior refresh
 * (the assertion that would have caught the dead-column bug).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, getWorkspace } from '../../server/workspaces.js';
import { persistKeywordStrategy } from '../../server/keyword-strategy-persistence.js';
import { setBroadcast } from '../../server/broadcast.js';
import type { StrategyPageMapEntry } from '../../server/keyword-strategy-ai-synthesis.js';

const ctx = createEphemeralTestContext(import.meta.url);

let wsId = '';

/**
 * Run a strategy refresh with the given pageMap entries. Defaults to a full refresh
 * on the module-level workspace; pass opts for the incremental path or a different ws.
 */
function refresh(
  pageMap: StrategyPageMapEntry[],
  opts: { wsId?: string; mode?: 'full' | 'incremental'; analyzedPaths?: string[] } = {},
): void {
  const targetWsId = opts.wsId ?? wsId;
  const mode = opts.mode ?? 'full';
  const ws = getWorkspace(targetWsId);
  if (!ws) throw new Error('workspace missing');
  persistKeywordStrategy({
    ws,
    strategy: { siteKeywords: ['seo services'], opportunities: [], pageMap, quickWins: [], contentGaps: [] },
    strategyMode: mode,
    pagesToAnalyze: (opts.analyzedPaths ?? []).map((path) => ({
      path,
      title: path,
      seoTitle: path,
      seoDesc: '',
      contentSnippet: '',
    })),
    siteKeywordMetrics: [],
    keywordGaps: [],
    competitorKeywordData: [],
    topicClusters: [],
    cannibalization: [],
    questionKeywords: [],
    businessContext: '',
    seoDataMode: 'quick',
    seoDataStatus: { mode: 'quick', provider: 'dataforseo', status: 'degraded', reasons: ['test'] },
    searchData: {
      deviceBreakdown: [],
      countryBreakdown: [],
      periodComparison: null,
      organicLandingPages: [],
      organicOverview: null,
    },
  });
}

interface ReadPage { pagePath: string; currentPosition?: number; previousPosition?: number }

async function readPageMap(targetWsId: string = wsId): Promise<Record<string, ReadPage>> {
  const res = await fetch(`${ctx.BASE}/api/webflow/keyword-strategy/${targetWsId}`);
  expect(res.status).toBe(200);
  const body = await res.json();
  const byPath: Record<string, ReadPage> = {};
  for (const p of body.pageMap as ReadPage[]) byPath[p.pagePath] = p;
  return byPath;
}

beforeAll(async () => {
  setBroadcast(vi.fn(), vi.fn());
  await ctx.startServer();
  wsId = createWorkspace('Position movements producer').id;
}, 30_000);

afterAll(async () => {
  if (wsId) deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('previousPosition rotation across consecutive strategy refreshes', () => {
  it('first refresh leaves previousPosition empty (no prior to compare against)', async () => {
    refresh([
      { pagePath: '/a', pageTitle: 'A', primaryKeyword: 'kw a', secondaryKeywords: [], currentPosition: 8, volume: 500 },
      { pagePath: '/b', pageTitle: 'B', primaryKeyword: 'kw b', secondaryKeywords: [], currentPosition: 4, volume: 500 },
      { pagePath: '/c', pageTitle: 'C', primaryKeyword: 'kw c', secondaryKeywords: [], currentPosition: 10, volume: 500 },
    ]);
    const pages = await readPageMap();
    expect(pages['/a'].currentPosition).toBe(8);
    expect(pages['/a'].previousPosition).toBeUndefined();
    expect(pages['/b'].previousPosition).toBeUndefined();
    expect(pages['/c'].previousPosition).toBeUndefined();
  });

  it('second refresh rotates the prior currentPosition into previousPosition', async () => {
    refresh([
      { pagePath: '/a', pageTitle: 'A', primaryKeyword: 'kw a', secondaryKeywords: [], currentPosition: 5, volume: 500 }, // improved 8→5
      { pagePath: '/b', pageTitle: 'B', primaryKeyword: 'kw b', secondaryKeywords: [], currentPosition: 7, volume: 500 }, // declined 4→7
      { pagePath: '/c', pageTitle: 'C', primaryKeyword: 'kw c', secondaryKeywords: [], volume: 500 },                      // lost (10 → unranked)
      { pagePath: '/d', pageTitle: 'D', primaryKeyword: 'kw d', secondaryKeywords: [], currentPosition: 6, volume: 500 }, // new
    ]);
    const pages = await readPageMap();

    // /a improved — previousPosition reflects refresh-1's currentPosition.
    expect(pages['/a'].currentPosition).toBe(5);
    expect(pages['/a'].previousPosition).toBe(8);

    // /b declined.
    expect(pages['/b'].currentPosition).toBe(7);
    expect(pages['/b'].previousPosition).toBe(4);

    // /c lost its ranking — current cleared, prior position retained.
    expect(pages['/c'].currentPosition).toBeUndefined();
    expect(pages['/c'].previousPosition).toBe(10);

    // /d is brand new this refresh — no prior position.
    expect(pages['/d'].currentPosition).toBe(6);
    expect(pages['/d'].previousPosition).toBeUndefined();

    // The movements the Rankings card derives from this read path (mirrors
    // useStrategyMetrics) must now be non-zero so the gated card renders.
    let improved = 0, declined = 0, lost = 0, newly = 0;
    for (const p of Object.values(pages)) {
      const curRanked = typeof p.currentPosition === 'number' && p.currentPosition >= 1;
      const prevRanked = typeof p.previousPosition === 'number' && p.previousPosition >= 1;
      if (curRanked && prevRanked) {
        if (p.currentPosition! < p.previousPosition!) improved += 1;
        else if (p.currentPosition! > p.previousPosition!) declined += 1;
      } else if (curRanked && !prevRanked) newly += 1;
      else if (!curRanked && prevRanked) lost += 1;
    }
    expect({ improved, declined, lost, newly }).toEqual({ improved: 1, declined: 1, lost: 1, newly: 1 });
    expect(improved + declined + lost).toBeGreaterThan(0); // card gate
  });
});

describe('incremental refresh rotates only the pages it touches', () => {
  it('rotates touched pages and freezes the baseline of untouched pages', async () => {
    const incWsId = createWorkspace('Incremental movements producer').id;
    try {
      // Full refresh establishes both pages' current positions (no prior yet).
      refresh(
        [
          { pagePath: '/x', pageTitle: 'X', primaryKeyword: 'kw x', secondaryKeywords: [], currentPosition: 10, volume: 500 },
          { pagePath: '/y', pageTitle: 'Y', primaryKeyword: 'kw y', secondaryKeywords: [], currentPosition: 6, volume: 500 },
        ],
        { wsId: incWsId },
      );

      // Incremental refresh that re-analyzes ONLY /x. /y is absent from pagesToAnalyze,
      // so it must not be upserted — its previousPosition baseline stays frozen.
      refresh(
        [
          { pagePath: '/x', pageTitle: 'X', primaryKeyword: 'kw x', secondaryKeywords: [], currentPosition: 4, volume: 500 },
          { pagePath: '/y', pageTitle: 'Y', primaryKeyword: 'kw y', secondaryKeywords: [], currentPosition: 6, volume: 500 },
        ],
        { wsId: incWsId, mode: 'incremental', analyzedPaths: ['/x'] },
      );

      const pages = await readPageMap(incWsId);
      // /x was touched → prior current (10) rotated into previousPosition.
      expect(pages['/x'].currentPosition).toBe(4);
      expect(pages['/x'].previousPosition).toBe(10);
      // /y was NOT touched → still no prior (baseline frozen, not rotated against itself).
      expect(pages['/y'].currentPosition).toBe(6);
      expect(pages['/y'].previousPosition).toBeUndefined();
    } finally {
      deleteWorkspace(incWsId);
    }
  });
});
