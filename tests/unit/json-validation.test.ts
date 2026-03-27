/**
 * Unit tests for server/db/json-validation.ts — safe JSON parsing with Zod validation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { parseJsonSafe, parseJsonFallback } from '../../server/db/json-validation.js';

// Mock the logger to verify warnings
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

const testSchema = z.object({
  name: z.string(),
  score: z.number(),
  tags: z.array(z.string()).optional(),
});

type TestData = z.infer<typeof testSchema>;
const fallback: TestData = { name: '', score: 0 };

describe('parseJsonSafe', () => {
  it('returns parsed data for valid JSON matching schema', () => {
    const raw = JSON.stringify({ name: 'page-a', score: 85, tags: ['seo'] });
    const result = parseJsonSafe(raw, testSchema, fallback);
    expect(result).toEqual({ name: 'page-a', score: 85, tags: ['seo'] });
  });

  it('returns fallback for null input', () => {
    expect(parseJsonSafe(null, testSchema, fallback)).toBe(fallback);
  });

  it('returns fallback for undefined input', () => {
    expect(parseJsonSafe(undefined, testSchema, fallback)).toBe(fallback);
  });

  it('returns fallback for empty string', () => {
    expect(parseJsonSafe('', testSchema, fallback)).toBe(fallback);
  });

  it('returns fallback for malformed JSON', () => {
    expect(parseJsonSafe('{not json', testSchema, fallback)).toBe(fallback);
  });

  it('returns fallback when schema validation fails (wrong type)', () => {
    const raw = JSON.stringify({ name: 123, score: 'not-a-number' });
    expect(parseJsonSafe(raw, testSchema, fallback)).toBe(fallback);
  });

  it('returns fallback when required field is missing', () => {
    const raw = JSON.stringify({ name: 'page-a' }); // missing score
    expect(parseJsonSafe(raw, testSchema, fallback)).toBe(fallback);
  });

  it('allows missing optional fields', () => {
    const raw = JSON.stringify({ name: 'page-a', score: 72 }); // no tags
    const result = parseJsonSafe(raw, testSchema, fallback);
    expect(result).toEqual({ name: 'page-a', score: 72 });
    expect(result.tags).toBeUndefined();
  });

  it('allows extra fields with passthrough schema', () => {
    const passthroughSchema = testSchema.passthrough();
    const raw = JSON.stringify({ name: 'page-a', score: 72, extra: true });
    const result = parseJsonSafe(raw, passthroughSchema, fallback);
    expect((result as any).extra).toBe(true);
  });

  it('strips extra fields with strict schema (default Zod behavior)', () => {
    const raw = JSON.stringify({ name: 'page-a', score: 72, extra: true });
    const result = parseJsonSafe(raw, testSchema, fallback);
    expect(result).toEqual({ name: 'page-a', score: 72 });
    expect((result as any).extra).toBeUndefined();
  });

  it('works with array schemas', () => {
    const arraySchema = z.array(z.object({ id: z.string() }));
    const raw = JSON.stringify([{ id: 'a' }, { id: 'b' }]);
    const result = parseJsonSafe(raw, arraySchema, []);
    expect(result).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('returns empty array fallback for malformed array data', () => {
    const arraySchema = z.array(z.object({ id: z.string() }));
    const raw = JSON.stringify([{ id: 123 }]); // id should be string
    const result = parseJsonSafe(raw, arraySchema, []);
    expect(result).toEqual([]);
  });
});

describe('parseJsonFallback', () => {
  it('returns parsed data for valid JSON', () => {
    const raw = JSON.stringify({ a: 1 });
    expect(parseJsonFallback(raw, {})).toEqual({ a: 1 });
  });

  it('returns fallback for null', () => {
    expect(parseJsonFallback(null, [])).toEqual([]);
  });

  it('returns fallback for undefined', () => {
    expect(parseJsonFallback(undefined, {})).toEqual({});
  });

  it('returns fallback for empty string', () => {
    expect(parseJsonFallback('', 42)).toBe(42);
  });

  it('returns fallback for malformed JSON', () => {
    expect(parseJsonFallback('{bad', 'default')).toBe('default');
  });

  it('parses arrays', () => {
    expect(parseJsonFallback('[1,2,3]', [])).toEqual([1, 2, 3]);
  });

  it('parses primitive JSON values', () => {
    expect(parseJsonFallback('"hello"', '')).toBe('hello');
    expect(parseJsonFallback('42', 0)).toBe(42);
    expect(parseJsonFallback('true', false)).toBe(true);
  });
});
