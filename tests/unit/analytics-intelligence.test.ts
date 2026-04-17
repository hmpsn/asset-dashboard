/**
 * Unit tests for server/analytics-intelligence.ts — insight computation algorithms.
 *
 * Tests the pure computation functions with known inputs.
 * API calls are not needed — functions accept pre-fetched data.
 */
import { describe, it, expect } from 'vitest';
import {
  computePageHealthScores,
  computeRankingOpportunities,
  computeCannibalizationInsights,
  isStale,
} from '../../server/analytics-intelligence.js';
import type { SearchPage, QueryPageRow } from '../../server/search-console.js';
import type { GA4TopPage, GA4LandingPage } from '../../server/google-analytics.js';

// ── Page Health Scores ───────────────────────────────────────────

describe('computePageHealthScores', () => {
  // CTR values in percentage form (e.g. 6.3 for 6.3%) matching getAllGscPages output
  const gscPages: SearchPage[] = [
    { page: 'https://example.com/blog/seo-tips', clicks: 500, impressions: 8000, ctr: 6.3, position: 3.2 },
    { page: 'https://example.com/services', clicks: 200, impressions: 5000, ctr: 4.0, position: 8.5 },
    { page: 'https://example.com/about', clicks: 10, impressions: 200, ctr: 5.0, position: 25 },
  ];

  const ga4Pages: GA4TopPage[] = [
    { path: '/blog/seo-tips', pageviews: 1200, users: 800, avgEngagementTime: 120 },
    { path: '/services', pageviews: 600, users: 400, avgEngagementTime: 45 },
    // /about not in GA4 data — should still get a score from GSC alone
  ];

  it('returns a PageHealthData insight for each GSC page', () => {
    const results = computePageHealthScores(gscPages, ga4Pages);
    expect(results).toHaveLength(3);
  });

  it('assigns higher score to page with better position and traffic', () => {
    const results = computePageHealthScores(gscPages, ga4Pages);
    const seoTips = results.find(r => r.pageId?.includes('seo-tips'));
    const about = results.find(r => r.pageId?.includes('about'));

    expect(seoTips).toBeDefined();
    expect(about).toBeDefined();
    expect(seoTips!.data.score).toBeGreaterThan(about!.data.score);
  });

  it('produces scores between 0 and 100', () => {
    const results = computePageHealthScores(gscPages, ga4Pages);
    for (const r of results) {
      expect(r.data.score).toBeGreaterThanOrEqual(0);
      expect(r.data.score).toBeLessThanOrEqual(100);
    }
  });

  it('includes GSC and GA4 metrics in data payload', () => {
    const results = computePageHealthScores(gscPages, ga4Pages);
    const seoTips = results.find(r => r.pageId?.includes('seo-tips'))!;

    expect(seoTips.data.clicks).toBe(500);
    expect(seoTips.data.impressions).toBe(8000);
    expect(seoTips.data.position).toBeCloseTo(3.2, 1);
    expect(seoTips.data.ctr).toBeCloseTo(6.3, 1);
    expect(seoTips.data.pageviews).toBe(1200);
    expect(seoTips.data.avgEngagementTime).toBe(120);
  });

  it('handles pages with no GA4 match gracefully', () => {
    const results = computePageHealthScores(gscPages, ga4Pages);
    const about = results.find(r => r.pageId?.includes('about'))!;

    expect(about.data.pageviews).toBe(0);
    expect(about.data.avgEngagementTime).toBe(0);
    expect(about.data.score).toBeGreaterThan(0); // still gets GSC-based score
  });

  it('classifies severity based on score', () => {
    const results = computePageHealthScores(gscPages, ga4Pages);
    for (const r of results) {
      if (r.data.score >= 70) expect(r.severity).toBe('positive');
      else if (r.data.score >= 40) expect(r.severity).toBe('opportunity');
      else expect(r.severity).toMatch(/warning|critical/);
    }
  });
});

// ── Ranking Opportunities ─────────────────────────────────────────

describe('computeRankingOpportunities', () => {
  const queryPageData: QueryPageRow[] = [
    // Position 7, high impressions — should be a ranking opportunity
    { query: 'seo tips for beginners', page: 'https://example.com/blog/seo-tips', clicks: 45, impressions: 2000, ctr: 0.0225, position: 7 },
    // Position 2, already top 3 — NOT a ranking opportunity
    { query: 'best seo agency', page: 'https://example.com/services', clicks: 150, impressions: 3000, ctr: 0.05, position: 2 },
    // Position 12, decent impressions — ranking opportunity
    { query: 'local seo guide', page: 'https://example.com/blog/local-seo', clicks: 10, impressions: 800, ctr: 0.0125, position: 12 },
    // Position 15, low impressions — below threshold, NOT a ranking opportunity
    { query: 'obscure seo term', page: 'https://example.com/blog/obscure', clicks: 1, impressions: 20, ctr: 0.05, position: 15 },
    // Position 25, out of range — NOT a ranking opportunity
    { query: 'deep query', page: 'https://example.com/deep', clicks: 5, impressions: 500, ctr: 0.01, position: 25 },
  ];

  it('identifies pages in positions 4-20 with sufficient impressions', () => {
    const results = computeRankingOpportunities(queryPageData);
    expect(results.length).toBe(2);

    const queries = results.map(r => r.data.query);
    expect(queries).toContain('seo tips for beginners');
    expect(queries).toContain('local seo guide');
  });

  it('excludes pages already in top 3', () => {
    const results = computeRankingOpportunities(queryPageData);
    const queries = results.map(r => r.data.query);
    expect(queries).not.toContain('best seo agency');
  });

  it('excludes pages beyond position 20', () => {
    const results = computeRankingOpportunities(queryPageData);
    const queries = results.map(r => r.data.query);
    expect(queries).not.toContain('deep query');
  });

  it('calculates estimated traffic gain', () => {
    const results = computeRankingOpportunities(queryPageData);
    const seoTips = results.find(r => r.data.query === 'seo tips for beginners')!;

    expect(seoTips.data.estimatedTrafficGain).toBeGreaterThan(0);
    expect(seoTips.data.currentPosition).toBe(7);
    expect(seoTips.data.pageUrl).toBe('https://example.com/blog/seo-tips');
  });

  it('uses page URL only as pageId so DB UNIQUE constraint deduplicates per page', () => {
    const results = computeRankingOpportunities(queryPageData);
    const seoTips = results.find(r => r.data.query === 'seo tips for beginners')!;
    expect(seoTips.pageId).toBe('https://example.com/blog/seo-tips');
  });

  it('sorts by estimated traffic gain descending', () => {
    const results = computeRankingOpportunities(queryPageData);
    if (results.length > 1) {
      expect(results[0].data.estimatedTrafficGain).toBeGreaterThanOrEqual(
        results[1].data.estimatedTrafficGain,
      );
    }
  });

  it('assigns opportunity severity', () => {
    const results = computeRankingOpportunities(queryPageData);
    for (const r of results) {
      expect(r.severity).toBe('opportunity');
    }
  });
});

// ── Cannibalization Detection ────────────────────────────────────

describe('computeCannibalizationInsights', () => {
  const queryPageData: QueryPageRow[] = [
    // Two pages ranking for same query — cannibalization
    { query: 'seo services', page: 'https://example.com/services', clicks: 50, impressions: 1000, ctr: 0.05, position: 5 },
    { query: 'seo services', page: 'https://example.com/seo-services', clicks: 20, impressions: 800, ctr: 0.025, position: 9 },
    // Three pages for same query
    { query: 'web design', page: 'https://example.com/design', clicks: 30, impressions: 600, ctr: 0.05, position: 7 },
    { query: 'web design', page: 'https://example.com/services/web', clicks: 10, impressions: 400, ctr: 0.025, position: 12 },
    { query: 'web design', page: 'https://example.com/portfolio', clicks: 5, impressions: 300, ctr: 0.017, position: 18 },
    // Only one page — no cannibalization
    { query: 'unique keyword', page: 'https://example.com/unique', clicks: 100, impressions: 2000, ctr: 0.05, position: 3 },
  ];

  it('detects queries with 2+ pages ranking', () => {
    const results = computeCannibalizationInsights(queryPageData);
    expect(results.length).toBe(2); // "seo services" and "web design"
  });

  it('does not flag queries with only one page', () => {
    const results = computeCannibalizationInsights(queryPageData);
    const queries = results.map(r => r.data.query);
    expect(queries).not.toContain('unique keyword');
  });

  it('includes all competing pages and positions', () => {
    const results = computeCannibalizationInsights(queryPageData);
    const webDesign = results.find(r => r.data.query === 'web design')!;
    expect(webDesign.data.pages).toHaveLength(3);
    expect(webDesign.data.positions).toHaveLength(3);
  });

  it('includes totalImpressions in data', () => {
    const results = computeCannibalizationInsights(queryPageData);
    const seoServices = results.find(r => r.data.query === 'seo services')!;
    expect(seoServices.data.totalImpressions).toBe(1800); // 1000 + 800
  });

  it('sorts by total impressions descending (most impactful first)', () => {
    const results = computeCannibalizationInsights(queryPageData);
    if (results.length > 1) {
      // seo services has 1800 total impressions, web design has 1300
      expect(results[0].data.query).toBe('seo services');
      expect(results[0].data.totalImpressions).toBeGreaterThan(results[1].data.totalImpressions);
    }
  });

  it('uses query-based pageId so each insight gets its own DB row', () => {
    const results = computeCannibalizationInsights(queryPageData);
    const pageIds = results.map(r => r.pageId);
    expect(pageIds).toContain('cannibalization::seo services');
    expect(pageIds).toContain('cannibalization::web design');
  });

  it('assigns warning severity', () => {
    const results = computeCannibalizationInsights(queryPageData);
    for (const r of results) {
      expect(r.severity).toBe('warning');
    }
  });
});

// ── Staleness Check ──────────────────────────────────────────────

describe('isStale', () => {
  it('returns true when computedAt is older than maxAge', () => {
    const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    expect(isStale(sevenHoursAgo, 6 * 60 * 60 * 1000)).toBe(true);
  });

  it('returns false when computedAt is within maxAge', () => {
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    expect(isStale(oneHourAgo, 6 * 60 * 60 * 1000)).toBe(false);
  });

  it('returns true for undefined computedAt', () => {
    expect(isStale(undefined, 6 * 60 * 60 * 1000)).toBe(true);
  });
});

// ── Branded Query Filtering ───────────────────────────────────────

describe('computeRankingOpportunities — branded query filter', () => {
  // All three rows qualify by position (4-20) and impressions (>=50)
  const queryPageData: QueryPageRow[] = [
    { query: 'hubspot pricing', page: 'https://example.com/blog/crm-guide', clicks: 5, impressions: 500, ctr: 0.01, position: 8 },
    { query: 'best crm software', page: 'https://example.com/services', clicks: 10, impressions: 600, ctr: 0.017, position: 10 },
    { query: 'hubspot alternatives', page: 'https://example.com/blog/alternatives', clicks: 8, impressions: 400, ctr: 0.02, position: 7 },
  ];

  it('filters out queries containing competitor brand tokens', () => {
    const results = computeRankingOpportunities(queryPageData, ['hubspot']);
    const queries = results.map(r => r.data.query);
    expect(queries).not.toContain('hubspot pricing');
    expect(queries).not.toContain('hubspot alternatives');
    expect(queries).toContain('best crm software');
  });

  it('returns all qualifying results when no brandTokens provided', () => {
    const results = computeRankingOpportunities(queryPageData);
    expect(results.length).toBe(3);
  });

  it('returns all qualifying results when brandTokens is empty array', () => {
    const results = computeRankingOpportunities(queryPageData, []);
    expect(results.length).toBe(3);
  });
});

describe('computeCannibalizationInsights — branded query filter', () => {
  const queryPageData: QueryPageRow[] = [
    // Branded cannibalization — navigational, not actionable
    { query: 'salesforce crm', page: 'https://example.com/page-a', clicks: 20, impressions: 800, ctr: 0.025, position: 5 },
    { query: 'salesforce crm', page: 'https://example.com/page-b', clicks: 15, impressions: 600, ctr: 0.025, position: 9 },
    // Non-branded cannibalization — should remain
    { query: 'seo services', page: 'https://example.com/seo', clicks: 50, impressions: 1000, ctr: 0.05, position: 5 },
    { query: 'seo services', page: 'https://example.com/services', clicks: 20, impressions: 800, ctr: 0.025, position: 9 },
  ];

  it('filters out cannibalization for branded competitor queries', () => {
    const results = computeCannibalizationInsights(queryPageData, ['salesforce']);
    const queries = results.map(r => r.data.query);
    expect(queries).not.toContain('salesforce crm');
    expect(queries).toContain('seo services');
  });

  it('returns all cannibalization results when no brandTokens provided', () => {
    const results = computeCannibalizationInsights(queryPageData);
    expect(results.length).toBe(2);
  });

  it('returns all cannibalization results when brandTokens is empty array', () => {
    const results = computeCannibalizationInsights(queryPageData, []);
    expect(results.length).toBe(2);
  });
});
