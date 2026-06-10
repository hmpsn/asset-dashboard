/**
 * Wave 3b-ii (#19b) — REAL-PATH carry-forward guard for the siteKeywordMetrics blob
 * strip (table-as-truth).
 *
 * WHY THIS FILE EXISTS (the faked-red gap it closes):
 * The sibling site-keyword-metrics-strip.test.ts validates the PUBLIC read path and
 * table-as-truth, but its closed-loop case *simulates* the generation carry-forward
 * inline — it calls `resolveSiteKeywordMetrics(wsId)` itself and then persists. That
 * means it never executes the production line it is meant to protect
 * (`keyword-strategy-generation.ts:314`: `siteKeywordMetrics: resolveSiteKeywordMetrics(ws.id)`).
 * Reverting line 314 to the pre-fix blob read (`existingStrategy?.siteKeywordMetrics ?? []`)
 * left that whole suite green. The production line was unguarded.
 *
 * THE SEAM (and why it is the right one):
 * Line 314 lives inside the incremental no-op re-persist branch of the REAL exported
 * `generateKeywordStrategy`. This test invokes that production function end-to-end —
 * the same seam the existing P2 generation test uses
 * (seo-genquality-p2-backfill-floor-generation.test.ts) — mocking only the heavy I/O
 * boundary deps (page discovery, search data, SEO data, AI synthesis, follow-on
 * seeding). It does NOT re-implement the carry-forward. To reach line 314 the branch
 * requires BOTH `synthesis.upToDate === true` (forced via the synthesis mock) AND
 * `noOpChanged === true`. We trigger the latter deterministically by seeding ONE
 * keyword gap whose keyword (`'paper tiger'`) is a hard-coded low-actionability
 * pattern in keyword-intelligence/rules.ts — with an empty keyword pool and empty
 * evaluation context the no-op sanitizer prunes it (length 1 → 0), flipping
 * `noOpChanged` true and entering the re-persist that runs line 314.
 *
 * WHY IT GUARDS THE LINE (the RED proof):
 * persistKeywordStrategy writes whatever `siteKeywordMetrics` it receives to the
 * site_keyword_metrics table via `replaceAllSiteKeywordMetrics` (an unconditional
 * replace) and NEVER to the blob. So if line 314 regresses to the blob read it
 * passes `[]` (the post-strip blob is always empty) and the re-persist WIPES the
 * table — silent loss of every SEMRush metric. Reverting line 314 turns this test
 * red; the correct table read keeps the metrics.
 *
 * Port: none. This is a unit-style integration test — the generation pipeline is
 * mocked and no HTTP server is booted, so no `createTestContext()` / 13xxx port is
 * allocated (same shape as the P2 generation test). 13893 is reserved for this file
 * should an HTTP read path ever be added.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

vi.mock('../../server/keyword-strategy-pages.js', () => ({
  discoverKeywordStrategyPages: vi.fn(async () => ({
    baseUrl: 'https://carry-forward-example.com',
    pageInfo: [
      { path: '/services', title: 'Services', seoTitle: 'Services', seoDesc: 'Our services.', contentSnippet: 'Services snippet.' },
    ],
    preloadedPageKeywords: null,
  })),
}));

vi.mock('../../server/keyword-strategy-search-data.js', () => ({
  fetchKeywordStrategySearchData: vi.fn(async () => ({
    gscData: [], deviceBreakdown: [], countryBreakdown: [], periodComparison: null,
    organicLandingPages: [], organicOverview: null, ga4Conversions: [], ga4EventsByPage: [],
  })),
}));

vi.mock('../../server/keyword-strategy-seo-data.js', () => ({
  fetchAndCacheKeywordStrategySeoData: vi.fn(async () => ({
    seoContext: '', domainKeywords: [], keywordGaps: [], discoveryKeywords: [], relatedKeywords: [],
    questionKeywords: [], competitorKeywords: [],
    seoDataStatus: { mode: 'none', status: 'disabled' },
  })),
}));

// upToDate = true forces the incremental no-op branch where line 314 lives. The
// empty keywordPool + empty evaluationContext make the no-op keyword-gap sanitizer
// prune the seeded 'paper tiger' gap (low-actionability), flipping noOpChanged true.
vi.mock('../../server/keyword-strategy-ai-synthesis.js', async importOriginal => {
  const original = await importOriginal<typeof import('../../server/keyword-strategy-ai-synthesis.js')>();
  return {
    ...original,
    synthesizeKeywordStrategy: vi.fn(async () => ({
      upToDate: true,
      strategy: {
        siteKeywords: ['emergency dentist', 'invisalign cost'],
        pageMap: [],
        contentGaps: [],
        quickWins: [],
      },
      pagesToAnalyze: [],
      keywordPool: new Map(),
      businessSection: 'A dental clinic.',
      keywordEvaluationContext: {},
      freshPageCount: 0,
    })),
  };
});

// seedKeywordStrategyTrackedKeywords reconciles + broadcasts; stub it (out of scope
// for the carry-forward assertion, and it would otherwise reach the rank-tracking
// reconcile path). The other follow-on helpers stay real except the post-update queue.
vi.mock('../../server/keyword-strategy-follow-ons.js', async importOriginal => {
  const original = await importOriginal<typeof import('../../server/keyword-strategy-follow-ons.js')>();
  return {
    ...original,
    queueKeywordStrategyPostUpdateFollowOns: vi.fn(),
    seedKeywordStrategyTrackedKeywords: vi.fn(),
    workspaceHasStrategyOwnedRankTracking: vi.fn(() => false),
  };
});

import db from '../../server/db/index.js';
import { generateKeywordStrategy } from '../../server/keyword-strategy-generation.js';
import { getUsageCount } from '../../server/usage-tracking.js';
import { deleteWorkspace } from '../../server/workspaces.js';
import { replaceAllSiteKeywordMetrics, listSiteKeywordMetrics } from '../../server/site-keyword-metrics.js';
import { replaceAllKeywordGaps } from '../../server/keyword-gaps.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import type { KeywordStrategySiteKeywordMetric } from '../../server/keyword-strategy-enrichment.js';

const originalOpenAiKey = process.env.OPENAI_API_KEY;
let workspace: SeededFullWorkspace;

const TABLE_METRICS: KeywordStrategySiteKeywordMetric[] = [
  { keyword: 'emergency dentist', volume: 5400, difficulty: 38 },
  { keyword: 'invisalign cost', volume: 2900, difficulty: 33 },
];

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-openai-key';
  // Premium so the usage gate (incrementIfAllowed) never blocks generation.
  workspace = seedWorkspace({ tier: 'premium' });

  // Post-strip steady state: a previously-persisted strategy whose blob carries NO
  // siteKeywordMetrics (the strip happened), while the table is the sole store.
  db.prepare('UPDATE workspaces SET keyword_strategy = ? WHERE id = ?').run(
    JSON.stringify({
      siteKeywords: ['emergency dentist', 'invisalign cost'],
      generatedAt: '2026-05-01T00:00:00.000Z',
      // intentionally NO siteKeywordMetrics key
    }),
    workspace.workspaceId,
  );
  replaceAllSiteKeywordMetrics(workspace.workspaceId, TABLE_METRICS);

  // One keyword gap that the no-op sanitizer will prune (length 1 -> 0), which is
  // what flips noOpChanged true and routes generation into the re-persist that runs
  // keyword-strategy-generation.ts:314. 'paper tiger' is a hard-coded
  // low-actionability pattern, so pruning is deterministic regardless of scoring.
  replaceAllKeywordGaps(workspace.workspaceId, [
    { keyword: 'paper tiger', volume: 0, difficulty: 0, competitorPosition: 3, competitorDomain: 'rival.com' },
  ]);
});

afterEach(() => {
  db.prepare('DELETE FROM keyword_gaps WHERE workspace_id = ?').run(workspace.workspaceId);
  db.prepare('DELETE FROM site_keyword_metrics WHERE workspace_id = ?').run(workspace.workspaceId);
  db.prepare('DELETE FROM page_keywords WHERE workspace_id = ?').run(workspace.workspaceId);
  db.prepare('UPDATE workspaces SET keyword_strategy = NULL WHERE id = ?').run(workspace.workspaceId);
  deleteWorkspace(workspace.workspaceId);
});

afterAll(() => {
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
});

describe('Wave 3b-ii — REAL-path incremental carry-forward (generation.ts:314 guard)', () => {
  it('carries siteKeywordMetrics forward from the TABLE through the real generateKeywordStrategy no-op re-persist', async () => {
    // Pre-condition sanity: the blob has no metrics (strip steady state), the table does.
    expect(listSiteKeywordMetrics(workspace.workspaceId).map(m => m.keyword).sort())
      .toEqual(['emergency dentist', 'invisalign cost']);

    // Run the REAL production path. synthesis.upToDate=true + a prunable keyword gap
    // route execution into the incremental no-op re-persist that runs line 314.
    const result = await generateKeywordStrategy({ workspaceId: workspace.workspaceId, mode: 'incremental' });

    // It must have taken the re-persist branch (upToDate:false is returned there),
    // not the early no-op short-circuit (which would return upToDate:true and never
    // touch line 314).
    expect(result.upToDate).toBe(false);

    // THE GUARD: the metrics survive in the table — the sole store. With line 314
    // reading the table they are carried forward into persistKeywordStrategy, which
    // re-writes the SAME metrics back via replaceAllSiteKeywordMetrics (an
    // unconditional replace). With line 314 regressed to the empty blob read, that
    // same replace runs with `[]` and WIPES the table — this assertion goes red.
    // (The persisted blob never carries siteKeywordMetrics — the strip forces it
    // undefined — so the table is the only place the loss is observable.)
    expect(listSiteKeywordMetrics(workspace.workspaceId)).toEqual(TABLE_METRICS);
  });

  it('refunds the strategy-generation usage slot on the sanitizer-only no-op re-persist (zero AI synthesis = zero billing)', async () => {
    // 2026-06-09 audit (strategy-keywords): the noOpChanged exit re-persists after a
    // deterministic sanitizer cleanup — synthesis.upToDate=true means NO AI batch ran
    // (the early return in keyword-strategy-ai-synthesis.ts fires before any AI call).
    // The pure no-op exit refunds the pre-reserved slot; this exit must meter
    // identically, or tier-limited workspaces burn monthly credits on cleanup passes.
    const before = getUsageCount(workspace.workspaceId, 'strategy_generations');

    const result = await generateKeywordStrategy({ workspaceId: workspace.workspaceId, mode: 'incremental' });

    // Same routing sanity as the carry-forward case: the re-persist branch ran.
    expect(result.upToDate).toBe(false);
    expect(getUsageCount(workspace.workspaceId, 'strategy_generations')).toBe(before);
  });

  it('refunds the strategy-generation usage slot on the pure no-op exit (pins the existing behavior so the two exits cannot diverge)', async () => {
    // Remove the prunable gap so the sanitizer changes nothing → noOpChanged=false →
    // the early up-to-date short-circuit (which already refunds) is taken.
    db.prepare('DELETE FROM keyword_gaps WHERE workspace_id = ?').run(workspace.workspaceId);
    const before = getUsageCount(workspace.workspaceId, 'strategy_generations');

    const result = await generateKeywordStrategy({ workspaceId: workspace.workspaceId, mode: 'incremental' });

    expect(result.upToDate).toBe(true);
    expect(getUsageCount(workspace.workspaceId, 'strategy_generations')).toBe(before);
  });
});
