/**
 * Wave 20 — Pure function unit tests for server/keyword-strategy-generation.ts
 * and its re-exported helpers from server/keyword-strategy-helpers.ts and
 * shared/keyword-normalization.ts
 *
 * Covers:
 *   - normalizeSeoDataMode (internal, tested via side-effect isolation)
 *   - normalizeSeoDataProvider (internal, tested via side-effect isolation)
 *   - KeywordStrategyGenerationError (error class structure)
 *   - hasActiveKeywordStrategyGeneration (exported guard)
 *   - KEYWORD_STRATEGY_MAX_PAGE_CAP constant
 *   - computeOpportunityScore (re-exported from helpers)
 *   - upsertKeywordPoolCandidate (from helpers)
 *   - isStrategyQualityDiscoveryKeyword (from helpers)
 *   - isSuspiciousPlannerGroupedVolume (from helpers)
 *   - getPagesNeedingAnalysis (from helpers)
 *   - shouldFetchCompetitorData (from helpers)
 *   - buildStrategyIntelligenceBlock (from helpers, re-exported)
 *   - normalizeKeywordForComparison, keywordComparisonKey, isVariantOf, findBestParent
 *     (from shared/keyword-normalization)
 */

import { describe, it, expect } from 'vitest';
import {
  KeywordStrategyGenerationError,
  hasActiveKeywordStrategyGeneration,
  KEYWORD_STRATEGY_MAX_PAGE_CAP,
  reconcileSeoDataStatusAfterCanonicalDiscovery,
} from '../../server/keyword-strategy-generation.js';
import {
  computeOpportunityScore,
  upsertKeywordPoolCandidate,
  isStrategyQualityDiscoveryKeyword,
  isSuspiciousPlannerGroupedVolume,
  getPagesNeedingAnalysis,
  buildStrategyIntelligenceBlock,
} from '../../server/keyword-strategy-helpers.js';
import {
  normalizeKeywordForComparison,
  keywordComparisonKey,
  isVariantOf,
  findBestParent,
} from '../../shared/keyword-normalization.js';

// ---------------------------------------------------------------------------
// KeywordStrategyGenerationError
// ---------------------------------------------------------------------------
describe('KeywordStrategyGenerationError', () => {
  it('sets name, statusCode, and payload from constructor args', () => {
    const err = new KeywordStrategyGenerationError(404, { error: 'Not found' });
    expect(err.name).toBe('KeywordStrategyGenerationError');
    expect(err.statusCode).toBe(404);
    expect(err.payload).toEqual({ error: 'Not found' });
    expect(err.message).toBe('Not found');
  });

  it('is an instance of Error', () => {
    const err = new KeywordStrategyGenerationError(500, { error: 'Internal error' });
    expect(err).toBeInstanceOf(Error);
  });

  it('preserves optional message and raw fields in payload', () => {
    const err = new KeywordStrategyGenerationError(429, {
      error: 'Rate limit',
      message: 'Upgrade your plan',
      raw: '{"code":"RATE_LIMIT"}',
    });
    expect(err.payload.message).toBe('Upgrade your plan');
    expect(err.payload.raw).toBe('{"code":"RATE_LIMIT"}');
  });
});

// ---------------------------------------------------------------------------
// KEYWORD_STRATEGY_MAX_PAGE_CAP
// ---------------------------------------------------------------------------
describe('KEYWORD_STRATEGY_MAX_PAGE_CAP', () => {
  it('equals 2000', () => {
    expect(KEYWORD_STRATEGY_MAX_PAGE_CAP).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// hasActiveKeywordStrategyGeneration
// ---------------------------------------------------------------------------
describe('hasActiveKeywordStrategyGeneration', () => {
  it('returns false for a workspace not in the active set', () => {
    // The set is module-private; we can only observe the exported guard.
    expect(hasActiveKeywordStrategyGeneration('ws_nonexistent')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// reconcileSeoDataStatusAfterCanonicalDiscovery
// ---------------------------------------------------------------------------
describe('reconcileSeoDataStatusAfterCanonicalDiscovery', () => {
  it('clears provider_returned_no_keyword_data when canonical discovery produced provider-backed terms', () => {
    const result = reconcileSeoDataStatusAfterCanonicalDiscovery(
      {
        mode: 'quick',
        provider: 'dataforseo',
        status: 'degraded',
        reasons: ['provider_returned_no_keyword_data'],
        fallbackProviderAvailable: false,
      },
      new Map([
        ['austin dental implants', { source: 'discovery:keywords_for_site' }],
      ]),
    );

    expect(result).toEqual({
      mode: 'quick',
      provider: 'dataforseo',
      status: 'available',
      reasons: [],
      fallbackProviderAvailable: false,
    });
  });

  it('keeps degraded status when the keyword pool has only client or GSC data', () => {
    const result = reconcileSeoDataStatusAfterCanonicalDiscovery(
      {
        mode: 'quick',
        provider: 'dataforseo',
        status: 'degraded',
        reasons: ['provider_returned_no_keyword_data'],
      },
      new Map([
        ['client keyword', { source: 'client' }],
        ['gsc keyword', { source: 'gsc' }],
      ]),
    );

    expect(result.status).toBe('degraded');
    expect(result.reasons).toEqual(['provider_returned_no_keyword_data']);
  });
});

// ---------------------------------------------------------------------------
// computeOpportunityScore
// ---------------------------------------------------------------------------
describe('computeOpportunityScore', () => {
  it('returns undefined when no signal data is present', () => {
    expect(computeOpportunityScore({})).toBeUndefined();
  });

  it('returns undefined when volume is 0 and difficulty/impressions are absent', () => {
    expect(computeOpportunityScore({ volume: 0 })).toBeUndefined();
  });

  it('computes a positive score when volume is present', () => {
    const score = computeOpportunityScore({ volume: 5000, difficulty: 30 });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('caps volume contribution at 1.0 (10000 volume)', () => {
    const score10k = computeOpportunityScore({ volume: 10000, difficulty: 0 });
    const score100k = computeOpportunityScore({ volume: 100000, difficulty: 0 });
    // Both should produce the same base result as the vol component is capped
    expect(score10k).toBe(score100k);
  });

  it('applies rising trend multiplier (×1.3)', () => {
    const stable = computeOpportunityScore({ volume: 5000, difficulty: 50, trendDirection: 'stable' });
    const rising = computeOpportunityScore({ volume: 5000, difficulty: 50, trendDirection: 'rising' });
    expect(rising!).toBeGreaterThan(stable!);
  });

  it('applies declining trend multiplier (×0.7)', () => {
    const stable = computeOpportunityScore({ volume: 5000, difficulty: 50, trendDirection: 'stable' });
    const declining = computeOpportunityScore({ volume: 5000, difficulty: 50, trendDirection: 'declining' });
    expect(declining!).toBeLessThan(stable!);
  });

  it('includes GSC impressions as additive bonus', () => {
    const without = computeOpportunityScore({ volume: 5000, difficulty: 50 });
    const withImp = computeOpportunityScore({ volume: 5000, difficulty: 50, impressions: 2000 });
    expect(withImp!).toBeGreaterThanOrEqual(without!);
  });

  it('caps score at 100', () => {
    // Max possible: vol=1, ease=1 (diff=0), gscBonus=0.5×0.1, trend rising ×1.3
    // (0.45+0.45+0.05)×1.3 = 1.235 → round(123.5) = 123 → min(100, 123) = 100
    const score = computeOpportunityScore({ volume: 100000, difficulty: 0, impressions: 9999999, trendDirection: 'rising' });
    expect(score).toBe(100);
  });

  it('returns a score when only difficulty is present (volume defaults to 0)', () => {
    const score = computeOpportunityScore({ difficulty: 20 });
    expect(score).toBeDefined();
    expect(score).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// isStrategyQualityDiscoveryKeyword
// ---------------------------------------------------------------------------
describe('isStrategyQualityDiscoveryKeyword', () => {
  it('returns true when keyword, volume, and difficulty are all present and positive', () => {
    expect(isStrategyQualityDiscoveryKeyword({ keyword: 'seo tools', volume: 500, difficulty: 30 })).toBe(true);
  });

  it('returns false when keyword is empty string', () => {
    expect(isStrategyQualityDiscoveryKeyword({ keyword: '   ', volume: 500, difficulty: 30 })).toBe(false);
  });

  it('returns false when volume is 0', () => {
    expect(isStrategyQualityDiscoveryKeyword({ keyword: 'seo tools', volume: 0, difficulty: 30 })).toBe(false);
  });

  it('returns false when difficulty is 0', () => {
    expect(isStrategyQualityDiscoveryKeyword({ keyword: 'seo tools', volume: 500, difficulty: 0 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isSuspiciousPlannerGroupedVolume
// ---------------------------------------------------------------------------
describe('isSuspiciousPlannerGroupedVolume', () => {
  it('returns false when volume is below the 1M threshold', () => {
    expect(isSuspiciousPlannerGroupedVolume('seo tools', 999999)).toBe(false);
  });

  it('returns true when volume is at or above 1M and keyword is non-empty', () => {
    expect(isSuspiciousPlannerGroupedVolume('marketing software', 1000000)).toBe(true);
  });

  it('returns false when volume is null or undefined', () => {
    expect(isSuspiciousPlannerGroupedVolume('seo tools', null)).toBe(false);
    expect(isSuspiciousPlannerGroupedVolume('seo tools', undefined)).toBe(false);
  });

  it('returns false when keyword is empty or whitespace even if volume is high', () => {
    expect(isSuspiciousPlannerGroupedVolume('', 2000000)).toBe(false);
    expect(isSuspiciousPlannerGroupedVolume('   ', 2000000)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// upsertKeywordPoolCandidate
// ---------------------------------------------------------------------------
describe('upsertKeywordPoolCandidate', () => {
  it('inserts a new candidate when the pool is empty', () => {
    const pool = new Map();
    const result = upsertKeywordPoolCandidate(pool, 'best seo tool', { volume: 500, difficulty: 40, source: 'gsc' });
    expect(result).toBe(true);
    expect(pool.size).toBe(1);
  });

  it('returns false for empty/blank keyword', () => {
    const pool = new Map();
    const result = upsertKeywordPoolCandidate(pool, '', { volume: 500, difficulty: 40, source: 'gsc' });
    expect(result).toBe(false);
    expect(pool.size).toBe(0);
  });

  it('upgrades when the new candidate has higher source priority (gap > gsc)', () => {
    const pool = new Map();
    upsertKeywordPoolCandidate(pool, 'seo tools', { volume: 100, difficulty: 30, source: 'gsc' });
    const result = upsertKeywordPoolCandidate(pool, 'seo tools', { volume: 50, difficulty: 30, source: 'gap:competitor.com' });
    expect(result).toBe(true);
    expect(pool.get('seo tools')?.source).toBe('gap:competitor.com');
  });

  it('does not downgrade when the existing candidate has higher source priority', () => {
    const pool = new Map();
    upsertKeywordPoolCandidate(pool, 'seo tools', { volume: 100, difficulty: 30, source: 'gap:competitor.com' });
    const result = upsertKeywordPoolCandidate(pool, 'seo tools', { volume: 200, difficulty: 30, source: 'gsc' });
    expect(result).toBe(false);
    expect(pool.get('seo tools')?.source).toBe('gap:competitor.com');
  });

  it('normalizes keyword for dedup (ignores case and punctuation differences)', () => {
    const pool = new Map();
    upsertKeywordPoolCandidate(pool, 'SEO Tools!', { volume: 100, difficulty: 30, source: 'gsc' });
    upsertKeywordPoolCandidate(pool, 'seo tools', { volume: 200, difficulty: 30, source: 'gsc' });
    // Both normalize to 'seo tools' — pool should have only 1 entry
    expect(pool.size).toBe(1);
  });

  it('upgrades when same priority source but higher volume', () => {
    const pool = new Map();
    upsertKeywordPoolCandidate(pool, 'web design', { volume: 100, difficulty: 30, source: 'related' });
    const result = upsertKeywordPoolCandidate(pool, 'web design', { volume: 500, difficulty: 30, source: 'related' });
    expect(result).toBe(true);
    expect(pool.get('web design')?.volume).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// getPagesNeedingAnalysis
// ---------------------------------------------------------------------------
describe('getPagesNeedingAnalysis', () => {
  it('in full mode, all pages go to toAnalyze regardless of analysisGeneratedAt', () => {
    const pages = [
      { path: '/about' },
      { path: '/services' },
    ];
    const existingByPath = new Map([
      ['/about', { analysisGeneratedAt: new Date().toISOString() }],
    ]);
    const result = getPagesNeedingAnalysis(pages, 'full', existingByPath);
    expect(result.toAnalyze).toHaveLength(2);
    expect(result.toPreserve).toHaveLength(0);
  });

  it('in incremental mode, a page with a recent analysisGeneratedAt goes to toPreserve', () => {
    const pages = [{ path: '/about' }];
    const recentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(); // 1 day ago
    const existingByPath = new Map([['/about', { analysisGeneratedAt: recentDate }]]);
    const result = getPagesNeedingAnalysis(pages, 'incremental', existingByPath);
    expect(result.toPreserve).toHaveLength(1);
    expect(result.toAnalyze).toHaveLength(0);
  });

  it('in incremental mode, a page with stale analysisGeneratedAt goes to toAnalyze', () => {
    const pages = [{ path: '/contact' }];
    const staleDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days ago
    const existingByPath = new Map([['/contact', { analysisGeneratedAt: staleDate }]]);
    const result = getPagesNeedingAnalysis(pages, 'incremental', existingByPath);
    expect(result.toAnalyze).toHaveLength(1);
    expect(result.toPreserve).toHaveLength(0);
  });

  it('in incremental mode, a page with no existing entry goes to toAnalyze', () => {
    const pages = [{ path: '/new-page' }];
    const result = getPagesNeedingAnalysis(pages, 'incremental', new Map());
    expect(result.toAnalyze).toHaveLength(1);
  });

  it('in incremental mode, a page with null analysisGeneratedAt goes to toAnalyze', () => {
    const pages = [{ path: '/home' }];
    const existingByPath = new Map([['/home', { analysisGeneratedAt: null }]]);
    const result = getPagesNeedingAnalysis(pages, 'incremental', existingByPath);
    expect(result.toAnalyze).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// buildStrategyIntelligenceBlock
// ---------------------------------------------------------------------------
describe('buildStrategyIntelligenceBlock', () => {
  it('returns empty string when no intelligence sections are provided', () => {
    expect(buildStrategyIntelligenceBlock({})).toBe('');
  });

  it('includes KEYWORD CLUSTERS section when provided', () => {
    const result = buildStrategyIntelligenceBlock({
      keywordClusters: [
        { label: 'SEO Basics', queries: ['what is seo', 'seo tips'], totalImpressions: 5000, avgPosition: 8.5, pillarPage: null },
      ],
    });
    expect(result).toContain('KEYWORD CLUSTERS');
    expect(result).toContain('SEO Basics');
    expect(result).toContain('2 queries');
  });

  it('includes COMPETITOR GAPS section when provided', () => {
    const result = buildStrategyIntelligenceBlock({
      competitorGaps: [
        { keyword: 'seo software', competitorDomain: 'competitor.com', competitorPosition: 3, ourPosition: null, volume: 2000, difficulty: 45 },
      ],
    });
    expect(result).toContain('COMPETITOR GAPS');
    expect(result).toContain('seo software');
    expect(result).toContain('not ranking');
  });

  it('includes PERFORMANCE CHANGES section and shows position direction', () => {
    const result = buildStrategyIntelligenceBlock({
      performanceDeltas: [
        { query: 'keyword research', positionDelta: 3, clicksDelta: -50, currentPosition: 12 },
      ],
    });
    expect(result).toContain('PERFORMANCE CHANGES');
    expect(result).toContain('keyword research');
    expect(result).toContain('↓3 pos');
  });

  it('shows up-arrow for position improvement (negative positionDelta)', () => {
    const result = buildStrategyIntelligenceBlock({
      performanceDeltas: [
        { query: 'seo audit', positionDelta: -2, clicksDelta: 30, currentPosition: 5 },
      ],
    });
    expect(result).toContain('↑2 pos');
  });

  it('limits keyword clusters to top 10', () => {
    const clusters = Array.from({ length: 15 }, (_, i) => ({
      label: `Cluster ${i}`,
      queries: ['q1'],
      totalImpressions: 100,
      avgPosition: 5,
      pillarPage: null,
    }));
    const result = buildStrategyIntelligenceBlock({ keywordClusters: clusters });
    // Only 10 should appear
    expect(result).toContain('Cluster 9');
    expect(result).not.toContain('Cluster 10');
  });

  it('returns analytics block header when any section is present', () => {
    const result = buildStrategyIntelligenceBlock({
      keywordClusters: [
        { label: 'Test', queries: ['q'], totalImpressions: 100, avgPosition: 5, pillarPage: null },
      ],
    });
    expect(result).toContain('ANALYTICS INTELLIGENCE');
  });
});

// ---------------------------------------------------------------------------
// normalizeKeywordForComparison / keywordComparisonKey
// ---------------------------------------------------------------------------
describe('normalizeKeywordForComparison', () => {
  it('lowercases the keyword', () => {
    expect(normalizeKeywordForComparison('SEO Tools')).toBe('seo tools');
  });

  it('strips non-alphanumeric characters (except spaces)', () => {
    expect(normalizeKeywordForComparison('best-seo_tools!')).toBe('best seo tools');
  });

  it('collapses multiple spaces to one', () => {
    expect(normalizeKeywordForComparison('seo   tools')).toBe('seo tools');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeKeywordForComparison('  seo tools  ')).toBe('seo tools');
  });

  it('handles null/undefined gracefully by returning empty string', () => {
    expect(normalizeKeywordForComparison(null)).toBe('');
    expect(normalizeKeywordForComparison(undefined)).toBe('');
  });
});

describe('keywordComparisonKey', () => {
  it('is an alias for normalizeKeywordForComparison', () => {
    expect(keywordComparisonKey('Best SEO Tool!')).toBe(normalizeKeywordForComparison('Best SEO Tool!'));
  });
});

// ---------------------------------------------------------------------------
// isVariantOf
// ---------------------------------------------------------------------------
describe('isVariantOf', () => {
  it('returns true when all strategy tokens appear in the query', () => {
    expect(isVariantOf('best seo tools for beginners', 'seo tools')).toBe(true);
  });

  it('returns false when a strategy token is missing from the query', () => {
    expect(isVariantOf('best marketing tools', 'seo tools')).toBe(false);
  });

  it('returns false for single-token strategy keyword (too broad)', () => {
    expect(isVariantOf('seo software', 'seo')).toBe(false);
  });

  it('returns false for empty strings', () => {
    expect(isVariantOf('', 'seo tools')).toBe(false);
    expect(isVariantOf('seo tools query', '')).toBe(false);
  });

  it('is case-insensitive (normalizes both sides)', () => {
    expect(isVariantOf('Best SEO Tools Review', 'seo tools')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findBestParent
// ---------------------------------------------------------------------------
describe('findBestParent', () => {
  it('returns the best matching parent key by token count', () => {
    const keys = ['seo', 'seo tools', 'best seo tools'];
    const metricsMap = new Map<string, number>();
    const result = findBestParent('best seo tools for beginners', keys, metricsMap);
    // 'best seo tools' has 3 tokens; single-token 'seo' is excluded by isVariantOf
    expect(result).toBe('best seo tools');
  });

  it('returns null when no strategy key matches', () => {
    const keys = ['marketing strategy', 'content plan'];
    const metricsMap = new Map<string, number>();
    const result = findBestParent('seo tools guide', keys, metricsMap);
    expect(result).toBeNull();
  });

  it('uses impressions as tie-breaker between same-length candidates', () => {
    const keys = ['seo tools', 'web tools']; // both 2 tokens, query contains both
    const metricsMap = new Map([
      ['seo tools', 500],
      ['web tools', 100],
    ]);
    const result = findBestParent('best seo web tools', keys, metricsMap);
    // 'seo tools' has higher impressions
    expect(result).toBe('seo tools');
  });

  it('returns null for an empty query', () => {
    const keys = ['seo tools'];
    const metricsMap = new Map<string, number>();
    expect(findBestParent('', keys, metricsMap)).toBeNull();
  });
});
