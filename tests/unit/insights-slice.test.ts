import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getInsights: vi.fn(),
}));

vi.mock('../../server/analytics-insights-store.js', () => ({
  getInsights: mocks.getInsights,
}));

const { assembleInsights, listAllInsightsFromSlice } = await import('../../server/intelligence/insights-slice.js');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getInsights.mockReturnValue([]);
});

describe('insights-slice module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/intelligence/insights-slice.js');
    expect(mod).toBeDefined();
  });
});

describe('assembleInsights', () => {
  it('caps all at 100 but keeps page-specific insights from the full data set', async () => {
    const highImpact = Array.from({ length: 101 }, (_, index) => ({
      id: `high-${index}`,
      workspaceId: 'ws-insights',
      insightType: 'ranking_opportunity',
      severity: 'opportunity',
      impactScore: 1000 - index,
      pageId: `/other-${index}`,
      data: {},
      createdAt: '2026-05-26T00:00:00.000Z',
    }));
    const lowImpactMatch = {
      id: 'low-page-match',
      workspaceId: 'ws-insights',
      insightType: 'content_decay',
      severity: 'warning',
      impactScore: 1,
      pageId: null,
      data: { pageUrl: '/target-page' },
      createdAt: '2026-05-26T00:00:00.000Z',
    };
    mocks.getInsights.mockReturnValue([...highImpact, lowImpactMatch]);

    const result = await assembleInsights('ws-insights', { pagePath: '/target-page' });

    expect(result.all).toHaveLength(100);
    expect(result.all.some(insight => insight.id === 'low-page-match')).toBe(false);
    expect(result.forPage?.map(insight => insight.id)).toContain('low-page-match');
    expect(result.bySeverity.warning).toBe(1);
  });

  it('reconstructs full insight coverage from uncapped byType rollups', async () => {
    const highImpact = Array.from({ length: 100 }, (_, index) => ({
      id: `high-${index}`,
      workspaceId: 'ws-insights',
      insightType: 'ranking_opportunity',
      severity: 'opportunity',
      impactScore: 1000 - index,
      pageId: `/other-${index}`,
      data: {},
      createdAt: '2026-05-26T00:00:00.000Z',
    }));
    const beyondCap = {
      id: 'beyond-cap-cannibalization',
      workspaceId: 'ws-insights',
      insightType: 'cannibalization',
      severity: 'warning',
      impactScore: 1,
      pageId: null,
      data: { query: 'seo services', pages: ['/a', '/b'], positions: [8, 12] },
      createdAt: '2026-05-26T00:00:00.000Z',
    };
    mocks.getInsights.mockReturnValue([...highImpact, beyondCap]);

    const result = await assembleInsights('ws-insights');
    const full = listAllInsightsFromSlice(result);

    expect(result.all).toHaveLength(100);
    expect(result.all.some(insight => insight.id === beyondCap.id)).toBe(false);
    expect(full.map(insight => insight.id)).toContain(beyondCap.id);
    expect(full.at(-1)?.id).toBe(beyondCap.id);
  });

  it('matches page-scoped anomaly insights by affectedPage', async () => {
    mocks.getInsights.mockReturnValue([
      {
        id: 'anomaly-target',
        insightType: 'anomaly_digest',
        severity: 'warning',
        impactScore: 5,
        pageId: 'synthetic-dedupe-key',
        data: { affectedPage: '/target-page' },
      },
      {
        id: 'anomaly-other',
        insightType: 'anomaly_digest',
        severity: 'warning',
        impactScore: 10,
        pageId: 'other-synthetic-key',
        data: { affectedPage: '/other-page' },
      },
    ]);

    const result = await assembleInsights('ws-insights', { pagePath: '/target-page' });

    expect(result.forPage?.map(insight => insight.id)).toEqual(['anomaly-target']);
  });
});
