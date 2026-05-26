import { describe, expect, it } from 'vitest';
import {
  evaluateKeywordCandidate,
  findKeywordMatches,
  inferBroadMismatchPenalty,
  isStrategyPoolEligibleKeyword,
  keywordTokens,
  normalizeKeyword,
  wordOverlapRatio,
} from '../../server/keyword-intelligence/rules.js';

describe('keyword rules normalization and branch behavior', () => {
  it('normalizes punctuation/spacing and removes stop words + one-char tokens', () => {
    expect(normalizeKeyword('  SEO---for A/B  Testing!!!  ')).toBe('seo for a b testing');
    expect(keywordTokens('SEO for A/B testing in 2026')).toEqual(['seo', 'testing', '2026']);
  });

  it('gates near-duplicate matching for single-token phrases in findKeywordMatches', () => {
    const matches = findKeywordMatches('roofing company near me', ['roofing', 'roofing company', 'hvac repair'], 3);

    expect(matches).toEqual(['roofing company']);
    expect(matches).not.toContain('roofing');
  });

  it('applies broad mismatch penalties only for materially broader/adjacent candidates', () => {
    expect(inferBroadMismatchPenalty('enterprise seo analytics platform', 'seo analytics')).toBe(12);
    expect(inferBroadMismatchPenalty('enterprise seo analytics platform', 'analytics')).toBe(10);
    expect(inferBroadMismatchPenalty('enterprise seo analytics platform', 'enterprise seo analytics platform')).toBe(0);
  });

  it('suppresses strict-business-fit provider keywords on strong mismatch', () => {
    const result = isStrategyPoolEligibleKeyword(
      { keyword: 'birthday party planner', source: 'semrush_related', volume: 120, difficulty: 20 },
      {
        strictBusinessFit: true,
        businessTerms: ['seo analytics', 'content optimization'],
        rejectionReasons: ['too broad'],
      },
    );

    expect(result.suppressed).toBe(true);
    expect(result.reasons.some((reason) => reason.type === 'business_mismatch')).toBe(true);
  });

  it('does not suppress low-actionability patterns when business phrase match is strong', () => {
    const result = evaluateKeywordCandidate(
      { keyword: 'typing tiger', source: 'keyword_ideas', volume: 5000, difficulty: 15, cpc: 1 },
      {
        strictBusinessFit: true,
        businessTerms: ['Typing Tiger'],
        businessPhrases: ['Typing Tiger'],
      },
    );

    expect(result.suppressed).toBe(false);
    expect(result.reasons.some((reason) => reason.type === 'noise_pattern')).toBe(false);
  });

  it('returns zero overlap when either side tokenizes to empty set', () => {
    expect(wordOverlapRatio('a in of', 'the and or')).toBe(0);
    expect(wordOverlapRatio('seo strategy', 'the and or')).toBe(0);
  });
});
