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

  it('listAllInsightsFromSlice returns the prompt-facing all list (top 100 by impact)', async () => {
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

    // G3: the helper reads `all` (the slice's intended prompt-facing bound) instead of
    // reconstructing the full set from byType, which is now capped at 25 per type.
    expect(result.all).toHaveLength(100);
    expect(full.map(insight => insight.id)).toEqual(result.all.map(insight => insight.id));
    // Pre-cap totals stay honest via countsByType even though the 101st insight is
    // outside the prompt-facing list.
    expect(result.countsByType.ranking_opportunity).toBe(100);
    expect(result.countsByType.cannibalization).toBe(1);
  });

  it('caps byType at 25 per type ordered by impactScore with full pre-cap countsByType', async () => {
    // Divergent fixture: highest-impact insight is NOT first by insertion order, so the
    // cap must select by impactScore, not by insertion.
    const lowFirst = Array.from({ length: 30 }, (_, index) => ({
      id: `low-${index}`,
      workspaceId: 'ws-insights',
      insightType: 'ranking_opportunity',
      severity: 'opportunity',
      impactScore: index + 1, // 1..30, ascending — insertion order inverse of impact order
      pageId: `/page-${index}`,
      data: {},
      createdAt: '2026-05-26T00:00:00.000Z',
    }));
    const apex = {
      id: 'apex-inserted-last',
      workspaceId: 'ws-insights',
      insightType: 'ranking_opportunity',
      severity: 'opportunity',
      impactScore: 999,
      pageId: '/apex',
      data: {},
      createdAt: '2026-05-26T00:00:00.000Z',
    };
    const otherType = Array.from({ length: 3 }, (_, index) => ({
      id: `decay-${index}`,
      workspaceId: 'ws-insights',
      insightType: 'content_decay',
      severity: 'warning',
      impactScore: 50 - index,
      pageId: `/decay-${index}`,
      data: {},
      createdAt: '2026-05-26T00:00:00.000Z',
    }));
    mocks.getInsights.mockReturnValue([...lowFirst, apex, ...otherType]);

    const result = await assembleInsights('ws-insights');

    const ranking = result.byType.ranking_opportunity ?? [];
    expect(ranking).toHaveLength(25);
    expect(ranking[0]?.id).toBe('apex-inserted-last');
    const scores = ranking.map(insight => insight.impactScore ?? 0);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    // The lowest-impact insights fall out of the capped list...
    expect(ranking.some(insight => insight.id === 'low-0')).toBe(false);
    // ...but the pre-cap totals are preserved.
    expect(result.countsByType.ranking_opportunity).toBe(31);
    expect(result.countsByType.content_decay).toBe(3);
    // The type×severity matrix is also pre-cap (joint-filtering consumers).
    expect(result.countsByTypeBySeverity.ranking_opportunity).toEqual({
      critical: 0, warning: 0, opportunity: 31, positive: 0,
    });
    expect(result.countsByTypeBySeverity.content_decay).toEqual({
      critical: 0, warning: 3, opportunity: 0, positive: 0,
    });
    // Types under the cap are unaffected.
    expect(result.byType.content_decay).toHaveLength(3);
    // `all` is unaffected by the per-type cap (34 insights, under its own 100 cap).
    expect(result.all).toHaveLength(34);
    expect(result.bySeverity.opportunity).toBe(31);
    expect(result.bySeverity.warning).toBe(3);
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
