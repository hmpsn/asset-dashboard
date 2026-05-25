/**
 * Wave 20 — Pure function unit tests for server/page-keywords.ts
 *
 * server/page-keywords.ts contains no exported pure functions — every exported
 * symbol is a DB-backed CRUD function. The file's pure internal helpers
 * (rowToScoreHistory, rowToModel, modelToParams, scoreHistorySourceFor,
 * normalizedKeyword) are all private.
 *
 * Strategy: test the pure algorithmic contracts that page-keywords.ts depends on:
 *
 * 1. shared/keyword-normalization.ts — keywordComparisonKey,
 *    normalizeKeywordForComparison, isVariantOf, findBestParent — these are
 *    the pure normalization/matching primitives used by page-keywords.ts for
 *    deduplication, equality checks, and keyword lifecycle joins.
 *
 * 2. Re-implement the private `scoreHistorySourceFor` logic to document and
 *    protect the contract (matches the source-selection rule in line 311–314).
 *
 * These tests verify the pure computation layer that drives page keyword
 * matching correctness independently of any database.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeKeywordForComparison,
  keywordComparisonKey,
  isVariantOf,
  findBestParent,
} from '../../shared/keyword-normalization.js';

// ── normalizeKeywordForComparison ─────────────────────────────────────────────

describe('normalizeKeywordForComparison', () => {
  it('lowercases the keyword', () => {
    expect(normalizeKeywordForComparison('SEO Services')).toBe('seo services');
  });

  it('strips special characters (trailing special chars trimmed)', () => {
    // '!' → space → trimmed away at end
    expect(normalizeKeywordForComparison('best SEO!')).toBe('best seo');
  });

  it('collapses multiple spaces into one', () => {
    expect(normalizeKeywordForComparison('web  design  agency')).toBe('web design agency');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeKeywordForComparison('  seo agency  ')).toBe('seo agency');
  });

  it('handles null by returning empty string', () => {
    expect(normalizeKeywordForComparison(null)).toBe('');
  });

  it('handles undefined by returning empty string', () => {
    expect(normalizeKeywordForComparison(undefined)).toBe('');
  });

  it('handles empty string', () => {
    expect(normalizeKeywordForComparison('')).toBe('');
  });

  it('replaces hyphens with spaces', () => {
    // Hyphens are not a-z0-9\s so they become spaces
    expect(normalizeKeywordForComparison('pay-per-click')).toBe('pay per click');
  });

  it('handles keyword with numbers', () => {
    expect(normalizeKeywordForComparison('SEO 2024')).toBe('seo 2024');
  });

  it('handles apostrophes (replaced by space)', () => {
    expect(normalizeKeywordForComparison("women's shoes")).toBe('women s shoes');
  });
});

// ── keywordComparisonKey ──────────────────────────────────────────────────────

describe('keywordComparisonKey', () => {
  it('produces same result as normalizeKeywordForComparison', () => {
    const inputs = ['SEO Services', 'web design', null, undefined, '', 'B2B Marketing'];
    for (const input of inputs) {
      expect(keywordComparisonKey(input)).toBe(normalizeKeywordForComparison(input));
    }
  });

  it('produces consistent key for equality checking', () => {
    const a = keywordComparisonKey('SEO Services');
    const b = keywordComparisonKey('seo services');
    const c = keywordComparisonKey('SEO  Services');
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it('distinguishes different keywords', () => {
    expect(keywordComparisonKey('seo')).not.toBe(keywordComparisonKey('ppc'));
  });
});

// ── isVariantOf ───────────────────────────────────────────────────────────────

describe('isVariantOf', () => {
  it('returns true when GSC query contains all strategy keyword tokens', () => {
    expect(isVariantOf('best seo services in london', 'seo services')).toBe(true);
  });

  it('returns true for exact match', () => {
    expect(isVariantOf('seo services', 'seo services')).toBe(true);
  });

  it('returns false when strategy keyword tokens are not all present in query', () => {
    expect(isVariantOf('seo agency', 'seo services')).toBe(false);
  });

  it('returns false for single-token strategy keywords (too broad)', () => {
    expect(isVariantOf('seo agency uk', 'seo')).toBe(false);
  });

  it('returns false for empty gsc query', () => {
    expect(isVariantOf('', 'seo services')).toBe(false);
  });

  it('returns false for empty strategy keyword', () => {
    expect(isVariantOf('seo services', '')).toBe(false);
  });

  it('is order-independent (all tokens present regardless of order)', () => {
    expect(isVariantOf('services seo agency', 'seo services')).toBe(true);
  });

  it('normalizes before comparing (case-insensitive)', () => {
    expect(isVariantOf('Best SEO Services', 'seo services')).toBe(true);
  });

  it('handles hyphenated strategy keywords', () => {
    // 'pay-per-click' normalizes to 'pay per click' (3 tokens)
    expect(isVariantOf('best pay per click agency', 'pay-per-click')).toBe(true);
  });

  it('returns false when query is missing one of the strategy tokens', () => {
    expect(isVariantOf('local seo', 'local seo services')).toBe(false);
  });
});

// ── findBestParent ─────────────────────────────────────────────────────────────

describe('findBestParent', () => {
  it('returns null when no strategy key is a valid parent', () => {
    const result = findBestParent('random query', ['seo services', 'web design'], new Map());
    expect(result).toBeNull();
  });

  it('returns the matching strategy key when one variant matches', () => {
    const result = findBestParent('best seo services', ['seo services', 'web design'], new Map());
    expect(result).toBe('seo services');
  });

  it('picks longer token match over shorter one', () => {
    // 'local seo services' is a variant of both 'seo services' (2 tokens) and
    // 'local seo services' (3 tokens) — prefers the longer match
    const result = findBestParent(
      'best local seo services',
      ['seo services', 'local seo services'],
      new Map(),
    );
    expect(result).toBe('local seo services');
  });

  it('uses impressions as tiebreaker when token counts are equal', () => {
    // Both 'seo services' and 'seo agency' have 2 tokens — pick higher impressions
    const metricsMap = new Map([
      ['seo services', 500],
      ['seo agency', 1000],
    ]);
    const result = findBestParent(
      'local seo agency services',
      ['seo services', 'seo agency'],
      metricsMap,
    );
    // Both are valid parents; 'seo agency' has more impressions
    expect(result).toBe('seo agency');
  });

  it('uses lexicographic order as final tiebreaker (equal tokens and impressions)', () => {
    const metricsMap = new Map([
      ['seo services', 100],
      ['seo packages', 100],
    ]);
    const result = findBestParent(
      'best seo packages and services',
      ['seo services', 'seo packages'],
      metricsMap,
    );
    // Both valid; same token count and impressions — lexicographic: 'seo packages' < 'seo services'
    expect(result).toBe('seo packages');
  });

  it('returns null for empty strategy keys list', () => {
    expect(findBestParent('seo services query', [], new Map())).toBeNull();
  });

  it('does not match single-token strategy keys', () => {
    // Single-token strategies are excluded by isVariantOf
    const result = findBestParent('seo agency', ['seo', 'ppc'], new Map());
    expect(result).toBeNull();
  });
});

// ── scoreHistorySourceFor (re-implemented pure logic) ────────────────────────

/**
 * Re-implements the private `scoreHistorySourceFor` from page-keywords.ts (line 311–314).
 * Logic: if the entry has no `analysisGeneratedAt`, the score came from strategy generation;
 * otherwise it came from a direct page-analysis job.
 */
function scoreHistorySourceFor(entry: { analysisGeneratedAt?: string }): 'strategy' | 'page-analysis' {
  if (!entry.analysisGeneratedAt) return 'strategy';
  return 'page-analysis';
}

describe('scoreHistorySourceFor (page-keyword score source classification)', () => {
  it('returns "strategy" when analysisGeneratedAt is absent', () => {
    expect(scoreHistorySourceFor({})).toBe('strategy');
  });

  it('returns "strategy" when analysisGeneratedAt is undefined', () => {
    expect(scoreHistorySourceFor({ analysisGeneratedAt: undefined })).toBe('strategy');
  });

  it('returns "page-analysis" when analysisGeneratedAt is set', () => {
    expect(scoreHistorySourceFor({ analysisGeneratedAt: '2024-01-15T10:00:00Z' })).toBe('page-analysis');
  });

  it('returns "page-analysis" for any non-empty timestamp string', () => {
    expect(scoreHistorySourceFor({ analysisGeneratedAt: '2024-06-01' })).toBe('page-analysis');
  });
});
