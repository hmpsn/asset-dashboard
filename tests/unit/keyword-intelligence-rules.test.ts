import { describe, expect, it } from 'vitest';
import {
  evaluateKeywordCandidate,
  isNearDuplicateKeyword,
  isStrategyPoolEligibleKeyword,
  normalizeKeyword,
  opportunityScore,
  shouldIncludeKeywordCandidate,
} from '../../server/keyword-intelligence/index.js';

describe('keyword intelligence shared rules', () => {
  it('normalizes and detects near-duplicate keyword variants', () => {
    expect(normalizeKeyword('  SEO--Strategy!! ')).toBe('seo strategy');
    expect(isNearDuplicateKeyword('keyword strategy engine', 'keyword strategy')).toBe(true);
    expect(isNearDuplicateKeyword('keyword strategy engine', 'dental implants')).toBe(false);
  });

  it('keeps the recommendation opportunity score contract stable', () => {
    expect(opportunityScore(0, 50)).toBe(0);
    expect(opportunityScore(1000, 20)).toBeGreaterThan(opportunityScore(1000, 80));
    expect(opportunityScore(1000, 50, 5)).toBe(opportunityScore(1000, 50, 0) + 10);
  });

  it('keeps the candidate inclusion boundary shared across consumers', () => {
    expect(shouldIncludeKeywordCandidate('pattern', 0)).toBe(true);
    expect(shouldIncludeKeywordCandidate('gsc', 0)).toBe(true);
    expect(shouldIncludeKeywordCandidate('semrush_related', 9)).toBe(false);
    expect(shouldIncludeKeywordCandidate('semrush_related', 10)).toBe(true);
  });

  it('suppresses declined keywords unless there is an explicit positive override', () => {
    const declined = evaluateKeywordCandidate(
      { keyword: 'cheap seo tools', volume: 500, difficulty: 35, cpc: 1, source: 'semrush_related' },
      { declinedKeywords: ['cheap seo'], requestedKeywords: [], approvedKeywords: [] },
    );
    expect(declined.suppressed).toBe(true);
    expect(declined.reasons.some(reason => reason.type === 'client_declined')).toBe(true);

    const approved = evaluateKeywordCandidate(
      { keyword: 'cheap seo tools', volume: 500, difficulty: 35, cpc: 1, source: 'semrush_related' },
      { declinedKeywords: ['cheap seo'], approvedKeywords: ['cheap seo tools'] },
    );
    expect(approved.suppressed).toBe(false);
  });

  it('does not suppress broad candidates just because a single-token keyword was declined', () => {
    const result = evaluateKeywordCandidate(
      { keyword: 'technical seo audit', volume: 500, difficulty: 35, cpc: 1, source: 'semrush_related' },
      { declinedKeywords: ['seo'], requestedKeywords: [], approvedKeywords: [] },
    );
    expect(result.suppressed).toBe(false);
    expect(result.reasons.some(reason => reason.type === 'client_declined')).toBe(false);
  });

  it('still boosts provider variants from one-token requested or approved feedback', () => {
    const result = evaluateKeywordCandidate(
      { keyword: 'roofing company near me', volume: 500, difficulty: 35, cpc: 2, source: 'semrush_related' },
      { requestedKeywords: ['roofing'], approvedKeywords: [], declinedKeywords: [] },
    );
    expect(result.suppressed).toBe(false);
    expect(result.reasons.some(reason => reason.type === 'client_requested')).toBe(true);
  });

  it('still boosts provider variants from one-token business priority signals', () => {
    const result = evaluateKeywordCandidate(
      { keyword: 'roofing company near me', volume: 500, difficulty: 35, cpc: 2, source: 'semrush_related' },
      { businessPriorities: ['roofing'] },
    );
    expect(result.suppressed).toBe(false);
    expect(result.reasons.some(reason => reason.type === 'business_fit')).toBe(true);
  });

  it('marks existing page-map conflicts as typed negative reasons', () => {
    const result = evaluateKeywordCandidate(
      { keyword: 'enterprise seo platform', volume: 1000, difficulty: 40, cpc: 4, source: 'semrush_related' },
      {
        pageMap: [{ pagePath: '/platform', pageTitle: 'Platform', primaryKeyword: 'enterprise seo', secondaryKeywords: ['seo platform'] }],
      },
    );
    expect(result.scoreDelta).toBeLessThan(0);
    expect(result.reasons.some(reason => reason.type === 'page_map_conflict')).toBe(true);
  });

  it('rejects observed staging noisy terms for hmpsn studio-like business context', () => {
    const context = {
      businessTerms: ['SEO analytics platform for agencies', 'content strategy', 'keyword intelligence', 'client reporting'],
      strictBusinessFit: true,
    };

    for (const keyword of ['paper tiger', 'typing tiger', 'all domain name extensions list', 'list of all domain name extensions']) {
      const result = evaluateKeywordCandidate(
        { keyword, volume: 12000, difficulty: 20, cpc: 0.5, source: 'keyword_ideas' },
        context,
      );
      expect(result.suppressed).toBe(true);
      expect(result.reasons.some(reason => reason.type === 'noise_pattern')).toBe(true);
    }
  });

  it('lets requested/client-owned keywords through even when lexical business fit is weak', () => {
    const result = evaluateKeywordCandidate(
      { keyword: 'founder narrative workshop', volume: 80, difficulty: 30, cpc: 2, source: 'client_requested' },
      {
        businessTerms: ['SEO analytics platform for agencies'],
        requestedKeywords: ['founder narrative workshop'],
        strictBusinessFit: true,
      },
    );
    expect(result.suppressed).toBe(false);
    expect(result.reasons.some(reason => reason.type === 'client_requested')).toBe(true);
  });

  it('applies the same noisy-term gate to strategy pool candidates', () => {
    const result = isStrategyPoolEligibleKeyword(
      { keyword: 'paper tiger', volume: 9000, difficulty: 12, sourceKind: 'keyword_ideas' },
      { businessTerms: ['SEO analytics platform for agencies'], strictBusinessFit: true },
    );
    expect(result.suppressed).toBe(true);
  });

  it('also rejects noisy terms returned as AI-suggested strategy mappings', () => {
    const result = isStrategyPoolEligibleKeyword(
      { keyword: 'typing tiger', volume: 0, difficulty: 0, source: 'ai_suggested' },
      { businessTerms: ['SEO analytics platform for agencies'] },
    );
    expect(result.suppressed).toBe(true);
    expect(result.reasons.some(reason => reason.type === 'noise_pattern')).toBe(true);
  });

  it('does not globally suppress noisy-looking phrases when they match the actual business', () => {
    const result = evaluateKeywordCandidate(
      { keyword: 'typing tiger', volume: 5000, difficulty: 30, cpc: 1, source: 'keyword_ideas' },
      { businessTerms: ['Typing Tiger typing tutor app'], strictBusinessFit: true },
    );
    expect(result.suppressed).toBe(false);
    expect(result.reasons.some(reason => reason.type === 'business_fit')).toBe(true);
  });

  it('does not let incidental one-token business overlap bypass noisy-term suppression', () => {
    const result = evaluateKeywordCandidate(
      { keyword: 'paper tiger', volume: 5000, difficulty: 30, cpc: 1, source: 'keyword_ideas' },
      { businessTerms: ['white paper content strategy for agencies'], strictBusinessFit: true },
    );
    expect(result.suppressed).toBe(true);
    expect(result.reasons.some(reason => reason.type === 'noise_pattern')).toBe(true);
  });

  it('does not apply business-mismatch penalties when no business context exists', () => {
    const result = evaluateKeywordCandidate(
      { keyword: 'technical seo audit', volume: 500, difficulty: 45, cpc: 3, source: 'semrush_related' },
      { strictBusinessFit: true },
    );
    expect(result.suppressed).toBe(false);
    expect(result.reasons.some(reason => reason.type === 'business_mismatch')).toBe(false);
  });
});
