/**
 * Unit tests for Phase 3 — Advanced Intelligence computation functions.
 *
 * 3C: Conversion attribution (GA4 landing pages → per-page conversions)
 * 3B: Competitor gap analysis (pure function that scores/filters gaps)
 * 3A: Keyword clustering (string similarity + co-occurrence grouping)
 */
import { describe, it, expect } from 'vitest';
import {
  computeConversionAttributionInsights,
  computeCompetitorGapInsights,
  computeKeywordClusterInsights,
} from '../../server/analytics-intelligence.js';

// ── 3C: Conversion Attribution ──────────────────────────────────

describe('computeConversionAttributionInsights', () => {
  const landingPages = [
    { landingPage: '/services', sessions: 200, users: 180, bounceRate: 40, avgEngagementTime: 90, conversions: 15 },
    { landingPage: '/blog/seo-tips', sessions: 500, users: 450, bounceRate: 55, avgEngagementTime: 60, conversions: 5 },
    { landingPage: '/contact', sessions: 50, users: 45, bounceRate: 30, avgEngagementTime: 120, conversions: 20 },
    { landingPage: '/about', sessions: 100, users: 90, bounceRate: 70, avgEngagementTime: 30, conversions: 0 },
    // Low-traffic page below threshold
    { landingPage: '/obscure', sessions: 3, users: 2, bounceRate: 100, avgEngagementTime: 5, conversions: 1 },
  ];

  it('returns an insight per landing page with sufficient sessions', () => {
    const results = computeConversionAttributionInsights(landingPages);
    // Should exclude /obscure (sessions < 10)
    expect(results.length).toBe(4);
  });

  it('calculates correct conversion rate', () => {
    const results = computeConversionAttributionInsights(landingPages);
    const contact = results.find(r => r.pageId === '/contact');
    expect(contact).toBeDefined();
    // 20/50 = 40%
    expect(contact!.data.conversionRate).toBeCloseTo(40, 0);
    expect(contact!.data.sessions).toBe(50);
    expect(contact!.data.conversions).toBe(20);
  });

  it('sorts by conversion rate descending', () => {
    const results = computeConversionAttributionInsights(landingPages);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].data.conversionRate).toBeGreaterThanOrEqual(results[i].data.conversionRate);
    }
  });

  it('assigns severity based on conversion rate', () => {
    const results = computeConversionAttributionInsights(landingPages);
    const contact = results.find(r => r.pageId === '/contact')!;
    // 40% → positive
    expect(contact.severity).toBe('positive');

    const about = results.find(r => r.pageId === '/about')!;
    // 0% → critical
    expect(about.severity).toBe('critical');
  });

  it('handles pages with zero conversions', () => {
    const results = computeConversionAttributionInsights(landingPages);
    const about = results.find(r => r.pageId === '/about');
    expect(about).toBeDefined();
    expect(about!.data.conversions).toBe(0);
    expect(about!.data.conversionRate).toBe(0);
  });

  it('returns empty array for empty input', () => {
    expect(computeConversionAttributionInsights([])).toHaveLength(0);
  });
});

// ── 3B: Competitor Gap Analysis ─────────────────────────────────

describe('computeCompetitorGapInsights', () => {
  const gapData = [
    { keyword: 'seo audit tool', competitorDomain: 'ahrefs.com', competitorPosition: 3, volume: 2000, difficulty: 45 },
    { keyword: 'backlink checker', competitorDomain: 'ahrefs.com', competitorPosition: 1, volume: 5000, difficulty: 70 },
    { keyword: 'local seo tips', competitorDomain: 'moz.com', competitorPosition: 5, volume: 800, difficulty: 30 },
    { keyword: 'meta tag generator', competitorDomain: 'moz.com', competitorPosition: 8, volume: 300, difficulty: 20 },
  ];

  // Our existing GSC data — we rank for some keywords
  const ourQueryData = [
    { query: 'local seo tips', page: 'https://example.com/blog/local-seo', clicks: 10, impressions: 200, ctr: 0.05, position: 15 },
  ];

  it('returns an insight per gap keyword', () => {
    const results = computeCompetitorGapInsights(gapData, ourQueryData);
    expect(results.length).toBe(4);
  });

  it('matches our existing position from GSC data', () => {
    const results = computeCompetitorGapInsights(gapData, ourQueryData);
    const localSeo = results.find(r => r.data.keyword === 'local seo tips');
    expect(localSeo).toBeDefined();
    expect(localSeo!.data.ourPosition).toBe(15);
  });

  it('sets ourPosition to null when we do not rank', () => {
    const results = computeCompetitorGapInsights(gapData, ourQueryData);
    const seoAudit = results.find(r => r.data.keyword === 'seo audit tool');
    expect(seoAudit).toBeDefined();
    expect(seoAudit!.data.ourPosition).toBeNull();
  });

  it('sorts by volume descending', () => {
    const results = computeCompetitorGapInsights(gapData, ourQueryData);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].data.volume).toBeGreaterThanOrEqual(results[i].data.volume);
    }
  });

  it('assigns severity based on volume and difficulty', () => {
    const results = computeCompetitorGapInsights(gapData, ourQueryData);
    // High volume but high difficulty (70) → opportunity (not easy to win)
    const backlink = results.find(r => r.data.keyword === 'backlink checker')!;
    expect(backlink.severity).toBe('opportunity');

    // High volume, low difficulty, we don't rank → critical
    const seoAudit = results.find(r => r.data.keyword === 'seo audit tool')!;
    expect(seoAudit.severity).toBe('critical');
  });

  it('returns empty array for empty input', () => {
    expect(computeCompetitorGapInsights([], [])).toHaveLength(0);
  });
});

// ── 3A: Keyword Clustering ──────────────────────────────────────

describe('computeKeywordClusterInsights', () => {
  const queryPageData = [
    // Cluster 1: SEO-related queries
    { query: 'seo tips', page: 'https://example.com/blog/seo', clicks: 100, impressions: 2000, ctr: 0.05, position: 5 },
    { query: 'seo tips for beginners', page: 'https://example.com/blog/seo', clicks: 50, impressions: 1000, ctr: 0.05, position: 8 },
    { query: 'seo tips 2024', page: 'https://example.com/blog/seo', clicks: 30, impressions: 800, ctr: 0.04, position: 10 },
    { query: 'best seo tips', page: 'https://example.com/blog/seo', clicks: 20, impressions: 500, ctr: 0.04, position: 12 },
    // Cluster 2: Web design queries
    { query: 'web design services', page: 'https://example.com/services/web', clicks: 80, impressions: 1500, ctr: 0.05, position: 4 },
    { query: 'web design agency', page: 'https://example.com/services/web', clicks: 60, impressions: 1200, ctr: 0.05, position: 6 },
    { query: 'web design pricing', page: 'https://example.com/services/web', clicks: 25, impressions: 600, ctr: 0.04, position: 9 },
    // Isolated query — should form own cluster or be grouped
    { query: 'contact us', page: 'https://example.com/contact', clicks: 200, impressions: 3000, ctr: 0.07, position: 2 },
  ];

  it('groups related queries into clusters', () => {
    const results = computeKeywordClusterInsights(queryPageData);
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.length).toBeLessThanOrEqual(8); // not more clusters than queries
  });

  it('each cluster has a label and queries array', () => {
    const results = computeKeywordClusterInsights(queryPageData);
    for (const r of results) {
      expect(r.data.label).toBeTruthy();
      expect(r.data.queries.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('aggregates impressions across cluster queries', () => {
    const results = computeKeywordClusterInsights(queryPageData);
    for (const r of results) {
      expect(r.data.totalImpressions).toBeGreaterThan(0);
    }
  });

  it('computes average position across cluster queries', () => {
    const results = computeKeywordClusterInsights(queryPageData);
    for (const r of results) {
      expect(r.data.avgPosition).toBeGreaterThan(0);
    }
  });

  it('identifies pillar page for clusters with shared pages', () => {
    const results = computeKeywordClusterInsights(queryPageData);
    // The seo cluster queries all point to the same page
    const seoClusters = results.filter(r =>
      r.data.queries.some(q => q.includes('seo')),
    );
    if (seoClusters.length > 0) {
      // At least one SEO cluster should have a pillar page
      const hasPillar = seoClusters.some(c => c.data.pillarPage !== null);
      expect(hasPillar).toBe(true);
    }
  });

  it('sorts clusters by total impressions descending', () => {
    const results = computeKeywordClusterInsights(queryPageData);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].data.totalImpressions).toBeGreaterThanOrEqual(results[i].data.totalImpressions);
    }
  });

  it('assigns severity based on cluster potential', () => {
    const results = computeKeywordClusterInsights(queryPageData);
    for (const r of results) {
      expect(['critical', 'warning', 'opportunity', 'positive']).toContain(r.severity);
    }
  });

  it('returns empty array for empty input', () => {
    expect(computeKeywordClusterInsights([])).toHaveLength(0);
  });
});
