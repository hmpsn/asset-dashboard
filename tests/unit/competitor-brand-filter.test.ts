// tests/unit/competitor-brand-filter.test.ts
// Tests for competitor brand name detection and filtering.

import { describe, it, expect } from 'vitest';
import {
  extractBrandTokens,
  isBrandedQuery,
  filterBrandedContentGaps,
  filterBrandedKeywords,
} from '../../server/competitor-brand-filter.js';

// ── extractBrandTokens ─────────────────────────────────────────────

describe('extractBrandTokens', () => {
  it('extracts base domain name', () => {
    const tokens = extractBrandTokens('semrush.com');
    expect(tokens).toContain('semrush');
  });

  it('strips common SaaS prefixes to find core brand', () => {
    const tokens = extractBrandTokens('getdx.com');
    expect(tokens).toContain('getdx');
    expect(tokens).toContain('dx');
  });

  it('handles "try" prefix', () => {
    const tokens = extractBrandTokens('trylinear.com');
    expect(tokens).toContain('trylinear');
    expect(tokens).toContain('linear');
  });

  it('handles "use" prefix', () => {
    const tokens = extractBrandTokens('usefathom.com');
    expect(tokens).toContain('usefathom');
    expect(tokens).toContain('fathom');
  });

  it('handles hyphenated domains', () => {
    const tokens = extractBrandTokens('my-tool.io');
    expect(tokens).toContain('tool');
    expect(tokens).toContain('mytool');
  });

  it('handles ccTLDs like .co.uk', () => {
    const tokens = extractBrandTokens('competitor.co.uk');
    expect(tokens).toContain('competitor');
    // Should NOT contain "co" as a brand token
    expect(tokens).not.toContain('co');
  });

  it('strips protocol and www', () => {
    const tokens = extractBrandTokens('https://www.acme.com');
    expect(tokens).toContain('acme');
  });

  it('handles .io domains', () => {
    const tokens = extractBrandTokens('linear.app');
    expect(tokens).toContain('linear');
  });

  it('returns unique tokens', () => {
    const tokens = extractBrandTokens('getdx.com');
    const unique = [...new Set(tokens)];
    expect(tokens.length).toBe(unique.length);
  });

  it('handles the specific getdx.com → dx case', () => {
    const tokens = extractBrandTokens('getdx.com');
    // This is the exact case that triggered the bug report
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens).toContain('dx');
  });
});

// ── isBrandedQuery ──────────────────────────────────────────────────

describe('isBrandedQuery', () => {
  it('detects long brand tokens via word boundary', () => {
    expect(isBrandedQuery('semrush alternatives', ['semrush'])).toBe(true);
    expect(isBrandedQuery('best semrush competitor', ['semrush'])).toBe(true);
  });

  it('detects short brand tokens (3-4 chars) via exact word match', () => {
    // "dx" as a standalone word should match
    expect(isBrandedQuery('dx integrations', ['dx'])).toBe(true);
    expect(isBrandedQuery('dx vs faros', ['dx'])).toBe(true);
  });

  it('does NOT match short tokens as substrings', () => {
    // "dx" should NOT match inside "redux" or "index"
    expect(isBrandedQuery('redux toolkit', ['dx'])).toBe(false);
    expect(isBrandedQuery('index management', ['dx'])).toBe(false);
  });

  it('skips single-char tokens', () => {
    expect(isBrandedQuery('a guide to development', ['a'])).toBe(false);
  });

  it('matches 2-char tokens as exact words (callers control which tokens to pass)', () => {
    // "dx" as standalone word matches — extractBrandTokens only produces
    // 2-char tokens from high-confidence prefix stripping, not random domain parts
    expect(isBrandedQuery('dx tools review', ['dx'])).toBe(true);
    // But does NOT substring-match
    expect(isBrandedQuery('redux tools', ['dx'])).toBe(false);
  });

  it('is case insensitive', () => {
    expect(isBrandedQuery('DX Integrations Guide', ['dx'])).toBe(true);
    expect(isBrandedQuery('SEMRUSH review', ['semrush'])).toBe(true);
  });

  it('handles the full getdx.com token set', () => {
    const tokens = extractBrandTokens('getdx.com');
    expect(isBrandedQuery('dx integrations', tokens)).toBe(true);
    expect(isBrandedQuery('getdx review', tokens)).toBe(true);
    expect(isBrandedQuery('developer experience tools', tokens)).toBe(false);
  });
});

// ── filterBrandedContentGaps ────────────────────────────────────────

describe('filterBrandedContentGaps', () => {
  const gaps = [
    { targetKeyword: 'dx integrations', topic: 'Guide to DX Integrations' },
    { targetKeyword: 'engineering metrics dashboard', topic: 'Best Engineering Metrics Tools' },
    { targetKeyword: 'getdx review', topic: 'GetDX Review and Alternatives' },
    { targetKeyword: 'developer productivity tools', topic: 'Top Developer Productivity Tools' },
  ];

  it('removes gaps with competitor brand in targetKeyword', () => {
    const { filtered, removed } = filterBrandedContentGaps(gaps, ['getdx.com']);
    expect(removed.length).toBeGreaterThan(0);
    expect(removed.some(g => g.targetKeyword === 'dx integrations')).toBe(true);
    expect(removed.some(g => g.targetKeyword === 'getdx review')).toBe(true);
  });

  it('preserves non-branded gaps', () => {
    const { filtered } = filterBrandedContentGaps(gaps, ['getdx.com']);
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.some(g => g.targetKeyword === 'engineering metrics dashboard')).toBe(true);
    expect(filtered.some(g => g.targetKeyword === 'developer productivity tools')).toBe(true);
  });

  it('returns all gaps when no competitor domains', () => {
    const { filtered, removed } = filterBrandedContentGaps(gaps, []);
    expect(filtered.length).toBe(gaps.length);
    expect(removed.length).toBe(0);
  });

  it('handles multiple competitor domains', () => {
    const { removed } = filterBrandedContentGaps(
      [
        { targetKeyword: 'dx integrations', topic: 'DX Guide' },
        { targetKeyword: 'jellyfish analytics', topic: 'Jellyfish Review' },
        { targetKeyword: 'sprint velocity tracking', topic: 'Sprint Velocity Guide' },
      ],
      ['getdx.com', 'jellyfish.co'],
    );
    expect(removed.length).toBeGreaterThan(0);
    expect(removed.some(g => g.targetKeyword === 'dx integrations')).toBe(true);
    expect(removed.some(g => g.targetKeyword === 'jellyfish analytics')).toBe(true);
    // Non-branded gap should survive
  });
});

// ── filterBrandedKeywords ───────────────────────────────────────────

describe('filterBrandedKeywords', () => {
  it('removes branded keywords from pool', () => {
    const pool = new Map([
      ['dx integrations', { volume: 1600, difficulty: 40, source: 'competitor:getdx.com' }],
      ['engineering metrics', { volume: 800, difficulty: 30, source: 'competitor:getdx.com' }],
      ['getdx pricing', { volume: 200, difficulty: 20, source: 'gap:getdx.com' }],
      ['developer productivity', { volume: 500, difficulty: 35, source: 'related' }],
    ]);

    const removed = filterBrandedKeywords(pool, ['getdx.com']);
    expect(removed).toBeGreaterThan(0);
    expect(pool.has('dx integrations')).toBe(false);
    expect(pool.has('getdx pricing')).toBe(false);
    expect(pool.has('engineering metrics')).toBe(true);
    expect(pool.has('developer productivity')).toBe(true);
  });

  it('returns 0 when no competitor domains', () => {
    const pool = new Map([
      ['some keyword', { volume: 100, difficulty: 20, source: 'gsc' }],
    ]);
    expect(filterBrandedKeywords(pool, [])).toBe(0);
    expect(pool.size).toBe(1);
  });
});
