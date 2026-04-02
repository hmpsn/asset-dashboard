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
      { id: 'r1', priority: 'fix_now', status: 'pending', affectedPages: ['/about'], title: 'Add meta description' },
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

  it('populates contentGaps from strategy gaps matching the page primary keyword', async () => {
    const workspaces = await import('../server/workspaces.js');
    // Use mockReturnValue (not Once) — getWorkspace is called multiple times per assembly
    vi.mocked(workspaces.getWorkspace).mockReturnValue({
      id: 'ws-1',
      keywordStrategy: {
        siteKeywords: [],
        pageMap: [],
        opportunities: [],
        generatedAt: '2025-01-01T00:00:00.000Z',
        contentGaps: [
          { topic: 'About Us History', targetKeyword: 'about us', intent: 'informational', priority: 'high', rationale: 'core page' },
          { topic: 'Pricing Guide', targetKeyword: 'pricing', intent: 'commercial', priority: 'medium', rationale: 'conversion page' },
          { topic: 'Contact Methods', targetKeyword: 'contact us', intent: 'navigational', priority: 'low', rationale: 'support' },
        ],
      },
    } as ReturnType<typeof workspaces.getWorkspace>);

    try {
      const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
      // pagePath /about has primaryKeyword 'about us' from the page-keywords mock
      const result = await buildWorkspaceIntelligence('ws-1', {
        slices: ['pageProfile'],
        pagePath: '/about',
      });

      const gaps = result.pageProfile!.contentGaps;
      expect(gaps.length).toBeGreaterThan(0);
      expect(gaps).toContain('About Us History');
      // Non-matching gap topics must not appear
      expect(gaps).not.toContain('Pricing Guide');
      expect(gaps).not.toContain('Contact Methods');
    } finally {
      // Restore default mock for subsequent tests
      vi.mocked(workspaces.getWorkspace).mockReturnValue({ id: 'ws-1', personas: [], siteId: null } as ReturnType<typeof workspaces.getWorkspace>);
    }
  });

  it('returns all gaps (capped at 5) when no page keyword matches any gap', async () => {
    const workspaces = await import('../server/workspaces.js');
    vi.mocked(workspaces.getWorkspace).mockReturnValue({
      id: 'ws-1',
      keywordStrategy: {
        siteKeywords: [],
        pageMap: [],
        opportunities: [],
        generatedAt: '2025-01-01T00:00:00.000Z',
        contentGaps: [
          { topic: 'Gap One', targetKeyword: 'unrelated-kw-1', intent: 'informational', priority: 'high', rationale: 'a' },
          { topic: 'Gap Two', targetKeyword: 'unrelated-kw-2', intent: 'informational', priority: 'medium', rationale: 'b' },
          { topic: 'Gap Three', targetKeyword: 'unrelated-kw-3', intent: 'informational', priority: 'low', rationale: 'c' },
        ],
      },
    } as ReturnType<typeof workspaces.getWorkspace>);

    try {
      const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
      // primaryKeyword is 'about us' from mock, which matches none of the gaps above
      const result = await buildWorkspaceIntelligence('ws-1', {
        slices: ['pageProfile'],
        pagePath: '/about',
      });

      const gaps = result.pageProfile!.contentGaps;
      // Falls back to all gaps since no match found
      expect(gaps.length).toBeGreaterThan(0);
      expect(gaps).toContain('Gap One');
    } finally {
      vi.mocked(workspaces.getWorkspace).mockReturnValue({ id: 'ws-1', personas: [], siteId: null } as ReturnType<typeof workspaces.getWorkspace>);
    }
  });

  it('returns empty contentGaps when workspace has no keywordStrategy', async () => {
    // Default mock has no keywordStrategy — no override needed
    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['pageProfile'],
      pagePath: '/about',
    });

    expect(result.pageProfile!.contentGaps).toEqual([]);
  });
});
