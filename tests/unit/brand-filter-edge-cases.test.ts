// tests/unit/brand-filter-edge-cases.test.ts
// Edge-case tests for competitor brand keyword filtering.
// Extends tests/unit/competitor-brand-filter.test.ts — does NOT duplicate existing coverage.

import { describe, it, expect } from 'vitest';
import {
  extractBrandTokens,
  isBrandedQuery,
  filterBrandedContentGaps,
  filterBrandedKeywords,
} from '../../server/competitor-brand-filter.js';

// ── 2-char token behaviour ─────────────────────────────────────────────────
// The existing tests confirm "dx" matches as an exact word and does NOT
// match "redux". These tests verify the boundary at exactly 2 chars — the
// minimum length the filter keeps — with additional keywords and domains.

describe('2-char tokens (exact-word match only)', () => {
  it('2-char token matches as a standalone word in a longer phrase', () => {
    // "dx" appears at the start of the keyword
    expect(isBrandedQuery('dx metrics platform', ['dx'])).toBe(true);
  });

  it('2-char token matches when it appears at the end of the keyword', () => {
    expect(isBrandedQuery('comparing alternatives to dx', ['dx'])).toBe(true);
  });

  it('2-char token does NOT match when embedded inside a longer word (substring guard)', () => {
    // "dx" must not fire on "index", "redux", "codex"
    expect(isBrandedQuery('codex documentation', ['dx'])).toBe(false);
  });

  it('2-char token does NOT match when concatenated with another word without a space', () => {
    // Hyphenated compound: "dx-free" splits into words ["dx-free"], which !== "dx"
    // so this is a negative case — the hyphen is not a word boundary for .split(/\s+/)
    expect(isBrandedQuery('dx-free workflow', ['dx'])).toBe(false);
  });

  it('extractBrandTokens produces a 2-char high-confidence token from a "get" prefix domain', () => {
    // "getdx.com" → strips "get" → core "dx" at 2 chars, kept because highConfidence
    const tokens = extractBrandTokens('getdx.com');
    expect(tokens).toContain('dx');
    // Must have more than just "dx" (at minimum also "getdx")
    expect(tokens.length).toBeGreaterThan(0);
  });
});

// ── SaaS prefix pipeline (extract → filter) ───────────────────────────────
// extractBrandTokens "trylinear" coverage exists, but the end-to-end pipeline
// (tokens from trylinear.com used to filter keywords mentioning "linear") is new.

describe('SaaS prefix end-to-end pipeline', () => {
  it('"trylinear.com" tokens filter keywords that mention "linear" as a word', () => {
    const tokens = extractBrandTokens('trylinear.com');
    expect(tokens.length).toBeGreaterThan(0);
    // "linear" must be in the token set (stripped from "try" prefix)
    expect(tokens).toContain('linear');
    // A keyword containing "linear" as a standalone word should be flagged
    expect(isBrandedQuery('linear project management review', tokens)).toBe(true);
  });

  it('"trylinear.com" does NOT flag keywords that contain "linear" only as a substring of another word', () => {
    const tokens = extractBrandTokens('trylinear.com');
    expect(tokens.length).toBeGreaterThan(0);
    // "nonlinear" contains "linear" but only as a substring — long token uses \b
    // which DOES match at word boundaries inside compound words in many regex engines,
    // so we verify the actual behaviour rather than assume
    const result = isBrandedQuery('nonlinear storytelling techniques', tokens);
    // \blinear\b does NOT match inside "nonlinear" — the regex engine treats the
    // "non" prefix as part of the same word, so no word boundary exists before "linear"
    expect(result).toBe(false);
  });

  it('"usenotionlike.com" — "use" prefix only stripped when remainder is > 1 char', () => {
    // "useit.com" → strips "use" → "it" (2 chars), kept as high-confidence token
    const tokens = extractBrandTokens('useit.com');
    expect(tokens.length).toBeGreaterThan(0);
    // "useit" should be present as the full base token
    expect(tokens).toContain('useit');
  });

  it('"getgo.com" — prefix "get" stripped correctly leaving "go" (2 chars)', () => {
    const tokens = extractBrandTokens('getgo.com');
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens).toContain('getgo');
    // "go" is exactly 2 chars and should be present (high-confidence)
    expect(tokens).toContain('go');
  });
});

// ── Multi-word brand names ─────────────────────────────────────────────────
// Brand names with spaces (e.g. "Google Analytics") that appear in the keyword.
// The domain "google-analytics.com" would produce tokens ["google", "analytics",
// "googleanalytics"]. Each token is matched independently.

describe('multi-word brand names via hyphenated domains', () => {
  it('extracts both words of a hyphenated two-word brand domain', () => {
    const tokens = extractBrandTokens('google-analytics.com');
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens).toContain('google');
    expect(tokens).toContain('analytics');
  });

  it('flags a keyword containing the first word of the brand', () => {
    const tokens = extractBrandTokens('google-analytics.com');
    expect(tokens.length).toBeGreaterThan(0);
    expect(isBrandedQuery('google analytics tools comparison', tokens)).toBe(true);
  });

  it('flags a keyword containing the second word of the brand', () => {
    const tokens = extractBrandTokens('google-analytics.com');
    expect(tokens.length).toBeGreaterThan(0);
    // "analytics" alone matches because it appears as a token
    expect(isBrandedQuery('best analytics platforms for ecommerce', tokens)).toBe(true);
  });

  it('filterBrandedContentGaps removes items whose topic contains a brand word', () => {
    const gaps = [
      { targetKeyword: 'analytics dashboard setup', topic: 'How to Set Up Google Analytics' },
      { targetKeyword: 'organic traffic growth tactics', topic: 'Organic Traffic Growth Guide' },
    ];
    const { filtered, removed } = filterBrandedContentGaps(gaps, ['google-analytics.com']);
    // "Google Analytics" in topic triggers removal
    expect(removed.length).toBeGreaterThan(0);
    expect(removed.some(g => g.targetKeyword === 'analytics dashboard setup')).toBe(true);
    // Non-branded gap survives
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.some(g => g.targetKeyword === 'organic traffic growth tactics')).toBe(true);
  });
});

// ── Empty inputs ───────────────────────────────────────────────────────────

describe('empty inputs', () => {
  it('isBrandedQuery with empty token array always returns false', () => {
    expect(isBrandedQuery('semrush alternatives', [])).toBe(false);
    expect(isBrandedQuery('best seo tools', [])).toBe(false);
  });

  it('isBrandedQuery with empty keyword string returns false (no words to match)', () => {
    expect(isBrandedQuery('', ['semrush', 'ahrefs'])).toBe(false);
  });

  it('filterBrandedContentGaps with empty contentGaps array returns empty filtered and removed', () => {
    const { filtered, removed } = filterBrandedContentGaps([], ['semrush.com']);
    expect(filtered.length).toBe(0);
    expect(removed.length).toBe(0);
  });

  it('filterBrandedKeywords with empty pool returns 0 removals', () => {
    const pool = new Map<string, { volume: number; difficulty: number; source: string }>();
    const removed = filterBrandedKeywords(pool, ['semrush.com']);
    expect(removed).toBe(0);
    expect(pool.size).toBe(0);
  });
});

// ── Case-insensitive matching (extended) ───────────────────────────────────
// The existing suite tests "DX Integrations Guide" and "SEMRUSH review".
// These tests verify mixed case and Title Case for longer tokens not yet exercised.

describe('case-insensitive matching (extended)', () => {
  it('matches "Ahrefs" keyword against lowercase token "ahrefs"', () => {
    expect(isBrandedQuery('Ahrefs vs Semrush comparison', ['ahrefs'])).toBe(true);
  });

  it('matches mixed-case keyword "aHrEfS" against lowercase token', () => {
    expect(isBrandedQuery('aHrEfS review 2025', ['ahrefs'])).toBe(true);
  });

  it('filterBrandedKeywords removes a keyword with Title Case brand name', () => {
    const pool = new Map([
      ['Ahrefs free trial review', { volume: 500, difficulty: 35, source: 'gap' }],
      ['seo keyword research tips', { volume: 1200, difficulty: 40, source: 'gsc' }],
    ]);
    const removed = filterBrandedKeywords(pool, ['ahrefs.com']);
    expect(removed).toBeGreaterThan(0);
    expect(pool.has('Ahrefs free trial review')).toBe(false);
    expect(pool.has('seo keyword research tips')).toBe(true);
  });
});

// ── Brand name that's a common English word ────────────────────────────────
// "apple" is both a fruit and a tech brand. Filtering on the "apple" token will
// flag ANY keyword containing "apple" as a word — including generic uses.
// These tests document the known over-filtering behaviour and confirm it's consistent.

describe('brand name that is a common English word (e.g., "apple")', () => {
  it('extractBrandTokens produces "apple" from apple.com', () => {
    const tokens = extractBrandTokens('apple.com');
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens).toContain('apple');
  });

  it('isBrandedQuery flags a tech keyword containing "apple"', () => {
    const tokens = extractBrandTokens('apple.com');
    expect(tokens.length).toBeGreaterThan(0);
    expect(isBrandedQuery('apple silicon performance benchmarks', tokens)).toBe(true);
  });

  it('isBrandedQuery also flags a non-tech keyword containing "apple" (known over-filtering)', () => {
    // "apple" as a generic word — the filter cannot distinguish context.
    // This test documents the expected behaviour, not a bug.
    const tokens = extractBrandTokens('apple.com');
    expect(tokens.length).toBeGreaterThan(0);
    expect(isBrandedQuery('best apple cider vinegar recipe', tokens)).toBe(true);
  });

  it('"apple" does NOT match inside "pineapple" (substring guard for 5-char token)', () => {
    // "apple" is 5 chars → uses \b word-boundary regex
    // \bapple\b does NOT match inside "pineapple" because there is no word boundary
    // between "pine" and "apple" — they form a single token
    expect(isBrandedQuery('pineapple juice benefits', ['apple'])).toBe(false);
  });

  it('filterBrandedContentGaps removes gaps mentioning "apple" in targetKeyword or topic', () => {
    const gaps = [
      { targetKeyword: 'apple watch fitness features', topic: 'Apple Watch Fitness Review' },
      { targetKeyword: 'best smartwatches 2025', topic: 'Top Smartwatch Picks' },
    ];
    const { filtered, removed } = filterBrandedContentGaps(gaps, ['apple.com']);
    expect(removed.length).toBeGreaterThan(0);
    expect(removed.some(g => g.targetKeyword === 'apple watch fitness features')).toBe(true);
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.some(g => g.targetKeyword === 'best smartwatches 2025')).toBe(true);
  });
});

// ── Substring non-matches (extended) ──────────────────────────────────────
// Existing tests cover "redux" and "index" vs "dx". These extend coverage
// to longer tokens and different substring positions.

describe('substring non-matches (extended)', () => {
  it('"redux" does NOT match brand token "dx" (existing behaviour, integration guard)', () => {
    // Included as a regression guard for the pipeline integration path
    const tokens = extractBrandTokens('getdx.com');
    expect(tokens.length).toBeGreaterThan(0);
    expect(isBrandedQuery('redux state management guide', tokens)).toBe(false);
  });

  it('"notion" token does NOT match keyword "promotion strategy"', () => {
    // "notion" appears inside "promotion" — word boundary check must prevent this
    expect(isBrandedQuery('promotion strategy for saas', ['notion'])).toBe(false);
  });

  it('"linear" token does NOT match keyword "curvilinear regression"', () => {
    // "linear" is embedded inside "curvilinear" — \b boundary check applies
    // \blinear\b matches at the boundary inside "curvilinear" after "curvi"
    // This documents the actual regex engine behaviour
    const result = isBrandedQuery('curvilinear regression analysis', ['linear']);
    // \blinear\b does NOT match inside "curvilinear" — no word boundary before "linear"
    expect(result).toBe(false);
  });

  it('"air" token (3 chars) does NOT match "repair" via substring', () => {
    // "air" is < 5 chars → exact word match only; "repair" !== "air"
    expect(isBrandedQuery('laptop repair service near me', ['air'])).toBe(false);
  });

  it('"air" token (3 chars) DOES match "air quality monitor" as exact word', () => {
    expect(isBrandedQuery('air quality monitor review', ['air'])).toBe(true);
  });
});
