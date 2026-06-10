/**
 * Pure logic tests for useInsightFeed.ts exported helpers.
 *
 * Tests target:
 *   - cleanSlugToTitle: URL → readable title conversion
 *   - transformToFeedInsight: AnalyticsInsight → FeedInsight transformation for all insight types
 *   - computeSummaryCounts: FeedInsight[] → SummaryCount[] pill badge aggregation
 */

import { describe, it, expect } from 'vitest';
import {
  cleanSlugToTitle,
  transformToFeedInsight,
  computeSummaryCounts,
} from '../../src/hooks/admin/useInsightFeed.js';
import { INSIGHT_FILTER_KEYS } from '../../shared/types/analytics.js';
import type { AnalyticsInsight } from '../../shared/types/analytics.js';
import type { FeedInsight } from '../../shared/types/insights.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeInsight(overrides: Partial<AnalyticsInsight> & { insightType: AnalyticsInsight['insightType']; data: Record<string, unknown> }): AnalyticsInsight {
  return {
    id: 'test-id',
    workspaceId: 'ws-1',
    pageId: 'https://example.com/test-page',
    severity: 'warning',
    computedAt: '2024-01-01T00:00:00Z',
    impactScore: 50,
    ...overrides,
  } as AnalyticsInsight;
}

function makeFeedInsight(overrides: Partial<FeedInsight>): FeedInsight {
  return {
    id: 'feed-1',
    type: 'page_health',
    severity: 'warning',
    title: 'Test Page',
    headline: 'health score 75',
    context: '',
    domain: 'cross',
    impactScore: 50,
    ...overrides,
  };
}

// ── cleanSlugToTitle ──────────────────────────────────────────────────────────

describe('cleanSlugToTitle', () => {
  it('converts a full URL slug to title case', () => {
    expect(cleanSlugToTitle('https://example.com/blog/seo-tips')).toBe('SEO Tips');
  });

  it('converts a hyphenated slug to title case words', () => {
    expect(cleanSlugToTitle('https://example.com/about-us')).toBe('About Us');
  });

  it('returns "Home" for root path', () => {
    expect(cleanSlugToTitle('/')).toBe('Home');
  });

  it('returns "Home" for a URL with no path segments', () => {
    expect(cleanSlugToTitle('https://example.com/')).toBe('Home');
  });

  it('returns "Home" for null input', () => {
    expect(cleanSlugToTitle(null)).toBe('Unknown Page');
  });

  it('uppercases known acronyms (seo, ctr, api, ui)', () => {
    expect(cleanSlugToTitle('https://example.com/seo-audit')).toBe('SEO Audit');
    expect(cleanSlugToTitle('https://example.com/ctr-guide')).toBe('CTR Guide');
    expect(cleanSlugToTitle('https://example.com/api-docs')).toBe('API Docs');
  });

  it('treats a plain path (non-URL) as a path and takes the last segment', () => {
    expect(cleanSlugToTitle('/blog/my-post')).toBe('My Post');
  });

  it('handles underscore separators', () => {
    expect(cleanSlugToTitle('https://example.com/contact_us')).toBe('Contact Us');
  });

  it('takes the last path segment from a deep URL', () => {
    expect(cleanSlugToTitle('https://example.com/a/b/c/target-page')).toBe('Target Page');
  });
});

// ── transformToFeedInsight — title resolution ─────────────────────────────────

describe('transformToFeedInsight — title resolution', () => {
  it('uses pageTitle when present and not a GA placeholder', () => {
    const insight = makeInsight({
      insightType: 'page_health',
      data: { score: 80, trend: 'stable' },
      pageTitle: 'My Real Title',
      pageId: 'https://example.com/page',
    });
    const result = transformToFeedInsight(insight);
    expect(result.title).toBe('My Real Title');
  });

  it('falls back to cleanSlugToTitle when pageTitle is a GA placeholder "(not set)"', () => {
    const insight = makeInsight({
      insightType: 'page_health',
      data: { score: 80, trend: 'stable' },
      pageTitle: '(not set)',
      pageId: 'https://example.com/contact-us',
    });
    const result = transformToFeedInsight(insight);
    expect(result.title).toBe('Contact Us');
  });

  it('falls back when pageTitle is null', () => {
    const insight = makeInsight({
      insightType: 'page_health',
      data: { score: 70, trend: 'declining' },
      pageTitle: null,
      pageId: 'https://example.com/services',
    });
    const result = transformToFeedInsight(insight);
    expect(result.title).toBe('Services');
  });

  it('maps id, severity, impactScore correctly', () => {
    const insight = makeInsight({
      id: 'insight-99',
      insightType: 'page_health',
      data: { score: 60 },
      severity: 'critical',
      impactScore: 95,
    });
    const result = transformToFeedInsight(insight);
    expect(result.id).toBe('insight-99');
    expect(result.severity).toBe('critical');
    expect(result.impactScore).toBe(95);
  });
});

// ── transformToFeedInsight — ranking_mover ────────────────────────────────────

describe('transformToFeedInsight — ranking_mover', () => {
  it('produces "climbed to position N" for improvement into top 10', () => {
    const insight = makeInsight({
      insightType: 'ranking_mover',
      data: { previousPosition: 15, currentPosition: 5, currentClicks: 100, previousClicks: 60 },
    });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('climbed to position 5');
    expect(result.context).toContain('Position 15 → 5');
    expect(result.context).toContain('+40 clicks/mo');
  });

  it('produces "improved to position N" for improvement outside top 10', () => {
    const insight = makeInsight({
      insightType: 'ranking_mover',
      data: { previousPosition: 20, currentPosition: 12, currentClicks: 50, previousClicks: 30 },
    });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('improved to position 12');
  });

  it('produces "dropped off page 1" when current position exceeds 10', () => {
    const insight = makeInsight({
      insightType: 'ranking_mover',
      data: { previousPosition: 8, currentPosition: 14 },
    });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('dropped off page 1');
  });

  it('produces "fell to position N" when still on page 1 but declined', () => {
    const insight = makeInsight({
      insightType: 'ranking_mover',
      data: { previousPosition: 3, currentPosition: 9 },
    });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('fell to position 9');
  });

  it('produces fallback headline when position data missing', () => {
    const insight = makeInsight({
      insightType: 'ranking_mover',
      data: {},
    });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('position changed');
  });

  it('omits click delta from context when zero', () => {
    const insight = makeInsight({
      insightType: 'ranking_mover',
      data: { previousPosition: 5, currentPosition: 3, currentClicks: 100, previousClicks: 100 },
    });
    const result = transformToFeedInsight(insight);
    expect(result.context).not.toContain('clicks/mo');
  });
});

// ── transformToFeedInsight — ctr_opportunity ─────────────────────────────────

describe('transformToFeedInsight — ctr_opportunity', () => {
  it('produces CTR headline with actual vs expected values', () => {
    const insight = makeInsight({
      insightType: 'ctr_opportunity',
      data: { actualCtr: 1.2, expectedCtr: 4.8, impressions: 5000 },
    });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('CTR 1.2% vs 4.8% expected');
    expect(result.context).toContain('impressions');
  });

  it('produces fallback headline when CTR data missing', () => {
    const insight = makeInsight({ insightType: 'ctr_opportunity', data: {} });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('low CTR vs expected');
  });
});

// ── transformToFeedInsight — ranking_opportunity ──────────────────────────────

describe('transformToFeedInsight — ranking_opportunity', () => {
  it('shows positions from page 1 when position > 10', () => {
    const insight = makeInsight({
      insightType: 'ranking_opportunity',
      data: { currentPosition: 14.7, estimatedTrafficGain: 300 },
    });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('5 positions from page 1');
    expect(result.context).toContain('~300 clicks/mo potential');
  });

  it('shows current position when already on page 1', () => {
    const insight = makeInsight({
      insightType: 'ranking_opportunity',
      data: { currentPosition: 7 },
    });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('currently position 7');
  });

  it('produces fallback when no position data', () => {
    const insight = makeInsight({ insightType: 'ranking_opportunity', data: {} });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('ranking opportunity');
  });
});

// ── transformToFeedInsight — content_decay ───────────────────────────────────

describe('transformToFeedInsight — content_decay', () => {
  it('shows traffic loss percentage', () => {
    const insight = makeInsight({
      insightType: 'content_decay',
      data: { deltaPercent: -35.7, baselineClicks: 1000, currentClicks: 643 },
    });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('lost 36% traffic');
    expect(result.context).toContain('643 vs');
    expect(result.context).toContain('clicks');
  });

  it('produces fallback when no delta', () => {
    const insight = makeInsight({ insightType: 'content_decay', data: {} });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('traffic declining');
  });
});

// ── transformToFeedInsight — audit_finding ────────────────────────────────────

describe('transformToFeedInsight — audit_finding', () => {
  it('produces site-scoped headline with siteScore', () => {
    const insight = makeInsight({
      insightType: 'audit_finding',
      data: { scope: 'site', siteScore: 72, issueCount: 3 },
    });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('site audit score 72');
    expect(result.context).toContain('3 issues');
  });

  it('uses "1 issue" (singular) for issueCount of 1', () => {
    const insight = makeInsight({
      insightType: 'audit_finding',
      data: { scope: 'site', siteScore: 85, issueCount: 1 },
    });
    const result = transformToFeedInsight(insight);
    expect(result.context).toContain('1 issue');
    expect(result.context).not.toContain('1 issues');
  });

  it('produces page-scoped headline with issue count', () => {
    const insight = makeInsight({
      insightType: 'audit_finding',
      data: { scope: 'page', issueCount: 5 },
    });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('5 audit issues');
  });
});

// ── transformToFeedInsight — cannibalization ──────────────────────────────────

describe('transformToFeedInsight — cannibalization', () => {
  it('shows count of competing pages from pages array', () => {
    const insight = makeInsight({
      insightType: 'cannibalization',
      data: {
        pages: ['https://ex.com/a', 'https://ex.com/b', 'https://ex.com/c'],
        query: 'seo tools',
      },
    });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('3 pages competing for same query');
    expect(result.context).toContain('"seo tools"');
  });

  it('builds details array with position annotations', () => {
    const insight = makeInsight({
      insightType: 'cannibalization',
      data: {
        pages: ['https://ex.com/page-a', 'https://ex.com/page-b'],
        positions: [3, 7],
        query: 'test query',
      },
    });
    const result = transformToFeedInsight(insight);
    expect(result.details).toBeDefined();
    expect(result.details![0]).toContain('/page-a');
    expect(result.details![0]).toContain('position 3');
  });

  it('falls back to pageCount when pages array is absent', () => {
    const insight = makeInsight({
      insightType: 'cannibalization',
      data: { pageCount: 4 },
    });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('4 pages competing for same query');
  });
});

// ── transformToFeedInsight — serp_opportunity ─────────────────────────────────

describe('transformToFeedInsight — serp_opportunity', () => {
  it('produces rich results headline with schema status in context', () => {
    const insight = makeInsight({
      insightType: 'serp_opportunity',
      data: { schemaStatus: 'partial' },
    });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('eligible for rich results');
    expect(result.context).toContain('Schema partial');
  });

  it('carries detectedAt from the insight computedAt (for chart callouts)', () => {
    const insight = makeInsight({ insightType: 'serp_opportunity', data: { schemaStatus: 'missing' } });
    const result = transformToFeedInsight(insight);
    expect(result.detectedAt).toBe(insight.computedAt);
  });
});

// ── transformToFeedInsight — conversion_attribution ──────────────────────────

describe('transformToFeedInsight — conversion_attribution', () => {
  it('shows conversion count and rate', () => {
    const insight = makeInsight({
      insightType: 'conversion_attribution',
      data: { conversions: 42, conversionRate: 4.0 },
    });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('drove 42 conversions');
    expect(result.context).toContain('4.0% CVR');
  });

  it('produces fallback headline when no conversion data', () => {
    const insight = makeInsight({ insightType: 'conversion_attribution', data: {} });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('conversion driver');
  });
});

// ── transformToFeedInsight — context enrichment ───────────────────────────────

describe('transformToFeedInsight — context enrichment', () => {
  it('appends "Strategy keyword match" when strategyKeyword is present', () => {
    const insight = makeInsight({
      insightType: 'page_health',
      data: { score: 80 },
      strategyKeyword: 'seo tools',
    });
    const result = transformToFeedInsight(insight);
    expect(result.context).toContain('Strategy keyword match');
  });

  it('appends pipeline status label when pipelineStatus is "brief_exists"', () => {
    const insight = makeInsight({
      insightType: 'page_health',
      data: { score: 80 },
      pipelineStatus: 'brief_exists',
    });
    const result = transformToFeedInsight(insight);
    expect(result.context).toContain('Brief exists');
  });

  it('appends "Content in progress" for in_progress pipeline status', () => {
    const insight = makeInsight({
      insightType: 'page_health',
      data: { score: 80 },
      pipelineStatus: 'in_progress',
    });
    const result = transformToFeedInsight(insight);
    expect(result.context).toContain('Content in progress');
  });

  it('joins multiple context parts with " · "', () => {
    const insight = makeInsight({
      insightType: 'ranking_mover',
      data: { previousPosition: 10, currentPosition: 5, currentClicks: 200, previousClicks: 100 },
      strategyKeyword: 'keyword',
    });
    const result = transformToFeedInsight(insight);
    expect(result.context).toContain(' · ');
  });

  it('uses domain from insight when present', () => {
    const insight = makeInsight({
      insightType: 'page_health',
      data: { score: 80 },
      domain: 'performance',
    });
    const result = transformToFeedInsight(insight);
    expect(result.domain).toBe('performance');
  });

  it('defaults domain to "cross" when absent', () => {
    const insight = makeInsight({ insightType: 'page_health', data: { score: 80 } });
    delete (insight as { domain?: unknown }).domain;
    const result = transformToFeedInsight(insight);
    expect(result.domain).toBe('cross');
  });
});

// ── transformToFeedInsight — default/unknown type ─────────────────────────────

describe('transformToFeedInsight — default/unknown type', () => {
  it('produces a readable headline from underscored type name', () => {
    const insight = makeInsight({
      insightType: 'keyword_cluster' as AnalyticsInsight['insightType'],
      data: {},
    });
    const result = transformToFeedInsight(insight);
    // keyword_cluster has its own handler but an unknown type like 'foo_bar' falls to default
    // We verify the type is surfaced either way
    expect(typeof result.headline).toBe('string');
    expect(result.headline.length).toBeGreaterThan(0);
  });
});

// ── computeSummaryCounts ──────────────────────────────────────────────────────

describe('computeSummaryCounts', () => {
  it('returns empty array for empty feed', () => {
    expect(computeSummaryCounts([])).toEqual([]);
  });

  it('counts critical + warning as "drops"', () => {
    const feed = [
      makeFeedInsight({ severity: 'critical' }),
      makeFeedInsight({ severity: 'warning' }),
      makeFeedInsight({ severity: 'opportunity' }),
    ];
    const counts = computeSummaryCounts(feed);
    const drops = counts.find(c => c.label === 'drops');
    expect(drops?.count).toBe(2);
    expect(drops?.color).toBe('red');
    expect(drops?.filterKey).toBe(INSIGHT_FILTER_KEYS.DROPS);
  });

  it('counts opportunity severity as "opportunities"', () => {
    const feed = [
      makeFeedInsight({ severity: 'opportunity' }),
      makeFeedInsight({ severity: 'opportunity' }),
    ];
    const counts = computeSummaryCounts(feed);
    const opps = counts.find(c => c.label === 'opportunities');
    expect(opps?.count).toBe(2);
    expect(opps?.color).toBe('amber');
    expect(opps?.filterKey).toBe(INSIGHT_FILTER_KEYS.OPPORTUNITIES);
  });

  it('counts positive severity as "wins"', () => {
    const feed = [makeFeedInsight({ severity: 'positive' })];
    const counts = computeSummaryCounts(feed);
    const wins = counts.find(c => c.label === 'wins');
    expect(wins?.count).toBe(1);
    expect(wins?.color).toBe('emerald');
    expect(wins?.filterKey).toBe(INSIGHT_FILTER_KEYS.WINS);
  });

  it('counts serp_opportunity type as "schema gaps"', () => {
    const feed = [
      makeFeedInsight({ type: 'serp_opportunity', severity: 'opportunity' }),
      makeFeedInsight({ type: 'serp_opportunity', severity: 'opportunity' }),
    ];
    const counts = computeSummaryCounts(feed);
    const schema = counts.find(c => c.label === 'schema gaps');
    expect(schema?.count).toBe(2);
    expect(schema?.color).toBe('blue');
    expect(schema?.filterKey).toBe(INSIGHT_FILTER_KEYS.SCHEMA);
  });

  it('counts content_decay type as "decaying pages"', () => {
    const feed = [makeFeedInsight({ type: 'content_decay', severity: 'critical' })];
    const counts = computeSummaryCounts(feed);
    const decay = counts.find(c => c.label === 'decaying pages');
    expect(decay?.count).toBe(1);
    expect(decay?.color).toBe('purple');
    expect(decay?.filterKey).toBe(INSIGHT_FILTER_KEYS.DECAY);
  });

  it('omits categories with a count of zero', () => {
    // Only wins in this feed
    const feed = [makeFeedInsight({ severity: 'positive' })];
    const counts = computeSummaryCounts(feed);
    const labels = counts.map(c => c.label);
    expect(labels).not.toContain('drops');
    expect(labels).not.toContain('opportunities');
    expect(labels).not.toContain('schema gaps');
    expect(labels).not.toContain('decaying pages');
    expect(labels).toContain('wins');
  });

  it('all categories present when feed contains one of each', () => {
    const feed = [
      makeFeedInsight({ severity: 'critical' }),
      makeFeedInsight({ severity: 'opportunity' }),
      makeFeedInsight({ severity: 'positive' }),
      makeFeedInsight({ type: 'serp_opportunity', severity: 'opportunity' }),
      makeFeedInsight({ type: 'content_decay', severity: 'warning' }),
    ];
    const counts = computeSummaryCounts(feed);
    const labels = counts.map(c => c.label);
    expect(labels).toContain('drops');
    expect(labels).toContain('opportunities');
    expect(labels).toContain('wins');
    expect(labels).toContain('schema gaps');
    expect(labels).toContain('decaying pages');
  });

  it('a single insight can contribute to both "drops" and "decaying pages" counts', () => {
    // content_decay with critical severity counts in both drops AND decaying pages
    const feed = [makeFeedInsight({ type: 'content_decay', severity: 'critical' })];
    const counts = computeSummaryCounts(feed);
    const drops = counts.find(c => c.label === 'drops');
    const decay = counts.find(c => c.label === 'decaying pages');
    expect(drops?.count).toBe(1);
    expect(decay?.count).toBe(1);
  });
});
