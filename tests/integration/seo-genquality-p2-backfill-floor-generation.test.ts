/**
 * SEO Generation Quality P2 — eval-fixture promotion (generation path).
 *
 * Promotes the P0 advisory bar "sparse workspace produces contentGaps >= 6" to a
 * REAL assertion now that the deterministic backfill floor guarantees it. A
 * Faros-like sparse workspace (synthesis returns 2 organic gaps; enrichment prunes
 * them to leave ≥6 prunable candidates) is run through generateKeywordStrategy with
 * the `seo-generation-quality` flag ENABLED for the workspace — the floor fills the
 * gap list to exactly 6 and tags re-admitted gaps `backfilled = true`.
 *
 * The flag-OFF parity case is also asserted here: with the flag OFF, generation
 * produces NO backfill (no re-admitted gaps, generationQuality.backfilledCount = 0,
 * floorHit = false) — byte-identical pruning behavior.
 *
 * Unit-style integration test: the generation pipeline (page discovery, search
 * data, SEO data, synthesis, enrichment, follow-ons) is mocked; no HTTP server is
 * booted, so no 13xxx port is allocated.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const enrichState = vi.hoisted(() => ({
  pruned: [] as Array<{ targetKeyword: string; topic: string; intent?: string; priority?: string; rationale?: string; volume?: number; difficulty?: number; opportunityScore?: number }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

vi.mock('../../server/keyword-strategy-pages.js', () => ({
  discoverKeywordStrategyPages: vi.fn(async () => ({
    baseUrl: 'https://faros-example.com',
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
    seoContext: '', domainKeywords: [], keywordGaps: [], relatedKeywords: [],
    questionKeywords: [], competitorKeywords: [],
  })),
}));

vi.mock('../../server/keyword-strategy-ai-synthesis.js', async importOriginal => {
  const original = await importOriginal<typeof import('../../server/keyword-strategy-ai-synthesis.js')>();
  return {
    ...original,
    synthesizeKeywordStrategy: vi.fn(async () => ({
      strategy: {
        siteKeywords: ['faros services'],
        opportunities: [],
        // Sparse: only two organic content gaps (the "2 gaps" symptom).
        contentGaps: [
          { targetKeyword: 'faros analytics platform', topic: 'Analytics platform', intent: 'commercial', priority: 'high', rationale: 'Core platform term.', volume: 800, difficulty: 30, opportunityScore: 70 },
          { targetKeyword: 'faros pricing', topic: 'Pricing', intent: 'transactional', priority: 'medium', rationale: 'High-intent pricing query.', volume: 400, difficulty: 15, opportunityScore: 60 },
        ],
        quickWins: [],
        pageMap: [
          { pagePath: '/services', pageTitle: 'Services', primaryKeyword: 'faros services', secondaryKeywords: [], searchIntent: 'commercial' },
        ],
      },
      pagesToAnalyze: [
        { path: '/services', title: 'Services', seoTitle: 'Services', seoDesc: 'Our services.', contentSnippet: 'Services snippet.' },
      ],
      keywordPool: new Map([
        ['faros services', { volume: 1200, difficulty: 42, source: 'mock' }],
      ]),
      businessSection: 'Faros — engineering intelligence platform.',
      keywordEvaluationContext: {},
      suppressedCount: 3,
    })),
  };
});

vi.mock('../../server/keyword-strategy-enrichment.js', () => ({
  enrichKeywordStrategy: vi.fn(async (opts: { strategy: { contentGaps?: unknown[] } }) => {
    // Simulate the page-coverage prune: the two organic gaps survive (kept), and a
    // pool of >=6 prunable candidates is surfaced for the deterministic floor.
    return {
      strategy: opts.strategy,
      siteKeywordMetrics: [],
      topicClusters: [],
      cannibalization: [],
      prunedContentGaps: enrichState.pruned,
    };
  }),
}));

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
import { deleteWorkspace } from '../../server/workspaces.js';
import { listContentGaps } from '../../server/content-gaps.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';

const originalOpenAiKey = process.env.OPENAI_API_KEY;
let workspace: SeededFullWorkspace;

function farosPrunablePool() {
  // >= 6 real prunable candidates with descending opportunity (deterministic order).
  return [
    { targetKeyword: 'faros ci insights', topic: 'CI insights', intent: 'informational', priority: 'medium', rationale: 'Prunable candidate.', volume: 1500, difficulty: 25, opportunityScore: 75 },
    { targetKeyword: 'faros deployment frequency', topic: 'Deployment frequency', intent: 'informational', priority: 'medium', rationale: 'Prunable candidate.', volume: 900, difficulty: 20, opportunityScore: 65 },
    { targetKeyword: 'faros dora metrics', topic: 'DORA metrics', intent: 'informational', priority: 'medium', rationale: 'Prunable candidate.', volume: 1200, difficulty: 28, opportunityScore: 62 },
    { targetKeyword: 'faros engineering benchmarks', topic: 'Benchmarks', intent: 'informational', priority: 'low', rationale: 'Prunable candidate.', volume: 600, difficulty: 22, opportunityScore: 55 },
    { targetKeyword: 'faros lead time tracking', topic: 'Lead time', intent: 'informational', priority: 'low', rationale: 'Prunable candidate.', volume: 300, difficulty: 18, opportunityScore: 48 },
    { targetKeyword: 'faros incident cost', topic: 'Incident cost', intent: 'informational', priority: 'low', rationale: 'Prunable candidate.', volume: 150, difficulty: 12, opportunityScore: 40 },
  ];
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-openai-key';
  workspace = seedWorkspace({ tier: 'premium' });
  enrichState.pruned = farosPrunablePool();
});

afterEach(() => {
  db.prepare('DELETE FROM content_gaps WHERE workspace_id = ?').run(workspace.workspaceId);
  db.prepare('DELETE FROM page_keywords WHERE workspace_id = ?').run(workspace.workspaceId);
  db.prepare('UPDATE workspaces SET keyword_strategy = NULL WHERE id = ?').run(workspace.workspaceId);
  deleteWorkspace(workspace.workspaceId);
});

afterAll(() => {
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
});

describe('P2 eval fixture — sparse Faros-like workspace produces contentGaps >= 6', () => {
  it('fills the gap list to the floor and tags re-admitted gaps backfilled', async () => {
    const result = await generateKeywordStrategy({ workspaceId: workspace.workspaceId });

    // ACCEPTANCE BAR (promoted from P0 it.todo): the deterministic floor guarantees >= 6.
    const persisted = listContentGaps(workspace.workspaceId);
    expect(persisted.length).toBeGreaterThanOrEqual(6);

    const backfilled = persisted.filter(g => g.backfilled);
    expect(backfilled.length).toBeGreaterThan(0);
    // The two organic gaps are NOT tagged backfilled.
    expect(persisted.find(g => g.targetKeyword === 'faros analytics platform')?.backfilled).toBeFalsy();

    // Telemetry reflects the floor hit.
    expect(result.generationQuality?.floorHit).toBe(true);
    expect(result.generationQuality?.backfilledCount).toBeGreaterThan(0);
    expect(result.generationQuality?.suppressedCount).toBe(3);
  });
});
