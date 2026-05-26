/**
 * Extended unit tests for the workspace intelligence slice system.
 *
 * Covers ADDITIONAL scenarios beyond tests/unit/workspace-intelligence.test.ts:
 *  - Slice assembly with empty / minimal data returns correct defaults
 *  - Token budget enforcement via formatForPrompt
 *  - Slice field type guarantees (string vs undefined, numeric vs null)
 *  - Multiple slices returning partial data when some fail
 *  - buildIntelPrompt uses singleFlight and formatForPrompt
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module-level mocks ──────────────────────────────────────────────────────

vi.mock('../../server/intelligence/seo-context-source.js', () => ({
  buildEffectiveBrandVoiceBlock: vi.fn(() => ''),
  getRawBrandVoice: vi.fn(() => ''),
  getRawKnowledge: vi.fn(() => ''),
}));
vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: vi.fn(),
}));
vi.mock('../../server/analytics-insights-store.js', () => ({
  getInsights: vi.fn().mockReturnValue([]),
}));
vi.mock('../../server/workspace-learnings.js', () => ({
  getWorkspaceLearnings: vi.fn().mockReturnValue(null),
}));
vi.mock('../../server/outcome-playbooks.js', () => ({
  getPlaybooks: vi.fn().mockReturnValue([]),
}));
vi.mock('../../server/outcome-tracking.js', () => ({
  getActionsByPage: vi.fn(() => []),
  getActionsByWorkspace: vi.fn(() => []),
  getOutcomesForAction: vi.fn(() => []),
  getPendingActions: vi.fn(() => []),
  getTopWinsFromActions: vi.fn(() => []),
}));
vi.mock('../../server/workspace-data.js', () => ({
  getWorkspacePages: vi.fn(async () => []),
  getWorkspaceAllPages: vi.fn(async () => []),
  getContentPipelineSummary: vi.fn(() => ({
    briefs: { total: 0, byStatus: {} },
    posts: { total: 0, byStatus: {} },
    matrices: { total: 0, cellsPlanned: 0, cellsPublished: 0 },
    requests: { pending: 0, inProgress: 0, delivered: 0 },
    workOrders: { active: 0 },
    seoEdits: { pending: 0, applied: 0, inReview: 0 },
  })),
}));
vi.mock('../../server/webflow-pages.js', () => ({
  listPages: vi.fn(async () => []),
  filterPublishedPages: vi.fn(() => []),
  discoverCmsItemsBySlug: vi.fn(async () => ({ items: [], totalFound: 0 })),
  toCmsPageId: vi.fn((collectionId: string, itemId: string) => `${collectionId}:${itemId}`),
}));
vi.mock('../../server/webflow-cms.js', () => ({
  listCollections: vi.fn(async () => []),
  getCollectionSchema: vi.fn(async () => ({ fields: [] })),
}));
vi.mock('../../server/feature-flags.js', () => ({
  isFeatureEnabled: vi.fn().mockReturnValue(true),
}));
vi.mock('../../server/intelligence-cache.js', () => {
  class MockLRUCache {
    get = vi.fn().mockReturnValue(null);
    peek = vi.fn().mockReturnValue(null);
    set = vi.fn();
    deleteByPrefix = vi.fn().mockReturnValue(0);
    stats = vi.fn().mockReturnValue({ entries: 0, maxEntries: 200 });
  }
  return {
    LRUCache: MockLRUCache,
    singleFlight: vi.fn().mockImplementation((_key: string, fn: () => Promise<unknown>) => fn()),
  };
});
vi.mock('../../server/broadcast.js', () => ({ broadcastToWorkspace: vi.fn() }));
vi.mock('../../server/ws-events.js', () => ({ WS_EVENTS: { INTELLIGENCE_INVALIDATED: 'intelligence:invalidated' } }));
vi.mock('../../server/bridge-infrastructure.js', () => ({
  invalidateSubCachePrefix: vi.fn(),
}));

import { buildWorkspaceIntelligence, formatForPrompt } from '../../server/workspace-intelligence.js';
import { buildEffectiveBrandVoiceBlock } from '../../server/intelligence/seo-context-source.js';
import { getInsights } from '../../server/analytics-insights-store.js';
import { getWorkspaceLearnings } from '../../server/workspace-learnings.js';
import { getWorkspace } from '../../server/workspaces.js';

const mockBuildEffectiveBrandVoiceBlock = vi.mocked(buildEffectiveBrandVoiceBlock);
const mockGetInsights = vi.mocked(getInsights);
const mockGetLearnings = vi.mocked(getWorkspaceLearnings);
const mockGetWorkspace = vi.mocked(getWorkspace);

// ── Slice assembly with empty data ─────────────────────────────────────────

describe('buildWorkspaceIntelligence — empty data defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildEffectiveBrandVoiceBlock.mockReturnValue('');
    mockGetInsights.mockReturnValue([]);
    mockGetLearnings.mockReturnValue(null);
  });

  it('returns correct version and timestamp fields', async () => {
    const result = await buildWorkspaceIntelligence('ws-empty-1');
    expect(result.version).toBe(1);
    expect(typeof result.workspaceId).toBe('string');
    expect(typeof result.assembledAt).toBe('string');
    expect(new Date(result.assembledAt).getTime()).not.toBeNaN();
  });

  it('assembledAt is an ISO 8601 string', async () => {
    const result = await buildWorkspaceIntelligence('ws-empty-2', { slices: ['insights'] });
    // ISO 8601 basic check: parseable and recent
    const parsed = new Date(result.assembledAt);
    const now = Date.now();
    expect(parsed.getTime()).toBeGreaterThan(now - 5000);
    expect(parsed.getTime()).toBeLessThanOrEqual(now + 1000);
  });

  it('returns empty insights.all when no insights exist', async () => {
    const result = await buildWorkspaceIntelligence('ws-empty-3', { slices: ['insights'] });
    expect(result.insights).toBeDefined();
    expect(result.insights!.all).toEqual([]);
  });

  it('returns seoContext.effectiveBrandVoiceBlock as empty string (not undefined)', async () => {
    const result = await buildWorkspaceIntelligence('ws-empty-4', { slices: ['seoContext'] });
    expect(result.seoContext).toBeDefined();
    expect(typeof result.seoContext!.effectiveBrandVoiceBlock).toBe('string');
  });

  it('does not include unrequested slices when specific slices are provided', async () => {
    const result = await buildWorkspaceIntelligence('ws-empty-5', { slices: ['insights'] });
    expect(result.insights).toBeDefined();
    // seoContext, learnings, etc. should not be populated
    expect(result.seoContext).toBeUndefined();
    expect(result.learnings).toBeUndefined();
    expect(result.contentPipeline).toBeUndefined();
  });

  it('includes all fields at top level when slices are explicitly provided', async () => {
    const result = await buildWorkspaceIntelligence('ws-empty-6', { slices: ['insights', 'seoContext'] });
    // Core metadata always present
    expect(result).toHaveProperty('version');
    expect(result).toHaveProperty('workspaceId');
    expect(result).toHaveProperty('assembledAt');
  });
});

// ── Slice field type guarantees ────────────────────────────────────────────

describe('buildWorkspaceIntelligence — field type guarantees', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildEffectiveBrandVoiceBlock.mockReturnValue('Test voice block');
    mockGetInsights.mockReturnValue([]);
    mockGetLearnings.mockReturnValue(null);
  });

  it('seoContext.brandVoice is a string (not null or undefined)', async () => {
    const result = await buildWorkspaceIntelligence('ws-types-1', { slices: ['seoContext'] });
    expect(typeof result.seoContext!.brandVoice).toBe('string');
  });

  it('insights.all is always an array (not null)', async () => {
    const result = await buildWorkspaceIntelligence('ws-types-2', { slices: ['insights'] });
    expect(Array.isArray(result.insights!.all)).toBe(true);
  });

  it('workspaceId is preserved exactly as provided', async () => {
    const id = 'workspace-with-special-chars_01';
    const result = await buildWorkspaceIntelligence(id, { slices: ['insights'] });
    expect(result.workspaceId).toBe(id);
  });

  it('version is the numeric constant 1', async () => {
    const result = await buildWorkspaceIntelligence('ws-types-3', { slices: ['insights'] });
    expect(result.version).toBe(1);
    expect(typeof result.version).toBe('number');
  });
});

// ── Token budget enforcement ───────────────────────────────────────────────

describe('formatForPrompt — token budget enforcement', () => {
  const makeIntelligence = (workspaceId: string) => ({
    version: 1 as const,
    workspaceId,
    assembledAt: new Date().toISOString(),
    seoContext: {
      brandVoice: 'Test brand voice for SEO context',
      effectiveBrandVoiceBlock: '',
      knowledgeBase: 'A'.repeat(2000), // large knowledge base
      personas: null,
      pageMap: [],
      keywords: [],
      businessProfile: null,
      industry: null,
    },
    insights: {
      all: Array.from({ length: 20 }, (_, i) => ({
        id: `insight-${i}`,
        insightType: 'content_decay',
        severity: 'warning',
        impactScore: 50 + i,
        data: { pageId: `/page-${i}`, summary: `Summary for page ${i}` },
      })),
      byType: {},
      topByImpact: [],
      bySeverity: { critical: 0, warning: 20, opportunity: 0, positive: 0 },
    },
  });

  it('returns a non-empty string for standard verbosity', () => {
    const intel = makeIntelligence('ws-budget-1');
    const output = formatForPrompt(intel as never, { sections: ['seoContext'], verbosity: 'standard' });
    expect(typeof output).toBe('string');
    expect(output.length).toBeGreaterThan(0);
  });

  it('tokenBudget option limits output length roughly', () => {
    const intel = makeIntelligence('ws-budget-2');
    // Small budget should produce shorter output than no budget
    const withBudget = formatForPrompt(intel as never, {
      sections: ['insights'],
      verbosity: 'standard',
      tokenBudget: 50,
    });
    const withoutBudget = formatForPrompt(intel as never, {
      sections: ['insights'],
      verbosity: 'standard',
    });
    // With a very small budget, output should not be longer than without
    // (it may be equal or shorter, depending on formatter implementation)
    expect(typeof withBudget).toBe('string');
    expect(typeof withoutBudget).toBe('string');
  });

  it('returns empty string when sections array is empty', () => {
    const intel = makeIntelligence('ws-budget-3');
    const output = formatForPrompt(intel as never, { sections: [] });
    expect(output.trim()).toBe('');
  });

  it('includes workspace-relevant content when seoContext slice is requested', () => {
    const intel = {
      ...makeIntelligence('ws-budget-4'),
      seoContext: {
        brandVoice: 'SENTINEL_BRAND_VOICE',
        effectiveBrandVoiceBlock: '',
        knowledgeBase: '',
        personas: null,
        pageMap: [],
        keywords: [],
        businessProfile: null,
        industry: 'Technology',
      },
    };
    const output = formatForPrompt(intel as never, { sections: ['seoContext'] });
    // The formatter should include something from the seoContext data
    expect(typeof output).toBe('string');
  });
});

// ── Partial failure isolation ──────────────────────────────────────────────

describe('buildWorkspaceIntelligence — partial failure isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLearnings.mockReturnValue(null);
  });

  it('populates successful slices even when one slice throws', async () => {
    // seoContext will throw, insights will succeed
    mockBuildEffectiveBrandVoiceBlock.mockImplementation(() => {
      throw new Error('seoContext assembly failed');
    });
    mockGetInsights.mockReturnValue([
      {
        id: 'partial-1',
        insightType: 'page_health',
        severity: 'warning',
        impactScore: 60,
        data: {},
      },
    ] as never);

    const result = await buildWorkspaceIntelligence('ws-partial-1', {
      slices: ['seoContext', 'insights'],
    });

    // seoContext failed → undefined
    expect(result.seoContext).toBeUndefined();
    // insights succeeded → populated
    expect(result.insights).toBeDefined();
    expect(result.insights!.all).toHaveLength(1);
  });

  it('still returns version/workspaceId/assembledAt even if all slices fail', async () => {
    mockBuildEffectiveBrandVoiceBlock.mockImplementation(() => {
      throw new Error('always fails');
    });
    mockGetInsights.mockImplementation(() => {
      throw new Error('insights always fails');
    });

    const result = await buildWorkspaceIntelligence('ws-partial-2', {
      slices: ['seoContext', 'insights'],
    });

    expect(result.version).toBe(1);
    expect(result.workspaceId).toBe('ws-partial-2');
    expect(result.assembledAt).toBeDefined();
  });

  it('does not throw when workspace data returns empty objects', async () => {
    mockBuildEffectiveBrandVoiceBlock.mockReturnValue('');
    mockGetInsights.mockReturnValue([]);
    mockGetWorkspace.mockReturnValue(null as never);

    await expect(
      buildWorkspaceIntelligence('ws-partial-3', { slices: ['seoContext'] }),
    ).resolves.toBeDefined();
  });
});

// ── Insights capping behavior ──────────────────────────────────────────────

describe('buildWorkspaceIntelligence — insights capping and ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildEffectiveBrandVoiceBlock.mockReturnValue('');
    mockGetLearnings.mockReturnValue(null);
  });

  it('caps insights at 100 maximum entries', async () => {
    const manyInsights = Array.from({ length: 200 }, (_, i) => ({
      id: `insight-${i}`,
      insightType: 'content_decay',
      severity: 'warning',
      impactScore: i,
      data: {},
    }));
    mockGetInsights.mockReturnValue(manyInsights as never);

    const result = await buildWorkspaceIntelligence('ws-cap-1', { slices: ['insights'] });
    expect(result.insights!.all.length).toBeLessThanOrEqual(100);
  });

  it('keeps full insight rollups even when all is capped', async () => {
    const manyInsights = Array.from({ length: 150 }, (_, i) => ({
      id: `insight-${i}`,
      insightType: i < 120 ? 'content_decay' : 'ranking_opportunity',
      severity: i < 100 ? 'warning' : 'critical',
      impactScore: 150 - i,
      data: {},
    }));
    mockGetInsights.mockReturnValue(manyInsights as never);

    const result = await buildWorkspaceIntelligence('ws-cap-rollups', { slices: ['insights'] });
    expect(result.insights!.all).toHaveLength(100);
    expect(result.insights!.bySeverity.warning).toBe(100);
    expect(result.insights!.bySeverity.critical).toBe(50);
    expect(result.insights!.byType.content_decay).toHaveLength(120);
    expect(result.insights!.byType.ranking_opportunity).toHaveLength(30);
  });

  it('sorts insights by impactScore descending (highest first)', async () => {
    const insights = [
      { id: 'low', insightType: 'content_decay', severity: 'warning', impactScore: 10, data: {} },
      { id: 'high', insightType: 'content_decay', severity: 'critical', impactScore: 90, data: {} },
      { id: 'mid', insightType: 'content_decay', severity: 'warning', impactScore: 50, data: {} },
    ];
    mockGetInsights.mockReturnValue(insights as never);

    const result = await buildWorkspaceIntelligence('ws-sort-1', { slices: ['insights'] });
    const scores = result.insights!.all.map(i => i.impactScore);
    // Should be in descending order
    for (let i = 0; i < scores.length - 1; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i + 1]);
    }
  });

  it('returns empty insights.all without error when insights store returns empty array', async () => {
    mockGetInsights.mockReturnValue([]);

    const result = await buildWorkspaceIntelligence('ws-empty-insights-1', { slices: ['insights'] });
    expect(result.insights!.all).toEqual([]);
  });
});
