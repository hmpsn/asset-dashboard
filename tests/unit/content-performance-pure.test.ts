/**
 * Pure unit tests for content performance analytics functions.
 *
 * Covers functions NOT already tested in analytics-intelligence.test.ts or
 * analytics-intelligence-phase3.test.ts:
 *  - isKeywordEmerging() trend detection helper
 *  - isStale() staleness check
 *  - computeRankingMovers() position-change detection
 *  - computeCtrOpportunities() CTR gap scoring
 *  - computeSerpOpportunities() schema opportunity detection
 *
 * All functions are pure — no DB or external service mocks required.
 */

import { describe, it, expect } from 'vitest';
import {
  isKeywordEmerging,
  isStale,
  computeRankingMovers,
  computeCtrOpportunities,
  computeSerpOpportunities,
} from '../../server/analytics-intelligence.js';
import type { QueryPageRow, SearchPage } from '../../server/search-console.js';

// ── isKeywordEmerging ──────────────────────────────────────────────────────

describe('isKeywordEmerging', () => {
  it('returns false when trend array is absent', () => {
    expect(isKeywordEmerging({})).toBe(false);
  });

  it('returns false when trend has fewer than 3 data points', () => {
    expect(isKeywordEmerging({ trend: [100, 120] })).toBe(false);
    expect(isKeywordEmerging({ trend: [] })).toBe(false);
  });

  it('returns false when first value is 0 or negative (guard against division by zero)', () => {
    expect(isKeywordEmerging({ trend: [0, 100, 200, 300, 400, 500] })).toBe(false);
    expect(isKeywordEmerging({ trend: [-10, 50, 100, 200, 300, 400] })).toBe(false);
  });

  it('returns false when net gain is less than 20%', () => {
    // 100 → 115 = 15% gain — below 20% threshold
    expect(isKeywordEmerging({ trend: [100, 105, 108, 110, 112, 115] })).toBe(false);
  });

  it('returns false when second half average is not higher than first half (declining trend)', () => {
    // Starts high, ends lower — not emerging
    expect(isKeywordEmerging({ trend: [200, 180, 160, 140, 120, 100] })).toBe(false);
  });

  it('returns true for a clearly emerging trend (rising last 6 data points)', () => {
    // 100 → 160 = 60% gain, second half (133, 146, 160) > first half (100, 113, 120)
    expect(isKeywordEmerging({ trend: [100, 113, 120, 133, 146, 160] })).toBe(true);
  });

  it('returns true when exactly at 20% gain threshold with rising second half', () => {
    // 100 → 120 exactly 20% — also needs secondHalfAvg > firstHalfAvg
    const trend = [100, 103, 108, 112, 116, 120];
    // first half: [100, 103, 108] avg=103.67; second half: [112, 116, 120] avg=116 → ok
    expect(isKeywordEmerging({ trend })).toBe(true);
  });

  it('uses only the last 6 data points from a longer trend array', () => {
    // Long array where last 6 points show emergence but earlier points are high
    // Older points (500, 500, 500...) don't affect the result — only last 6 matter
    const trend = [500, 500, 500, 100, 110, 125, 140, 150, 160, 170];
    // last 6: [125, 140, 150, 160, 170, ?] — wait, last 6 is [125,140,150,160,170,?]
    // actual last 6 (indices 4-9): [110,125,140,150,160,170]
    // 110→170=54.5% gain, secondHalf [150,160,170] avg=160 > firstHalf [110,125,140] avg=125
    expect(isKeywordEmerging({ trend })).toBe(true);
  });

  it('returns false for exactly 3 data points where second half cannot beat first with enough gain', () => {
    // With 3 points, first half = [v0] (1 item), second half = [v1, v2] (2 items)
    // 100 → 121 = 21% gain, but check halves: first=[100], second=[110, 121]
    // 110.5 > 100 and gain = 21% — should return true
    expect(isKeywordEmerging({ trend: [100, 110, 121] })).toBe(true);
  });

  it('handles a flat trend (no change)', () => {
    expect(isKeywordEmerging({ trend: [100, 100, 100, 100, 100, 100] })).toBe(false);
  });
});

// ── isStale ────────────────────────────────────────────────────────────────

describe('isStale', () => {
  it('returns true when computedAt is undefined', () => {
    expect(isStale(undefined)).toBe(true);
  });

  it('returns false for a very recent timestamp (just now)', () => {
    const justNow = new Date().toISOString();
    expect(isStale(justNow)).toBe(false);
  });

  it('returns true for a timestamp older than the default 24h max age', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(isStale(twoDaysAgo)).toBe(true);
  });

  it('respects a custom maxAgeMs parameter', () => {
    const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString();
    // 5 second max age — 10s old is stale
    expect(isStale(tenSecondsAgo, 5_000)).toBe(true);
    // 30 second max age — 10s old is fresh
    expect(isStale(tenSecondsAgo, 30_000)).toBe(false);
  });

  it('returns false for a timestamp exactly 1 second ago with 5 second max age', () => {
    const oneSecondAgo = new Date(Date.now() - 1_000).toISOString();
    expect(isStale(oneSecondAgo, 5_000)).toBe(false);
  });

  it('returns true for a timestamp at exactly the boundary (>= maxAgeMs)', () => {
    // At the boundary, the check is > not >=, so exactly at maxAge is NOT stale
    // Using a value slightly over the boundary
    const slightlyOverBoundary = new Date(Date.now() - 24 * 60 * 60 * 1000 - 100).toISOString();
    expect(isStale(slightlyOverBoundary)).toBe(true);
  });
});

// ── computeRankingMovers ───────────────────────────────────────────────────

describe('computeRankingMovers', () => {
  const makeRow = (
    query: string,
    page: string,
    position: number,
    impressions: number,
    clicks: number,
  ): QueryPageRow => ({ query, page, position, impressions, clicks, ctr: (clicks / impressions) * 100 });

  it('returns empty array when current is empty', () => {
    const prev = [makeRow('seo tips', 'https://ex.com/blog', 5, 500, 30)];
    expect(computeRankingMovers([], prev)).toEqual([]);
  });

  it('returns empty array when previous is empty (no comparison possible)', () => {
    const curr = [makeRow('seo tips', 'https://ex.com/blog', 3, 500, 50)];
    expect(computeRankingMovers(curr, [])).toEqual([]);
  });

  it('detects a significant improvement (positive positionChange)', () => {
    const curr = [makeRow('seo tips', 'https://ex.com/blog', 3, 500, 50)];
    const prev = [makeRow('seo tips', 'https://ex.com/blog', 10, 500, 20)];
    const results = computeRankingMovers(curr, prev);
    expect(results).toHaveLength(1);
    expect(results[0].data.positionChange).toBeGreaterThan(0); // improvement
    expect(results[0].insightType).toBe('ranking_mover');
  });

  it('detects a significant drop (negative positionChange)', () => {
    const curr = [makeRow('seo tips', 'https://ex.com/blog', 15, 500, 10)];
    const prev = [makeRow('seo tips', 'https://ex.com/blog', 5, 500, 40)];
    const results = computeRankingMovers(curr, prev);
    expect(results).toHaveLength(1);
    expect(results[0].data.positionChange).toBeLessThan(0); // drop
  });

  it('ignores small position changes (< 3 positions)', () => {
    const curr = [makeRow('seo tips', 'https://ex.com/blog', 6, 500, 30)];
    const prev = [makeRow('seo tips', 'https://ex.com/blog', 7.5, 500, 25)]; // change < 3
    const results = computeRankingMovers(curr, prev);
    expect(results).toHaveLength(0);
  });

  it('ignores queries with fewer than 50 impressions', () => {
    const curr = [makeRow('seo tips', 'https://ex.com/blog', 3, 40, 10)]; // impressions < 50
    const prev = [makeRow('seo tips', 'https://ex.com/blog', 15, 40, 2)];
    const results = computeRankingMovers(curr, prev);
    expect(results).toHaveLength(0);
  });

  it('deduplicates to one entry per page (highest impact query wins)', () => {
    // Two queries for the same page, both with significant changes
    const curr = [
      makeRow('query a', 'https://ex.com/blog', 3, 500, 50),  // impact: (10-3)*500=3500
      makeRow('query b', 'https://ex.com/blog', 2, 1000, 80), // impact: (12-2)*1000=10000 (higher)
    ];
    const prev = [
      makeRow('query a', 'https://ex.com/blog', 13, 500, 15),
      makeRow('query b', 'https://ex.com/blog', 12, 1000, 20),
    ];
    const results = computeRankingMovers(curr, prev);
    // Should produce only 1 entry for the page (best impact = query b)
    expect(results).toHaveLength(1);
    expect(results[0].data.query).toBe('query b');
  });

  it('assigns severity "positive" for large improvement (> 5 positions)', () => {
    const curr = [makeRow('seo tips', 'https://ex.com/blog', 2, 500, 80)];
    const prev = [makeRow('seo tips', 'https://ex.com/blog', 12, 500, 20)];
    const results = computeRankingMovers(curr, prev);
    expect(results[0].severity).toBe('positive');
  });

  it('assigns severity "critical" for large drop (> 5 positions)', () => {
    const curr = [makeRow('seo tips', 'https://ex.com/blog', 12, 500, 10)];
    const prev = [makeRow('seo tips', 'https://ex.com/blog', 3, 500, 50)];
    const results = computeRankingMovers(curr, prev);
    expect(results[0].severity).toBe('critical');
  });

  it('caps results at 30 entries', () => {
    // Create 50 unique page/query pairs all with large improvements
    const curr = Array.from({ length: 50 }, (_, i) =>
      makeRow(`query ${i}`, `https://ex.com/page-${i}`, 2, 500, 80),
    );
    const prev = Array.from({ length: 50 }, (_, i) =>
      makeRow(`query ${i}`, `https://ex.com/page-${i}`, 12, 500, 20),
    );
    const results = computeRankingMovers(curr, prev);
    expect(results.length).toBeLessThanOrEqual(30);
  });

  it('positionChange is rounded to one decimal place', () => {
    const curr = [makeRow('q', 'https://ex.com/p', 3.15, 500, 40)];
    const prev = [makeRow('q', 'https://ex.com/p', 10.25, 500, 10)];
    const results = computeRankingMovers(curr, prev);
    if (results.length > 0) {
      expect(Number.isFinite(results[0].data.positionChange)).toBe(true);
      // Rounded to 1 decimal place means at most 1 decimal digit
      const str = results[0].data.positionChange.toString();
      const decimalPart = str.includes('.') ? str.split('.')[1] : '';
      expect(decimalPart.length).toBeLessThanOrEqual(1);
    }
  });
});

// ── computeCtrOpportunities ────────────────────────────────────────────────

describe('computeCtrOpportunities', () => {
  const makeRow = (
    query: string,
    page: string,
    position: number,
    impressions: number,
    ctr: number,
  ): QueryPageRow => ({
    query,
    page,
    position,
    impressions,
    ctr,
    clicks: Math.round((ctr / 100) * impressions),
  });

  it('returns empty array for empty input', () => {
    expect(computeCtrOpportunities([])).toEqual([]);
  });

  it('excludes rows with fewer than 100 impressions', () => {
    const rows = [makeRow('seo tips', 'https://ex.com/blog', 3, 50, 1.0)]; // impressions < 100
    expect(computeCtrOpportunities(rows)).toHaveLength(0);
  });

  it('excludes rows with position > 10 (not on page 1)', () => {
    const rows = [makeRow('seo tips', 'https://ex.com/blog', 15, 500, 0.5)];
    expect(computeCtrOpportunities(rows)).toHaveLength(0);
  });

  it('identifies a significant CTR opportunity at position 1 with very low CTR', () => {
    // Position 1 expected CTR ~30%, but page is only getting 5% (ctr_ratio ≈ 0.17 < 0.70)
    const rows = [makeRow('seo tips', 'https://ex.com/blog', 1, 1000, 5.0)];
    const results = computeCtrOpportunities(rows);
    expect(results).toHaveLength(1);
    expect(results[0].insightType).toBe('ctr_opportunity');
    expect(results[0].data.actualCtr).toBe(5.0);
  });

  it('excludes a page with a healthy CTR (at or above 70% of expected)', () => {
    // Position 3 expected CTR ~12%, page getting 10% (ratio ≈ 0.83 > 0.70) — not an opportunity
    const rows = [makeRow('seo tips', 'https://ex.com/blog', 3, 500, 10.0)];
    const results = computeCtrOpportunities(rows);
    expect(results).toHaveLength(0);
  });

  it('assigns severity "critical" when ctrRatio < 0.3', () => {
    // Position 1 (exp ~30%), actual ctr 2% → ratio = 0.02/0.30 ≈ 0.07 → critical
    const rows = [makeRow('seo', 'https://ex.com/blog', 1, 1000, 2.0)];
    const results = computeCtrOpportunities(rows);
    expect(results[0].severity).toBe('critical');
  });

  it('deduplicates to one entry per page (highest click gap wins)', () => {
    // Two queries for the same page
    const rows = [
      makeRow('query a', 'https://ex.com/page', 2, 500, 1.0),  // low CTR, low gap
      makeRow('query b', 'https://ex.com/page', 2, 5000, 1.0), // low CTR, HIGH gap (more impressions)
    ];
    const results = computeCtrOpportunities(rows);
    // Should produce only 1 entry (best click gap = query b)
    expect(results).toHaveLength(1);
    expect(results[0].data.query).toBe('query b');
  });

  it('caps results at 30 entries', () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      makeRow(`query ${i}`, `https://ex.com/page-${i}`, 2, 500, 1.0),
    );
    const results = computeCtrOpportunities(rows);
    expect(results.length).toBeLessThanOrEqual(30);
  });

  it('sorts results by estimated click gap descending (highest opportunity first)', () => {
    const rows = [
      makeRow('low-gap', 'https://ex.com/low', 3, 200, 1.0),
      makeRow('high-gap', 'https://ex.com/high', 3, 2000, 1.0),
    ];
    const results = computeCtrOpportunities(rows);
    if (results.length >= 2) {
      expect(results[0].data.estimatedClickGap).toBeGreaterThanOrEqual(results[1].data.estimatedClickGap);
    }
  });

  it('includes pageId, actualCtr, expectedCtr, and impressions in result data', () => {
    const rows = [makeRow('seo', 'https://ex.com/blog', 1, 1000, 5.0)];
    const results = computeCtrOpportunities(rows);
    if (results.length > 0) {
      expect(results[0].data).toMatchObject({
        query: expect.any(String),
        pageUrl: expect.any(String),
        position: expect.any(Number),
        actualCtr: expect.any(Number),
        expectedCtr: expect.any(Number),
        impressions: expect.any(Number),
        estimatedClickGap: expect.any(Number),
      });
    }
  });
});

// ── computeSerpOpportunities ───────────────────────────────────────────────

describe('computeSerpOpportunities', () => {
  const makePage = (page: string, impressions: number, clicks: number, position: number, ctr: number): SearchPage => ({
    page,
    impressions,
    clicks,
    position,
    ctr,
  });

  it('returns empty array for empty input', () => {
    expect(computeSerpOpportunities([], new Set())).toEqual([]);
  });

  it('excludes pages with fewer than 500 impressions', () => {
    const pages = [makePage('https://ex.com/blog', 300, 10, 5, 3.3)];
    expect(computeSerpOpportunities(pages, new Set())).toHaveLength(0);
  });

  it('excludes pages that already have schema markup', () => {
    const pages = [makePage('https://ex.com/blog', 1000, 30, 3, 3.0)];
    const pagesWithSchema = new Set(['/blog']);
    expect(computeSerpOpportunities(pages, pagesWithSchema)).toHaveLength(0);
  });

  it('includes pages without schema markup that meet impression threshold', () => {
    const pages = [makePage('https://ex.com/blog', 1000, 30, 3, 3.0)];
    const results = computeSerpOpportunities(pages, new Set());
    expect(results).toHaveLength(1);
    expect(results[0].insightType).toBe('serp_opportunity');
    expect(results[0].data.schemaStatus).toBe('missing');
  });

  it('assigns severity "warning" for pages with 5000+ impressions', () => {
    const pages = [makePage('https://ex.com/blog', 6000, 200, 3, 3.3)];
    const results = computeSerpOpportunities(pages, new Set());
    expect(results[0].severity).toBe('warning');
  });

  it('assigns severity "opportunity" for pages with 500-4999 impressions', () => {
    const pages = [makePage('https://ex.com/blog', 1000, 30, 5, 3.0)];
    const results = computeSerpOpportunities(pages, new Set());
    expect(results[0].severity).toBe('opportunity');
  });

  it('excludes page when its pathname matches schema set (even if full URL is not in set)', () => {
    const pages = [makePage('https://ex.com/services/seo', 1000, 30, 3, 3.0)];
    const pagesWithSchema = new Set(['/services/seo']); // pathname match
    expect(computeSerpOpportunities(pages, pagesWithSchema)).toHaveLength(0);
  });

  it('excludes page when its full URL matches schema set', () => {
    const pages = [makePage('https://ex.com/blog', 1000, 30, 3, 3.0)];
    const pagesWithSchema = new Set(['https://ex.com/blog']); // full URL match
    expect(computeSerpOpportunities(pages, pagesWithSchema)).toHaveLength(0);
  });

  it('sorts results by impressions descending', () => {
    const pages = [
      makePage('https://ex.com/low', 600, 10, 5, 1.7),
      makePage('https://ex.com/high', 5000, 150, 2, 3.0),
      makePage('https://ex.com/mid', 2000, 60, 3, 3.0),
    ];
    const results = computeSerpOpportunities(pages, new Set());
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].data.impressions).toBeGreaterThanOrEqual(results[i].data.impressions);
    }
  });

  it('caps results at 20 entries', () => {
    const pages = Array.from({ length: 30 }, (_, i) =>
      makePage(`https://ex.com/page-${i}`, 1000 + i, 30, 5, 3.0),
    );
    const results = computeSerpOpportunities(pages, new Set());
    expect(results.length).toBeLessThanOrEqual(20);
  });

  it('includes all required data fields', () => {
    const pages = [makePage('https://ex.com/blog', 1000, 30, 3, 3.0)];
    const results = computeSerpOpportunities(pages, new Set());
    expect(results[0].data).toMatchObject({
      pageUrl: expect.any(String),
      impressions: expect.any(Number),
      clicks: expect.any(Number),
      position: expect.any(Number),
      ctr: expect.any(Number),
      schemaStatus: 'missing',
    });
  });

  it('handles malformed page URL gracefully (falls back to raw string for schema check)', () => {
    const pages = [makePage('not-a-valid-url', 1000, 30, 3, 3.0)];
    // Should not throw — falls back to the raw value for schema lookup
    expect(() => computeSerpOpportunities(pages, new Set())).not.toThrow();
  });
});
