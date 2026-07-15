/**
 * F1 (#7a / FM-2) — GenerationQuality persistence.
 *
 * The keyword-strategy generation pipeline computes a typed GenerationQuality
 * record (poolSize, aiReturnedCount, suppressedCount, backfilledCount, floorHit)
 * on every run. Before F1 it was log-only; F1 persists one row per run into the
 * generation_quality table. These tests prove:
 *
 *   1. A normal generation run persists exactly one quality row with every field
 *      and correct workspace scoping.
 *   2. FM-2 — when the site-synthesis AI fails validation (the closed-set path
 *      degrades to a TYPED-EMPTY object → the deterministic content-gap backfill
 *      floor fires rather than throwing), the run still reaches the persistence
 *      site and the quality row records the floor (floorHit = true,
 *      backfilledCount > 0). We model the post-AI-failure state by returning an
 *      EMPTY content-gap set from the mocked synthesis (exactly what
 *      synthesizeKeywordStrategy returns after its retry-then-typed-empty path)
 *      with a populated prunable pool so the generation-layer floor re-admits gaps.
 *
 * Mirrors the P2 backfill-floor harness: the generation pipeline is mocked; no
 * HTTP server is booted, so no 13xxx port is allocated.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const synthState = vi.hoisted(() => ({
  /** AI-failure simulation: when true the mocked synthesis returns ZERO content
   *  gaps (the typed-empty post-retry state) so the generation-layer floor fires. */
  aiFailed: false,
  pruned: [] as Array<{ targetKeyword: string; topic: string; intent?: string; priority?: string; rationale?: string; volume?: number; difficulty?: number; opportunityScore?: number }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

vi.mock('../../server/keyword-strategy-pages.js', () => ({
  discoverKeywordStrategyPages: vi.fn(async () => ({
    baseUrl: 'https://genquality-example.com',
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
        siteKeywords: ['genquality services'],
        opportunities: [],
        // Normal run: two organic gaps. AI-failure run: zero (typed-empty post-retry).
        contentGaps: synthState.aiFailed
          ? []
          : [
              { targetKeyword: 'genquality analytics platform', topic: 'Analytics platform', intent: 'commercial', priority: 'high', rationale: 'Core platform term.', volume: 800, difficulty: 30, opportunityScore: 70 },
              { targetKeyword: 'genquality pricing', topic: 'Pricing', intent: 'transactional', priority: 'medium', rationale: 'High-intent pricing query.', volume: 400, difficulty: 15, opportunityScore: 60 },
            ],
        quickWins: [],
        pageMap: [
          { pagePath: '/services', pageTitle: 'Services', primaryKeyword: 'genquality services', secondaryKeywords: [], searchIntent: 'commercial' },
        ],
      },
      pagesToAnalyze: [
        { path: '/services', title: 'Services', seoTitle: 'Services', seoDesc: 'Our services.', contentSnippet: 'Services snippet.' },
      ],
      keywordPool: new Map([
        ['genquality services', { volume: 1200, difficulty: 42, source: 'mock' }],
        ['genquality analytics platform', { volume: 800, difficulty: 30, source: 'mock' }],
        ['genquality pricing', { volume: 400, difficulty: 15, source: 'mock' }],
      ]),
      businessSection: 'GenQuality — analytics platform.',
      keywordEvaluationContext: {},
      suppressedCount: 2,
      executions: [],
    })),
  };
});

vi.mock('../../server/keyword-strategy-enrichment.js', () => ({
  enrichKeywordStrategy: vi.fn(async (opts: { strategy: { contentGaps?: unknown[] } }) => ({
    strategy: opts.strategy,
    siteKeywordMetrics: [],
    topicClusters: [],
    cannibalization: [],
    prunedContentGaps: synthState.pruned,
  })),
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
import { listGenerationQuality } from '../../server/generation-quality-store.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';

const originalOpenAiKey = process.env.OPENAI_API_KEY;
let workspace: SeededFullWorkspace;

function prunablePool() {
  // >= 6 real prunable candidates with descending opportunity (deterministic order).
  return [
    { targetKeyword: 'genquality ci insights', topic: 'CI insights', intent: 'informational', priority: 'medium', rationale: 'Prunable candidate.', volume: 1500, difficulty: 25, opportunityScore: 75 },
    { targetKeyword: 'genquality deployment frequency', topic: 'Deployment frequency', intent: 'informational', priority: 'medium', rationale: 'Prunable candidate.', volume: 900, difficulty: 20, opportunityScore: 65 },
    { targetKeyword: 'genquality dora metrics', topic: 'DORA metrics', intent: 'informational', priority: 'medium', rationale: 'Prunable candidate.', volume: 1200, difficulty: 28, opportunityScore: 62 },
    { targetKeyword: 'genquality benchmarks', topic: 'Benchmarks', intent: 'informational', priority: 'low', rationale: 'Prunable candidate.', volume: 600, difficulty: 22, opportunityScore: 55 },
    { targetKeyword: 'genquality lead time tracking', topic: 'Lead time', intent: 'informational', priority: 'low', rationale: 'Prunable candidate.', volume: 300, difficulty: 18, opportunityScore: 48 },
    { targetKeyword: 'genquality incident cost', topic: 'Incident cost', intent: 'informational', priority: 'low', rationale: 'Prunable candidate.', volume: 150, difficulty: 12, opportunityScore: 40 },
  ];
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-openai-key';
  workspace = seedWorkspace({ tier: 'premium' });
  synthState.aiFailed = false;
  synthState.pruned = prunablePool();
});

afterEach(() => {
  db.prepare('DELETE FROM content_gaps WHERE workspace_id = ?').run(workspace.workspaceId);
  db.prepare('DELETE FROM page_keywords WHERE workspace_id = ?').run(workspace.workspaceId);
  db.prepare('DELETE FROM generation_quality WHERE workspace_id = ?').run(workspace.workspaceId);
  db.prepare('UPDATE workspaces SET keyword_strategy = NULL WHERE id = ?').run(workspace.workspaceId);
  deleteWorkspace(workspace.workspaceId);
});

afterAll(() => {
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
});

describe('F1 #7a — GenerationQuality persistence', () => {
  it('persists exactly one quality row per generation run with all fields workspace-scoped', async () => {
    const result = await generateKeywordStrategy({ workspaceId: workspace.workspaceId });

    const rows = listGenerationQuality(workspace.workspaceId);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.workspaceId).toBe(workspace.workspaceId);
    expect(typeof row.id).toBe('number');
    expect(typeof row.createdAt).toBe('string');
    expect(row.poolSize).toBeGreaterThan(0);
    expect(row.suppressedCount).toBe(2);
    // The persisted row matches the in-memory telemetry the run returned.
    expect(row.poolSize).toBe(result.generationQuality?.poolSize);
    expect(row.aiReturnedCount).toBe(result.generationQuality?.aiReturnedCount);
    expect(row.backfilledCount).toBe(result.generationQuality?.backfilledCount);
    expect(row.floorHit).toBe(result.generationQuality?.floorHit);
    // A scoping sanity check: a different workspace has no rows.
    expect(listGenerationQuality('nonexistent-workspace-id')).toHaveLength(0);
  });

  it('FM-2: AI synthesis failure still persists a quality row recording the deterministic-backfill floor', async () => {
    // Simulate the post-AI-failure state: synthesis returns ZERO content gaps
    // (the typed-empty object the closed-set path produces after its retry), and
    // the prunable pool feeds the generation-layer deterministic floor.
    synthState.aiFailed = true;

    const result = await generateKeywordStrategy({ workspaceId: workspace.workspaceId });

    // The deterministic floor fired (the AI returned nothing).
    expect(result.generationQuality?.floorHit).toBe(true);
    expect(result.generationQuality?.aiReturnedCount).toBe(0);
    expect(result.generationQuality?.backfilledCount).toBeGreaterThan(0);

    // The quality row was STILL written and records the floor.
    const rows = listGenerationQuality(workspace.workspaceId);
    expect(rows).toHaveLength(1);
    expect(rows[0].floorHit).toBe(true);
    expect(rows[0].aiReturnedCount).toBe(0);
    expect(rows[0].backfilledCount).toBeGreaterThan(0);
  });
});
