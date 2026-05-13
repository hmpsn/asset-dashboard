import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../server/page-keywords.js', () => ({
  getPageKeyword: vi.fn(() => ({
    pagePath: '/about',
    primaryKeyword: 'about us',
    searchIntent: 'informational',
    currentPosition: 12,
    previousPosition: 15,
    optimizationIssues: ['Primary keyword missing from H1', 'Meta description too short'],
    recommendations: ['Add primary keyword to H1', 'Expand meta description to 150 chars'],
    contentGaps: ['Local SEO signals', 'Customer testimonials section'],
    primaryKeywordPresence: { inTitle: true, inMeta: false, inContent: true, inSlug: false },
    competitorKeywords: ['competitor term A', 'competitor term B'],
    topicCluster: 'Brand & Company',
    estimatedDifficulty: 'medium',
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
  getActionsByWorkspace: vi.fn(() => []),
  getOutcomesForAction: vi.fn(() => []),
  getPendingActions: vi.fn(() => []),
  getTopWinsFromActions: vi.fn(() => []),
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
vi.mock('../server/schema-store.js', () => ({
  getSchemaSnapshot: vi.fn(() => null),
}));
vi.mock('../server/reports.js', () => ({
  getLatestSnapshot: vi.fn(() => null),
  getLatestSnapshotBefore: vi.fn(() => null),
}));
vi.mock('../server/performance-store.js', () => ({
  getInternalLinks: vi.fn(() => null),
  getPageSpeed: vi.fn(() => null),
}));
vi.mock('../server/site-architecture.js', () => ({
  getCachedArchitecture: vi.fn(() => null),
  flattenTree: vi.fn(() => []),
}));

vi.mock('../server/content-brief.js', () => ({
  listBriefs: vi.fn(() => []),
}));

vi.mock('../server/content-decay.js', () => ({
  loadDecayAnalysis: vi.fn(() => null),
}));

// Mock other required dependencies
vi.mock('../server/intelligence/seo-context-source.js', () => ({
  buildEffectiveBrandVoiceBlock: vi.fn(() => ''),
  getRawBrandVoice: vi.fn(() => ''),
  getRawKnowledge: vi.fn(() => ''),
}));
vi.mock('../server/workspaces.js', () => ({
  getWorkspace: vi.fn(() => ({ id: 'ws-1', personas: [], siteId: null })),
}));
vi.mock('../server/content-gaps.js', () => ({
  listContentGaps: vi.fn(() => []),
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

  it('matches page recommendations by exact normalized identity without sibling overmatch', async () => {
    const recommendations = await import('../server/recommendations.js');
    vi.mocked(recommendations.loadRecommendations).mockReturnValueOnce({
      recommendations: [
        { id: 'r1', priority: 'fix_now', status: 'pending', affectedPages: ['https://example.com/about?utm=1'], title: 'About page rec' },
        { id: 'r2', priority: 'fix_now', status: 'pending', affectedPages: ['services/about'], title: 'Nested sibling rec' },
      ],
    } as ReturnType<typeof recommendations.loadRecommendations>);

    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['pageProfile'],
      pagePath: '/about',
    });

    expect(result.pageProfile!.recommendations).toContain('About page rec');
    expect(result.pageProfile!.recommendations).not.toContain('Nested sibling rec');
  });

  it('matches audit and CWV page data by URL path when slug is only a leaf', async () => {
    const workspaces = await import('../server/workspaces.js');
    const reports = await import('../server/reports.js');
    const performanceStore = await import('../server/performance-store.js');

    vi.mocked(workspaces.getWorkspace).mockReturnValue({
      id: 'ws-1',
      webflowSiteId: 'site-1',
      personas: [],
    } as ReturnType<typeof workspaces.getWorkspace>);
    vi.mocked(reports.getLatestSnapshot).mockReturnValueOnce({
      audit: {
        pages: [
          {
            pageId: 'page-services-seo',
            slug: 'seo',
            url: 'https://example.com/services/seo?utm=1',
            issues: [{ message: 'Nested page audit issue' }],
          },
        ],
      },
    } as ReturnType<typeof reports.getLatestSnapshot>);
    vi.mocked(performanceStore.getPageSpeed).mockReturnValueOnce({
      result: {
        pages: [
          { slug: 'seo', url: 'https://example.com/services/seo#top', score: 94 },
        ],
      },
    } as ReturnType<typeof performanceStore.getPageSpeed>);

    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['pageProfile'],
      pagePath: '/services/seo',
    });

    expect(result.pageProfile!.auditIssues).toContain('Nested page audit issue');
    expect(result.pageProfile!.cwvStatus).toBe('good');
  });

  it('omits suppressed audit issues from pageProfile auditIssues', async () => {
    const workspaces = await import('../server/workspaces.js');
    const reports = await import('../server/reports.js');

    vi.mocked(workspaces.getWorkspace).mockReturnValue({
      id: 'ws-1',
      webflowSiteId: 'site-1',
      personas: [],
      auditSuppressions: [{ check: 'meta-description', pageSlug: 'about', createdAt: new Date().toISOString() }],
    } as ReturnType<typeof workspaces.getWorkspace>);
    vi.mocked(reports.getLatestSnapshot).mockReturnValueOnce({
      id: 'snap-1',
      siteId: 'site-1',
      siteName: 'Example',
      createdAt: new Date().toISOString(),
      audit: {
        siteScore: 80,
        totalPages: 1,
        errors: 1,
        warnings: 1,
        infos: 0,
        pages: [
          {
            pageId: 'p-about',
            slug: 'about',
            url: 'https://example.com/about',
            page: 'About',
            score: 80,
            issues: [
              { check: 'meta-description', severity: 'error', message: 'Suppressed meta issue' },
              { check: 'content-length', severity: 'warning', message: 'Visible content issue' },
            ],
          },
        ],
        siteWideIssues: [],
      },
    } as ReturnType<typeof reports.getLatestSnapshot>);

    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['pageProfile'],
      pagePath: '/about',
    });

    expect(result.pageProfile!.auditIssues).toContain('Visible content issue');
    expect(result.pageProfile!.auditIssues).not.toContain('Suppressed meta issue');
  });

  it('does not let nested leaf slugs overmatch top-level audit/CWV page data', async () => {
    const workspaces = await import('../server/workspaces.js');
    const reports = await import('../server/reports.js');
    const performanceStore = await import('../server/performance-store.js');

    vi.mocked(workspaces.getWorkspace).mockReturnValue({
      id: 'ws-1',
      webflowSiteId: 'site-1',
      personas: [],
    } as ReturnType<typeof workspaces.getWorkspace>);
    vi.mocked(reports.getLatestSnapshot).mockReturnValueOnce({
      audit: {
        pages: [
          {
            pageId: 'page-services-seo',
            slug: 'seo',
            url: 'https://example.com/services/seo',
            issues: [{ message: 'Nested page audit issue' }],
          },
          {
            pageId: 'page-root-seo',
            slug: 'seo',
            url: 'https://example.com/seo?utm=1',
            issues: [{ message: 'Root page audit issue' }],
          },
        ],
      },
    } as ReturnType<typeof reports.getLatestSnapshot>);
    vi.mocked(performanceStore.getPageSpeed).mockReturnValueOnce({
      result: {
        pages: [
          { slug: 'seo', url: 'https://example.com/services/seo', score: 94 },
          { slug: 'seo', url: 'https://example.com/seo#top', score: 45 },
        ],
      },
    } as ReturnType<typeof performanceStore.getPageSpeed>);

    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['pageProfile'],
      pagePath: '/seo',
    });

    expect(result.pageProfile!.auditIssues).toContain('Root page audit issue');
    expect(result.pageProfile!.auditIssues).not.toContain('Nested page audit issue');
    expect(result.pageProfile!.cwvStatus).toBe('poor');
  });

  it('matches schema validation status through snapshot URL/path identity for nested pages', async () => {
    const workspaces = await import('../server/workspaces.js');
    const schemaStore = await import('../server/schema-store.js');
    const schemaValidator = await import('../server/schema-validator.js');

    vi.mocked(workspaces.getWorkspace).mockReturnValue({
      id: 'ws-1',
      webflowSiteId: 'site-1',
      personas: [],
    } as ReturnType<typeof workspaces.getWorkspace>);
    vi.mocked(schemaStore.getSchemaSnapshot).mockReturnValueOnce({
      siteId: 'site-1',
      workspaceId: 'ws-1',
      generatedAt: new Date().toISOString(),
      results: [
        {
          pageId: 'page-services-seo',
          pageTitle: 'SEO Services',
          slug: 'seo',
          url: 'https://example.com/services/seo',
          existingSchemas: [],
          suggestedSchemas: [],
        },
      ],
    } as ReturnType<typeof schemaStore.getSchemaSnapshot>);
    vi.mocked(schemaValidator.getValidations).mockReturnValueOnce([
      { pageId: 'page-services-seo', status: 'warnings' },
    ] as ReturnType<typeof schemaValidator.getValidations>);

    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['pageProfile'],
      pagePath: '/services/seo',
    });

    expect(result.pageProfile!.schemaStatus).toBe('warnings');
  });

  it('does not let nested leaf slugs overmatch top-level schema status', async () => {
    const workspaces = await import('../server/workspaces.js');
    const schemaStore = await import('../server/schema-store.js');
    const schemaValidator = await import('../server/schema-validator.js');

    vi.mocked(workspaces.getWorkspace).mockReturnValue({
      id: 'ws-1',
      webflowSiteId: 'site-1',
      personas: [],
    } as ReturnType<typeof workspaces.getWorkspace>);
    vi.mocked(schemaStore.getSchemaSnapshot).mockReturnValueOnce({
      siteId: 'site-1',
      workspaceId: 'ws-1',
      generatedAt: new Date().toISOString(),
      results: [
        {
          pageId: 'page-services-seo',
          pageTitle: 'SEO Services',
          slug: 'seo',
          url: 'https://example.com/services/seo',
          existingSchemas: [],
          suggestedSchemas: [],
        },
        {
          pageId: 'page-root-seo',
          pageTitle: 'SEO Root',
          slug: 'seo',
          url: 'https://example.com/seo?utm=1',
          existingSchemas: [],
          suggestedSchemas: [],
        },
      ],
    } as ReturnType<typeof schemaStore.getSchemaSnapshot>);
    vi.mocked(schemaValidator.getValidations).mockReturnValueOnce([
      { pageId: 'page-services-seo', status: 'valid' },
      { pageId: 'page-root-seo', status: 'errors' },
    ] as ReturnType<typeof schemaValidator.getValidations>);

    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['pageProfile'],
      pagePath: '/seo',
    });

    expect(result.pageProfile!.schemaStatus).toBe('errors');
    expect(result.pageProfile!.schemaStatus).not.toBe('valid');
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
    expect(pp).toHaveProperty('optimizationIssues');
    expect(pp).toHaveProperty('primaryKeywordPresence');
    expect(pp).toHaveProperty('competitorKeywords');
    expect(pp).toHaveProperty('topicCluster');
    expect(pp).toHaveProperty('estimatedDifficulty');
    expect(pp).toHaveProperty('schemaStatus');
    expect(pp).toHaveProperty('linkHealth');
    expect(pp).toHaveProperty('seoEdits');
    expect(pp).toHaveProperty('rankHistory');
    expect(pp).toHaveProperty('contentStatus');
    expect(pp).toHaveProperty('cwvStatus');
  });

  it('populates optimizationIssues from pageKw (AI keyword analysis source)', async () => {
    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['pageProfile'], pagePath: '/about' });
    const pp = result.pageProfile!;
    expect(pp.optimizationIssues).toContain('Primary keyword missing from H1');
    expect(pp.optimizationIssues).toContain('Meta description too short');
  });

  it('populates primaryKeywordPresence from pageKw', async () => {
    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['pageProfile'], pagePath: '/about' });
    const pp = result.pageProfile!;
    expect(pp.primaryKeywordPresence).toEqual({ inTitle: true, inMeta: false, inContent: true, inSlug: false });
  });

  it('populates competitorKeywords, topicCluster, estimatedDifficulty from pageKw', async () => {
    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['pageProfile'], pagePath: '/about' });
    const pp = result.pageProfile!;
    expect(pp.competitorKeywords).toContain('competitor term A');
    expect(pp.topicCluster).toBe('Brand & Company');
    expect(pp.estimatedDifficulty).toBe('medium');
  });

  it('prefers pageKw.contentGaps over strategy gaps when both exist', async () => {
    // pageKw mock returns contentGaps: ['Local SEO signals', 'Customer testimonials section']
    // Strategy gaps (from workspace mock) are absent — just verifying pageKw wins when present
    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['pageProfile'], pagePath: '/about' });
    const gaps = result.pageProfile!.contentGaps;
    expect(gaps).toContain('Local SEO signals');
    expect(gaps).toContain('Customer testimonials section');
  });

  it('merges pageKw.recommendations with platform recs, pageKw recs first', async () => {
    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['pageProfile'], pagePath: '/about' });
    const recs = result.pageProfile!.recommendations;
    // pageKw recs come first
    expect(recs[0]).toBe('Add primary keyword to H1');
    // Platform rec ('Add meta description' from loadRecommendations mock) is also present
    expect(recs).toContain('Add meta description');
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

  it('falls back to strategy gaps matching page keyword when pageKw has no contentGaps', async () => {
    // Override pageKw to have no contentGaps — tests the fallback path
    const pageKeywords = await import('../server/page-keywords.js');
    vi.mocked(pageKeywords.getPageKeyword).mockReturnValueOnce({
      pagePath: '/about', primaryKeyword: 'about us', searchIntent: 'informational',
      currentPosition: 12, previousPosition: 15,
      // No contentGaps — forces fallback to strategy
    } as ReturnType<typeof pageKeywords.getPageKeyword>);

    // contentGaps now live in the content_gaps table (post-#365 normalization),
    // not on keywordStrategy.contentGaps. Mock listContentGaps directly.
    const contentGaps = await import('../server/content-gaps.js');
    vi.mocked(contentGaps.listContentGaps).mockReturnValueOnce([
      { topic: 'About Us History', targetKeyword: 'about us', intent: 'informational', priority: 'high', rationale: 'core page' },
      { topic: 'Pricing Guide', targetKeyword: 'pricing', intent: 'commercial', priority: 'medium', rationale: 'conversion page' },
      { topic: 'Contact Methods', targetKeyword: 'contact us', intent: 'navigational', priority: 'low', rationale: 'support' },
    ]);

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
  });

  it('fallback: returns all strategy gaps (capped at 5) when no keyword matches and pageKw has no gaps', async () => {
    const pageKeywords = await import('../server/page-keywords.js');
    vi.mocked(pageKeywords.getPageKeyword).mockReturnValueOnce({
      pagePath: '/about', primaryKeyword: 'about us', searchIntent: 'informational',
      currentPosition: 12, previousPosition: 15,
    } as ReturnType<typeof pageKeywords.getPageKeyword>);

    const contentGaps = await import('../server/content-gaps.js');
    vi.mocked(contentGaps.listContentGaps).mockReturnValueOnce([
      { topic: 'Gap One', targetKeyword: 'unrelated-kw-1', intent: 'informational', priority: 'high', rationale: 'a' },
      { topic: 'Gap Two', targetKeyword: 'unrelated-kw-2', intent: 'informational', priority: 'medium', rationale: 'b' },
      { topic: 'Gap Three', targetKeyword: 'unrelated-kw-3', intent: 'informational', priority: 'low', rationale: 'c' },
    ]);

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
  });

  it('fallback: returns empty contentGaps when pageKw has none and workspace has no keywordStrategy', async () => {
    const pageKeywords = await import('../server/page-keywords.js');
    vi.mocked(pageKeywords.getPageKeyword).mockReturnValueOnce({
      pagePath: '/about', primaryKeyword: 'about us', searchIntent: 'informational',
      currentPosition: 12, previousPosition: 15,
      // No contentGaps — forces fallback; default workspace mock has no keywordStrategy either
    } as ReturnType<typeof pageKeywords.getPageKeyword>);

    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['pageProfile'],
      pagePath: '/about',
    });

    expect(result.pageProfile!.contentGaps).toEqual([]);
  });
});
