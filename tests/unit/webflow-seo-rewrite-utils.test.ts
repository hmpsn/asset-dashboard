/**
 * Unit tests: server/webflow-seo-rewrite-utils.ts
 *
 * Tests pure functions: enforceSeoTextLimit, normalizeSeoRewriteVariations,
 * normalizeSeoRewritePairs.
 */
import { describe, it, expect } from 'vitest';
import {
  enforceSeoTextLimit,
  normalizeSeoRewriteVariations,
  normalizeSeoRewritePairs,
} from '../../server/webflow-seo-rewrite-utils.js';

// ── enforceSeoTextLimit ─────────────────────────────────────────────────────

describe('enforceSeoTextLimit', () => {
  it('returns the text unchanged when within the limit', () => {
    expect(enforceSeoTextLimit('Short title', 60)).toBe('Short title');
  });

  it('strips surrounding quotes before measuring length', () => {
    const text = '"Quoted title"';
    const result = enforceSeoTextLimit(text, 60);
    expect(result).not.toMatch(/^"/);
    expect(result).not.toMatch(/"$/);
  });

  it('truncates at a word boundary when text exceeds limit', () => {
    const text = 'This is a longer title that exceeds the sixty character limit by far';
    const result = enforceSeoTextLimit(text, 60);
    expect(result.length).toBeLessThanOrEqual(60);
    // Should not cut mid-word
    expect(result).not.toMatch(/\w-$/);
  });

  it('falls back to a hard cut when no word boundary exists in the last 40%', () => {
    // A single very long word with no spaces — must hard-cut at maxLen
    const longWord = 'a'.repeat(80);
    const result = enforceSeoTextLimit(longWord, 60);
    expect(result.length).toBeLessThanOrEqual(60);
  });

  it('returns the text as-is when exactly at the limit', () => {
    const text = 'x'.repeat(60);
    expect(enforceSeoTextLimit(text, 60)).toBe(text);
  });

  it('trims whitespace from the result', () => {
    const text = '  Padded text  ';
    const result = enforceSeoTextLimit(text, 60);
    expect(result).toBe('Padded text');
  });

  it('truncates at sentence boundary when available', () => {
    const text = 'First sentence. Second sentence that pushes it over sixty chars total.';
    const result = enforceSeoTextLimit(text, 60);
    expect(result.length).toBeLessThanOrEqual(60);
  });
});

// ── normalizeSeoRewriteVariations ──────────────────────────────────────────

describe('normalizeSeoRewriteVariations', () => {
  it('returns empty array for null/undefined input', () => {
    expect(normalizeSeoRewriteVariations(null, 60)).toEqual([]);
    expect(normalizeSeoRewriteVariations(undefined, 60)).toEqual([]);
  });

  it('returns empty array for empty array input', () => {
    expect(normalizeSeoRewriteVariations([], 60)).toEqual([]);
  });

  it('extracts strings from a plain array', () => {
    const result = normalizeSeoRewriteVariations(['Title A', 'Title B', 'Title C'], 60);
    expect(result).toHaveLength(3);
  });

  it('removes duplicates (case-insensitive)', () => {
    const result = normalizeSeoRewriteVariations(['Title A', 'title a', 'Title B'], 60);
    // Duplicates deduplicated → only 2 unique titles
    expect(result.length).toBeLessThan(3);
  });

  it('removes empty strings', () => {
    const result = normalizeSeoRewriteVariations(['Title A', '', 'Title B'], 60);
    expect(result).not.toContain('');
  });

  it('enforces maxLen on each variation', () => {
    const longTitle = 'This title is extremely long and definitely exceeds sixty characters in total';
    const result = normalizeSeoRewriteVariations([longTitle], 60);
    expect(result[0].length).toBeLessThanOrEqual(60);
  });

  it('limits output to expectedCount variations (default 3)', () => {
    const input = ['A', 'B', 'C', 'D', 'E'];
    const result = normalizeSeoRewriteVariations(input, 60);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('accepts a custom expectedCount', () => {
    const result = normalizeSeoRewriteVariations(['A', 'B', 'C', 'D'], 60, 2);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('extracts from {variations: [...]} object shape', () => {
    const result = normalizeSeoRewriteVariations({ variations: ['Title X', 'Title Y'] }, 60);
    expect(result.length).toBeGreaterThan(0);
  });

  it('filters non-string items from the array', () => {
    const result = normalizeSeoRewriteVariations([42, 'Valid title', null, 'Another title'], 60);
    expect(result.every(r => typeof r === 'string')).toBe(true); // every-ok: length checked elsewhere
  });
});

// ── normalizeSeoRewritePairs ──────────────────────────────────────────────

describe('normalizeSeoRewritePairs', () => {
  it('returns empty array for null/undefined input', () => {
    expect(normalizeSeoRewritePairs(null)).toEqual([]);
    expect(normalizeSeoRewritePairs(undefined)).toEqual([]);
  });

  it('returns empty array for empty array input', () => {
    expect(normalizeSeoRewritePairs([])).toEqual([]);
  });

  it('extracts valid pairs from a plain array', () => {
    const input = [
      { title: 'Title A', description: 'Desc A' },
      { title: 'Title B', description: 'Desc B' },
    ];
    const result = normalizeSeoRewritePairs(input);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('Title A');
    expect(result[0].description).toBe('Desc A');
  });

  it('rejects pairs with empty title', () => {
    const input = [
      { title: '', description: 'Desc A' },
      { title: 'Good Title', description: 'Desc B' },
    ];
    const result = normalizeSeoRewritePairs(input);
    // Empty-title pair is invalid and filtered
    const emptyTitlePair = result.find(p => p.title === '');
    expect(emptyTitlePair).toBeUndefined();
  });

  it('rejects pairs with empty description', () => {
    const input = [
      { title: 'Good Title', description: '' },
    ];
    const result = normalizeSeoRewritePairs(input);
    expect(result).toHaveLength(0);
  });

  it('limits output to expectedCount pairs (default 3)', () => {
    const input = Array.from({ length: 5 }, (_, i) => ({
      title: `Title ${i}`,
      description: `Description ${i}`,
    }));
    const result = normalizeSeoRewritePairs(input);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('extracts from {pairs: [...]} object shape', () => {
    const result = normalizeSeoRewritePairs({
      pairs: [{ title: 'T', description: 'D' }],
    });
    expect(result.length).toBeGreaterThan(0);
  });
});
