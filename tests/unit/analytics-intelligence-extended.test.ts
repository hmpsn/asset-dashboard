/**
 * Wave 10 — Extended unit tests for server/analytics-intelligence.ts.
 *
 * Covers functions and branches not exercised by existing test files:
 * - normalizePageUrl / deduplicatePages / deduplicateQueryPages
 * - expectedCtrForPosition (boundary values)
 * - wordJaccard (edge cases)
 * - computeRankingMovers (threshold boundaries, ties, no-match, dedup, severity)
 * - computeCtrOpportunities (severity classification, position boundaries, dedup)
 * - computeSerpOpportunities (schema match variants, impression threshold)
 * - capWithDiversity (diversity cap, backfill pass, type filter bypass)
 * - pickWeaker (severity rank, impactScore tiebreak, equal case)
 * - isKeywordEmerging (short arrays, zero-first-value, exactly-20%-gain boundary)
 * - computeConversionAttributionInsights (severity boundary values at 5%, 2%, 0.5%)
 * - computeCompetitorGapInsights (low-volume filter, severity at 500-volume threshold)
 */
import { describe, it, expect } from 'vitest';
import {
  normalizePageUrl,
  deduplicatePages,
  deduplicateQueryPages,
  expectedCtrForPosition,
  wordJaccard,
  computeRankingMovers,
  computeCtrOpportunities,
  computeSerpOpportunities,
  capWithDiversity,
  pickWeaker,
  isKeywordEmerging,
  computeConversionAttributionInsights,
  computeCompetitorGapInsights,
} from '../../server/analytics-intelligence.js';
import type { SearchPage, QueryPageRow } from '../../server/search-console.js';
import type { AnalyticsInsight } from '../../shared/types/analytics.js';

// ── normalizePageUrl ──────────────────────────────────────────────

describe('normalizePageUrl', () => {
  it('strips query params from a full URL', () => {
    expect(normalizePageUrl('https://example.com/blog?utm_source=google')).toBe('https://example.com/blog');
  });

  it('strips fragment from a full URL', () => {
    expect(normalizePageUrl('https://example.com/contact#section')).toBe('https://example.com/contact');
  });

  it('strips trailing slash from a path (not root)', () => {
    expect(normalizePageUrl('https://example.com/about/')).toBe('https://example.com/about');
  });

  it('preserves root URL (single slash)', () => {
    expect(normalizePageUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('falls back for invalid URLs — strips trailing slash', () => {
    expect(normalizePageUrl('/relative/path/')).toBe('/relative/path');
  });

  it('falls back for invalid URLs — no trailing slash unchanged', () => {
    expect(normalizePageUrl('/no-slash')).toBe('/no-slash');
  });

  it('preserves root slash fallback', () => {
    expect(normalizePageUrl('/')).toBe('/');
  });
});

// ── deduplicatePages ─────────────────────────────────────────────

describe('deduplicatePages', () => {
  it('merges URL variants with trailing slash into one entry', () => {
    const pages: SearchPage[] = [
      { page: 'https://example.com/blog/', clicks: 40, impressions: 800, ctr: 5, position: 4 },
      { page: 'https://example.com/blog', clicks: 60, impressions: 1200, ctr: 5, position: 6 },
    ];
    const result = deduplicatePages(pages);
    expect(result).toHaveLength(1);
    expect(result[0].clicks).toBe(100);
    expect(result[0].impressions).toBe(2000);
  });

  it('uses weighted-average for position', () => {
    const pages: SearchPage[] = [
      { page: 'https://example.com/page', clicks: 10, impressions: 1000, ctr: 1, position: 4 },
      { page: 'https://example.com/page?q=1', clicks: 10, impressions: 1000, ctr: 1, position: 6 },
    ];
    const result = deduplicatePages(pages);
    expect(result[0].position).toBeCloseTo(5, 5); // equal impressions → midpoint
  });

  it('merges query-string variants into single entry', () => {
    const pages: SearchPage[] = [
      { page: 'https://example.com/services?ref=footer', clicks: 20, impressions: 400, ctr: 5, position: 3 },
      { page: 'https://example.com/services', clicks: 80, impressions: 1600, ctr: 5, position: 2 },
    ];
    const result = deduplicatePages(pages);
    expect(result).toHaveLength(1);
    expect(result[0].clicks).toBe(100);
  });

  it('keeps distinct URLs as separate entries', () => {
    const pages: SearchPage[] = [
      { page: 'https://example.com/about', clicks: 10, impressions: 200, ctr: 5, position: 5 },
      { page: 'https://example.com/contact', clicks: 20, impressions: 400, ctr: 5, position: 7 },
    ];
    expect(deduplicatePages(pages)).toHaveLength(2);
  });

  it('handles zero-impression dedup edge case without division by zero', () => {
    const pages: SearchPage[] = [
      { page: 'https://example.com/zero/', clicks: 0, impressions: 0, ctr: 0, position: 10 },
      { page: 'https://example.com/zero', clicks: 0, impressions: 0, ctr: 0, position: 10 },
    ];
    const result = deduplicatePages(pages);
    expect(result).toHaveLength(1);
    expect(result[0].impressions).toBe(0);
  });
});

// ── deduplicateQueryPages ─────────────────────────────────────────

describe('deduplicateQueryPages', () => {
  it('merges rows with same query + page URL variant', () => {
    const rows: QueryPageRow[] = [
      { query: 'seo tips', page: 'https://example.com/blog/', clicks: 10, impressions: 200, ctr: 5, position: 5 },
      { query: 'seo tips', page: 'https://example.com/blog', clicks: 20, impressions: 400, ctr: 5, position: 7 },
    ];
    const result = deduplicateQueryPages(rows);
    expect(result).toHaveLength(1);
    expect(result[0].clicks).toBe(30);
    expect(result[0].impressions).toBe(600);
  });

  it('keeps rows with different queries as separate entries', () => {
    const rows: QueryPageRow[] = [
      { query: 'seo tips', page: 'https://example.com/blog', clicks: 10, impressions: 200, ctr: 5, position: 5 },
      { query: 'web design', page: 'https://example.com/blog', clicks: 15, impressions: 300, ctr: 5, position: 6 },
    ];
    expect(deduplicateQueryPages(rows)).toHaveLength(2);
  });
});

// ── expectedCtrForPosition ────────────────────────────────────────

describe('expectedCtrForPosition', () => {
  it('returns 0.30 for position 1', () => {
    expect(expectedCtrForPosition(1)).toBe(0.30);
  });

  it('returns 0.025 for position 10', () => {
    expect(expectedCtrForPosition(10)).toBe(0.025);
  });

  it('clamps position < 1 to 1', () => {
    expect(expectedCtrForPosition(0)).toBe(0.30);
  });

  it('clamps position > 10 to 10, returning 0.025', () => {
    expect(expectedCtrForPosition(15)).toBe(0.025);
  });

  it('rounds fractional position to nearest integer', () => {
    // 1.4 rounds to 1 → 0.30
    expect(expectedCtrForPosition(1.4)).toBe(0.30);
    // 1.6 rounds to 2 → 0.17
    expect(expectedCtrForPosition(1.6)).toBe(0.17);
  });
});

// ── wordJaccard ───────────────────────────────────────────────────

describe('wordJaccard', () => {
  it('returns 1.0 for identical strings', () => {
    expect(wordJaccard('seo tips', 'seo tips')).toBe(1.0);
  });

  it('returns 0 for completely disjoint strings', () => {
    expect(wordJaccard('web design', 'seo audit')).toBe(0);
  });

  it('returns partial overlap for partially-matching strings', () => {
    const score = wordJaccard('seo tips for beginners', 'seo tips');
    // Intersection = {seo, tips} = 2; union = {seo, tips, for, beginners} = 4 → 0.5
    expect(score).toBeCloseTo(0.5, 5);
  });

  it('is case-insensitive', () => {
    expect(wordJaccard('SEO TIPS', 'seo tips')).toBe(1.0);
  });

  it('returns 1 for two empty strings (both have empty-string token, full overlap)', () => {
    // ''.split(/\s+/) → [''] — both sets share the empty-string token
    // intersection=1, union=1 → Jaccard=1. This documents actual behaviour.
    expect(wordJaccard('', '')).toBe(1);
  });
});

// ── computeRankingMovers ──────────────────────────────────────────

describe('computeRankingMovers', () => {
  it('detects opportunity mover (rank improved by 4 positions, within 3–5 range)', () => {
    const current: QueryPageRow[] = [
      { query: 'seo tools', page: 'https://example.com/tools', clicks: 50, impressions: 500, ctr: 10, position: 5 },
    ];
    const previous: QueryPageRow[] = [
      { query: 'seo tools', page: 'https://example.com/tools', clicks: 30, impressions: 500, ctr: 6, position: 9 },
    ];
    const results = computeRankingMovers(current, previous);
    expect(results).toHaveLength(1);
    expect(results[0].data.positionChange).toBeGreaterThan(0); // improvement
    // prev.position - curr.position = 9 - 5 = 4 → not > 5 → severity 'opportunity'
    expect(results[0].severity).toBe('opportunity');
  });

  it('assigns positive severity for improvement > 5 positions', () => {
    const current: QueryPageRow[] = [
      { query: 'big mover', page: 'https://example.com/page', clicks: 100, impressions: 1000, ctr: 10, position: 2 },
    ];
    const previous: QueryPageRow[] = [
      { query: 'big mover', page: 'https://example.com/page', clicks: 20, impressions: 1000, ctr: 2, position: 9 },
    ];
    const results = computeRankingMovers(current, previous);
    expect(results[0].severity).toBe('positive');
  });

  it('assigns warning severity for drop of 3-5 positions', () => {
    const current: QueryPageRow[] = [
      { query: 'dropping kw', page: 'https://example.com/page', clicks: 20, impressions: 500, ctr: 4, position: 8 },
    ];
    const previous: QueryPageRow[] = [
      { query: 'dropping kw', page: 'https://example.com/page', clicks: 60, impressions: 500, ctr: 12, position: 4 },
    ];
    const results = computeRankingMovers(current, previous);
    expect(results[0].severity).toBe('warning'); // dropped 4 positions: -3 < change < -5
  });

  it('assigns critical severity for drop > 5 positions', () => {
    const current: QueryPageRow[] = [
      { query: 'big drop', page: 'https://example.com/page', clicks: 5, impressions: 500, ctr: 1, position: 12 },
    ];
    const previous: QueryPageRow[] = [
      { query: 'big drop', page: 'https://example.com/page', clicks: 100, impressions: 500, ctr: 20, position: 2 },
    ];
    const results = computeRankingMovers(current, previous);
    expect(results[0].severity).toBe('critical');
  });

  it('skips rows with fewer than 50 impressions', () => {
    const current: QueryPageRow[] = [
      { query: 'low imp', page: 'https://example.com/page', clicks: 5, impressions: 30, ctr: 17, position: 3 },
    ];
    const previous: QueryPageRow[] = [
      { query: 'low imp', page: 'https://example.com/page', clicks: 1, impressions: 30, ctr: 3, position: 12 },
    ];
    expect(computeRankingMovers(current, previous)).toHaveLength(0);
  });

  it('skips rows with no previous data', () => {
    const current: QueryPageRow[] = [
      { query: 'new kw', page: 'https://example.com/new', clicks: 50, impressions: 500, ctr: 10, position: 5 },
    ];
    expect(computeRankingMovers(current, [])).toHaveLength(0);
  });

  it('skips rows where position change is <= 3', () => {
    const current: QueryPageRow[] = [
      { query: 'small move', page: 'https://example.com/page', clicks: 30, impressions: 500, ctr: 6, position: 5 },
    ];
    const previous: QueryPageRow[] = [
      { query: 'small move', page: 'https://example.com/page', clicks: 25, impressions: 500, ctr: 5, position: 7 },
    ];
    // change = 7 - 5 = 2 → below threshold
    expect(computeRankingMovers(current, previous)).toHaveLength(0);
  });

  it('deduplicates to the highest-impact query per page', () => {
    // Two queries on the same page — keep the one with higher |change| × impressions
    const current: QueryPageRow[] = [
      { query: 'kw-a', page: 'https://example.com/page', clicks: 50, impressions: 1000, ctr: 5, position: 3 },
      { query: 'kw-b', page: 'https://example.com/page', clicks: 20, impressions: 100, ctr: 20, position: 3 },
    ];
    const previous: QueryPageRow[] = [
      { query: 'kw-a', page: 'https://example.com/page', clicks: 10, impressions: 1000, ctr: 1, position: 10 }, // change=7, impact=7000
      { query: 'kw-b', page: 'https://example.com/page', clicks: 5, impressions: 100, ctr: 5, position: 10 },   // change=7, impact=700
    ];
    const results = computeRankingMovers(current, previous);
    expect(results).toHaveLength(1);
    expect(results[0].data.query).toBe('kw-a');
  });

  it('caps results at 30 entries', () => {
    const current: QueryPageRow[] = Array.from({ length: 50 }, (_, i) => ({
      query: `kw-${i}`,
      page: `https://example.com/page-${i}`,
      clicks: 100,
      impressions: 1000,
      ctr: 10,
      position: 3,
    }));
    const previous: QueryPageRow[] = Array.from({ length: 50 }, (_, i) => ({
      query: `kw-${i}`,
      page: `https://example.com/page-${i}`,
      clicks: 20,
      impressions: 1000,
      ctr: 2,
      position: 10,
    }));
    const results = computeRankingMovers(current, previous);
    expect(results.length).toBeLessThanOrEqual(30);
  });
});

// ── computeCtrOpportunities ───────────────────────────────────────

describe('computeCtrOpportunities', () => {
  it('identifies query-page with CTR well below expected', () => {
    // Position 1 → expected 30% CTR. Actual 6% (decimal 0.06) → ratio 0.2 < 0.70
    const rows: QueryPageRow[] = [
      { query: 'seo tools', page: 'https://example.com/tools', clicks: 60, impressions: 1000, ctr: 6, position: 1 },
    ];
    const results = computeCtrOpportunities(rows);
    expect(results).toHaveLength(1);
    expect(results[0].data.ctrRatio).toBeCloseTo(0.06 / 0.30, 2);
  });

  it('assigns critical severity when ctrRatio < 0.3', () => {
    // Actual CTR = 8%, expected for position 1 = 30% → ratio ≈ 0.267
    const rows: QueryPageRow[] = [
      { query: 'test kw', page: 'https://example.com/page', clicks: 80, impressions: 1000, ctr: 8, position: 1 },
    ];
    const results = computeCtrOpportunities(rows);
    expect(results[0].severity).toBe('critical');
  });

  it('assigns warning severity when 0.3 <= ctrRatio < 0.5', () => {
    // Actual CTR = 10%, expected for position 1 = 30% → ratio ≈ 0.333
    const rows: QueryPageRow[] = [
      { query: 'test kw', page: 'https://example.com/page', clicks: 100, impressions: 1000, ctr: 10, position: 1 },
    ];
    const results = computeCtrOpportunities(rows);
    expect(results[0].severity).toBe('warning');
  });

  it('assigns opportunity severity when 0.5 <= ctrRatio < 0.70', () => {
    // Actual CTR = 16%, expected for position 1 = 30% → ratio ≈ 0.533
    const rows: QueryPageRow[] = [
      { query: 'test kw', page: 'https://example.com/page', clicks: 160, impressions: 1000, ctr: 16, position: 1 },
    ];
    const results = computeCtrOpportunities(rows);
    expect(results[0].severity).toBe('opportunity');
  });

  it('excludes rows with impressions below 100', () => {
    const rows: QueryPageRow[] = [
      { query: 'low imp kw', page: 'https://example.com/page', clicks: 1, impressions: 50, ctr: 2, position: 1 },
    ];
    expect(computeCtrOpportunities(rows)).toHaveLength(0);
  });

  it('excludes rows outside page-1 (positions 11+)', () => {
    const rows: QueryPageRow[] = [
      { query: 'deep kw', page: 'https://example.com/page', clicks: 2, impressions: 500, ctr: 0.4, position: 12 },
    ];
    expect(computeCtrOpportunities(rows)).toHaveLength(0);
  });

  it('excludes rows where CTR meets threshold (ratio >= 0.70)', () => {
    // Position 1 expected 30%, actual 25% → ratio 0.833 → no opportunity
    const rows: QueryPageRow[] = [
      { query: 'decent ctr', page: 'https://example.com/page', clicks: 250, impressions: 1000, ctr: 25, position: 1 },
    ];
    expect(computeCtrOpportunities(rows)).toHaveLength(0);
  });

  it('deduplicates to highest click-gap query per page', () => {
    const rows: QueryPageRow[] = [
      // kw-a: expected 30%, actual 6% → click gap = (0.30 - 0.06) * 2000 = 480
      { query: 'kw-a', page: 'https://example.com/page', clicks: 120, impressions: 2000, ctr: 6, position: 1 },
      // kw-b: expected 30%, actual 6% → click gap = (0.30 - 0.06) * 500 = 120
      { query: 'kw-b', page: 'https://example.com/page', clicks: 30, impressions: 500, ctr: 6, position: 1 },
    ];
    const results = computeCtrOpportunities(rows);
    expect(results).toHaveLength(1);
    expect(results[0].data.query).toBe('kw-a');
  });

  it('caps results at 30 entries', () => {
    const rows: QueryPageRow[] = Array.from({ length: 50 }, (_, i) => ({
      query: `kw-${i}`,
      page: `https://example.com/page-${i}`,
      clicks: 10,
      impressions: 200,
      ctr: 5, // pos 1 expected 30%, actual 5% → ratio 0.167 qualifies
      position: 1,
    }));
    expect(computeCtrOpportunities(rows).length).toBeLessThanOrEqual(30);
  });
});

// ── computeSerpOpportunities ──────────────────────────────────────

describe('computeSerpOpportunities', () => {
  it('flags high-impression pages without schema markup', () => {
    const pages: SearchPage[] = [
      { page: 'https://example.com/services', clicks: 100, impressions: 2000, ctr: 5, position: 5 },
    ];
    const results = computeSerpOpportunities(pages, new Set());
    expect(results).toHaveLength(1);
    expect(results[0].data.schemaStatus).toBe('missing');
  });

  it('skips pages with impressions below 500', () => {
    const pages: SearchPage[] = [
      { page: 'https://example.com/low', clicks: 10, impressions: 300, ctr: 3, position: 8 },
    ];
    expect(computeSerpOpportunities(pages, new Set())).toHaveLength(0);
  });

  it('skips pages already in pagesWithSchema (by pathname)', () => {
    const pages: SearchPage[] = [
      { page: 'https://example.com/blog', clicks: 50, impressions: 1000, ctr: 5, position: 4 },
    ];
    const withSchema = new Set(['/blog']);
    expect(computeSerpOpportunities(pages, withSchema)).toHaveLength(0);
  });

  it('skips pages already in pagesWithSchema (by full URL fallback)', () => {
    const pages: SearchPage[] = [
      { page: 'https://example.com/blog', clicks: 50, impressions: 1000, ctr: 5, position: 4 },
    ];
    const withSchema = new Set(['https://example.com/blog']);
    expect(computeSerpOpportunities(pages, withSchema)).toHaveLength(0);
  });

  it('assigns warning severity for pages with >= 5000 impressions', () => {
    const pages: SearchPage[] = [
      { page: 'https://example.com/high', clicks: 200, impressions: 6000, ctr: 3.3, position: 3 },
    ];
    const results = computeSerpOpportunities(pages, new Set());
    expect(results[0].severity).toBe('warning');
  });

  it('assigns opportunity severity for pages with 500-4999 impressions', () => {
    const pages: SearchPage[] = [
      { page: 'https://example.com/medium', clicks: 30, impressions: 800, ctr: 3.75, position: 7 },
    ];
    const results = computeSerpOpportunities(pages, new Set());
    expect(results[0].severity).toBe('opportunity');
  });

  it('caps results at 20 entries', () => {
    const pages: SearchPage[] = Array.from({ length: 30 }, (_, i) => ({
      page: `https://example.com/page-${i}`,
      clicks: 20,
      impressions: 1000,
      ctr: 2,
      position: 5,
    }));
    expect(computeSerpOpportunities(pages, new Set()).length).toBeLessThanOrEqual(20);
  });
});

// ── capWithDiversity ──────────────────────────────────────────────

describe('capWithDiversity', () => {
  /** Build a minimal AnalyticsInsight stub */
  function makeInsight(id: string, insightType: string, impactScore = 50): AnalyticsInsight {
    return {
      id,
      workspaceId: 'ws-test',
      pageId: `/page-${id}`,
      insightType: insightType as AnalyticsInsight['insightType'],
      severity: 'opportunity',
      data: {},
      computedAt: new Date().toISOString(),
      impactScore,
      resolutionStatus: null,
      resolvedAt: null,
      resolvedBy: null,
      resolvedNote: null,
      bridgeSource: null,
      enrichedTitle: null,
      strategyAligned: null,
      domainClassification: null,
      pipelineStatus: null,
    } as unknown as AnalyticsInsight;
  }

  it('returns up to PUBLIC_CAP (25) insights without filter', () => {
    const insights = Array.from({ length: 30 }, (_, i) => makeInsight(`i${i}`, 'page_health'));
    const result = capWithDiversity(insights);
    expect(result.length).toBeLessThanOrEqual(25);
  });

  it('applies MAX_PER_TYPE (5) cap per insight type in first pass', () => {
    // 10 of type A and 10 of type B — each should be capped at 5 in first pass
    const insightsA = Array.from({ length: 10 }, (_, i) => makeInsight(`a${i}`, 'page_health', 100 - i));
    const insightsB = Array.from({ length: 10 }, (_, i) => makeInsight(`b${i}`, 'ranking_opportunity', 90 - i));
    const result = capWithDiversity([...insightsA, ...insightsB]);
    const aCount = result.filter(r => r.insightType === 'page_health').length;
    const bCount = result.filter(r => r.insightType === 'ranking_opportunity').length;
    expect(aCount).toBeLessThanOrEqual(5 + 5); // first pass 5, backfill up to 5 more
    expect(bCount).toBeLessThanOrEqual(5 + 5);
    expect(result.length).toBeLessThanOrEqual(25);
  });

  it('backfills remaining capacity from skipped insights', () => {
    // 3 types × 6 insights each = 18 total; after first pass only 15 selected
    // backfill should add 3 more to reach min(18, 25)=18
    const allInsights = [
      ...Array.from({ length: 6 }, (_, i) => makeInsight(`a${i}`, 'page_health', 100 - i)),
      ...Array.from({ length: 6 }, (_, i) => makeInsight(`b${i}`, 'ranking_opportunity', 90 - i)),
      ...Array.from({ length: 6 }, (_, i) => makeInsight(`c${i}`, 'content_decay', 80 - i)),
    ];
    const result = capWithDiversity(allInsights);
    expect(result.length).toBe(18); // all 18 fit within PUBLIC_CAP=25
  });

  it('skips diversity cap and returns up to 25 when typeFilter is provided', () => {
    // 20 page_health insights — typeFilter should bypass MAX_PER_TYPE
    const insights = Array.from({ length: 20 }, (_, i) => makeInsight(`ph${i}`, 'page_health'));
    const result = capWithDiversity(insights, 'page_health');
    expect(result.length).toBe(20); // all 20 returned, no 5-cap applied
  });

  it('returns empty array for empty input', () => {
    expect(capWithDiversity([])).toHaveLength(0);
  });
});

// ── pickWeaker ────────────────────────────────────────────────────

describe('pickWeaker', () => {
  function makeInsight(id: string, severity: string, impactScore: number | null = null): AnalyticsInsight {
    return {
      id,
      severity,
      impactScore,
      insightType: 'page_health',
    } as unknown as AnalyticsInsight;
  }

  it('returns id of insight with lower severity rank', () => {
    const a = makeInsight('a', 'opportunity'); // rank 2
    const b = makeInsight('b', 'warning');    // rank 3
    expect(pickWeaker(a, b)).toBe('a');
  });

  it('returns id of insight with lower impactScore when severity is equal', () => {
    const a = makeInsight('a', 'warning', 30);
    const b = makeInsight('b', 'warning', 70);
    expect(pickWeaker(a, b)).toBe('a');
  });

  it('returns null when severity and impactScore are both equal', () => {
    const a = makeInsight('a', 'warning', 50);
    const b = makeInsight('b', 'warning', 50);
    expect(pickWeaker(a, b)).toBeNull();
  });

  it('treats null impactScore as 0', () => {
    const a = makeInsight('a', 'warning', null);
    const b = makeInsight('b', 'warning', 10);
    expect(pickWeaker(a, b)).toBe('a'); // null → 0, lower than 10
  });

  it('critical beats positive', () => {
    const a = makeInsight('a', 'positive'); // rank 1
    const b = makeInsight('b', 'critical'); // rank 4
    expect(pickWeaker(a, b)).toBe('a');
  });
});

// ── isKeywordEmerging — additional edge cases ─────────────────────

describe('isKeywordEmerging — edge cases', () => {
  it('returns false for trend with only 2 values (too short)', () => {
    expect(isKeywordEmerging({ trend: [100, 150] })).toBe(false);
  });

  it('returns false when first value is zero (division guard)', () => {
    expect(isKeywordEmerging({ trend: [0, 50, 100, 150, 200, 250] })).toBe(false);
  });

  it('returns false when net gain is exactly 19.9% (just below threshold)', () => {
    // first=100, last=119.9 → (19.9/100)=0.199 < 0.20
    expect(isKeywordEmerging({ trend: [100, 105, 110, 112, 115, 119] })).toBe(false);
  });

  it('returns true when net gain is exactly 20% and second half > first half', () => {
    // first=100, last=120 → net gain exactly 0.20 — must also have secondHalf > firstHalf
    expect(isKeywordEmerging({ trend: [100, 100, 100, 110, 115, 120] })).toBe(true);
  });

  it('returns false when second half average not > first half (U-shape)', () => {
    // Net gain would be positive but second half dipped
    expect(isKeywordEmerging({ trend: [100, 200, 300, 200, 150, 130] })).toBe(false);
  });
});

// ── computeConversionAttributionInsights — severity boundary values ──

describe('computeConversionAttributionInsights — severity boundaries', () => {
  it('assigns positive severity when conversion rate >= 5%', () => {
    const pages = [{ landingPage: '/high', sessions: 100, users: 90, bounceRate: 20, avgEngagementTime: 60, conversions: 5 }];
    // 5/100 = 5% exactly
    const results = computeConversionAttributionInsights(pages);
    expect(results[0].severity).toBe('positive');
  });

  it('assigns opportunity severity when conversion rate is 2% to <5%', () => {
    const pages = [{ landingPage: '/mid', sessions: 100, users: 90, bounceRate: 40, avgEngagementTime: 60, conversions: 3 }];
    // 3/100 = 3%
    const results = computeConversionAttributionInsights(pages);
    expect(results[0].severity).toBe('opportunity');
  });

  it('assigns warning severity when conversion rate is 0.5% to <2%', () => {
    const pages = [{ landingPage: '/low', sessions: 100, users: 90, bounceRate: 60, avgEngagementTime: 40, conversions: 1 }];
    // 1/100 = 1%
    const results = computeConversionAttributionInsights(pages);
    expect(results[0].severity).toBe('warning');
  });

  it('assigns critical severity when conversion rate < 0.5%', () => {
    const pages = [{ landingPage: '/very-low', sessions: 1000, users: 900, bounceRate: 80, avgEngagementTime: 20, conversions: 2 }];
    // 2/1000 = 0.2%
    const results = computeConversionAttributionInsights(pages);
    expect(results[0].severity).toBe('critical');
  });
});

// ── computeCompetitorGapInsights — low-volume filter + severity boundary ──

describe('computeCompetitorGapInsights — additional coverage', () => {
  it('excludes keywords with volume < 50', () => {
    const gapData = [
      { keyword: 'tiny kw', competitorDomain: 'example.com', competitorPosition: 3, volume: 40, difficulty: 10 },
    ];
    expect(computeCompetitorGapInsights(gapData, [])).toHaveLength(0);
  });

  it('assigns warning severity for volume >= 500 and difficulty < 60 when we do not rank', () => {
    const gapData = [
      { keyword: 'medium kw', competitorDomain: 'example.com', competitorPosition: 5, volume: 700, difficulty: 40 },
    ];
    const results = computeCompetitorGapInsights(gapData, []);
    expect(results[0].severity).toBe('warning');
  });

  it('assigns opportunity severity for keywords we already rank for regardless of volume', () => {
    const gapData = [
      { keyword: 'ranking kw', competitorDomain: 'example.com', competitorPosition: 2, volume: 2000, difficulty: 30 },
    ];
    const ourData: QueryPageRow[] = [
      { query: 'ranking kw', page: 'https://example.com/page', clicks: 50, impressions: 500, ctr: 10, position: 8 },
    ];
    const results = computeCompetitorGapInsights(gapData, ourData);
    // We rank (ourPosition != null) → falls to 'opportunity' default
    expect(results[0].severity).toBe('opportunity');
    expect(results[0].data.ourPosition).toBe(8);
  });

  it('uses the best (lowest) of our positions across multiple GSC rows', () => {
    const gapData = [
      { keyword: 'multi-rank kw', competitorDomain: 'example.com', competitorPosition: 1, volume: 500, difficulty: 30 },
    ];
    const ourData: QueryPageRow[] = [
      { query: 'multi-rank kw', page: 'https://example.com/page-a', clicks: 10, impressions: 200, ctr: 5, position: 12 },
      { query: 'multi-rank kw', page: 'https://example.com/page-b', clicks: 30, impressions: 600, ctr: 5, position: 4 },
    ];
    const results = computeCompetitorGapInsights(gapData, ourData);
    expect(results[0].data.ourPosition).toBe(4); // lowest (best) position
  });
});
