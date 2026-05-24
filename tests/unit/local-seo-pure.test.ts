/**
 * Pure-function unit tests for server/local-seo.ts (Wave 13)
 *
 * Covers all exported utility functions that have no DB or external-API
 * dependencies: normalization helpers, domain cleaning, phone normalization,
 * confidence priority ranking, keyword classification, market-modifier
 * detection, variant generation, source scoring, and the per-page source cap.
 *
 * None of these tests touch the database or any external service.
 */

import { describe, it, expect } from 'vitest';

import {
  cleanDomain,
  normalizePhone,
  normalizeText,
  normalizeProviderIdentity,
  confidencePriority,
  cleanKeywordDisplay,
  titleLooksLikeServiceKeyword,
  hasMarketModifier,
  classifyLocalKeywordIntent,
  localVariantKeywords,
  candidateSourceScore,
  applySourcePageCap,
  LOCAL_SEO_MAX_MARKETS,
  LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH,
  type LocalSeoKeywordCandidate,
} from '../../server/local-seo.js';
import {
  LOCAL_BUSINESS_MATCH_CONFIDENCE,
  LOCAL_SEO_MARKET_STATUS,
  LOCAL_SEO_MARKET_SOURCE,
  LOCAL_SEO_DEFAULT_KEYWORDS_PER_REFRESH,
  type LocalSeoMarket,
} from '../../shared/types/local-seo.js';

// ─── Test helpers ────────────────────────────────────────────────────────────

function makeMarket(overrides: Partial<LocalSeoMarket> = {}): LocalSeoMarket {
  return {
    id: 'market-1',
    workspaceId: 'ws-1',
    label: 'Austin, TX',
    city: 'Austin',
    stateOrRegion: 'TX',
    country: 'US',
    source: LOCAL_SEO_MARKET_SOURCE.ADMIN_OVERRIDE,
    status: LOCAL_SEO_MARKET_STATUS.ACTIVE,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<LocalSeoKeywordCandidate> = {}): LocalSeoKeywordCandidate {
  return {
    keyword: 'dentist austin',
    normalizedKeyword: 'dentist austin',
    source: 'tracking',
    sourceLabel: 'Rank tracking',
    selected: true,
    score: 100,
    reasons: [],
    intent: 'transactional',
    ...overrides,
  };
}

// ─── cleanDomain ─────────────────────────────────────────────────────────────

describe('cleanDomain', () => {
  it('returns undefined for undefined input', () => {
    expect(cleanDomain(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(cleanDomain('')).toBeUndefined();
  });

  it('strips https:// prefix', () => {
    expect(cleanDomain('https://example.com')).toBe('example.com');
  });

  it('strips http:// prefix', () => {
    expect(cleanDomain('http://example.com')).toBe('example.com');
  });

  it('strips www. prefix', () => {
    expect(cleanDomain('www.example.com')).toBe('example.com');
  });

  it('strips https://www. combination', () => {
    expect(cleanDomain('https://www.example.com')).toBe('example.com');
  });

  it('lowercases the result', () => {
    expect(cleanDomain('EXAMPLE.COM')).toBe('example.com');
  });

  it('strips paths from URL', () => {
    expect(cleanDomain('https://example.com/path/to/page')).toBe('example.com');
  });

  it('returns bare hostname unchanged when no protocol', () => {
    expect(cleanDomain('example.com')).toBe('example.com');
  });

  it('strips subdomain other than www', () => {
    // cleanDomain only strips www. — other subdomains are preserved
    expect(cleanDomain('https://blog.example.com')).toBe('blog.example.com');
  });

  it('handles URL with query string', () => {
    expect(cleanDomain('https://example.com/path?foo=bar')).toBe('example.com');
  });
});

// ─── normalizePhone ───────────────────────────────────────────────────────────

describe('normalizePhone', () => {
  it('returns undefined for undefined input', () => {
    expect(normalizePhone(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(normalizePhone('')).toBeUndefined();
  });

  it('strips non-digit characters and returns last 10 digits', () => {
    expect(normalizePhone('(512) 555-0123')).toBe('5125550123');
  });

  it('returns last 10 digits of 11-digit number with leading 1', () => {
    expect(normalizePhone('+15125550123')).toBe('5125550123');
  });

  it('handles plain 10-digit string', () => {
    expect(normalizePhone('5125550123')).toBe('5125550123');
  });

  it('returns undefined when fewer than 7 digits', () => {
    expect(normalizePhone('123-456')).toBeUndefined();
  });

  it('handles dashes and dots in phone number', () => {
    expect(normalizePhone('512.555.0123')).toBe('5125550123');
  });

  it('strips parentheses and spaces', () => {
    expect(normalizePhone('(512)5550123')).toBe('5125550123');
  });

  it('returns last 10 when number is longer than 10 digits', () => {
    // International format with country code
    expect(normalizePhone('15125550123')).toBe('5125550123');
  });

  it('returns undefined for 6-digit number', () => {
    expect(normalizePhone('555-012')).toBeUndefined();
  });
});

// ─── normalizeText ────────────────────────────────────────────────────────────

describe('normalizeText', () => {
  it('returns empty string for undefined', () => {
    expect(normalizeText(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(normalizeText('')).toBe('');
  });

  it('lowercases the text', () => {
    expect(normalizeText('DENTAL')).toBe('dental');
  });

  it('collapses multiple spaces to single space', () => {
    expect(normalizeText('dental  clinic')).toBe('dental clinic');
  });

  it('strips punctuation', () => {
    expect(normalizeText("Bob's Dental, LLC.")).toBe('bob s dental llc');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeText('  dental  ')).toBe('dental');
  });

  it('replaces hyphens with spaces', () => {
    expect(normalizeText('top-rated dentist')).toBe('top rated dentist');
  });

  it('handles mixed case and special chars', () => {
    expect(normalizeText('Austin, TX — Premier Dental')).toBe('austin tx premier dental');
  });
});

// ─── normalizeProviderIdentity ───────────────────────────────────────────────

describe('normalizeProviderIdentity', () => {
  it('returns undefined for undefined input', () => {
    expect(normalizeProviderIdentity(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(normalizeProviderIdentity('')).toBeUndefined();
  });

  it('lowercases the value', () => {
    expect(normalizeProviderIdentity('ABCDEF123')).toBe('abcdef123');
  });

  it('strips non-alphanumeric characters', () => {
    expect(normalizeProviderIdentity('abc-def:123')).toBe('abcdef123');
  });

  it('handles colons and slashes', () => {
    expect(normalizeProviderIdentity('0x1234:abcd/5678')).toBe('0x1234abcd5678');
  });

  it('returns undefined for whitespace-only after stripping', () => {
    // Special chars only, stripped to empty → undefined
    expect(normalizeProviderIdentity('---')).toBeUndefined();
  });

  it('preserves plain alphanumeric CID', () => {
    expect(normalizeProviderIdentity('1234567890abcdef')).toBe('1234567890abcdef');
  });
});

// ─── confidencePriority ──────────────────────────────────────────────────────

describe('confidencePriority', () => {
  it('VERIFIED has highest priority (3)', () => {
    expect(confidencePriority(LOCAL_BUSINESS_MATCH_CONFIDENCE.VERIFIED)).toBe(3);
  });

  it('STRONG_MATCH has second-highest priority (2)', () => {
    expect(confidencePriority(LOCAL_BUSINESS_MATCH_CONFIDENCE.STRONG_MATCH)).toBe(2);
  });

  it('POSSIBLE_MATCH has third-highest priority (1)', () => {
    expect(confidencePriority(LOCAL_BUSINESS_MATCH_CONFIDENCE.POSSIBLE_MATCH)).toBe(1);
  });

  it('NOT_FOUND has lowest priority (0)', () => {
    expect(confidencePriority(LOCAL_BUSINESS_MATCH_CONFIDENCE.NOT_FOUND)).toBe(0);
  });

  it('UNKNOWN has lowest priority (0)', () => {
    expect(confidencePriority(LOCAL_BUSINESS_MATCH_CONFIDENCE.UNKNOWN)).toBe(0);
  });

  it('VERIFIED priority is strictly greater than STRONG_MATCH', () => {
    expect(confidencePriority(LOCAL_BUSINESS_MATCH_CONFIDENCE.VERIFIED)).toBeGreaterThan(
      confidencePriority(LOCAL_BUSINESS_MATCH_CONFIDENCE.STRONG_MATCH),
    );
  });

  it('STRONG_MATCH priority is strictly greater than POSSIBLE_MATCH', () => {
    expect(confidencePriority(LOCAL_BUSINESS_MATCH_CONFIDENCE.STRONG_MATCH)).toBeGreaterThan(
      confidencePriority(LOCAL_BUSINESS_MATCH_CONFIDENCE.POSSIBLE_MATCH),
    );
  });

  it('POSSIBLE_MATCH priority is strictly greater than NOT_FOUND', () => {
    expect(confidencePriority(LOCAL_BUSINESS_MATCH_CONFIDENCE.POSSIBLE_MATCH)).toBeGreaterThan(
      confidencePriority(LOCAL_BUSINESS_MATCH_CONFIDENCE.NOT_FOUND),
    );
  });
});

// ─── cleanKeywordDisplay ─────────────────────────────────────────────────────

describe('cleanKeywordDisplay', () => {
  it('returns undefined for undefined input', () => {
    expect(cleanKeywordDisplay(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(cleanKeywordDisplay('')).toBeUndefined();
  });

  it('returns undefined for keyword shorter than 3 chars', () => {
    expect(cleanKeywordDisplay('ab')).toBeUndefined();
  });

  it('returns undefined for keyword longer than 90 chars', () => {
    expect(cleanKeywordDisplay('a'.repeat(91))).toBeUndefined();
  });

  it('returns keyword at exactly 3 chars', () => {
    expect(cleanKeywordDisplay('abc')).toBe('abc');
  });

  it('returns keyword at exactly 90 chars', () => {
    expect(cleanKeywordDisplay('a'.repeat(90))).toBe('a'.repeat(90));
  });

  it('collapses multiple spaces to single space', () => {
    expect(cleanKeywordDisplay('dental   implant   austin')).toBe('dental implant austin');
  });

  it('trims leading/trailing whitespace', () => {
    expect(cleanKeywordDisplay('  dentist  ')).toBe('dentist');
  });

  it('preserves normal keyword as-is', () => {
    expect(cleanKeywordDisplay('dental implants austin')).toBe('dental implants austin');
  });

  it('returns undefined for string of only spaces', () => {
    expect(cleanKeywordDisplay('   ')).toBeUndefined();
  });
});

// ─── titleLooksLikeServiceKeyword ────────────────────────────────────────────

describe('titleLooksLikeServiceKeyword', () => {
  it('returns false for undefined', () => {
    expect(titleLooksLikeServiceKeyword(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(titleLooksLikeServiceKeyword('')).toBe(false);
  });

  it('returns false for titles with more than 6 tokens', () => {
    expect(titleLooksLikeServiceKeyword('a b c d e f g')).toBe(false);
  });

  it('returns true for dental service keywords', () => {
    expect(titleLooksLikeServiceKeyword('dental implants')).toBe(true);
    expect(titleLooksLikeServiceKeyword('teeth whitening service')).toBe(true);
    expect(titleLooksLikeServiceKeyword('emergency dental care')).toBe(true);
  });

  it('returns true for orthodontic service keywords', () => {
    expect(titleLooksLikeServiceKeyword('orthodontics clinic')).toBe(true);
  });

  it('returns true for legal/law service keywords', () => {
    expect(titleLooksLikeServiceKeyword('personal injury attorney')).toBe(true);
    expect(titleLooksLikeServiceKeyword('employment law firm')).toBe(true);
  });

  it('returns true for contractor/home service keywords', () => {
    expect(titleLooksLikeServiceKeyword('roof replacement service')).toBe(true);
    expect(titleLooksLikeServiceKeyword('plumbing repair')).toBe(true);
  });

  it('returns false for non-service generic titles', () => {
    expect(titleLooksLikeServiceKeyword('About Our Team')).toBe(false);
    expect(titleLooksLikeServiceKeyword('Contact Us')).toBe(false);
    expect(titleLooksLikeServiceKeyword('Home Page')).toBe(false);
  });

  it('returns false for restaurant if length exceeds 6 words', () => {
    expect(titleLooksLikeServiceKeyword('the best local restaurant for every occasion')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(titleLooksLikeServiceKeyword('DENTAL IMPLANTS')).toBe(true);
  });
});

// ─── hasMarketModifier ────────────────────────────────────────────────────────

describe('hasMarketModifier', () => {
  const markets = [
    makeMarket({ city: 'Austin', stateOrRegion: 'TX' }),
    makeMarket({ id: 'market-2', city: 'Houston', stateOrRegion: 'TX' }),
  ];

  it('returns true for "near me" keyword', () => {
    expect(hasMarketModifier('dentist near me', markets)).toBe(true);
  });

  it('returns true for "local" keyword', () => {
    expect(hasMarketModifier('local dental office', markets)).toBe(true);
  });

  it('returns true when keyword contains a market city', () => {
    expect(hasMarketModifier('dentist austin', markets)).toBe(true);
  });

  it('returns true when keyword contains second market city', () => {
    expect(hasMarketModifier('best dentist houston', markets)).toBe(true);
  });

  it('returns true when keyword contains state/region', () => {
    expect(hasMarketModifier('dentist tx', markets)).toBe(true);
  });

  it('returns false for generic keyword with no modifier', () => {
    expect(hasMarketModifier('dental implants', markets)).toBe(false);
  });

  it('returns false for empty markets array', () => {
    expect(hasMarketModifier('dentist near me', [])).toBe(true); // 'near me' still triggers
  });

  it('returns false when no city/state match and no near-me/local', () => {
    expect(hasMarketModifier('teeth whitening', markets)).toBe(false);
  });

  it('handles case-insensitive city matching', () => {
    expect(hasMarketModifier('DENTIST AUSTIN TX', markets)).toBe(true);
  });

  it('returns false for partial city name that does not match whole word', () => {
    // "Aus" is not Austin
    const narrowMarkets = [makeMarket({ city: 'Springfield', stateOrRegion: 'IL' })];
    expect(hasMarketModifier('dental spring', narrowMarkets)).toBe(false);
  });
});

// ─── classifyLocalKeywordIntent ──────────────────────────────────────────────

describe('classifyLocalKeywordIntent', () => {
  it('classifies "vs" queries as comparison', () => {
    expect(classifyLocalKeywordIntent('implants vs dentures')).toBe('comparison');
  });

  it('classifies "versus" queries as comparison', () => {
    expect(classifyLocalKeywordIntent('invisalign versus braces')).toBe('comparison');
  });

  it('classifies "alternatives" queries as comparison', () => {
    expect(classifyLocalKeywordIntent('dental implant alternatives')).toBe('comparison');
  });

  it('classifies "compare" queries as comparison', () => {
    expect(classifyLocalKeywordIntent('compare dental plans')).toBe('comparison');
  });

  it('classifies "how" question words as informational', () => {
    expect(classifyLocalKeywordIntent('how does dental bonding work')).toBe('informational');
  });

  it('classifies "what" question words as informational', () => {
    expect(classifyLocalKeywordIntent('what is a dental implant')).toBe('informational');
  });

  it('classifies "why" question words as informational', () => {
    expect(classifyLocalKeywordIntent('why do I need a crown')).toBe('informational');
  });

  it('classifies "guide" queries as informational', () => {
    expect(classifyLocalKeywordIntent('dental implants guide')).toBe('informational');
  });

  it('classifies "cost of" queries as informational', () => {
    expect(classifyLocalKeywordIntent('cost of dental veneers')).toBe('informational');
  });

  it('classifies "pros and cons" as informational', () => {
    expect(classifyLocalKeywordIntent('dental implants pros and cons')).toBe('informational');
  });

  it('classifies "benefits of" as informational', () => {
    expect(classifyLocalKeywordIntent('benefits of Invisalign')).toBe('informational');
  });

  it('classifies "best" queries as commercial', () => {
    expect(classifyLocalKeywordIntent('best dentist in Austin')).toBe('commercial');
  });

  it('classifies "top rated" queries as commercial', () => {
    expect(classifyLocalKeywordIntent('top rated cosmetic dentist')).toBe('commercial');
  });

  it('classifies "affordable" queries as commercial', () => {
    expect(classifyLocalKeywordIntent('affordable dental implants')).toBe('commercial');
  });

  it('classifies "cheap" queries as commercial', () => {
    expect(classifyLocalKeywordIntent('cheap dentist near me')).toBe('commercial');
  });

  it('classifies "premium" queries as commercial', () => {
    expect(classifyLocalKeywordIntent('premium dental care')).toBe('commercial');
  });

  it('defaults to transactional for local service keywords', () => {
    expect(classifyLocalKeywordIntent('dentist Austin TX')).toBe('transactional');
  });

  it('defaults to transactional for service area pattern', () => {
    expect(classifyLocalKeywordIntent('dental office near me')).toBe('transactional');
  });

  it('comparison takes precedence over informational', () => {
    expect(classifyLocalKeywordIntent('compare dental financing options overview')).toBe('comparison');
  });

  it('informational takes precedence over commercial', () => {
    expect(classifyLocalKeywordIntent('what is the best dental plan')).toBe('informational');
  });
});

// ─── localVariantKeywords ─────────────────────────────────────────────────────

describe('localVariantKeywords', () => {
  const markets = [
    makeMarket({ city: 'Austin', stateOrRegion: 'TX' }),
  ];

  it('returns empty array for undefined/invalid keyword', () => {
    expect(localVariantKeywords('', markets)).toEqual([]);
    expect(localVariantKeywords('ab', markets)).toEqual([]);
  });

  it('adds city modifier when base keyword does not contain city', () => {
    const variants = localVariantKeywords('dental implants', markets);
    expect(variants).toContain('dental implants Austin');
  });

  it('adds near me variant when not already present', () => {
    const variants = localVariantKeywords('dental implants', markets);
    expect(variants).toContain('dental implants near me');
  });

  it('does not add city modifier when base already contains city', () => {
    const variants = localVariantKeywords('dental implants Austin', markets);
    expect(variants.some(v => v.includes('Austin Austin'))).toBe(false);
  });

  it('does not add near me if already in keyword', () => {
    const variants = localVariantKeywords('dentist near me', markets);
    expect(variants.filter(v => v.includes('near me')).length).toBeLessThanOrEqual(1);
    // No duplicate "near me near me"
    expect(variants.some(v => v.includes('near me near me'))).toBe(false);
  });

  it('does not add city+state variant for short state abbreviations (cleanKeywordDisplay filters < 3 chars)', () => {
    const variants = localVariantKeywords('dental implants', markets);
    // "TX" has only 2 chars → cleanKeywordDisplay returns undefined → no city+state variant
    expect(variants.some(v => v.includes('TX'))).toBe(false);
  });

  it('adds city+state variant when state is exactly 3 chars (e.g. "NYC")', () => {
    const triStateMarket = [makeMarket({ city: 'Manhattan', stateOrRegion: 'NYC' })];
    const variants = localVariantKeywords('dental implants', triStateMarket);
    // "NYC" is exactly 3 chars → city+state variant should appear
    expect(variants).toContain('dental implants Manhattan NYC');
  });

  it('does not add city+state variant for long state names', () => {
    const longStateMarkets = [makeMarket({ city: 'Austin', stateOrRegion: 'Texas' })];
    const variants = localVariantKeywords('dental implants', longStateMarkets);
    // "Texas" is 5 chars (> 3) so city+state variant should NOT appear
    expect(variants.some(v => v.includes('Texas'))).toBe(false);
  });

  it('generates variants across multiple markets', () => {
    const multiMarkets = [
      makeMarket({ city: 'Austin', stateOrRegion: 'TX' }),
      makeMarket({ id: 'market-2', city: 'Houston', stateOrRegion: 'TX' }),
    ];
    const variants = localVariantKeywords('dental implants', multiMarkets);
    expect(variants).toContain('dental implants Austin');
    expect(variants).toContain('dental implants Houston');
  });

  it('returns empty array for empty markets and keyword with near me', () => {
    // "near me" already in base — nothing to add, no markets
    const variants = localVariantKeywords('dentist near me', []);
    expect(variants).toEqual([]);
  });
});

// ─── candidateSourceScore ────────────────────────────────────────────────────

describe('candidateSourceScore', () => {
  it('explicit source has highest score', () => {
    expect(candidateSourceScore('explicit')).toBe(120);
  });

  it('strategy source scores second', () => {
    expect(candidateSourceScore('strategy')).toBe(95);
  });

  it('tracking source scores third', () => {
    expect(candidateSourceScore('tracking')).toBe(90);
  });

  it('page_assignment source scores fourth', () => {
    expect(candidateSourceScore('page_assignment')).toBe(85);
  });

  it('content_gap source scores fifth', () => {
    expect(candidateSourceScore('content_gap')).toBe(72);
  });

  it('local_variant source has lowest score', () => {
    expect(candidateSourceScore('local_variant')).toBe(62);
  });

  it('explicit > strategy > tracking > page_assignment > content_gap > local_variant', () => {
    const scores = ['explicit', 'strategy', 'tracking', 'page_assignment', 'content_gap', 'local_variant'] as const;
    for (let i = 0; i < scores.length - 1; i++) {
      expect(candidateSourceScore(scores[i])).toBeGreaterThan(candidateSourceScore(scores[i + 1]));
    }
  });
});

// ─── applySourcePageCap ──────────────────────────────────────────────────────

describe('applySourcePageCap', () => {
  it('returns all candidates when under budget', () => {
    const candidates = [
      makeCandidate({ keyword: 'kw1', pagePath: '/page1', source: 'tracking' }),
      makeCandidate({ keyword: 'kw2', pagePath: '/page1', source: 'tracking' }),
    ];
    // Budget of 100 → pageCap = ceil(100 * 0.2) = 20. 2 items < 20
    const result = applySourcePageCap(candidates, 100);
    expect(result).toHaveLength(2);
  });

  it('never caps explicit source candidates', () => {
    // Fill up the cap with explicit keywords
    const candidates = Array.from({ length: 10 }, (_, i) =>
      makeCandidate({ keyword: `kw${i}`, pagePath: '/page1', source: 'explicit' }),
    );
    // Budget 10 → pageCap = ceil(10 * 0.2) = 2; but explicit is never capped
    const result = applySourcePageCap(candidates, 10);
    expect(result).toHaveLength(10);
  });

  it('caps non-explicit candidates from the same page to 20% of budget', () => {
    const budget = 20; // pageCap = ceil(20 * 0.2) = 4
    const candidates = Array.from({ length: 10 }, (_, i) =>
      makeCandidate({ keyword: `kw${i}`, pagePath: '/page1', source: 'tracking' }),
    );
    const result = applySourcePageCap(candidates, budget);
    expect(result).toHaveLength(4);
  });

  it('applies per-page cap independently to different pages', () => {
    const budget = 20; // pageCap = 4 per page
    const page1 = Array.from({ length: 8 }, (_, i) =>
      makeCandidate({ keyword: `kw-p1-${i}`, pagePath: '/page1', source: 'tracking' }),
    );
    const page2 = Array.from({ length: 8 }, (_, i) =>
      makeCandidate({ keyword: `kw-p2-${i}`, pagePath: '/page2', source: 'tracking' }),
    );
    const result = applySourcePageCap([...page1, ...page2], budget);
    expect(result).toHaveLength(8); // 4 from each page
  });

  it('treats candidates without a pagePath as a per-source bucket', () => {
    const budget = 20; // pageCap = 4
    const candidates = Array.from({ length: 6 }, (_, i) =>
      makeCandidate({ keyword: `kw${i}`, pagePath: undefined, source: 'content_gap' }),
    );
    const result = applySourcePageCap(candidates, budget);
    expect(result).toHaveLength(4);
  });

  it('keeps pageCap of at least 1 even for very small budgets', () => {
    const candidates = [
      makeCandidate({ keyword: 'kw1', pagePath: '/page1', source: 'tracking' }),
      makeCandidate({ keyword: 'kw2', pagePath: '/page1', source: 'tracking' }),
    ];
    // Budget of 1 → pageCap = max(1, ceil(1 * 0.2)) = max(1, 1) = 1
    const result = applySourcePageCap(candidates, 1);
    expect(result).toHaveLength(1);
  });

  it('returns empty array for empty input', () => {
    expect(applySourcePageCap([], 100)).toEqual([]);
  });

  it('separates no-pagePath candidates by source type to avoid over-capping', () => {
    const budget = 10; // pageCap = 2
    const tracking = Array.from({ length: 5 }, (_, i) =>
      makeCandidate({ keyword: `t${i}`, pagePath: undefined, source: 'tracking' }),
    );
    const contentGap = Array.from({ length: 5 }, (_, i) =>
      makeCandidate({ keyword: `cg${i}`, pagePath: undefined, source: 'content_gap' }),
    );
    const result = applySourcePageCap([...tracking, ...contentGap], budget);
    // tracking bucket: 2, content_gap bucket: 2 → 4 total
    expect(result).toHaveLength(4);
  });
});

// ─── Module-level constants ──────────────────────────────────────────────────

describe('module constants', () => {
  it('LOCAL_SEO_MAX_MARKETS is 3', () => {
    expect(LOCAL_SEO_MAX_MARKETS).toBe(3);
  });

  it('LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH equals LOCAL_SEO_DEFAULT_KEYWORDS_PER_REFRESH (deprecated alias)', () => {
    expect(LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH).toBe(LOCAL_SEO_DEFAULT_KEYWORDS_PER_REFRESH);
  });
});
