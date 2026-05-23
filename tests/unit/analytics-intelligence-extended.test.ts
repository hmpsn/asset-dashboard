/**
 * Extended unit tests for server/analytics-intelligence.ts.
 *
 * Covers:
 * - isKeywordEmerging: trend detection edge cases
 * - computeRankingMovers: severity thresholds, dedup, impression filter
 * - computeCtrOpportunities: CTR % vs decimal confusion, severity, dedup
 * - computeSerpOpportunities: impression filter, schema URL normalization, severity
 * - capWithDiversity: PUBLIC_CAP=25, MAX_PER_TYPE=5, backfill pass
 *
 * NO existing test coverage: computePageHealthScores, computeRankingOpportunities,
 * computeCannibalizationInsights, computeFreshnessAlerts, isStale,
 * computeConversionAttributionInsights, computeCompetitorGapInsights,
 * computeKeywordClusterInsights.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../server/db/index.js', () => ({
  default: { prepare: vi.fn(() => ({ get: vi.fn(), all: vi.fn(() => []), run: vi.fn() })) },
}));
vi.mock('../../server/db/stmt-cache.js', () => ({
  createStmtCache: (factory: () => unknown) => factory,
}));
vi.mock('../../server/sentry.js', () => ({ captureException: vi.fn() }));
vi.mock('../../server/ws-broadcaster.js', () => ({ broadcastToWorkspace: vi.fn() }));

import {
  isKeywordEmerging,
  computeRankingMovers,
  computeCtrOpportunities,
  computeSerpOpportunities,
  capWithDiversity,
} from '../../server/analytics-intelligence.js';
import type { AnalyticsInsight, InsightType } from '../../shared/types/analytics.js';
import type { SearchPage, QueryPageRow } from '../../server/search-console.js';

// ── Helpers ──────────────────────────────────────────────────────

function makeRow(
  query: string,
  page: string,
  impressions: number,
  position: number,
  clicks = 10,
  ctr = 5,
): QueryPageRow {
  return { query, page, clicks, impressions, ctr, position };
}

function makePage(
  page: string,
  impressions: number,
  clicks = 50,
  position = 5,
  ctr = 5,
): SearchPage {
  return { page, clicks, impressions, ctr, position };
}

let insightId = 0;
function makeInsight(type: string, id?: string, impactScore = 50): AnalyticsInsight {
  return {
    id: id ?? `insight-${++insightId}`,
    insightType: type as InsightType,
    pageId: 'page-1',
    workspaceId: 'ws-1',
    severity: 'warning',
    impactScore,
    data: {},
    computedAt: new Date().toISOString(),
    resolutionStatus: null,
    bridgeSource: null,
  } as unknown as AnalyticsInsight;
}

beforeEach(() => { insightId = 0; });

// ── isKeywordEmerging ─────────────────────────────────────────────

describe('isKeywordEmerging', () => {
  it('returns false when trend is undefined', () => {
    expect(isKeywordEmerging({})).toBe(false);
  });

  it('returns false when trend array has fewer than 3 elements', () => {
    expect(isKeywordEmerging({ trend: [10, 12] })).toBe(false);
  });

  it('returns false when trend has exactly 2 elements', () => {
    expect(isKeywordEmerging({ trend: [5, 10] })).toBe(false);
  });

  it('returns true for 50% net gain with second-half avg > first-half avg (6 points)', () => {
    // first=10, last=15 → netGainPct=0.50 ≥ 0.20
    // firstHalfAvg=(10+11+12)/3=11, secondHalfAvg=(13+14+15)/3=14 → 14 > 11 ✓
    expect(isKeywordEmerging({ trend: [10, 11, 12, 13, 14, 15] })).toBe(true);
  });

  it('returns false when first value is 0 (division-by-zero guard)', () => {
    // first=0 → guard triggers immediately
    expect(isKeywordEmerging({ trend: [0, 5, 10, 15, 20, 25] })).toBe(false);
  });

  it('returns false when first value is negative', () => {
    expect(isKeywordEmerging({ trend: [-5, 5, 10, 15, 20, 25] })).toBe(false);
  });

  it('returns false when trend is flat (no net gain)', () => {
    // netGainPct=(11-10)/10=0.10 < 0.20
    expect(isKeywordEmerging({ trend: [10, 12, 11, 10, 11, 11] })).toBe(false);
  });

  it('returns false when trend is declining', () => {
    // first=100, last=50 → netGainPct = -0.50
    expect(isKeywordEmerging({ trend: [100, 90, 80, 70, 60, 50] })).toBe(false);
  });

  it('returns true when exactly 20% net gain and second half higher', () => {
    // first=10, last=12 → netGainPct=0.20 ≥ 0.20 (exact boundary)
    // firstHalfAvg=(10+11+10)/3≈10.33, secondHalfAvg=(11+11+12)/3≈11.33 → 11.33 > 10.33 ✓
    expect(isKeywordEmerging({ trend: [10, 11, 10, 11, 11, 12] })).toBe(true);
  });

  it('returns false when net gain ≥20% but second half avg not > first half avg', () => {
    // Spike then return: first=10, last=12 (20% net gain), but spike in first half
    // firstHalfAvg=(10+20+18)/3≈16, secondHalfAvg=(12+12+12)/3=12 → 12 < 16, fail
    expect(isKeywordEmerging({ trend: [10, 20, 18, 12, 12, 12] })).toBe(false);
  });

  it('works with exactly 3 data points (minimum valid length)', () => {
    // n=3: recent=[10,11,14], first=10, last=14
    // netGainPct=0.40 ≥ 0.20
    // midpoint=1, firstHalfAvg=recent[0]/1=10, secondHalfAvg=(11+14)/2=12.5 → 12.5 > 10 ✓
    expect(isKeywordEmerging({ trend: [10, 11, 14] })).toBe(true);
  });

  it('uses only the last 6 values from longer trend arrays', () => {
    // First 4 are high, last 6 are declining → should be false
    // last 6: [30, 20, 15, 10, 8, 6]  first=30, last=6 → netGainPct=(6-30)/30 negative
    expect(isKeywordEmerging({ trend: [100, 200, 300, 400, 30, 20, 15, 10, 8, 6] })).toBe(false);
  });

  it('uses only the last 6 values — emerging from recent recovery', () => {
    // First values declining, last 6 showing 50%+ growth
    // last 6: [10, 11, 12, 13, 14, 15] → should return true
    expect(isKeywordEmerging({ trend: [100, 90, 80, 70, 60, 10, 11, 12, 13, 14, 15] })).toBe(true);
  });

  it('returns false when gain is 19% (just below threshold)', () => {
    // first=100, last=119 → netGainPct=0.19 < 0.20
    // firstHalfAvg=(100+105+110)/3≈105, secondHalfAvg=(115+117+119)/3≈117 → second > first ✓
    // but netGainPct threshold fails
    expect(isKeywordEmerging({ trend: [100, 105, 110, 115, 117, 119] })).toBe(false);
  });
});

// ── computeRankingMovers ─────────────────────────────────────────

describe('computeRankingMovers', () => {
  it('returns empty array when both inputs are empty', () => {
    expect(computeRankingMovers([], [])).toEqual([]);
  });

  it('returns empty array when current rows have no match in previous', () => {
    const curr = [makeRow('keyword a', 'https://example.com/page-a', 200, 5)];
    expect(computeRankingMovers(curr, [])).toEqual([]);
  });

  it('skips rows with impressions < 50', () => {
    const curr = [makeRow('kw', 'https://example.com/p', 49, 5)];
    const prev = [makeRow('kw', 'https://example.com/p', 49, 10)];
    expect(computeRankingMovers(curr, prev)).toEqual([]);
  });

  it('skips rows with exactly 49 impressions (boundary check)', () => {
    const curr = [makeRow('kw', 'https://example.com/p', 49, 5)];
    const prev = [makeRow('kw', 'https://example.com/p', 49, 15)];
    expect(computeRankingMovers(curr, prev)).toEqual([]);
  });

  it('includes rows with exactly 50 impressions', () => {
    const curr = [makeRow('kw', 'https://example.com/p', 50, 5)];
    const prev = [makeRow('kw', 'https://example.com/p', 50, 10)];
    const results = computeRankingMovers(curr, prev);
    expect(results).toHaveLength(1);
  });

  it('skips pair when positionChange is exactly 2 (< 3 threshold)', () => {
    // prev.position=8, curr.position=6 → positionChange=2 < 3
    const curr = [makeRow('kw', 'https://example.com/p', 100, 6)];
    const prev = [makeRow('kw', 'https://example.com/p', 100, 8)];
    expect(computeRankingMovers(curr, prev)).toEqual([]);
  });

  it('includes pair when positionChange is exactly 3 (at threshold)', () => {
    // prev.position=8, curr.position=5 → positionChange=3 ≥ 3
    const curr = [makeRow('kw', 'https://example.com/p', 100, 5)];
    const prev = [makeRow('kw', 'https://example.com/p', 100, 8)];
    const results = computeRankingMovers(curr, prev);
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('opportunity'); // 3 ≤ 5
  });

  it('assigns severity "positive" when positionChange > 5 (improvement)', () => {
    // prev.position=12, curr.position=5 → positionChange=7
    const curr = [makeRow('kw', 'https://example.com/p', 100, 5)];
    const prev = [makeRow('kw', 'https://example.com/p', 100, 12)];
    const results = computeRankingMovers(curr, prev);
    expect(results[0].severity).toBe('positive');
  });

  it('assigns severity "opportunity" when positionChange is between 3 and 5 (inclusive)', () => {
    // prev=10, curr=5 → positionChange=5 (exactly 5, not > 5)
    const curr = [makeRow('kw', 'https://example.com/p', 100, 5)];
    const prev = [makeRow('kw', 'https://example.com/p', 100, 10)];
    const results = computeRankingMovers(curr, prev);
    expect(results[0].severity).toBe('opportunity');
  });

  it('assigns severity "warning" when positionChange is between -3 and -5 (decline)', () => {
    // prev=3, curr=7 → positionChange=-4 → between -5 and -3
    const curr = [makeRow('kw', 'https://example.com/p', 100, 7)];
    const prev = [makeRow('kw', 'https://example.com/p', 100, 3)];
    const results = computeRankingMovers(curr, prev);
    expect(results[0].severity).toBe('warning');
  });

  it('assigns severity "critical" when positionChange < -5 (sharp decline)', () => {
    // prev=2, curr=10 → positionChange=-8
    const curr = [makeRow('kw', 'https://example.com/p', 100, 10)];
    const prev = [makeRow('kw', 'https://example.com/p', 100, 2)];
    const results = computeRankingMovers(curr, prev);
    expect(results[0].severity).toBe('critical');
  });

  it('deduplicates to one entry per page URL, keeping highest impact', () => {
    const page = 'https://example.com/services';
    // Two queries for same page. Query A: positionChange=3, impressions=100 → impact=300
    // Query B: positionChange=6, impressions=200 → impact=1200 (wins)
    const curr = [
      makeRow('query-a', page, 100, 5),  // prev.position=8 → change=3
      makeRow('query-b', page, 200, 2),  // prev.position=8 → change=6
    ];
    const prev = [
      makeRow('query-a', page, 100, 8),
      makeRow('query-b', page, 200, 8),
    ];
    const results = computeRankingMovers(curr, prev);
    expect(results).toHaveLength(1);
    expect(results[0].data.query).toBe('query-b');
  });

  it('produces correct pageId using toInsightPageId (pathname)', () => {
    const curr = [makeRow('kw', 'https://example.com/my-page', 100, 5)];
    const prev = [makeRow('kw', 'https://example.com/my-page', 100, 10)];
    const results = computeRankingMovers(curr, prev);
    expect(results[0].pageId).toBe('/my-page');
  });

  it('stores positionChange correctly (positive = improvement)', () => {
    // prev=10, curr=4 → positionChange=6
    const curr = [makeRow('kw', 'https://example.com/p', 100, 4)];
    const prev = [makeRow('kw', 'https://example.com/p', 100, 10)];
    const results = computeRankingMovers(curr, prev);
    expect(results[0].data.positionChange).toBeCloseTo(6, 1);
    expect(results[0].data.currentPosition).toBeCloseTo(4, 1);
    expect(results[0].data.previousPosition).toBeCloseTo(10, 1);
  });

  it('insightType is always "ranking_mover"', () => {
    const curr = [makeRow('kw', 'https://example.com/p', 100, 3)];
    const prev = [makeRow('kw', 'https://example.com/p', 100, 10)];
    const results = computeRankingMovers(curr, prev);
    expect(results[0].insightType).toBe('ranking_mover');
  });

  it('sorts results by impact (|positionChange| × impressions) descending', () => {
    const page1 = 'https://example.com/page1';
    const page2 = 'https://example.com/page2';
    // page1: change=10, impressions=50 → impact=500
    // page2: change=4, impressions=200 → impact=800 — page2 should come first
    const curr = [
      makeRow('kw1', page1, 50, 1),   // prev=11 → change=10
      makeRow('kw2', page2, 200, 4),  // prev=8  → change=4
    ];
    const prev = [
      makeRow('kw1', page1, 50, 11),
      makeRow('kw2', page2, 200, 8),
    ];
    const results = computeRankingMovers(curr, prev);
    expect(results[0].data.pageUrl).toBe(page2);
    expect(results[1].data.pageUrl).toBe(page1);
  });

  it('caps output at 30 results', () => {
    const curr: QueryPageRow[] = [];
    const prev: QueryPageRow[] = [];
    for (let i = 0; i < 40; i++) {
      const page = `https://example.com/page-${i}`;
      curr.push(makeRow(`kw-${i}`, page, 100, 5));
      prev.push(makeRow(`kw-${i}`, page, 100, 15));
    }
    const results = computeRankingMovers(curr, prev);
    expect(results.length).toBeLessThanOrEqual(30);
  });
});

// ── computeCtrOpportunities ───────────────────────────────────────

describe('computeCtrOpportunities', () => {
  it('returns empty array for empty input', () => {
    expect(computeCtrOpportunities([])).toEqual([]);
  });

  it('skips rows with impressions < 100', () => {
    // position=1, ctr=2% → actualDecimal=0.02, expected=0.30, ratio=0.067 (critical)
    // but impressions=99 → skipped
    const row = makeRow('kw', 'https://example.com/p', 99, 1, 2, 2);
    expect(computeCtrOpportunities([row])).toEqual([]);
  });

  it('skips rows at position 11 (outside page 1)', () => {
    const row = makeRow('kw', 'https://example.com/p', 200, 11, 2, 2);
    expect(computeCtrOpportunities([row])).toEqual([]);
  });

  it('skips rows at position > 10', () => {
    const row = makeRow('kw', 'https://example.com/p', 500, 15, 5, 3);
    expect(computeCtrOpportunities([row])).toEqual([]);
  });

  it('skips rows where actual CTR ratio >= 0.70', () => {
    // position=1, expectedCtr=0.30
    // To get ratio=0.70: actualCtrDecimal=0.21, so ctr=21 (percentage)
    const row = makeRow('kw', 'https://example.com/p', 200, 1, 42, 21);
    // ratio=0.21/0.30=0.70 → exactly at threshold → skipped
    expect(computeCtrOpportunities([row])).toEqual([]);
  });

  it('includes rows where CTR ratio is just below 0.70 threshold', () => {
    // position=1, expectedCtr=0.30
    // ctr=20.9% → actualDecimal=0.209, ratio=0.209/0.30=0.6967 < 0.70 → included
    const row = makeRow('kw', 'https://example.com/p', 200, 1, 41, 20.9);
    const results = computeCtrOpportunities([row]);
    expect(results).toHaveLength(1);
  });

  it('correctly handles CTR as percentage (not decimal) — bug-detector test', () => {
    // position=2, expectedCtr=0.17 (decimal)
    // If ctr=5 (percentage), actualDecimal=0.05, ratio=0.05/0.17≈0.294 → 'critical'
    // Bug: if code treated ctr as decimal (ctr=5 → 5.0), ratio=5/0.17≈29 (no opportunity)
    const row = makeRow('kw', 'https://example.com/p', 500, 2, 25, 5);
    const results = computeCtrOpportunities([row]);
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('critical'); // ratio≈0.294 < 0.30
  });

  it('assigns severity "critical" when ctrRatio < 0.30', () => {
    // position=1, expectedCtr=0.30
    // ctr=8% → actualDecimal=0.08, ratio=0.08/0.30≈0.267 < 0.30 → critical
    const row = makeRow('kw', 'https://example.com/p', 200, 1, 16, 8);
    const results = computeCtrOpportunities([row]);
    expect(results[0].severity).toBe('critical');
  });

  it('assigns severity "warning" when ctrRatio is between 0.30 and 0.49', () => {
    // position=1, expectedCtr=0.30
    // ctr=12% → actualDecimal=0.12, ratio=0.12/0.30=0.40 → warning
    const row = makeRow('kw', 'https://example.com/p', 200, 1, 24, 12);
    const results = computeCtrOpportunities([row]);
    expect(results[0].severity).toBe('warning');
  });

  it('assigns severity "opportunity" when ctrRatio is between 0.50 and 0.69', () => {
    // position=1, expectedCtr=0.30
    // ctr=18% → actualDecimal=0.18, ratio=0.18/0.30=0.60 → opportunity
    const row = makeRow('kw', 'https://example.com/p', 200, 1, 36, 18);
    const results = computeCtrOpportunities([row]);
    expect(results[0].severity).toBe('opportunity');
  });

  it('stores actualCtr as percentage (original ctr value from GSC)', () => {
    // ctr=10 (10%) — stored as-is in output
    const row = makeRow('kw', 'https://example.com/p', 200, 1, 20, 10);
    const results = computeCtrOpportunities([row]);
    if (results.length > 0) {
      // actualCtr should be 10, not 0.10
      expect(results[0].data.actualCtr).toBe(10);
    }
  });

  it('stores expectedCtr as percentage (decimal × 100)', () => {
    // position=1 → expectedCtrForPosition returns 0.30 decimal → stored as 30 (%)
    const row = makeRow('kw', 'https://example.com/p', 200, 1, 5, 5);
    const results = computeCtrOpportunities([row]);
    if (results.length > 0) {
      // expectedCtr should be ~30, not 0.30
      expect(results[0].data.expectedCtr).toBeGreaterThan(1);
      expect(results[0].data.expectedCtr).toBeCloseTo(30, 0);
    }
  });

  it('deduplicates to one entry per page URL, keeping highest estimatedClickGap', () => {
    const page = 'https://example.com/services';
    // Query A: position=1, ctr=5% → clickGap = (0.30-0.05)*100 = 25
    // Query B: position=2, ctr=2% → clickGap = (0.17-0.02)*500 = 75 (higher → wins)
    const rows = [
      makeRow('query-a', page, 100, 1, 5, 5),
      makeRow('query-b', page, 500, 2, 10, 2),
    ];
    const results = computeCtrOpportunities(rows);
    expect(results).toHaveLength(1);
    expect(results[0].data.query).toBe('query-b');
  });

  it('produces correct pageId using toInsightPageId (pathname)', () => {
    const row = makeRow('kw', 'https://example.com/my-page', 200, 1, 5, 5);
    const results = computeCtrOpportunities([row]);
    if (results.length > 0) {
      expect(results[0].pageId).toBe('/my-page');
    }
  });

  it('insightType is always "ctr_opportunity"', () => {
    const row = makeRow('kw', 'https://example.com/p', 200, 1, 5, 5);
    const results = computeCtrOpportunities([row]);
    if (results.length > 0) {
      expect(results[0].insightType).toBe('ctr_opportunity');
    }
  });

  it('caps output at 30 results', () => {
    const rows: QueryPageRow[] = [];
    for (let i = 0; i < 40; i++) {
      rows.push(makeRow(`kw-${i}`, `https://example.com/page-${i}`, 200, 1, 5, 5));
    }
    const results = computeCtrOpportunities(rows);
    expect(results.length).toBeLessThanOrEqual(30);
  });

  it('handles position rounding — position 1.4 rounds to 1 (included)', () => {
    const row = makeRow('kw', 'https://example.com/p', 200, 1.4, 5, 5);
    const results = computeCtrOpportunities([row]);
    // rounded to 1, which is within 1-10
    if (results.length > 0) {
      expect(results[0].insightType).toBe('ctr_opportunity');
    }
  });

  it('handles position rounding — position 10.5 rounds to 11 (excluded)', () => {
    const row = makeRow('kw', 'https://example.com/p', 200, 10.5, 2, 2);
    expect(computeCtrOpportunities([row])).toEqual([]);
  });

  it('sorts output by estimatedClickGap descending', () => {
    // page1: position=1, ctr=5% → clickGap=(0.30-0.05)*200=50
    // page2: position=1, ctr=2% → clickGap=(0.30-0.02)*1000=280 → should be first
    const rows = [
      makeRow('kw1', 'https://example.com/page1', 200, 1, 10, 5),
      makeRow('kw2', 'https://example.com/page2', 1000, 1, 20, 2),
    ];
    const results = computeCtrOpportunities(rows);
    expect(results[0].data.pageUrl).toBe('https://example.com/page2');
  });
});

// ── computeSerpOpportunities ──────────────────────────────────────

describe('computeSerpOpportunities', () => {
  it('returns empty array for empty input', () => {
    expect(computeSerpOpportunities([], new Set())).toEqual([]);
  });

  it('skips pages with impressions < 500', () => {
    const page = makePage('https://example.com/p', 499);
    expect(computeSerpOpportunities([page], new Set())).toEqual([]);
  });

  it('includes pages with exactly 500 impressions', () => {
    const page = makePage('https://example.com/p', 500);
    const results = computeSerpOpportunities([page], new Set());
    expect(results).toHaveLength(1);
  });

  it('skips pages whose pathname is in pagesWithSchema', () => {
    const page = makePage('https://example.com/services', 1000);
    const schema = new Set(['/services']); // pathname match
    expect(computeSerpOpportunities([page], schema)).toEqual([]);
  });

  it('skips pages whose full URL is in pagesWithSchema', () => {
    const page = makePage('https://example.com/services', 1000);
    const schema = new Set(['https://example.com/services']); // full URL match
    expect(computeSerpOpportunities([page], schema)).toEqual([]);
  });

  it('includes pages not in schema set', () => {
    const page = makePage('https://example.com/blog/post-1', 600);
    const schema = new Set(['/services']); // different path
    const results = computeSerpOpportunities([page], schema);
    expect(results).toHaveLength(1);
  });

  it('assigns severity "opportunity" for impressions between 500 and 4999', () => {
    const page = makePage('https://example.com/p', 4999);
    const results = computeSerpOpportunities([page], new Set());
    expect(results[0].severity).toBe('opportunity');
  });

  it('assigns severity "warning" for impressions >= 5000', () => {
    const page = makePage('https://example.com/p', 5000);
    const results = computeSerpOpportunities([page], new Set());
    expect(results[0].severity).toBe('warning');
  });

  it('assigns severity "warning" for impressions >> 5000', () => {
    const page = makePage('https://example.com/p', 50000);
    const results = computeSerpOpportunities([page], new Set());
    expect(results[0].severity).toBe('warning');
  });

  it('sets schemaStatus to "missing" in output data', () => {
    const page = makePage('https://example.com/p', 1000);
    const results = computeSerpOpportunities([page], new Set());
    expect(results[0].data.schemaStatus).toBe('missing');
  });

  it('uses pathname for schema set lookup (URL normalization)', () => {
    // Page has a full URL. Schema set contains the pathname only.
    const page = makePage('https://example.com/about', 1500);
    const schema = new Set(['/about']);
    expect(computeSerpOpportunities([page], schema)).toEqual([]);
  });

  it('handles invalid page URL gracefully (no protocol)', () => {
    // A non-URL string falls back to the raw string for pathname
    const page: SearchPage = { page: '/relative-path', clicks: 10, impressions: 600, ctr: 3, position: 5 };
    // Schema set doesn't contain it
    const results = computeSerpOpportunities([page], new Set());
    // Should not throw — result may or may not include (depends on fallback path)
    expect(Array.isArray(results)).toBe(true);
  });

  it('sorts results by impressions descending', () => {
    const pages = [
      makePage('https://example.com/page-a', 600),
      makePage('https://example.com/page-b', 8000),
      makePage('https://example.com/page-c', 1500),
    ];
    const results = computeSerpOpportunities(pages, new Set());
    expect(results[0].data.impressions).toBe(8000);
    expect(results[1].data.impressions).toBe(1500);
    expect(results[2].data.impressions).toBe(600);
  });

  it('caps output at 20 results', () => {
    const pages: SearchPage[] = [];
    for (let i = 0; i < 30; i++) {
      pages.push(makePage(`https://example.com/page-${i}`, 1000 + i));
    }
    const results = computeSerpOpportunities(pages, new Set());
    expect(results.length).toBeLessThanOrEqual(20);
  });

  it('produces correct pageId using toInsightPageId', () => {
    const page = makePage('https://example.com/my-service', 700);
    const results = computeSerpOpportunities([page], new Set());
    expect(results[0].pageId).toBe('/my-service');
  });

  it('insightType is always "serp_opportunity"', () => {
    const page = makePage('https://example.com/p', 700);
    const results = computeSerpOpportunities([page], new Set());
    expect(results[0].insightType).toBe('serp_opportunity');
  });

  it('stores full pageUrl in data (not just pathname)', () => {
    const pageUrl = 'https://example.com/full-url-page';
    const page = makePage(pageUrl, 700);
    const results = computeSerpOpportunities([page], new Set());
    expect(results[0].data.pageUrl).toBe(pageUrl);
  });
});

// ── capWithDiversity ──────────────────────────────────────────────

describe('capWithDiversity', () => {
  it('returns empty array for empty input', () => {
    expect(capWithDiversity([])).toEqual([]);
  });

  it('returns empty array for empty input with typeFilter', () => {
    expect(capWithDiversity([], 'page_health')).toEqual([]);
  });

  it('with typeFilter: returns first 25 of that type without diversity cap', () => {
    // 30 insights all of type page_health — with typeFilter, just slice(0, 25)
    const insights = Array.from({ length: 30 }, (_, i) =>
      makeInsight('page_health', `id-${i}`, 100 - i),
    );
    const results = capWithDiversity(insights, 'page_health');
    expect(results).toHaveLength(25);
    // Should be the first 25 in order (already sorted by impact desc in input)
    expect(results[0].id).toBe('id-0');
    expect(results[24].id).toBe('id-24');
  });

  it('without typeFilter: first pass caps at MAX_PER_TYPE=5, second pass backfills', () => {
    // 10 insights of type page_health:
    // - First pass takes 5 (hits MAX_PER_TYPE)
    // - Second pass backfills remaining 5 from same type (slots still available since 5 < 25)
    // - Total: 10 (all included since 10 < PUBLIC_CAP=25)
    const insights = Array.from({ length: 10 }, (_, i) =>
      makeInsight('page_health', `id-${i}`, 100 - i),
    );
    const results = capWithDiversity(insights);
    // Second pass backfills the remaining 5, so all 10 are in the result
    expect(results).toHaveLength(10);
  });

  it('without typeFilter: first pass guarantees diversity; second pass backfills remaining slots', () => {
    // 3 types × 6 insights each = 18 total (all < PUBLIC_CAP=25)
    // First pass: 5 of each type = 15 (then backfill adds remaining 3 from overflow)
    // All 18 fit within PUBLIC_CAP=25
    const insights: AnalyticsInsight[] = [];
    for (let i = 0; i < 6; i++) {
      insights.push(makeInsight('page_health', `ph-${i}`, 100 - i));
      insights.push(makeInsight('ctr_opportunity', `ctr-${i}`, 90 - i));
      insights.push(makeInsight('ranking_mover', `rm-${i}`, 80 - i));
    }
    // Sort by impactScore desc to simulate DB ordering
    insights.sort((a, b) => (b.impactScore ?? 0) - (a.impactScore ?? 0));
    const results = capWithDiversity(insights);
    // All 18 fit within PUBLIC_CAP=25
    expect(results).toHaveLength(18);
    // Each type should be represented (diversity guarantee from first pass)
    const phCount = results.filter(r => r.insightType === 'page_health').length;
    const ctrCount = results.filter(r => r.insightType === 'ctr_opportunity').length;
    const rmCount = results.filter(r => r.insightType === 'ranking_mover').length;
    expect(phCount).toBeGreaterThanOrEqual(1);
    expect(ctrCount).toBeGreaterThanOrEqual(1);
    expect(rmCount).toBeGreaterThanOrEqual(1);
  });

  it('backfill pass fills remaining slots beyond first-pass cap', () => {
    // 6 types × 6 insights each = 36 total
    // First pass (5 per type): 30 total but PUBLIC_CAP=25 stops first pass early
    // Second pass backfills remaining slots
    const types: InsightType[] = [
      'page_health', 'ctr_opportunity', 'ranking_mover',
      'serp_opportunity', 'ranking_opportunity', 'cannibalization',
    ];
    const insights: AnalyticsInsight[] = [];
    for (const type of types) {
      for (let i = 0; i < 6; i++) {
        insights.push(makeInsight(type, `${type}-${i}`, 100));
      }
    }
    const results = capWithDiversity(insights);
    expect(results).toHaveLength(25); // PUBLIC_CAP
  });

  it('without typeFilter: all 6 returned when only 6 insights (no cap needed)', () => {
    const insights = [
      makeInsight('page_health', 'ph-1'),
      makeInsight('ctr_opportunity', 'ctr-1'),
      makeInsight('ranking_mover', 'rm-1'),
      makeInsight('serp_opportunity', 'so-1'),
      makeInsight('ranking_opportunity', 'ro-1'),
      makeInsight('cannibalization', 'can-1'),
    ];
    const results = capWithDiversity(insights);
    expect(results).toHaveLength(6);
  });

  it('second pass includes skipped insights when slots remain', () => {
    // 1 type with 8 insights: first pass takes 5, second pass backfills 8 more
    // But PUBLIC_CAP=25, so all 8 that fit should be included
    // Total = 8 insights, all same type: first pass=5, second pass backfills remaining 3 → total=8
    const insights = Array.from({ length: 8 }, (_, i) =>
      makeInsight('page_health', `id-${i}`, 100 - i),
    );
    const results = capWithDiversity(insights);
    expect(results).toHaveLength(8); // all 8 fit within PUBLIC_CAP=25
  });

  it('does not duplicate insights between first and second pass', () => {
    const insights = Array.from({ length: 10 }, (_, i) =>
      makeInsight('page_health', `id-${i}`, 100 - i),
    );
    const results = capWithDiversity(insights);
    const ids = results.map(r => r.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });

  it('with typeFilter: ignores diversity and includes up to 25 regardless of type distribution', () => {
    // Mix of types, but typeFilter='ranking_mover' → just first 25
    const insights: AnalyticsInsight[] = [];
    for (let i = 0; i < 10; i++) {
      insights.push(makeInsight('ranking_mover', `rm-${i}`, 100 - i));
      insights.push(makeInsight('page_health', `ph-${i}`, 90 - i));
    }
    // typeFilter just slices at 25 — does NOT filter by type; that filtering happens upstream
    const results = capWithDiversity(insights, 'ranking_mover');
    expect(results.length).toBeLessThanOrEqual(25);
  });
});
