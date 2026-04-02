import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../server/page-keywords.js', () => ({
  getPageKeyword: vi.fn(() => ({
    pagePath: '/about',
    primaryKeyword: 'about us',
    searchIntent: 'informational',
    currentPosition: 12,
    previousPosition: 15,
  })),
}));

vi.mock('../server/recommendations.js', () => ({
  loadRecommendations: vi.fn(() => ({
    recommendations: [
      { id: 'r1', priority: 'fix_now', status: 'pending', pageUrl: '/about', title: 'Add meta description' },
    ],
  })),
}));

vi.mock('../server/seo-change-tracker.js', () => ({
  getSeoChanges: vi.fn(() => []),
}));

vi.mock('../server/outcome-tracking.js', () => ({
  getActionsByPage: vi.fn(() => []),
  getOutcomesForAction: vi.fn(() => []),
  getPendingActions: vi.fn(() => []),
  getActionsByWorkspace: vi.fn(() => []),
}));

vi.mock('../server/analytics-insights-store.js', () => ({
  getInsights: vi.fn(() => []),
}));

vi.mock('../server/rank-tracking.js', () => ({
  getTrackedKeywords: vi.fn(() => []),
  getLatestRanks: vi.fn(() => []),
}));

vi.mock('../server/schema-validator.js', () => ({
  getValidations: vi.fn(() => []),
}));

vi.mock('../server/content-brief.js', () => ({
  listBriefs: vi.fn(() => []),
}));

vi.mock('../server/content-decay.js', () => ({
  loadDecayAnalysis: vi.fn(() => null),
}));

// Mock other required dependencies
vi.mock('../server/seo-context.js', () => ({
  buildSeoContext: vi.fn(() => ({ strategy: null, brandVoiceBlock: '', businessContext: '', knowledgeBlock: '' })),
}));
vi.mock('../server/workspaces.js', () => ({
  getWorkspace: vi.fn(() => ({ id: 'ws-1', personas: [], siteId: null })),
}));
vi.mock('../server/feature-flags.js', () => ({ isFeatureEnabled: vi.fn(() => false) }));
vi.mock('../server/workspace-learnings.js', () => ({ getWorkspaceLearnings: vi.fn(() => null) }));
vi.mock('../server/outcome-playbooks.js', () => ({ getPlaybooks: vi.fn(() => []) }));
vi.mock('../server/workspace-data.js', () => ({
  getContentPipelineSummary: vi.fn(() => ({
    briefs: { total: 0, byStatus: {} }, posts: { total: 0, byStatus: {} },
    matrices: { total: 0, cellsPlanned: 0, cellsPublished: 0 },
    requests: { pending: 0, inProgress: 0, delivered: 0 },
    workOrders: { active: 0 }, seoEdits: { pending: 0, applied: 0, inReview: 0 },
  })),
  getPageCacheStats: vi.fn(() => ({ entries: 0, maxEntries: 100 })),
}));
vi.mock('../server/db/index.js', () => {
  const prepare = vi.fn(() => ({ all: vi.fn(() => []), get: vi.fn(() => undefined), run: vi.fn() }));
  return { default: { prepare } };
});

describe('assemblePageProfile', () => {
  beforeEach(async () => {
    const { invalidateIntelligenceCache } = await import('../server/workspace-intelligence.js');
    invalidateIntelligenceCache('ws-1');
  });

  it('returns undefined when no pagePath provided', async () => {
    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['pageProfile'],
      // no pagePath
    });
    expect(result.pageProfile).toBeUndefined();
  });

  it('returns populated PageProfileSlice when pagePath provided', async () => {
    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['pageProfile'],
      pagePath: '/about',
    });

    expect(result.pageProfile).toBeDefined();
    const pp = result.pageProfile!;
    expect(pp.pagePath).toBe('/about');
    expect(pp.primaryKeyword).toBe('about us');
    expect(pp.searchIntent).toBe('informational');
  });

  it('includes page-filtered recommendations', async () => {
    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['pageProfile'],
      pagePath: '/about',
    });

    expect(result.pageProfile!.recommendations).toContain('Add meta description');
  });

  it('has all required shape fields', async () => {
    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['pageProfile'],
      pagePath: '/about',
    });

    const pp = result.pageProfile!;
    expect(pp).toHaveProperty('pagePath');
    expect(pp).toHaveProperty('primaryKeyword');
    expect(pp).toHaveProperty('searchIntent');
    expect(pp).toHaveProperty('optimizationScore');
    expect(pp).toHaveProperty('recommendations');
    expect(pp).toHaveProperty('contentGaps');
    expect(pp).toHaveProperty('insights');
    expect(pp).toHaveProperty('actions');
    expect(pp).toHaveProperty('auditIssues');
    expect(pp).toHaveProperty('schemaStatus');
    expect(pp).toHaveProperty('linkHealth');
    expect(pp).toHaveProperty('seoEdits');
    expect(pp).toHaveProperty('rankHistory');
    expect(pp).toHaveProperty('contentStatus');
    expect(pp).toHaveProperty('cwvStatus');
  });

  it('derives rank trend from page-keywords fallback when rank-tracking throws', async () => {
    const rankTracking = await import('../server/rank-tracking.js');
    vi.mocked(rankTracking.getLatestRanks).mockImplementationOnce(() => { throw new Error('No rank data'); });

    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['pageProfile'],
      pagePath: '/about',
    });

    // currentPosition=12, previousPosition=15 → trend='up' (improved)
    expect(result.pageProfile!.rankHistory.trend).toBe('up');
    expect(result.pageProfile!.rankHistory.current).toBe(12);
  });
});
