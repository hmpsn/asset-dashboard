/**
 * Unit tests for internal links Zod validation schemas.
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { parseJsonSafe } from '../../server/db/json-validation.js';
import { linkSuggestionSchema, linkSuggestionsArraySchema } from '../../server/schemas/internal-links-schemas.js';

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(),
  }),
}));

const validSuggestion = {
  fromPage: '/blog/seo-tips',
  fromTitle: 'SEO Tips',
  toPage: '/services/seo',
  toTitle: 'SEO Services',
  anchorText: 'our SEO services',
  reason: 'Relevant internal link to service page',
  priority: 'high' as const,
};

describe('linkSuggestionsArraySchema', () => {
  it('parses valid suggestions array', () => {
    const raw = JSON.stringify([validSuggestion]);
    const result = parseJsonSafe(raw, linkSuggestionsArraySchema, []);
    expect(result).toHaveLength(1);
    expect(result[0].fromPage).toBe('/blog/seo-tips');
    expect(result[0].priority).toBe('high');
  });

  it('parses empty array', () => {
    const result = parseJsonSafe('[]', linkSuggestionsArraySchema, []);
    expect(result).toEqual([]);
  });

  it('returns fallback for wrong priority enum', () => {
    const bad = [{ ...validSuggestion, priority: 'critical' }];
    const result = parseJsonSafe(JSON.stringify(bad), linkSuggestionsArraySchema, []);
    expect(result).toEqual([]);
  });

  it('returns fallback for missing required field', () => {
    const { anchorText, ...noAnchor } = validSuggestion;
    const result = parseJsonSafe(JSON.stringify([noAnchor]), linkSuggestionsArraySchema, []);
    expect(result).toEqual([]);
  });

  it('returns fallback for malformed JSON', () => {
    expect(parseJsonSafe('{bad', linkSuggestionsArraySchema, [])).toEqual([]);
  });

  it('returns fallback for null', () => {
    expect(parseJsonSafe(null, linkSuggestionsArraySchema, [])).toEqual([]);
  });

  it('returns fallback for undefined', () => {
    expect(parseJsonSafe(undefined, linkSuggestionsArraySchema, [])).toEqual([]);
  });

  it('allows extra fields via passthrough', () => {
    const extra = [{ ...validSuggestion, confidence: 0.95 }];
    const result = parseJsonSafe(JSON.stringify(extra), linkSuggestionsArraySchema, []);
    expect(result).toHaveLength(1);
    expect((result[0] as any).confidence).toBe(0.95);
  });
});
