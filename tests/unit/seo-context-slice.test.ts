import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  strategyHistoryRows: [] as Array<{ generated_at: string }>,
  getWorkspace: vi.fn(),
  listPageKeywords: vi.fn(),
  listContentGaps: vi.fn(),
  getTrackedKeywords: vi.fn(),
  getLatestRanks: vi.fn(),
  getDiscoveredQuerySummary: vi.fn(),
  getBacklinksProvider: vi.fn(),
  getPrimaryMarketLocationCode: vi.fn(),
  findPageMapEntry: vi.fn(),
  normalizeSocialProfiles: vi.fn(),
  getRawBrandVoice: vi.fn(),
  getRawKnowledge: vi.fn(),
  buildEffectiveBrandVoiceBlock: vi.fn(),
  dbPrepare: vi.fn(() => ({
    all: vi.fn(() => mocks.strategyHistoryRows),
    get: vi.fn(),
    run: vi.fn(),
  })),
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../server/db/stmt-cache.js', () => ({
  createStmtCache: (factory: () => unknown) => factory,
}));

vi.mock('../../server/db/index.js', () => ({
  default: {
    prepare: mocks.dbPrepare,
  },
}));

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: mocks.getWorkspace,
}));

vi.mock('../../server/page-keywords.js', () => ({
  listPageKeywords: mocks.listPageKeywords,
}));

vi.mock('../../server/content-gaps.js', () => ({
  listContentGaps: mocks.listContentGaps,
}));

vi.mock('../../server/rank-tracking.js', () => ({
  getTrackedKeywords: mocks.getTrackedKeywords,
  getLatestRanks: mocks.getLatestRanks,
}));

vi.mock('../../server/client-discovered-queries.js', () => ({
  getDiscoveredQuerySummary: mocks.getDiscoveredQuerySummary,
}));

vi.mock('../../server/seo-data-provider.js', () => ({
  getBacklinksProvider: mocks.getBacklinksProvider,
}));

vi.mock('../../server/local-seo.js', () => ({
  getPrimaryMarketLocationCode: mocks.getPrimaryMarketLocationCode,
}));

vi.mock('../../server/helpers.js', () => ({
  findPageMapEntry: mocks.findPageMapEntry,
}));

vi.mock('../../server/social-profiles.js', () => ({
  normalizeSocialProfiles: mocks.normalizeSocialProfiles,
}));

vi.mock('../../server/intelligence/seo-context-source.js', () => ({
  getRawBrandVoice: mocks.getRawBrandVoice,
  getRawKnowledge: mocks.getRawKnowledge,
  buildEffectiveBrandVoiceBlock: mocks.buildEffectiveBrandVoiceBlock,
}));

// PR6 (Spine D) — new optional slice reads degrade gracefully; mock them to empty.
vi.mock('../../server/quick-wins.js', () => ({
  listQuickWins: vi.fn(() => []),
}));

vi.mock('../../server/cannibalization-issues.js', () => ({
  listCannibalizationIssues: vi.fn(() => []),
}));

vi.mock('../../server/recommendations.js', () => ({
  loadRecommendations: vi.fn(() => null),
}));

const { assembleSeoContext } = await import('../../server/intelligence/seo-context-slice.js');

beforeEach(() => {
  vi.clearAllMocks();

  mocks.strategyHistoryRows = [];
  mocks.getRawBrandVoice.mockReturnValue('raw brand voice');
  mocks.getRawKnowledge.mockReturnValue('knowledge text');
  mocks.buildEffectiveBrandVoiceBlock.mockReturnValue('EFFECTIVE VOICE');
  mocks.listPageKeywords.mockReturnValue([]);
  mocks.listContentGaps.mockReturnValue([]);
  mocks.getTrackedKeywords.mockReturnValue([]);
  mocks.getLatestRanks.mockReturnValue([]);
  mocks.getDiscoveredQuerySummary.mockReturnValue({ totalDiscovered: 0, lostVisibilityCount: 0, topLostQueries: [] });
  mocks.getPrimaryMarketLocationCode.mockReturnValue(undefined);
  mocks.findPageMapEntry.mockReturnValue(undefined);
  mocks.getBacklinksProvider.mockReturnValue(null);
  mocks.normalizeSocialProfiles.mockImplementation((profiles: string[] | null | undefined) =>
    Array.isArray(profiles) ? profiles.filter(Boolean) : undefined,
  );

  mocks.getWorkspace.mockReturnValue({
    id: 'ws-seo',
    name: 'WS',
    folder: 'ws',
    createdAt: '2026-01-01T00:00:00.000Z',
    personas: [],
    keywordStrategy: {
      businessContext: 'B2B SEO tools',
      pageMap: [
        {
          pagePath: '/stored',
          pageTitle: 'Stored',
          primaryKeyword: 'stored keyword',
          secondaryKeywords: [],
        },
      ],
      contentGaps: [
        { topic: 'legacy gap', intent: 'informational', priority: 'high', rationale: 'legacy', targetKeyword: 'legacy gap keyword' },
      ],
      targetKeywords: [],
      quickWins: [],
      summary: 'summary',
      generatedAt: '2026-01-01T00:00:00.000Z',
    },
    businessPriorities: ['Increase demos', ' increase demos ', 'Expand into Chicago'],
    intelligenceProfile: {
      industry: 'SaaS',
      goals: ['Increase demos'],
      targetAudience: 'Agencies',
    },
    businessProfile: {
      phone: '555-222-3333',
      email: 'ops@example.com',
      address: {
        street: '1 Main',
        city: 'Austin',
        state: 'TX',
        zip: '78701',
        country: 'US',
      },
      socialProfiles: ['https://linkedin.com/company/example', '', 'https://x.com/example'],
      openingHours: 'Mon-Fri 9-5',
      foundedDate: '2018-01-01',
      numberOfEmployees: 18,
    },
  });
});

describe('assembleSeoContext', () => {
  it('prefers live pageMap over stored pageMap and aggregates serp features from live rows', async () => {
    mocks.listPageKeywords.mockReturnValue([
      {
        pagePath: '/live',
        pageTitle: 'Live',
        primaryKeyword: 'live keyword',
        secondaryKeywords: ['secondary'],
        serpFeatures: ['featured_snippet', 'people_also_ask', 'video', 'ai_overview'],
      },
      {
        pagePath: '/live-2',
        pageTitle: 'Live 2',
        primaryKeyword: 'second live keyword',
        secondaryKeywords: [],
        serpFeatures: ['video', 'local_pack'],
      },
    ]);

    const result = await assembleSeoContext('ws-seo');

    expect(result.strategy?.pageMap.map((entry) => entry.pagePath)).toEqual(['/live', '/live-2']);
    expect(result.serpFeatures).toEqual({
      featuredSnippets: 1,
      peopleAlsoAsk: 1,
      localPack: true,
      videoCarousel: 2,
      aiOverview: 1,
    });
  });

  it('falls back to stored pageMap when live page keywords are unavailable', async () => {
    mocks.listPageKeywords.mockImplementation(() => {
      throw new Error('table missing');
    });

    const result = await assembleSeoContext('ws-seo');

    expect(result.strategy?.pageMap.map((entry) => entry.pagePath)).toEqual(['/stored']);
    expect(result.serpFeatures).toBeUndefined();
  });

  it('uses live content gaps and ignores legacy stored content gaps', async () => {
    mocks.listContentGaps.mockReturnValue([
      {
        topic: 'new gap',
        targetKeyword: 'new gap keyword',
        intent: 'commercial',
        priority: 'medium',
        rationale: 'from normalized table',
      },
    ]);

    const result = await assembleSeoContext('ws-seo');

    expect(result.strategy?.contentGaps).toEqual([
      {
        topic: 'new gap',
        targetKeyword: 'new gap keyword',
        intent: 'commercial',
        priority: 'medium',
        rationale: 'from normalized table',
      },
    ]);
  });

  it('deduplicates goals case-insensitively and normalizes social profiles via helper', async () => {
    const result = await assembleSeoContext('ws-seo');

    expect(result.businessProfile).toBeDefined();
    expect(result.businessProfile?.goals).toEqual(['Increase demos', 'Expand into Chicago']);
    expect(result.businessProfile?.socialProfiles).toEqual([
      'https://linkedin.com/company/example',
      'https://x.com/example',
    ]);
    expect(mocks.normalizeSocialProfiles).toHaveBeenCalledWith([
      'https://linkedin.com/company/example',
      '',
      'https://x.com/example',
    ]);
  });

  it('hydrates pageKeywords only when pagePath is provided and matched', async () => {
    mocks.findPageMapEntry.mockReturnValue({
      pagePath: '/stored',
      pageTitle: 'Stored',
      primaryKeyword: 'stored keyword',
      secondaryKeywords: ['stored-secondary'],
    });

    const result = await assembleSeoContext('ws-seo', { pagePath: '/stored' });

    expect(result.pageKeywords).toEqual({
      pagePath: '/stored',
      pageTitle: 'Stored',
      primaryKeyword: 'stored keyword',
      secondaryKeywords: ['stored-secondary'],
    });
  });
});
