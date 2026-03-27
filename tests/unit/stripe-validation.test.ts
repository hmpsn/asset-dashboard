/**
 * Unit tests for Stripe payment Zod validation schemas.
 */
import { describe, it, expect, vi } from 'vitest';
import { parseJsonSafe } from '../../server/db/json-validation.js';
import { cartItemsArraySchema, stringArraySchema } from '../../server/schemas/payment-schemas.js';

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(),
  }),
}));

describe('cartItemsArraySchema', () => {
  it('parses valid cart items', () => {
    const items = [{ productType: 'fix_title', pageIds: ['/about'], quantity: 1 }];
    const result = parseJsonSafe(JSON.stringify(items), cartItemsArraySchema, []);
    expect(result).toHaveLength(1);
    expect(result[0].productType).toBe('fix_title');
    expect(result[0].pageIds).toEqual(['/about']);
  });

  it('parses cart items without optional fields', () => {
    const items = [{ productType: 'schema_faq' }];
    const result = parseJsonSafe(JSON.stringify(items), cartItemsArraySchema, []);
    expect(result).toHaveLength(1);
    expect(result[0].pageIds).toBeUndefined();
  });

  it('returns fallback for wrong productType type', () => {
    const items = [{ productType: 123 }];
    expect(parseJsonSafe(JSON.stringify(items), cartItemsArraySchema, [])).toEqual([]);
  });

  it('returns fallback for malformed JSON', () => {
    expect(parseJsonSafe('{bad', cartItemsArraySchema, [])).toEqual([]);
  });

  it('returns fallback for null', () => {
    expect(parseJsonSafe(null, cartItemsArraySchema, [])).toEqual([]);
  });
});

describe('stringArraySchema (pageIds/issueChecks)', () => {
  it('parses valid string array', () => {
    const result = parseJsonSafe(JSON.stringify(['/about', '/contact']), stringArraySchema, []);
    expect(result).toEqual(['/about', '/contact']);
  });

  it('returns fallback for non-string elements', () => {
    expect(parseJsonSafe(JSON.stringify([1, 2, 3]), stringArraySchema, [])).toEqual([]);
  });

  it('returns fallback for null', () => {
    expect(parseJsonSafe(null, stringArraySchema, [])).toEqual([]);
  });
});
