/**
 * Wave 24-A21 — Pure unit tests for server/keyword-intelligence/rules.ts
 *
 * Covers functions not tested in keyword-intelligence-rules.test.ts:
 *   - keywordTokens
 *   - wordOverlapRatio
 *   - findKeywordMatches
 *   - describeMatches
 *   - inferBroadMismatchPenalty
 *   - buildBusinessTerms
 *   - inferBusinessFit
 *   - KEYWORD_STOP_WORDS constant
 *
 * All functions are pure (no DB, no I/O). No mocking required.
 */

import { describe, expect, it } from 'vitest';
import {
  KEYWORD_STOP_WORDS,
  buildBusinessTerms,
  describeMatches,
  findKeywordMatches,
  inferBroadMismatchPenalty,
  inferBusinessFit,
  keywordTokens,
  wordOverlapRatio,
} from '../../server/keyword-intelligence/index.js';

// ════════════════════════════════════════════════════════════════════════════
// KEYWORD_STOP_WORDS
// ════════════════════════════════════════════════════════════════════════════

describe('KEYWORD_STOP_WORDS', () => {
  it('contains the expected common stop words', () => {
    expect(KEYWORD_STOP_WORDS.has('the')).toBe(true);
    expect(KEYWORD_STOP_WORDS.has('and')).toBe(true);
    expect(KEYWORD_STOP_WORDS.has('for')).toBe(true);
    expect(KEYWORD_STOP_WORDS.has('in')).toBe(true);
    expect(KEYWORD_STOP_WORDS.has('near')).toBe(true);
    expect(KEYWORD_STOP_WORDS.has('of')).toBe(true);
  });

  it('does not contain meaningful business terms', () => {
    expect(KEYWORD_STOP_WORDS.has('seo')).toBe(false);
    expect(KEYWORD_STOP_WORDS.has('agency')).toBe(false);
    expect(KEYWORD_STOP_WORDS.has('consulting')).toBe(false);
  });

  it('is a Set instance', () => {
    expect(KEYWORD_STOP_WORDS).toBeInstanceOf(Set);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// keywordTokens
// ════════════════════════════════════════════════════════════════════════════

describe('keywordTokens', () => {
  it('splits a multi-word keyword into tokens', () => {
    const tokens = keywordTokens('seo consulting services');
    expect(tokens).toEqual(['seo', 'consulting', 'services']);
  });

  it('filters out stop words', () => {
    const tokens = keywordTokens('seo for small businesses');
    expect(tokens).not.toContain('for');
    expect(tokens).toContain('seo');
    expect(tokens).toContain('small');
    expect(tokens).toContain('businesses');
  });

  it('filters out single-character tokens', () => {
    const tokens = keywordTokens('a b seo agency');
    expect(tokens).not.toContain('a');
    expect(tokens).not.toContain('b');
    expect(tokens).toContain('seo');
    expect(tokens).toContain('agency');
  });

  it('normalizes case before tokenizing', () => {
    const tokens = keywordTokens('SEO Consulting Agency');
    expect(tokens).toEqual(['seo', 'consulting', 'agency']);
  });

  it('handles extra whitespace', () => {
    const tokens = keywordTokens('  seo   agency  ');
    expect(tokens).toContain('seo');
    expect(tokens).toContain('agency');
    expect(tokens).not.toContain('');
  });

  it('returns empty array for a stop-word-only phrase', () => {
    const tokens = keywordTokens('the and for in');
    expect(tokens).toHaveLength(0);
  });

  it('returns empty array for empty string', () => {
    expect(keywordTokens('')).toHaveLength(0);
  });

  it('handles punctuation by stripping it via normalization', () => {
    const tokens = keywordTokens('seo-consulting!!');
    expect(tokens).toContain('seo');
    expect(tokens).toContain('consulting');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// wordOverlapRatio
// ════════════════════════════════════════════════════════════════════════════

describe('wordOverlapRatio', () => {
  it('returns 1.0 for identical keywords', () => {
    expect(wordOverlapRatio('seo consulting', 'seo consulting')).toBe(1);
  });

  it('returns 0 for completely disjoint keywords', () => {
    expect(wordOverlapRatio('dental implants', 'web design agency')).toBe(0);
  });

  it('returns a partial ratio for overlapping keywords', () => {
    // "seo agency" vs "seo consulting agency" → shared: seo, agency → intersection=2, union=3
    const ratio = wordOverlapRatio('seo agency', 'seo consulting agency');
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(1);
    expect(ratio).toBeCloseTo(2 / 3, 5);
  });

  it('returns 0 when either string produces no meaningful tokens', () => {
    expect(wordOverlapRatio('the and for', 'seo agency')).toBe(0);
    expect(wordOverlapRatio('seo agency', 'the and for')).toBe(0);
  });

  it('is commutative (order does not matter)', () => {
    const ab = wordOverlapRatio('keyword research tools', 'seo keyword tools');
    const ba = wordOverlapRatio('seo keyword tools', 'keyword research tools');
    expect(ab).toBeCloseTo(ba, 10);
  });

  it('handles single matching token correctly', () => {
    // "seo" vs "seo agency" → shared: seo → intersection=1, union=2
    const ratio = wordOverlapRatio('seo', 'seo agency');
    expect(ratio).toBeCloseTo(0.5, 5);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// findKeywordMatches
// ════════════════════════════════════════════════════════════════════════════

describe('findKeywordMatches', () => {
  it('returns exact match', () => {
    const matches = findKeywordMatches('seo agency', ['seo agency', 'web design']);
    expect(matches).toContain('seo agency');
  });

  it('returns near-duplicate match', () => {
    // "seo consulting services" is a near-dup of "seo consulting"
    const matches = findKeywordMatches('seo consulting services', ['seo consulting', 'web design']);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toBe('seo consulting');
  });

  it('returns empty array when no match found', () => {
    const matches = findKeywordMatches('dental implants', ['seo agency', 'web design']);
    expect(matches).toHaveLength(0);
  });

  it('respects maxMatches limit', () => {
    const phrases = [
      'seo agency services',
      'seo agency consulting',
      'seo agency firm',
      'seo agency help',
    ];
    const matches = findKeywordMatches('seo agency', phrases, 2);
    expect(matches.length).toBeLessThanOrEqual(2);
  });

  it('handles empty phrases array', () => {
    expect(findKeywordMatches('seo agency', [])).toHaveLength(0);
  });

  it('skips falsy/empty phrase entries', () => {
    // Passing empty strings in the array should not throw or match
    const matches = findKeywordMatches('seo agency', ['', 'seo agency']);
    expect(matches).toContain('seo agency');
  });

  it('does not match single-token keyword against multi-token phrase via near-dup', () => {
    // Single-token keyword "seo" vs multi-token phrase "seo consulting agency"
    // findKeywordMatches only matches by near-dup when both have >1 token
    // or by exact normalized equality. "seo" normalizes to "seo"; "seo consulting agency" → different.
    const matches = findKeywordMatches('seo', ['seo consulting agency']);
    // No match expected: single-token/multi-token guard in findKeywordMatches
    expect(matches).toHaveLength(0);
  });

  it('matches by high word overlap ratio (≥0.6) for multi-token keywords', () => {
    // "seo audit services" vs "seo audit tools" → overlap: seo, audit → 2/4 = 0.5 → below threshold
    // "seo audit tools" vs "seo audit tool services" → overlap: seo, audit, tool(s)? Let's use a clear case
    // "keyword research guide" vs "keyword research tutorial" → seo keyword, research = 2/4 = 0.5 no
    // "local seo agency" vs "local seo firm agency" → local, seo, agency = 3/4 = 0.75 → match
    const matches = findKeywordMatches('local seo agency', ['local seo firm agency']);
    expect(matches).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// describeMatches
// ════════════════════════════════════════════════════════════════════════════

describe('describeMatches', () => {
  it('returns empty string for empty matches array', () => {
    expect(describeMatches('approved', [])).toBe('');
  });

  it('returns label + single match for one item', () => {
    expect(describeMatches('matches', ['seo agency'])).toBe('matches: seo agency');
  });

  it('returns label + first match + count for two items', () => {
    expect(describeMatches('declined', ['seo agency', 'web design'])).toBe(
      'declined: seo agency + 1 more',
    );
  });

  it('returns label + first match + count for three items', () => {
    expect(describeMatches('priority', ['seo', 'consulting', 'agency'])).toBe(
      'priority: seo + 2 more',
    );
  });

  it('correctly reports the number of additional matches (N-1)', () => {
    const matches = ['a', 'b', 'c', 'd', 'e'];
    const result = describeMatches('label', matches);
    expect(result).toContain('+ 4 more');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// inferBroadMismatchPenalty
// ════════════════════════════════════════════════════════════════════════════

describe('inferBroadMismatchPenalty', () => {
  it('returns 0 when no seed keyword is provided', () => {
    expect(inferBroadMismatchPenalty(undefined, 'seo agency')).toBe(0);
  });

  it('returns 0 when seed keyword has fewer than 2 meaningful tokens', () => {
    // Single token seed → no penalty
    expect(inferBroadMismatchPenalty('seo', 'seo agency')).toBe(0);
  });

  it('returns 0 when candidate has no meaningful tokens', () => {
    expect(inferBroadMismatchPenalty('seo consulting services', 'the and for')).toBe(0);
  });

  it('returns 12 when candidate is shorter AND has moderate overlap with the seed', () => {
    // "seo consulting agency nyc" (4 tokens) vs "seo consulting" (2 tokens)
    // candidateShorter: 2+1=3 < 4 → true; overlap: seo, consulting → 2/4=0.5 ≥ 0.34 → true → 12
    const penalty = inferBroadMismatchPenalty('seo consulting agency nyc', 'seo consulting');
    expect(penalty).toBe(12);
  });

  it('returns 10 when candidate has ≤2 tokens and low overlap', () => {
    // Seed: "technical seo audit services" (4 tokens)
    // Candidate: "dental implants" (2 tokens) → overlap ~0 → penalty 10
    const penalty = inferBroadMismatchPenalty('technical seo audit services', 'dental implants');
    expect(penalty).toBe(10);
  });

  it('returns 0 for a close match with good token overlap', () => {
    // "technical seo audit" (3 tokens) vs "technical seo audit services" (4 tokens)
    // candidateShorter: 4+1=5 > 3 → false; candidateTokens.length=4 > 2; overlap high → 0
    const penalty = inferBroadMismatchPenalty('technical seo audit', 'technical seo audit services');
    expect(penalty).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// buildBusinessTerms
// ════════════════════════════════════════════════════════════════════════════

describe('buildBusinessTerms', () => {
  it('returns empty array for empty context', () => {
    expect(buildBusinessTerms({})).toHaveLength(0);
  });

  it('extracts tokens from businessTerms', () => {
    const terms = buildBusinessTerms({ businessTerms: ['SEO consulting agency'] });
    expect(terms).toContain('seo');
    expect(terms).toContain('consulting');
    expect(terms).toContain('agency');
  });

  it('deduplicates repeated tokens across context arrays', () => {
    const terms = buildBusinessTerms({
      businessTerms: ['SEO agency'],
      businessPhrases: ['SEO consulting'],
      businessPriorities: ['agency growth'],
    });
    // "seo" appears in businessTerms and businessPhrases → should appear once
    const seoCount = terms.filter(t => t === 'seo').length;
    expect(seoCount).toBe(1);
  });

  it('combines all five context arrays', () => {
    const terms = buildBusinessTerms({
      businessTerms: ['seo'],
      businessPhrases: ['consulting'],
      businessPriorities: ['agency'],
      contentGapTopics: ['content strategy'],
      recentChatTopics: ['keyword research'],
    });
    expect(terms).toContain('seo');
    expect(terms).toContain('consulting');
    expect(terms).toContain('agency');
    expect(terms).toContain('content');
    expect(terms).toContain('strategy');
    expect(terms).toContain('keyword');
    expect(terms).toContain('research');
  });

  it('filters out stop words from phrases', () => {
    const terms = buildBusinessTerms({ businessTerms: ['SEO for the agencies'] });
    expect(terms).not.toContain('for');
    expect(terms).not.toContain('the');
    expect(terms).toContain('seo');
    expect(terms).toContain('agencies');
  });

  it('returns unique tokens only (Set semantics)', () => {
    const terms = buildBusinessTerms({
      businessTerms: ['keyword research tools'],
      businessPhrases: ['keyword research guide'],
    });
    const keywordCount = terms.filter(t => t === 'keyword').length;
    const researchCount = terms.filter(t => t === 'research').length;
    expect(keywordCount).toBe(1);
    expect(researchCount).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// inferBusinessFit
// ════════════════════════════════════════════════════════════════════════════

describe('inferBusinessFit', () => {
  it('returns score=0 and empty matches when context has no business terms', () => {
    const result = inferBusinessFit('seo agency', {});
    expect(result.score).toBe(0);
    expect(result.matches).toHaveLength(0);
  });

  it('returns higher score when keyword tokens all match business context', () => {
    const ctx = { businessTerms: ['seo consulting agency platform'] };
    const result = inferBusinessFit('seo consulting', ctx);
    expect(result.score).toBeGreaterThan(0);
    expect(result.matches).toContain('seo');
    expect(result.matches).toContain('consulting');
  });

  it('returns score=0 for keyword with no overlap with business terms', () => {
    const ctx = { businessTerms: ['dental implants cosmetic'] };
    const result = inferBusinessFit('seo agency', ctx);
    expect(result.score).toBe(0);
  });

  it('caps score at 1.0', () => {
    // Keyword that perfectly matches all business terms
    const ctx = {
      businessTerms: ['seo'],
      businessPhrases: ['consulting'],
      businessPriorities: ['agency'],
    };
    const result = inferBusinessFit('seo consulting agency', ctx);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('returns at most 5 unique matches', () => {
    const ctx = {
      businessTerms: ['apple banana cherry date elderberry fig grape'],
    };
    const result = inferBusinessFit('apple banana cherry date elderberry fig grape', ctx);
    expect(result.matches.length).toBeLessThanOrEqual(5);
  });

  it('handles partial overlap — only matching tokens are counted', () => {
    const ctx = { businessTerms: ['seo consulting agency analytics platform'] };
    // Keyword "seo analytics" has 2 matching tokens (seo, analytics)
    const result = inferBusinessFit('seo analytics', ctx);
    expect(result.matches).toContain('seo');
    expect(result.matches).toContain('analytics');
    expect(result.score).toBeGreaterThan(0);
  });

  it('returns unique matches (no duplicates)', () => {
    // "seo" appears in multiple context arrays, but matches should be unique
    const ctx = {
      businessTerms: ['seo platform'],
      businessPhrases: ['seo consulting'],
    };
    const result = inferBusinessFit('seo', ctx);
    const seoCount = result.matches.filter(m => m === 'seo').length;
    expect(seoCount).toBe(1);
  });
});
