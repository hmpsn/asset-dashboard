/**
 * Unit tests for internal links Zod validation schemas.
 * Tests use parseJsonSafeArray + linkSuggestionSchema to match the production
 * code path in server/internal-links.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { parseJsonSafeArray } from '../../server/db/json-validation.js';
import { linkSuggestionSchema } from '../../server/schemas/internal-links-schemas.js';

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

describe('linkSuggestionSchema via parseJsonSafeArray (production path)', () => {
  it('parses valid suggestions array', () => {
    const result = parseJsonSafeArray(JSON.stringify([validSuggestion]), linkSuggestionSchema);
    expect(result).toHaveLength(1);
    expect(result[0].fromPage).toBe('/blog/seo-tips');
    expect(result[0].priority).toBe('high');
  });

  it('parses empty array', () => {
    expect(parseJsonSafeArray('[]', linkSuggestionSchema)).toEqual([]);
  });

  it('filters item with wrong priority enum, keeps valid items', () => {
    const data = [
      validSuggestion,
      { ...validSuggestion, toPage: '/services/ppc', priority: 'critical' }, // invalid enum
    ];
    const result = parseJsonSafeArray(JSON.stringify(data), linkSuggestionSchema);
    // Per-item: bad item is filtered, good item is kept
    expect(result).toHaveLength(1);
    expect(result[0].fromPage).toBe('/blog/seo-tips');
  });

  it('returns empty array when all items have wrong priority enum', () => {
    const bad = [{ ...validSuggestion, priority: 'critical' }];
    const result = parseJsonSafeArray(JSON.stringify(bad), linkSuggestionSchema);
    expect(result).toEqual([]);
  });

  it('filters item with missing required field, keeps valid items', () => {
    const { anchorText, ...noAnchor } = validSuggestion;
    const data = [validSuggestion, noAnchor];
    const result = parseJsonSafeArray(JSON.stringify(data), linkSuggestionSchema);
    expect(result).toHaveLength(1);
    expect(result[0].anchorText).toBe('our SEO services');
  });

  it('returns empty array for malformed JSON', () => {
    expect(parseJsonSafeArray('{bad', linkSuggestionSchema)).toEqual([]);
  });

  it('returns empty array for null', () => {
    expect(parseJsonSafeArray(null, linkSuggestionSchema)).toEqual([]);
  });

  it('returns empty array for undefined', () => {
    expect(parseJsonSafeArray(undefined, linkSuggestionSchema)).toEqual([]);
  });

  it('allows extra fields via passthrough on valid items', () => {
    const extra = [{ ...validSuggestion, confidence: 0.95 }];
    const result = parseJsonSafeArray(JSON.stringify(extra), linkSuggestionSchema);
    expect(result).toHaveLength(1);
    expect((result[0] as any).confidence).toBe(0.95);
  });
});
