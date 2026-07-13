/**
 * Unit tests for the metrics-cache key versioning + language threading (P1 #4/#5).
 *
 * The global L1 `keyword_metrics_cache` is keyed on `(keyword, database_region)`
 * where `database_region` is the provider's `cacheRegion` token. Before P1 that
 * token was geo-only (language-blind, cross-workspace) — a non-US/non-en flag-ON
 * workspace could read/write rows a flag-OFF or other-geo workspace consumes.
 * K3b's metrics-only token folds language + the keyword-identity generation so distinct
 * (locationCode, language) yields a distinct cache key.
 *
 * The "language is threaded, not the literal 'en'" behavior is asserted in
 * tests/unit/dataforseo-provider.test.ts via fetch-body mocks (behavior, not
 * source-text sniffing).
 */
import { describe, expect, it } from 'vitest';
import { keywordMetricsCacheRegionToken } from '../../server/providers/dataforseo-provider.js';

describe('keyword metrics cache-key versioning + language', () => {
  it('a distinct (locationCode, language) yields a distinct cache key', () => {
    const usEn = keywordMetricsCacheRegionToken('2840', 'en');
    const usEs = keywordMetricsCacheRegionToken('2840', 'es');
    const ukEn = keywordMetricsCacheRegionToken('2826', 'en');

    // Same geo, different language → different key.
    expect(usEs).not.toBe(usEn);
    // Same language, different geo → different key.
    expect(ukEn).not.toBe(usEn);
    // All three are mutually distinct.
    expect(new Set([usEn, usEs, ukEn]).size).toBe(3);
  });

  it('is versioned so legacy language-blind rows are not consumed', () => {
    expect(keywordMetricsCacheRegionToken('2840', 'en')).toMatch(/^v3:kid-v2:/);
    // The legacy unversioned region ('2840' alone) is NOT the new key.
    expect(keywordMetricsCacheRegionToken('2840', 'en')).not.toBe('2840');
  });

  it('defaults the language to en and normalizes case/whitespace', () => {
    expect(keywordMetricsCacheRegionToken('2840')).toBe(keywordMetricsCacheRegionToken('2840', 'en'));
    expect(keywordMetricsCacheRegionToken('2840', '  EN ')).toBe(keywordMetricsCacheRegionToken('2840', 'en'));
  });
});
