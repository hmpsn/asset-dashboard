import { describe, it, expect } from 'vitest';
import { matchesQuestionKeyword } from '../../server/strategy-filters.js';

describe('matchesQuestionKeyword', () => {
  it('requires both words for a 2-word target', () => {
    expect(matchesQuestionKeyword('technical seo', 'how to do technical seo')).toBe(true);
    expect(matchesQuestionKeyword('technical seo', 'technical writing tips')).toBe(false);
  });

  it('single-word target only requires 1 match', () => {
    expect(matchesQuestionKeyword('seo', 'how to improve seo rankings')).toBe(true);
    expect(matchesQuestionKeyword('seo', 'unrelated topic')).toBe(false);
  });

  it('3-word target requires at least 2 matches', () => {
    expect(matchesQuestionKeyword('local seo strategy', 'local seo for small business')).toBe(true);
    expect(matchesQuestionKeyword('local seo strategy', 'some other content')).toBe(false);
  });

  it('uses word-boundary matching — short words must match as whole tokens, not substrings', () => {
    // "ai" must not match as a substring inside "email"
    expect(matchesQuestionKeyword('ai seo', 'email seo tips')).toBe(false);
    // "or" must not match inside "for" or "organic"
    expect(matchesQuestionKeyword('or seo', 'organic seo guide')).toBe(false);
    // Exact word match still works
    expect(matchesQuestionKeyword('ai seo', 'best ai seo tools')).toBe(true);
  });
});
