/**
 * Unit tests for src/lib/strategy-health-score.ts. Verifies the StrategyTab
 * health score calculation, the derived counts that feed the UI, and the
 * division-safety / empty-data edge cases that previously lived inline.
 */
import { describe, it, expect } from 'vitest';
import { calculateStrategyHealth } from '../../src/lib/strategy-health-score';
import type { ClientKeywordStrategy } from '../../src/components/client/types';

type PageMapEntry = ClientKeywordStrategy['pageMap'][number];

const makeStrategy = (overrides: Partial<ClientKeywordStrategy> = {}): ClientKeywordStrategy => ({
  siteKeywords: [],
  pageMap: [],
  opportunities: [],
  generatedAt: '2025-01-01T00:00:00Z',
  ...overrides,
});

const page = (over: Partial<PageMapEntry>): PageMapEntry => ({
  pagePath: '/p',
  primaryKeyword: 'k',
  ...over,
});

describe('calculateStrategyHealth — empty / minimal data', () => {
  it('returns zero scores for a totally empty strategy', () => {
    const result = calculateStrategyHealth(makeStrategy());
    expect(result).toEqual({
      contentGapsFound: 0,
      quickWinsAvailable: 0,
      keywordGapCount: 0,
      newContentTopicCount: 0,
      pagesRanking: 0,
      totalPages: 0,
      pagesWithGrowthOpps: 0,
      contentScore: 0,
      quickWinScore: 0,
      coverageScore: 0,
      healthScore: 0,
    });
  });

  it('does NOT divide by zero when pageMap is empty', () => {
    const result = calculateStrategyHealth(makeStrategy({ pageMap: [] }));
    expect(Number.isFinite(result.coverageScore)).toBe(true);
    expect(result.coverageScore).toBe(0);
    expect(result.healthScore).toBe(0);
  });
});

describe('calculateStrategyHealth — content gap component (max 40)', () => {
  it('awards 4 points per content gap below the cap', () => {
    const result = calculateStrategyHealth(
      makeStrategy({ contentGaps: Array(3).fill({}) as ClientKeywordStrategy['contentGaps'] }),
    );
    expect(result.contentScore).toBe(12);
  });

  it('caps content gap contribution at 40 (10 gaps)', () => {
    const result = calculateStrategyHealth(
      makeStrategy({ contentGaps: Array(15).fill({}) as ClientKeywordStrategy['contentGaps'] }),
    );
    expect(result.contentGapsFound).toBe(15);
    expect(result.contentScore).toBe(40);
  });
});

describe('calculateStrategyHealth — quick win component (max 30)', () => {
  it('awards 6 points per quick win below the cap', () => {
    const result = calculateStrategyHealth(
      makeStrategy({ quickWins: Array(3).fill({}) as ClientKeywordStrategy['quickWins'] }),
    );
    expect(result.quickWinScore).toBe(18);
  });

  it('caps quick wins at 30 (5 wins)', () => {
    const result = calculateStrategyHealth(
      makeStrategy({ quickWins: Array(20).fill({}) as ClientKeywordStrategy['quickWins'] }),
    );
    expect(result.quickWinsAvailable).toBe(20);
    expect(result.quickWinScore).toBe(30);
  });
});

describe('calculateStrategyHealth — coverage component (max 30)', () => {
  it('awards 30 when every page has a current position', () => {
    const result = calculateStrategyHealth(makeStrategy({
      pageMap: [
        page({ currentPosition: 1 }),
        page({ currentPosition: 7 }),
        page({ currentPosition: 12 }),
      ],
    }));
    expect(result.totalPages).toBe(3);
    expect(result.pagesRanking).toBe(3);
    expect(result.coverageScore).toBe(30);
  });

  it('rounds the coverage ratio to the nearest integer', () => {
    // 1/3 ranking → 1/3 × 30 = 10
    const result = calculateStrategyHealth(makeStrategy({
      pageMap: [
        page({ currentPosition: 5 }),
        page({}),
        page({}),
      ],
    }));
    expect(result.pagesRanking).toBe(1);
    expect(result.totalPages).toBe(3);
    expect(result.coverageScore).toBe(10);
  });

  it('rounds 2/7 × 30 to 9 (.toBeCloseTo would be wrong — score is integer)', () => {
    const result = calculateStrategyHealth(makeStrategy({
      pageMap: [
        page({ currentPosition: 1 }),
        page({ currentPosition: 2 }),
        page({}),
        page({}),
        page({}),
        page({}),
        page({}),
      ],
    }));
    // 2/7 * 30 = 8.571 → 9
    expect(result.coverageScore).toBe(9);
  });

  it('counts pages without a position but with impressions as growth opportunities', () => {
    const result = calculateStrategyHealth(makeStrategy({
      pageMap: [
        page({ currentPosition: 4 }),
        page({ impressions: 50 }),
        page({ impressions: 0 }),
        page({}),
      ],
    }));
    expect(result.pagesWithGrowthOpps).toBe(1);
    expect(result.pagesRanking).toBe(1);
  });

  it('does not double-count: pages with both position and impressions are NOT growth opps', () => {
    const result = calculateStrategyHealth(makeStrategy({
      pageMap: [page({ currentPosition: 4, impressions: 100 })],
    }));
    expect(result.pagesRanking).toBe(1);
    expect(result.pagesWithGrowthOpps).toBe(0);
  });
});

describe('calculateStrategyHealth — derived counts', () => {
  it('newContentTopicCount = contentGaps + keywordGaps', () => {
    const result = calculateStrategyHealth(makeStrategy({
      contentGaps: Array(2).fill({}) as ClientKeywordStrategy['contentGaps'],
      keywordGaps: Array(5).fill({}) as ClientKeywordStrategy['keywordGaps'],
    }));
    expect(result.contentGapsFound).toBe(2);
    expect(result.keywordGapCount).toBe(5);
    expect(result.newContentTopicCount).toBe(7);
  });

  it('treats missing arrays as zero (no NaN propagation)', () => {
    // Explicitly omit contentGaps / quickWins / keywordGaps
    const result = calculateStrategyHealth(makeStrategy({
      pageMap: [page({ currentPosition: 1 })],
    }));
    expect(result.contentGapsFound).toBe(0);
    expect(result.quickWinsAvailable).toBe(0);
    expect(result.keywordGapCount).toBe(0);
    expect(result.newContentTopicCount).toBe(0);
    expect(Number.isNaN(result.healthScore)).toBe(false);
  });
});

describe('calculateStrategyHealth — composite healthScore', () => {
  it('returns 100 when every component maxes out', () => {
    const result = calculateStrategyHealth(makeStrategy({
      contentGaps: Array(10).fill({}) as ClientKeywordStrategy['contentGaps'],
      quickWins: Array(5).fill({}) as ClientKeywordStrategy['quickWins'],
      pageMap: [
        page({ currentPosition: 1 }),
        page({ currentPosition: 2 }),
        page({ currentPosition: 3 }),
      ],
    }));
    expect(result.healthScore).toBe(100);
  });

  it('still returns 100 when a single component overshoots its cap', () => {
    // Caps prevent runaway scores from skewing the total above 100.
    const result = calculateStrategyHealth(makeStrategy({
      contentGaps: Array(50).fill({}) as ClientKeywordStrategy['contentGaps'],
      quickWins: Array(50).fill({}) as ClientKeywordStrategy['quickWins'],
      pageMap: [page({ currentPosition: 1 })],
    }));
    expect(result.contentScore).toBe(40);
    expect(result.quickWinScore).toBe(30);
    expect(result.coverageScore).toBe(30);
    expect(result.healthScore).toBe(100);
  });

  it('sums components correctly in a mixed case', () => {
    // 5 gaps × 4 = 20, 2 wins × 6 = 12, 1/2 ranking × 30 = 15 → 47
    const result = calculateStrategyHealth(makeStrategy({
      contentGaps: Array(5).fill({}) as ClientKeywordStrategy['contentGaps'],
      quickWins: Array(2).fill({}) as ClientKeywordStrategy['quickWins'],
      pageMap: [
        page({ currentPosition: 4 }),
        page({}),
      ],
    }));
    expect(result.contentScore).toBe(20);
    expect(result.quickWinScore).toBe(12);
    expect(result.coverageScore).toBe(15);
    expect(result.healthScore).toBe(47);
  });
});
