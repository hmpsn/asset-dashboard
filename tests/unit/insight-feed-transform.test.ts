/**
 * Unit tests for transformToFeedInsight and computeSummaryCounts
 * in src/hooks/admin/useInsightFeed.ts
 */
import { describe, it, expect } from 'vitest';
import {
  transformToFeedInsight,
  computeSummaryCounts,
} from '../../src/hooks/admin/useInsightFeed.js';
import { INSIGHT_FILTER_KEYS, type AnalyticsInsight } from '../../shared/types/analytics.js';
import type { FeedInsight } from '../../shared/types/insights.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeInsight(overrides: Partial<AnalyticsInsight>): AnalyticsInsight {
  return {
    id: 'test-id',
    workspaceId: 'ws-1',
    pageId: 'https://example.com/blog/seo-tips',
    insightType: 'ranking_mover',
    data: {},
    severity: 'warning',
    computedAt: '2026-01-01T00:00:00Z',
    impactScore: 50,
    domain: 'search',
    ...overrides,
  };
}

// ── transformToFeedInsight ────────────────────────────────────────────────────

describe('transformToFeedInsight', () => {
  describe('ranking_mover', () => {
    it('uses pageTitle as title when present', () => {
      const insight = makeInsight({
        insightType: 'ranking_mover',
        pageTitle: 'The Real Page Title',
        data: { previousPosition: 4, currentPosition: 11 },
      });
      const result = transformToFeedInsight(insight);
      expect(result.title).toBe('The Real Page Title');
    });

    it('falls back to cleaned slug from URL when pageTitle is null', () => {
      const insight = makeInsight({
        insightType: 'ranking_mover',
        pageTitle: null,
        pageId: 'https://example.com/blog/seo-tips',
        data: { previousPosition: 4, currentPosition: 11 },
      });
      const result = transformToFeedInsight(insight);
      expect(result.title).toBe('Seo Tips');
    });

    it('produces headline containing "dropped to page 2" when position > 10', () => {
      const insight = makeInsight({
        insightType: 'ranking_mover',
        data: { previousPosition: 9, currentPosition: 12 },
      });
      const result = transformToFeedInsight(insight);
      expect(result.headline).toContain('dropped to page 2');
    });

    it('produces headline containing "climbed to position X" when position improved', () => {
      const insight = makeInsight({
        insightType: 'ranking_mover',
        data: { previousPosition: 8, currentPosition: 3 },
      });
      const result = transformToFeedInsight(insight);
      expect(result.headline).toContain('climbed to position 3');
    });

    it('produces headline containing "dropped to position X" when position worsened (still on page 1)', () => {
      const insight = makeInsight({
        insightType: 'ranking_mover',
        data: { previousPosition: 3, currentPosition: 7 },
      });
      const result = transformToFeedInsight(insight);
      expect(result.headline).toContain('dropped to position 7');
    });

    it('context contains "Position X → Y"', () => {
      const insight = makeInsight({
        insightType: 'ranking_mover',
        data: { previousPosition: 4, currentPosition: 11 },
      });
      const result = transformToFeedInsight(insight);
      expect(result.context).toContain('Position 4 → 11');
    });

    it('sets domain to search', () => {
      const insight = makeInsight({
        insightType: 'ranking_mover',
        domain: 'search',
        data: { previousPosition: 4, currentPosition: 11 },
      });
      const result = transformToFeedInsight(insight);
      expect(result.domain).toBe('search');
    });
  });

  describe('ctr_opportunity', () => {
    it('headline shows actual vs expected CTR', () => {
      const insight = makeInsight({
        insightType: 'ctr_opportunity',
        severity: 'opportunity',
        data: { actualCtr: 1.2, expectedCtr: 4.8, impressions: 5000 },
      });
      const result = transformToFeedInsight(insight);
      expect(result.headline).toContain('CTR 1.2% vs 4.8% expected');
    });
  });

  describe('ranking_opportunity', () => {
    it('headline shows positions from page 1', () => {
      const insight = makeInsight({
        insightType: 'ranking_opportunity',
        severity: 'opportunity',
        data: { currentPosition: 14.3, estimatedTrafficGain: 230 },
      });
      const result = transformToFeedInsight(insight);
      // Math.ceil(14.3) - 10 = 5
      expect(result.headline).toContain('5 positions from page 1');
    });
  });

  describe('content_decay', () => {
    it('headline shows lost % traffic', () => {
      const insight = makeInsight({
        insightType: 'content_decay',
        severity: 'warning',
        data: { deltaPercent: -42, baselineClicks: 1000, currentClicks: 580 },
      });
      const result = transformToFeedInsight(insight);
      expect(result.headline).toContain('lost 42% traffic');
    });
  });

  describe('page_health', () => {
    it('headline shows health score', () => {
      const insight = makeInsight({
        insightType: 'page_health',
        data: { score: 67, trend: 'declining' },
      });
      const result = transformToFeedInsight(insight);
      expect(result.headline).toBe('health score 67');
    });
  });

  describe('serp_opportunity', () => {
    it('headline says eligible for rich results', () => {
      const insight = makeInsight({
        insightType: 'serp_opportunity',
        severity: 'opportunity',
        data: { schemaType: 'FAQ' },
      });
      const result = transformToFeedInsight(insight);
      expect(result.headline).toBe('eligible for rich results');
      expect(result.context).toContain('FAQ');
    });
  });

  describe('cannibalization', () => {
    it('headline shows page count competing', () => {
      const insight = makeInsight({
        insightType: 'cannibalization',
        severity: 'warning',
        data: {
          query: 'seo tips',
          pages: ['https://example.com/a', 'https://example.com/b', 'https://example.com/c'],
        },
      });
      const result = transformToFeedInsight(insight);
      expect(result.headline).toContain('3 pages competing for same query');
    });
  });

  describe('conversion_attribution', () => {
    it('headline shows conversions count', () => {
      const insight = makeInsight({
        insightType: 'conversion_attribution',
        severity: 'positive',
        data: { conversions: 142, conversionRate: 0.085 },
      });
      const result = transformToFeedInsight(insight);
      expect(result.headline).toContain('drove 142 conversions');
    });
  });

  describe('strategy keyword and pipeline enrichment', () => {
    it('appends strategy keyword match to context', () => {
      const insight = makeInsight({
        insightType: 'ranking_mover',
        data: { previousPosition: 5, currentPosition: 8 },
        strategyKeyword: 'seo agency',
      });
      const result = transformToFeedInsight(insight);
      expect(result.context).toContain('Strategy keyword match');
    });

    it('appends pipeline status to context', () => {
      const insight = makeInsight({
        insightType: 'ranking_mover',
        data: { previousPosition: 5, currentPosition: 8 },
        pipelineStatus: 'brief_exists',
      });
      const result = transformToFeedInsight(insight);
      expect(result.context).toContain('Brief exists');
    });
  });

  describe('impactScore and id pass-through', () => {
    it('preserves id and impactScore', () => {
      const insight = makeInsight({
        id: 'abc-123',
        impactScore: 87,
        insightType: 'page_health',
        data: { score: 55 },
      });
      const result = transformToFeedInsight(insight);
      expect(result.id).toBe('abc-123');
      expect(result.impactScore).toBe(87);
    });

    it('defaults impactScore to 0 when undefined', () => {
      const insight = makeInsight({ insightType: 'page_health', data: { score: 40 } });
      delete (insight as Partial<AnalyticsInsight>).impactScore;
      const result = transformToFeedInsight(insight);
      expect(result.impactScore).toBe(0);
    });
  });
});

// ── computeSummaryCounts ──────────────────────────────────────────────────────

describe('computeSummaryCounts', () => {
  function makeFeedInsight(overrides: Partial<FeedInsight>): FeedInsight {
    return {
      id: 'f-1',
      type: 'ranking_mover',
      severity: 'warning',
      title: 'Test Page',
      headline: 'test',
      context: '',
      domain: 'search',
      impactScore: 50,
      ...overrides,
    };
  }

  it('counts critical + warning as drops', () => {
    const feed: FeedInsight[] = [
      makeFeedInsight({ severity: 'critical' }),
      makeFeedInsight({ severity: 'warning' }),
      makeFeedInsight({ severity: 'positive' }),
    ];
    const summary = computeSummaryCounts(feed);
    const drops = summary.find(s => s.filterKey === INSIGHT_FILTER_KEYS.DROPS);
    expect(drops).toBeDefined();
    expect(drops!.count).toBe(2);
    expect(drops!.color).toBe('red');
  });

  it('counts opportunity severity as opportunities', () => {
    const feed: FeedInsight[] = [
      makeFeedInsight({ severity: 'opportunity' }),
      makeFeedInsight({ severity: 'opportunity' }),
    ];
    const summary = computeSummaryCounts(feed);
    const opps = summary.find(s => s.filterKey === INSIGHT_FILTER_KEYS.OPPORTUNITIES);
    expect(opps).toBeDefined();
    expect(opps!.count).toBe(2);
    expect(opps!.color).toBe('amber');
  });

  it('counts positive severity as wins', () => {
    const feed: FeedInsight[] = [
      makeFeedInsight({ severity: 'positive', type: 'ranking_mover' }),
    ];
    const summary = computeSummaryCounts(feed);
    const wins = summary.find(s => s.filterKey === INSIGHT_FILTER_KEYS.WINS);
    expect(wins).toBeDefined();
    expect(wins!.count).toBe(1);
    expect(wins!.color).toBe('green');
  });

  it('counts serp_opportunity type as schema gaps (blue)', () => {
    const feed: FeedInsight[] = [
      makeFeedInsight({ type: 'serp_opportunity', severity: 'opportunity' }),
      makeFeedInsight({ type: 'serp_opportunity', severity: 'opportunity' }),
    ];
    const summary = computeSummaryCounts(feed);
    const gaps = summary.find(s => s.filterKey === INSIGHT_FILTER_KEYS.SCHEMA);
    expect(gaps).toBeDefined();
    expect(gaps!.count).toBe(2);
    expect(gaps!.color).toBe('blue');
  });

  it('counts content_decay type as decaying pages (purple)', () => {
    const feed: FeedInsight[] = [
      makeFeedInsight({ type: 'content_decay', severity: 'warning' }),
    ];
    const summary = computeSummaryCounts(feed);
    const decaying = summary.find(s => s.filterKey === INSIGHT_FILTER_KEYS.DECAY);
    expect(decaying).toBeDefined();
    expect(decaying!.count).toBe(1);
    expect(decaying!.color).toBe('purple');
  });

  it('omits zero-count buckets', () => {
    const feed: FeedInsight[] = [
      makeFeedInsight({ severity: 'positive' }),
    ];
    const summary = computeSummaryCounts(feed);
    const keys = summary.map(s => s.filterKey);
    expect(keys).not.toContain('drops');
    expect(keys).not.toContain('opportunities');
    expect(keys).toContain('wins');
  });

  it('returns empty array for empty feed', () => {
    expect(computeSummaryCounts([])).toEqual([]);
  });
});
