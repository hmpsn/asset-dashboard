/**
 * Extended pure-function unit tests for server/local-seo.ts (Wave 23)
 *
 * Covers scenarios NOT already tested in:
 *   - tests/unit/local-seo-pure.test.ts (normalizers, classifiers, scoring)
 *   - tests/unit/local-seo.test.ts (DB-backed integration tests)
 *   - tests/unit/local-seo-multi-location-match.test.ts (evaluateLocalBusinessMatch, isOwnedLocalResult)
 *
 * New coverage areas:
 *   - isOwnedLocalResult: URL-as-domain fallback, missing fields, multi-location edge cases
 *   - evaluateLocalBusinessMatch: street-address-only match, phone-only match, URL-based domain,
 *     result.url as domain fallback, GBP identity normalization edge cases
 *   - classifyLocalKeywordIntent: edge cases not covered (boundary patterns, prefix false-positives)
 *   - hasMarketModifier: partial-word city guard, case insensitivity, empty state
 *   - normalizePhone: exactly 7-digit threshold
 *   - cleanDomain: URL with port, bare IP, trailing slash variants
 */

import { describe, it, expect } from 'vitest';

import {
  cleanDomain,
  normalizePhone,
  normalizeText,
  normalizeProviderIdentity,
  confidencePriority,
  cleanKeywordDisplay,
  classifyLocalKeywordIntent,
  hasMarketModifier,
  isOwnedLocalResult,
  evaluateLocalBusinessMatch,
  candidateSourceScore,
  localVariantKeywords,
  titleLooksLikeServiceKeyword,
} from '../../server/local-seo.js';
import {
  LOCAL_BUSINESS_MATCH_CONFIDENCE,
  LOCAL_SEO_MARKET_SOURCE,
  LOCAL_SEO_MARKET_STATUS,
  type ClientLocation,
  type LocalVisibilityBusinessResult,
  type LocalSeoMarket,
} from '../../shared/types/local-seo.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeLocation(overrides: Partial<ClientLocation> = {}): ClientLocation {
  return {
    id: 'loc-1',
    workspaceId: 'ws-1',
    name: 'Acme Dental',
    domain: 'acmedental.com',
    phone: '5125550100',
    streetAddress: '123 Main St',
    isPrimary: true,
    status: 'confirmed',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeResult(overrides: Partial<LocalVisibilityBusinessResult> = {}): LocalVisibilityBusinessResult {
  return {
    rank: 1,
    title: 'Unknown Competitor',
    domain: 'competitor.com',
    ...overrides,
  };
}

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

// ── isOwnedLocalResult — URL as domain fallback ───────────────────────────────

describe('isOwnedLocalResult — URL-as-domain fallback', () => {
  it('scrubs by result.url when result.domain is absent', () => {
    const location = makeLocation({ domain: 'acmedental.com' });
    const result = makeResult({ domain: undefined, url: 'https://acmedental.com/page', title: 'Other' });
    expect(isOwnedLocalResult(result, [location])).toBe(true);
  });

  it('does not scrub when url domain differs from location domain', () => {
    const location = makeLocation({ domain: 'acmedental.com' });
    const result = makeResult({ domain: undefined, url: 'https://competitor.com/page', title: 'Other' });
    expect(isOwnedLocalResult(result, [location])).toBe(false);
  });

  it('scrubs by domain even when result has no phone or address', () => {
    const location = makeLocation({ domain: 'acmedental.com', phone: undefined, streetAddress: undefined });
    const result = makeResult({ domain: 'acmedental.com', phone: undefined, address: undefined });
    expect(isOwnedLocalResult(result, [location])).toBe(true);
  });
});

// ── isOwnedLocalResult — GBP CID normalization ───────────────────────────────

describe('isOwnedLocalResult — GBP CID normalization', () => {
  it('matches CID after stripping non-alphanumeric chars', () => {
    const location = makeLocation({ gbpPlaceId: 'cid:12345', domain: undefined });
    const result = makeResult({ cid: 'cid 12345', domain: 'dir.example.com' });
    expect(isOwnedLocalResult(result, [location])).toBe(true);
  });

  it('does not scrub when CIDs differ after normalization', () => {
    const location = makeLocation({ gbpPlaceId: 'cid:11111', domain: undefined });
    const result = makeResult({ cid: 'cid 22222', domain: 'competitor.com' });
    expect(isOwnedLocalResult(result, [location])).toBe(false);
  });

  it('does not scrub when location has no gbpPlaceId', () => {
    const location = makeLocation({ gbpPlaceId: undefined, domain: undefined, phone: undefined, streetAddress: undefined });
    const result = makeResult({ cid: 'some-cid' });
    expect(isOwnedLocalResult(result, [location])).toBe(false);
  });
});

// ── isOwnedLocalResult — phone matching ──────────────────────────────────────

describe('isOwnedLocalResult — phone matching', () => {
  it('scrubs by phone with different formatting', () => {
    const location = makeLocation({ domain: undefined, phone: '(512) 555-0100' });
    const result = makeResult({ domain: 'other.com', phone: '512.555.0100' });
    expect(isOwnedLocalResult(result, [location])).toBe(true);
  });

  it('does not scrub when phones differ', () => {
    const location = makeLocation({ domain: undefined, phone: '5125550100' });
    const result = makeResult({ domain: 'other.com', phone: '5125550199' });
    expect(isOwnedLocalResult(result, [location])).toBe(false);
  });
});

// ── isOwnedLocalResult — street address matching ──────────────────────────────

describe('isOwnedLocalResult — street address matching', () => {
  it('scrubs when result address includes location street address', () => {
    const location = makeLocation({ domain: undefined, phone: undefined, streetAddress: '123 Main St' });
    const result = makeResult({ domain: 'other.com', address: '123 Main St, Austin, TX 78701' });
    expect(isOwnedLocalResult(result, [location])).toBe(true);
  });

  it('does not scrub when street address does not match', () => {
    const location = makeLocation({ domain: undefined, phone: undefined, streetAddress: '123 Main St' });
    const result = makeResult({ domain: 'other.com', address: '456 Oak Ave, Austin, TX' });
    expect(isOwnedLocalResult(result, [location])).toBe(false);
  });

  it('does not scrub when location has no street address', () => {
    const location = makeLocation({ domain: undefined, phone: undefined, streetAddress: undefined });
    const result = makeResult({ domain: 'other.com', address: '123 Main St, Austin, TX' });
    expect(isOwnedLocalResult(result, [location])).toBe(false);
  });
});

// ── evaluateLocalBusinessMatch — additional edge cases ───────────────────────

describe('evaluateLocalBusinessMatch — URL-based domain resolution', () => {
  it('verifies match when result has url instead of domain', () => {
    const loc = makeLocation({ domain: 'acmedental.com', name: 'Acme Dental' });
    const result = makeResult({ domain: undefined, url: 'https://acmedental.com/', title: 'Acme Dental', rank: 1 });
    const match = evaluateLocalBusinessMatch([loc], [result]);
    expect(match.found).toBe(true);
    // domain(from url) + name → verified
    expect(match.confidence).toBe(LOCAL_BUSINESS_MATCH_CONFIDENCE.VERIFIED);
    expect(match.rank).toBe(1);
  });

  it('returns not_found when url does not match location domain and no other signals', () => {
    const loc = makeLocation({ domain: 'acmedental.com', phone: undefined, streetAddress: undefined });
    const result = makeResult({ domain: undefined, url: 'https://competitor.com/', title: 'Other Dental' });
    const match = evaluateLocalBusinessMatch([loc], [result]);
    expect(match.found).toBe(false);
    expect(match.confidence).toBe(LOCAL_BUSINESS_MATCH_CONFIDENCE.NOT_FOUND);
  });
});

describe('evaluateLocalBusinessMatch — phone-only match', () => {
  it('returns possible_match for phone-only signal', () => {
    const loc = makeLocation({ domain: undefined, phone: '5125550100', streetAddress: undefined });
    const result = makeResult({ domain: 'other.com', phone: '5125550100', title: 'Different Name' });
    const match = evaluateLocalBusinessMatch([loc], [result]);
    expect(match.found).toBe(true);
    expect(match.confidence).toBe(LOCAL_BUSINESS_MATCH_CONFIDENCE.POSSIBLE_MATCH);
  });
});

describe('evaluateLocalBusinessMatch — street address-only match', () => {
  it('returns possible_match for street address-only signal', () => {
    const loc = makeLocation({ domain: undefined, phone: undefined, streetAddress: '123 Main St' });
    const result = makeResult({ domain: 'other.com', phone: undefined, address: '123 Main St, Austin, TX', title: 'Different Name' });
    const match = evaluateLocalBusinessMatch([loc], [result]);
    expect(match.found).toBe(true);
    expect(match.confidence).toBe(LOCAL_BUSINESS_MATCH_CONFIDENCE.POSSIBLE_MATCH);
  });
});

describe('evaluateLocalBusinessMatch — name + phone strong match', () => {
  it('returns strong_match for name + phone combination', () => {
    const loc = makeLocation({ domain: undefined, name: 'Acme Dental', phone: '5125550100', streetAddress: undefined });
    const result = makeResult({ domain: 'other.com', title: 'Acme Dental', phone: '5125550100', rank: 2 });
    const match = evaluateLocalBusinessMatch([loc], [result]);
    expect(match.found).toBe(true);
    expect(match.confidence).toBe(LOCAL_BUSINESS_MATCH_CONFIDENCE.STRONG_MATCH);
  });
});

describe('evaluateLocalBusinessMatch — empty inputs', () => {
  it('returns not_found with descriptive reason when results is empty', () => {
    const match = evaluateLocalBusinessMatch([makeLocation()], []);
    expect(match.found).toBe(false);
    expect(match.confidence).toBe(LOCAL_BUSINESS_MATCH_CONFIDENCE.NOT_FOUND);
    expect(match.reason).toBeTruthy();
  });

  it('returns not_found when locations is empty', () => {
    const match = evaluateLocalBusinessMatch([], [makeResult()]);
    expect(match.found).toBe(false);
    expect(match.confidence).toBe(LOCAL_BUSINESS_MATCH_CONFIDENCE.NOT_FOUND);
  });

  it('returns not_found when no signals match', () => {
    const loc = makeLocation({ domain: 'acmedental.com', phone: '5125550100' });
    const result = makeResult({ domain: 'competitor.com', phone: '5125559999', title: 'Competitor' });
    const match = evaluateLocalBusinessMatch([loc], [result]);
    expect(match.found).toBe(false);
    expect(match.confidence).toBe(LOCAL_BUSINESS_MATCH_CONFIDENCE.NOT_FOUND);
  });
});

// ── classifyLocalKeywordIntent — prefix/boundary edge cases ──────────────────

describe('classifyLocalKeywordIntent — boundary and edge cases', () => {
  it('does not classify "howard county dentist" as informational (how prefix false positive)', () => {
    // "how" pattern should not match mid-word
    const result = classifyLocalKeywordIntent('howard county dentist');
    expect(result).not.toBe('informational');
  });

  it('classifies "what is a dentist" as informational (starts with "what ")', () => {
    expect(classifyLocalKeywordIntent('what is a dentist')).toBe('informational');
  });

  it('classifies "where to find a dentist" as informational', () => {
    expect(classifyLocalKeywordIntent('where to find a dentist near me')).toBe('informational');
  });

  it('classifies "which dentist" as informational', () => {
    expect(classifyLocalKeywordIntent('which dentist is best for implants')).toBe('informational');
  });

  it('classifies "types of dental crowns" as informational', () => {
    expect(classifyLocalKeywordIntent('types of dental crowns')).toBe('informational');
  });

  it('classifies "difference between braces and invisalign" as informational', () => {
    expect(classifyLocalKeywordIntent('difference between braces and invisalign')).toBe('informational');
  });

  it('classifies "statistics" keyword as informational', () => {
    expect(classifyLocalKeywordIntent('dental implant success statistics')).toBe('informational');
  });

  it('commercial "budget" keyword wins over transactional default', () => {
    expect(classifyLocalKeywordIntent('budget dental clinic austin')).toBe('commercial');
  });

  it('commercial "discount" keyword wins over transactional default', () => {
    expect(classifyLocalKeywordIntent('discount dental care near me')).toBe('commercial');
  });

  it('transactional is the default when no pattern matches', () => {
    expect(classifyLocalKeywordIntent('dentist 78701')).toBe('transactional');
  });
});

// ── hasMarketModifier — additional edge cases ─────────────────────────────────

describe('hasMarketModifier — edge cases', () => {
  const markets = [
    makeMarket({ city: 'Springfield', stateOrRegion: 'IL' }),
  ];

  it('returns true for "near me" even with no markets', () => {
    expect(hasMarketModifier('dentist near me', [])).toBe(true);
  });

  it('returns true for "local" keyword even with no markets', () => {
    expect(hasMarketModifier('local plumber', [])).toBe(true);
  });

  it('returns false when keyword has partial city name (not word boundary)', () => {
    // "spring" is not "springfield" — the normalizeText lookup uses .includes()
    // which may partially match. This tests the documented behavior.
    const result = hasMarketModifier('dental spring flowers', markets);
    // This is a documentation test — includes() means partial matches do trigger.
    // "spring" includes "spring" from "springfield" is false since it's the other
    // way around: we check if normalized keyword includes the city.
    // "spring flowers" normalized = "spring flowers"
    // city normalized = "springfield"
    // "spring flowers".includes("springfield") → false
    expect(result).toBe(false);
  });

  it('returns true when keyword exactly contains the city name', () => {
    expect(hasMarketModifier('dentist springfield il', markets)).toBe(true);
  });

  it('returns true when keyword contains state abbreviation', () => {
    // IL state abbr — normalized as "il", keyword normalized contains "il"
    expect(hasMarketModifier('best dentist il', markets)).toBe(true);
  });

  it('is case insensitive for city matching', () => {
    expect(hasMarketModifier('BEST DENTIST IN SPRINGFIELD', markets)).toBe(true);
  });
});

// ── cleanDomain — additional edge cases ──────────────────────────────────────

describe('cleanDomain — additional edge cases', () => {
  it('strips trailing slash from bare domain', () => {
    // URL parsing: "https://example.com/" → hostname = "example.com"
    expect(cleanDomain('example.com/')).toBe('example.com');
  });

  it('handles URL with port number (strips port)', () => {
    // new URL("https://example.com:8080/path").hostname = "example.com"
    expect(cleanDomain('https://example.com:8080/path')).toBe('example.com');
  });

  it('lowercases mixed-case domain with subdomain', () => {
    expect(cleanDomain('https://Blog.Example.COM/posts')).toBe('blog.example.com');
  });

  it('handles domain with multiple path segments', () => {
    expect(cleanDomain('https://example.com/a/b/c/d')).toBe('example.com');
  });
});

// ── normalizePhone — exactly-7-digit boundary ─────────────────────────────────

describe('normalizePhone — digit boundary', () => {
  it('returns value for exactly 7 digits', () => {
    expect(normalizePhone('555-0123')).toBe('5550123');
  });

  it('returns undefined for exactly 6 digits', () => {
    expect(normalizePhone('55-0123')).toBeUndefined();
  });

  it('handles phone with extension (only strips non-digits, takes last 10)', () => {
    // "(512) 555-0100 ext 123" → digits = "5125550100123" → last 10 = "5550100123"
    expect(normalizePhone('(512) 555-0100 ext 123')).toBe('5550100123');
  });
});

// ── localVariantKeywords — edge cases not in pure test ───────────────────────

describe('localVariantKeywords — additional edge cases', () => {
  it('returns empty array when base keyword is undefined', () => {
    expect(localVariantKeywords(undefined as unknown as string, [])).toEqual([]);
  });

  it('does not produce duplicates when base already contains near me in different case', () => {
    const markets = [makeMarket({ city: 'Austin', stateOrRegion: 'TX' })];
    const variants = localVariantKeywords('Dentist Near Me', markets);
    expect(variants.filter(v => /near me/i.test(v)).length).toBeLessThanOrEqual(1);
  });

  it('generates city variant when city is valid but state is undefined', () => {
    const markets = [makeMarket({ city: 'Portland', stateOrRegion: undefined })];
    const variants = localVariantKeywords('dental implants', markets);
    expect(variants).toContain('dental implants Portland');
    expect(variants).toContain('dental implants near me');
  });
});

// ── candidateSourceScore — exhaustive ordering ───────────────────────────────

describe('candidateSourceScore — score values are unique and ordered', () => {
  const ordered: Array<LocalSeoKeywordCandidate['source']> = [
    'explicit', 'strategy', 'tracking', 'page_assignment', 'content_gap', 'local_variant',
  ];

  it('all six source types return distinct score values', () => {
    const scores = ordered.map(candidateSourceScore);
    const unique = new Set(scores);
    expect(unique.size).toBe(ordered.length);
  });

  it('explicit always outscores all others', () => {
    const explicitScore = candidateSourceScore('explicit');
    for (const source of ordered.slice(1)) {
      expect(explicitScore).toBeGreaterThan(candidateSourceScore(source));
    }
  });
});

// Import the type for use in test
import type { LocalSeoKeywordCandidate } from '../../server/local-seo.js';

// ── titleLooksLikeServiceKeyword — additional patterns ───────────────────────

describe('titleLooksLikeServiceKeyword — additional patterns', () => {
  it('returns true for "med spa" keyword', () => {
    expect(titleLooksLikeServiceKeyword('med spa treatments')).toBe(true);
  });

  it('returns true for "roof" keyword', () => {
    expect(titleLooksLikeServiceKeyword('roof repair austin')).toBe(true);
  });

  it('returns false for titles exceeding 6 tokens', () => {
    // "dental implants austin tx affordable payment" is 7 tokens
    expect(titleLooksLikeServiceKeyword('dental implants austin tx affordable payment options')).toBe(false);
  });

  it('returns false for single character title', () => {
    expect(titleLooksLikeServiceKeyword('a')).toBe(false);
  });

  it('returns true for exact single-word service term', () => {
    expect(titleLooksLikeServiceKeyword('implants')).toBe(true);
  });
});
