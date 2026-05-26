/**
 * Unit tests for shared/keyword-normalization.ts
 *
 * Covers: normalizeKeywordForComparison, keywordComparisonKey, isVariantOf, findBestParent
 */
import { describe, expect, it } from 'vitest';
import {
  normalizeKeywordForComparison,
  keywordComparisonKey,
  isVariantOf,
  findBestParent,
} from '../../shared/keyword-normalization.js';

// ─────────────────────────────────────────────────────────────────────────────
// normalizeKeywordForComparison
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeKeywordForComparison', () => {
  // ── null / undefined / empty ───────────────────────────────────────────────

  it('returns empty string for null', () => {
    expect(normalizeKeywordForComparison(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(normalizeKeywordForComparison(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(normalizeKeywordForComparison('')).toBe('');
  });

  // ── casing ─────────────────────────────────────────────────────────────────

  it('passes through already-lowercase strings unchanged', () => {
    expect(normalizeKeywordForComparison('seo agency')).toBe('seo agency');
  });

  it('lowercases uppercase input', () => {
    expect(normalizeKeywordForComparison('SEO AGENCY')).toBe('seo agency');
  });

  it('lowercases mixed-case input', () => {
    expect(normalizeKeywordForComparison('Best SEO Agency')).toBe('best seo agency');
  });

  it('lowercases a single uppercase word', () => {
    expect(normalizeKeywordForComparison('DENTIST')).toBe('dentist');
  });

  it('lowercases camelCase input', () => {
    expect(normalizeKeywordForComparison('teethWhitening')).toBe('teethwhitening');
  });

  // ── special characters → spaces ────────────────────────────────────────────

  it('replaces hyphens with spaces', () => {
    expect(normalizeKeywordForComparison('teeth-whitening')).toBe('teeth whitening');
  });

  it('replaces underscores with spaces', () => {
    expect(normalizeKeywordForComparison('seo_agency')).toBe('seo agency');
  });

  it('replaces forward slashes with spaces', () => {
    expect(normalizeKeywordForComparison('seo/ppc')).toBe('seo ppc');
  });

  it('replaces apostrophes with spaces', () => {
    // apostrophe → space, then "dentist s office" collapses to "dentist s office" (space around s)
    expect(normalizeKeywordForComparison("dentist's office")).toBe('dentist s office');
  });

  it('replaces parentheses with spaces (collapsed and trimmed)', () => {
    // '(' and ')' → spaces, then multiple spaces collapse and trim
    expect(normalizeKeywordForComparison('seo (agency)')).toBe('seo agency');
  });

  it('replaces dots with spaces', () => {
    expect(normalizeKeywordForComparison('seo.agency')).toBe('seo agency');
  });

  it('replaces multiple special chars', () => {
    expect(normalizeKeywordForComparison('teeth-whitening/bleaching')).toBe('teeth whitening bleaching');
  });

  it('handles a string that is all special characters → empty string', () => {
    expect(normalizeKeywordForComparison('---')).toBe('');
  });

  it('removes exclamation marks', () => {
    expect(normalizeKeywordForComparison('best dentist!')).toBe('best dentist');
  });

  it('removes question marks', () => {
    expect(normalizeKeywordForComparison('what is seo?')).toBe('what is seo');
  });

  it('removes commas (collapsed to single space)', () => {
    // 'seo, ppc, content' — comma → space, then " " + " " collapse to one space
    expect(normalizeKeywordForComparison('seo, ppc, content')).toBe('seo ppc content');
  });

  // ── whitespace collapsing ──────────────────────────────────────────────────

  it('collapses multiple spaces into one', () => {
    expect(normalizeKeywordForComparison('seo   agency')).toBe('seo agency');
  });

  it('trims leading whitespace', () => {
    expect(normalizeKeywordForComparison('  seo agency')).toBe('seo agency');
  });

  it('trims trailing whitespace', () => {
    expect(normalizeKeywordForComparison('seo agency  ')).toBe('seo agency');
  });

  it('trims both leading and trailing whitespace', () => {
    expect(normalizeKeywordForComparison('  seo agency  ')).toBe('seo agency');
  });

  it('collapses mixed-type whitespace (tab + spaces)', () => {
    expect(normalizeKeywordForComparison('seo\t\t agency')).toBe('seo agency');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeKeywordForComparison('   ')).toBe('');
  });

  // ── digits ─────────────────────────────────────────────────────────────────

  it('preserves numeric characters', () => {
    expect(normalizeKeywordForComparison('seo 2024')).toBe('seo 2024');
  });

  it('preserves all-digit string', () => {
    expect(normalizeKeywordForComparison('2024')).toBe('2024');
  });

  // ── combined cases ─────────────────────────────────────────────────────────

  it('handles mixed case + special chars + extra spaces', () => {
    expect(normalizeKeywordForComparison('  Best SEO-Agency!  ')).toBe('best seo agency');
  });

  it('normalises two equivalent representations to the same value', () => {
    const a = normalizeKeywordForComparison('Teeth Whitening');
    const b = normalizeKeywordForComparison('teeth-whitening');
    expect(a).toBe(b);
  });

  it('single-word keyword with no special chars is unchanged (besides lower)', () => {
    expect(normalizeKeywordForComparison('dentist')).toBe('dentist');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// keywordComparisonKey
// ─────────────────────────────────────────────────────────────────────────────

describe('keywordComparisonKey', () => {
  it('returns the same result as normalizeKeywordForComparison for null', () => {
    expect(keywordComparisonKey(null)).toBe(normalizeKeywordForComparison(null));
  });

  it('returns the same result as normalizeKeywordForComparison for undefined', () => {
    expect(keywordComparisonKey(undefined)).toBe(normalizeKeywordForComparison(undefined));
  });

  it('returns the same result as normalizeKeywordForComparison for empty string', () => {
    expect(keywordComparisonKey('')).toBe(normalizeKeywordForComparison(''));
  });

  it('returns the same result as normalizeKeywordForComparison for lowercase keyword', () => {
    const kw = 'seo agency';
    expect(keywordComparisonKey(kw)).toBe(normalizeKeywordForComparison(kw));
  });

  it('returns the same result as normalizeKeywordForComparison for mixed-case keyword', () => {
    const kw = 'Best Dentist Near Me';
    expect(keywordComparisonKey(kw)).toBe(normalizeKeywordForComparison(kw));
  });

  it('returns the same result as normalizeKeywordForComparison for hyphenated keyword', () => {
    const kw = 'teeth-whitening-austin';
    expect(keywordComparisonKey(kw)).toBe(normalizeKeywordForComparison(kw));
  });

  it('delegates to normalize — lowercases the input', () => {
    expect(keywordComparisonKey('DENTIST')).toBe('dentist');
  });

  it('delegates to normalize — collapses spaces', () => {
    expect(keywordComparisonKey('seo   ppc')).toBe('seo ppc');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isVariantOf
// ─────────────────────────────────────────────────────────────────────────────

describe('isVariantOf', () => {
  // ── exact match ────────────────────────────────────────────────────────────

  it('returns true for exact match (same tokens, same order)', () => {
    expect(isVariantOf('teeth whitening', 'teeth whitening')).toBe(true);
  });

  // ── superset match (extra tokens in query) ─────────────────────────────────

  it('returns true when gscQuery is a superset of strategyKeyword tokens', () => {
    expect(isVariantOf('teeth whitening austin', 'teeth whitening')).toBe(true);
  });

  it('returns true when query adds tokens at the start', () => {
    expect(isVariantOf('austin teeth whitening', 'teeth whitening')).toBe(true);
  });

  it('returns true when query adds tokens in the middle', () => {
    expect(isVariantOf('teeth professional whitening', 'teeth whitening')).toBe(true);
  });

  it('returns true when query adds multiple extra tokens', () => {
    expect(isVariantOf('best teeth whitening austin tx', 'teeth whitening')).toBe(true);
  });

  // ── order independence ─────────────────────────────────────────────────────

  it('returns true for order-independent token match', () => {
    expect(isVariantOf('whitening teeth austin', 'teeth whitening')).toBe(true);
  });

  it('returns true for reversed order of strategy tokens in query', () => {
    expect(isVariantOf('me near dentist', 'dentist near me')).toBe(true);
  });

  // ── case insensitivity ─────────────────────────────────────────────────────

  it('is case-insensitive in the query', () => {
    expect(isVariantOf('Teeth Whitening Austin', 'teeth whitening')).toBe(true);
  });

  it('is case-insensitive in the strategy keyword', () => {
    expect(isVariantOf('teeth whitening austin', 'Teeth Whitening')).toBe(true);
  });

  it('is case-insensitive in both', () => {
    expect(isVariantOf('TEETH WHITENING AUSTIN', 'Teeth Whitening')).toBe(true);
  });

  // ── single-token guard ─────────────────────────────────────────────────────

  it('returns false for single-token strategy keyword (guard against over-broad parenting)', () => {
    expect(isVariantOf('dentist austin', 'dentist')).toBe(false);
  });

  it('returns false for single-token strategy keyword even with exact match', () => {
    expect(isVariantOf('dentist', 'dentist')).toBe(false);
  });

  it('returns false for single-token strategy keyword that appears many times in query', () => {
    expect(isVariantOf('dentist dentist dentist', 'dentist')).toBe(false);
  });

  // ── missing token failure ──────────────────────────────────────────────────

  it('returns false when query is missing one strategy token', () => {
    expect(isVariantOf('teeth cleaning austin', 'teeth whitening')).toBe(false);
  });

  it('returns false when query is a proper subset of strategy keyword', () => {
    expect(isVariantOf('dentist', 'dentist near me')).toBe(false);
  });

  it('returns false when query shares only one of three strategy tokens', () => {
    expect(isVariantOf('dentist office hours', 'dentist near me')).toBe(false);
  });

  it('returns false when no tokens overlap at all', () => {
    expect(isVariantOf('plumber austin tx', 'teeth whitening')).toBe(false);
  });

  // ── empty inputs ───────────────────────────────────────────────────────────

  it('returns false for empty gscQuery', () => {
    expect(isVariantOf('', 'teeth whitening')).toBe(false);
  });

  it('returns false for empty strategyKeyword', () => {
    expect(isVariantOf('teeth whitening austin', '')).toBe(false);
  });

  it('returns false for both empty', () => {
    expect(isVariantOf('', '')).toBe(false);
  });

  // ── special characters normalized before comparison ────────────────────────

  it('handles hyphens in query — normalised to spaces for comparison', () => {
    expect(isVariantOf('teeth-whitening austin', 'teeth whitening')).toBe(true);
  });

  it('handles hyphens in strategy keyword — normalised to spaces for comparison', () => {
    expect(isVariantOf('teeth whitening austin', 'teeth-whitening')).toBe(true);
  });

  // ── three-token strategy ───────────────────────────────────────────────────

  it('returns true when all three strategy tokens appear in query', () => {
    expect(isVariantOf('best dentist near me in austin', 'dentist near me')).toBe(true);
  });

  it('returns false when only two of three strategy tokens appear in query', () => {
    expect(isVariantOf('dentist near austin', 'dentist near me')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// findBestParent
// ─────────────────────────────────────────────────────────────────────────────

describe('findBestParent', () => {
  const baseMetrics = new Map<string, number>([
    ['teeth whitening', 100],
    ['teeth cleaning', 50],
    ['dentist near me', 200],
    ['best dentist near me', 150],
  ]);

  // ── no matching parent ─────────────────────────────────────────────────────

  it('returns null when no strategy key matches the query', () => {
    const result = findBestParent('plumber austin', ['teeth whitening', 'teeth cleaning'], baseMetrics);
    expect(result).toBeNull();
  });

  it('returns null for empty strategyKeys array', () => {
    expect(findBestParent('teeth whitening austin', [], baseMetrics)).toBeNull();
  });

  it('returns null when the only key is single-token (guard applies)', () => {
    const result = findBestParent('dentist austin', ['dentist'], baseMetrics);
    expect(result).toBeNull();
  });

  it('returns null when query is empty string', () => {
    const result = findBestParent('', ['teeth whitening'], baseMetrics);
    expect(result).toBeNull();
  });

  // ── single matching parent ─────────────────────────────────────────────────

  it('returns the single matching strategy key', () => {
    const result = findBestParent('teeth whitening austin', ['teeth whitening'], baseMetrics);
    expect(result).toBe('teeth whitening');
  });

  it('returns the single matching key when metrics map is empty (0 impressions fallback)', () => {
    // 'teeth cleaning' does NOT match query 'teeth whitening austin' (no 'cleaning' token)
    // only 'teeth whitening' matches
    const emptyMetrics = new Map<string, number>();
    const result = findBestParent('teeth whitening austin', ['teeth whitening', 'teeth cleaning'], emptyMetrics);
    expect(result).toBe('teeth whitening');
  });

  // ── longer token match wins ────────────────────────────────────────────────

  it('prefers the strategy key with more matching tokens (longer wins)', () => {
    const result = findBestParent(
      'best dentist near me in austin',
      ['dentist near me', 'best dentist near me'],
      baseMetrics,
    );
    expect(result).toBe('best dentist near me'); // 4 tokens > 3 tokens
  });

  it('returns 3-token key over 2-token key when both match', () => {
    const result = findBestParent(
      'dentist near me austin',
      ['teeth whitening', 'dentist near me'],
      baseMetrics,
    );
    expect(result).toBe('dentist near me');
  });

  // ── impressions tie-breaker ────────────────────────────────────────────────

  it('tie-breaks on impressions when token counts are equal (higher impressions wins)', () => {
    const result = findBestParent(
      'teeth cleaning whitening',
      ['teeth whitening', 'teeth cleaning'],
      baseMetrics, // teeth whitening=100, teeth cleaning=50 → whitening wins
    );
    expect(result).toBe('teeth whitening');
  });

  it('tie-breaks correctly when second key has higher impressions', () => {
    const metrics = new Map([['teeth whitening', 30], ['teeth cleaning', 80]]);
    const result = findBestParent(
      'teeth cleaning whitening',
      ['teeth whitening', 'teeth cleaning'],
      metrics,
    );
    expect(result).toBe('teeth cleaning'); // 80 > 30
  });

  // ── lexicographic tie-breaker ──────────────────────────────────────────────

  it('tie-breaks lexicographically when token count and impressions are equal', () => {
    const tiedMetrics = new Map([['teeth whitening', 100], ['teeth cleaning', 100]]);
    const result = findBestParent(
      'teeth cleaning whitening',
      ['teeth whitening', 'teeth cleaning'],
      tiedMetrics,
    );
    // 'teeth cleaning' < 'teeth whitening' → lexicographic winner
    expect(result).toBe('teeth cleaning');
  });

  it('lexicographic tie-break is stable regardless of input array order', () => {
    const tiedMetrics = new Map([['teeth whitening', 100], ['teeth cleaning', 100]]);
    const r1 = findBestParent('teeth cleaning whitening', ['teeth whitening', 'teeth cleaning'], tiedMetrics);
    const r2 = findBestParent('teeth cleaning whitening', ['teeth cleaning', 'teeth whitening'], tiedMetrics);
    expect(r1).toBe(r2);
  });

  // ── metrics map absence ────────────────────────────────────────────────────

  it('uses 0 impressions for keys absent from metricsMap when resolving a tie', () => {
    const metrics = new Map([['teeth whitening', 0]]); // cleaning absent → defaults to 0
    const result = findBestParent('teeth cleaning whitening', ['teeth whitening', 'teeth cleaning'], metrics);
    // Both have 0 impressions, 2 tokens — lexicographic: 'teeth cleaning' < 'teeth whitening'
    expect(result).toBe('teeth cleaning');
  });

  // ── case insensitivity via normalization ───────────────────────────────────

  it('matches case-insensitively via normalization', () => {
    const result = findBestParent(
      'TEETH WHITENING AUSTIN',
      ['teeth whitening'],
      baseMetrics,
    );
    expect(result).toBe('teeth whitening');
  });

  // ── multiple matching with clear winner ────────────────────────────────────

  it('handles multiple matching parents and picks the longest-token match', () => {
    const metrics = new Map([
      ['teeth whitening', 100],
      ['teeth whitening austin', 80],
      ['teeth whitening austin tx', 60],
    ]);
    const result = findBestParent(
      'teeth whitening austin tx special',
      ['teeth whitening', 'teeth whitening austin', 'teeth whitening austin tx'],
      metrics,
    );
    expect(result).toBe('teeth whitening austin tx'); // 4 tokens beats 3 and 2
  });
});
