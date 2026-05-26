/**
 * Unit tests for server/db/json-validation.ts — safe JSON parsing with Zod validation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { parseJsonSafe, parseJsonSafeArray, parseJsonFallback } from '../../server/db/json-validation.js';

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

// ─────────────────────────────────────────────────────────────────────────────
// parseJsonSafe
// ─────────────────────────────────────────────────────────────────────────────

describe('parseJsonSafe', () => {
  // ── null / undefined / empty inputs ────────────────────────────────────────

  it('returns fallback for null input', () => {
    expect(parseJsonSafe(null, testSchema, fallback)).toBe(fallback);
  });

  it('returns fallback for undefined input', () => {
    expect(parseJsonSafe(undefined, testSchema, fallback)).toBe(fallback);
  });

  it('returns fallback for empty string', () => {
    expect(parseJsonSafe('', testSchema, fallback)).toBe(fallback);
  });

  // ── happy-path parsing ──────────────────────────────────────────────────────

  it('returns parsed data for valid JSON matching schema', () => {
    const raw = JSON.stringify({ name: 'page-a', score: 85, tags: ['seo'] });
    const result = parseJsonSafe(raw, testSchema, fallback);
    expect(result).toEqual({ name: 'page-a', score: 85, tags: ['seo'] });
  });

  it('allows missing optional fields', () => {
    const raw = JSON.stringify({ name: 'page-a', score: 72 }); // no tags
    const result = parseJsonSafe(raw, testSchema, fallback);
    expect(result).toEqual({ name: 'page-a', score: 72 });
    expect(result.tags).toBeUndefined();
  });

  it('returns correct data, not the fallback reference, for valid input', () => {
    const raw = JSON.stringify({ name: 'x', score: 1 });
    const result = parseJsonSafe(raw, testSchema, fallback);
    expect(result).not.toBe(fallback);
    expect(result.name).toBe('x');
  });

  // ── schema-validation failures ──────────────────────────────────────────────

  it('returns fallback when schema validation fails (wrong type)', () => {
    const raw = JSON.stringify({ name: 123, score: 'not-a-number' });
    expect(parseJsonSafe(raw, testSchema, fallback)).toBe(fallback);
  });

  it('returns fallback when required field is missing (score absent)', () => {
    const raw = JSON.stringify({ name: 'page-a' });
    expect(parseJsonSafe(raw, testSchema, fallback)).toBe(fallback);
  });

  it('returns fallback when required field is missing (name absent)', () => {
    const raw = JSON.stringify({ score: 10 });
    expect(parseJsonSafe(raw, testSchema, fallback)).toBe(fallback);
  });

  it('returns fallback for valid JSON string that is a primitive (schema expects object)', () => {
    expect(parseJsonSafe('"just a string"', testSchema, fallback)).toBe(fallback);
  });

  it('returns fallback for valid JSON number (schema expects object)', () => {
    expect(parseJsonSafe('42', testSchema, fallback)).toBe(fallback);
  });

  it('returns fallback for JSON null (schema expects object)', () => {
    expect(parseJsonSafe('null', testSchema, fallback)).toBe(fallback);
  });

  it('returns fallback for JSON array when schema expects object', () => {
    expect(parseJsonSafe('[]', testSchema, fallback)).toBe(fallback);
  });

  // ── invalid JSON ────────────────────────────────────────────────────────────

  it('returns fallback for malformed JSON', () => {
    expect(parseJsonSafe('{not json', testSchema, fallback)).toBe(fallback);
  });

  it('returns fallback for trailing comma in JSON object', () => {
    expect(parseJsonSafe('{"name":"a","score":1,}', testSchema, fallback)).toBe(fallback);
  });

  it('returns fallback for completely arbitrary non-JSON string', () => {
    expect(parseJsonSafe('hello world', testSchema, fallback)).toBe(fallback);
  });

  it('returns fallback for whitespace-only string', () => {
    expect(parseJsonSafe('   ', testSchema, fallback)).toBe(fallback);
  });

  // ── extra fields behavior (Zod default strip) ───────────────────────────────

  it('strips extra fields with default Zod strip behavior', () => {
    const raw = JSON.stringify({ name: 'page-a', score: 72, extra: true });
    const result = parseJsonSafe(raw, testSchema, fallback);
    expect(result).toEqual({ name: 'page-a', score: 72 });
    expect((result as any).extra).toBeUndefined();
  });

  it('allows extra fields with passthrough schema', () => {
    const passthroughSchema = testSchema.passthrough();
    const raw = JSON.stringify({ name: 'page-a', score: 72, extra: true });
    const result = parseJsonSafe(raw, passthroughSchema, fallback);
    expect((result as any).extra).toBe(true);
  });

  it('rejects extra fields with strict schema', () => {
    const strictSchema = testSchema.strict();
    const raw = JSON.stringify({ name: 'page-a', score: 72, extra: true });
    expect(parseJsonSafe(raw, strictSchema, fallback)).toBe(fallback);
  });

  // ── array schema ────────────────────────────────────────────────────────────

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

  it('parses an empty JSON array with an array schema', () => {
    const arraySchema = z.array(z.string());
    expect(parseJsonSafe('[]', arraySchema, [])).toEqual([]);
  });

  // ── number schema ───────────────────────────────────────────────────────────

  it('works with a number schema', () => {
    expect(parseJsonSafe('42', z.number(), -1)).toBe(42);
  });

  it('returns fallback for number schema when input is a string literal', () => {
    expect(parseJsonSafe('"hello"', z.number(), -1)).toBe(-1);
  });

  // ── boolean schema ──────────────────────────────────────────────────────────

  it('works with a boolean schema (true)', () => {
    expect(parseJsonSafe('true', z.boolean(), false)).toBe(true);
  });

  it('works with a boolean schema (false)', () => {
    expect(parseJsonSafe('false', z.boolean(), true)).toBe(false);
  });

  // ── string schema ───────────────────────────────────────────────────────────

  it('works with a string schema', () => {
    expect(parseJsonSafe('"hello"', z.string(), '')).toBe('hello');
  });

  it('returns fallback for string schema when input is a number', () => {
    expect(parseJsonSafe('99', z.string(), 'default')).toBe('default');
  });

  // ── nested object ───────────────────────────────────────────────────────────

  it('parses deeply nested objects', () => {
    const deepSchema = z.object({
      outer: z.object({
        inner: z.object({ value: z.number() }),
      }),
    });
    const raw = JSON.stringify({ outer: { inner: { value: 7 } } });
    expect(parseJsonSafe(raw, deepSchema, null)).toEqual({ outer: { inner: { value: 7 } } });
  });

  it('returns fallback when nested required field is absent', () => {
    const deepSchema = z.object({
      outer: z.object({ inner: z.object({ value: z.number() }) }),
    });
    const raw = JSON.stringify({ outer: { inner: {} } }); // value missing
    expect(parseJsonSafe(raw, deepSchema, null)).toBeNull();
  });

  // ── context parameter ───────────────────────────────────────────────────────

  it('accepts context parameter without throwing', () => {
    const raw = JSON.stringify({ name: 'ok', score: 1 });
    expect(() =>
      parseJsonSafe(raw, testSchema, fallback, { workspaceId: 'ws-1', field: 'col', table: 'tbl' }),
    ).not.toThrow();
  });

  it('does not throw when logging validation failure with context', () => {
    const raw = JSON.stringify({ bad: true });
    expect(() =>
      parseJsonSafe(raw, testSchema, fallback, { workspaceId: 'ws-1', field: 'col', table: 'tbl' }),
    ).not.toThrow();
  });

  it('does not throw when logging JSON parse failure with context', () => {
    expect(() =>
      parseJsonSafe('not json', testSchema, fallback, { workspaceId: 'ws-X', field: 'f', table: 't' }),
    ).not.toThrow();
  });

  // ── union / enum schemas ────────────────────────────────────────────────────

  it('works with z.enum schemas', () => {
    const enumSchema = z.enum(['active', 'inactive', 'pending']);
    expect(parseJsonSafe('"active"', enumSchema, 'pending')).toBe('active');
  });

  it('returns fallback for value not in enum', () => {
    const enumSchema = z.enum(['active', 'inactive']);
    expect(parseJsonSafe('"unknown"', enumSchema, 'active')).toBe('active');
  });

  // ── null fallback ───────────────────────────────────────────────────────────

  it('supports null as a fallback value', () => {
    expect(parseJsonSafe('not json', testSchema, null)).toBeNull();
  });

  it('returns null fallback for invalid JSON when fallback is null', () => {
    expect(parseJsonSafe(undefined, testSchema, null)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseJsonSafeArray
// ─────────────────────────────────────────────────────────────────────────────

describe('parseJsonSafeArray', () => {
  const itemSchema = z.object({ id: z.string(), score: z.number() });

  // ── null / undefined / empty inputs ────────────────────────────────────────

  it('returns empty array for null input', () => {
    expect(parseJsonSafeArray(null, itemSchema)).toEqual([]);
  });

  it('returns empty array for undefined input', () => {
    expect(parseJsonSafeArray(undefined, itemSchema)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseJsonSafeArray('', itemSchema)).toEqual([]);
  });

  // ── valid arrays ────────────────────────────────────────────────────────────

  it('returns all items when every item passes validation', () => {
    const data = [{ id: 'a', score: 90 }, { id: 'b', score: 75 }];
    const result = parseJsonSafeArray(JSON.stringify(data), itemSchema);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('a');
    expect(result[1].score).toBe(75);
  });

  it('returns empty array for valid empty array input', () => {
    expect(parseJsonSafeArray('[]', itemSchema)).toEqual([]);
  });

  it('preserves order of valid items', () => {
    const data = [{ id: 'c', score: 3 }, { id: 'a', score: 1 }, { id: 'b', score: 2 }];
    const result = parseJsonSafeArray(JSON.stringify(data), itemSchema);
    expect(result.map(r => r.id)).toEqual(['c', 'a', 'b']);
  });

  // ── per-item filtering ──────────────────────────────────────────────────────

  it('filters bad items and keeps good ones (per-item validation)', () => {
    const data = [{ id: 'good', score: 85 }, { id: 'bad', score: 'not-a-number' }];
    const result = parseJsonSafeArray(JSON.stringify(data), itemSchema);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('good');
  });

  it('returns empty array when all items fail validation', () => {
    const data = [{ id: 123, score: 'wrong' }, { score: 99 }]; // both invalid
    const result = parseJsonSafeArray(JSON.stringify(data), itemSchema);
    expect(result).toEqual([]);
  });

  it('filters null items within the array', () => {
    const data = [{ id: 'ok', score: 1 }, null];
    const result = parseJsonSafeArray(JSON.stringify(data), itemSchema);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ok');
  });

  it('filters items where a required field is missing', () => {
    const data = [{ id: 'ok', score: 5 }, { id: 'no-score' }];
    const result = parseJsonSafeArray(JSON.stringify(data), itemSchema);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ok');
  });

  // ── non-array JSON ──────────────────────────────────────────────────────────

  it('returns empty array for valid JSON that is not an array (object)', () => {
    const result = parseJsonSafeArray(JSON.stringify({ id: 'a', score: 1 }), itemSchema);
    expect(result).toEqual([]);
  });

  it('returns empty array for valid JSON that is a string primitive', () => {
    expect(parseJsonSafeArray('"just a string"', itemSchema)).toEqual([]);
  });

  it('returns empty array for valid JSON number primitive', () => {
    expect(parseJsonSafeArray('42', itemSchema)).toEqual([]);
  });

  it('returns empty array for JSON null', () => {
    expect(parseJsonSafeArray('null', itemSchema)).toEqual([]);
  });

  it('returns empty array for JSON boolean', () => {
    expect(parseJsonSafeArray('true', itemSchema)).toEqual([]);
  });

  // ── malformed JSON ──────────────────────────────────────────────────────────

  it('returns empty array for malformed JSON', () => {
    expect(parseJsonSafeArray('{bad json', itemSchema)).toEqual([]);
  });

  it('returns empty array for trailing-comma JSON (invalid syntax)', () => {
    expect(parseJsonSafeArray('[{"id":"a","score":1},]', itemSchema)).toEqual([]);
  });

  // ── alternative item schemas ────────────────────────────────────────────────

  it('works with simple scalar schemas (z.string()) — filters non-strings', () => {
    const data = ['apple', 'banana', 42, null, 'cherry'];
    const result = parseJsonSafeArray(JSON.stringify(data), z.string());
    expect(result).toEqual(['apple', 'banana', 'cherry']);
  });

  it('works with z.number() item schema', () => {
    const data = [1, 2, 'three', 4];
    const result = parseJsonSafeArray(JSON.stringify(data), z.number());
    expect(result).toEqual([1, 2, 4]);
  });

  it('works with enum item schema', () => {
    const statusSchema = z.enum(['active', 'inactive']);
    const data = ['active', 'unknown', 'inactive'];
    const result = parseJsonSafeArray(JSON.stringify(data), statusSchema);
    expect(result).toEqual(['active', 'inactive']);
  });

  it('works with nested object item schema', () => {
    const nestedSchema = z.object({ meta: z.object({ key: z.string() }) });
    const data = [{ meta: { key: 'a' } }, { meta: { key: 123 } }, { meta: { key: 'b' } }];
    const result = parseJsonSafeArray(JSON.stringify(data), nestedSchema);
    expect(result).toHaveLength(2);
    expect(result[0].meta.key).toBe('a');
    expect(result[1].meta.key).toBe('b');
  });

  it('returns all items from a large array when all are valid', () => {
    const data = Array.from({ length: 100 }, (_, i) => ({ id: String(i), score: i }));
    const result = parseJsonSafeArray(JSON.stringify(data), itemSchema);
    expect(result).toHaveLength(100);
  });

  // ── context parameter ───────────────────────────────────────────────────────

  it('passes context to logger when items are dropped (does not throw)', () => {
    const data = [{ id: 'ok', score: 1 }, { id: 99, score: 'bad' }];
    expect(() =>
      parseJsonSafeArray(JSON.stringify(data), itemSchema, {
        workspaceId: 'ws-1',
        field: 'test_field',
        table: 'test_table',
      }),
    ).not.toThrow();
  });

  it('does not throw when logging parse failure with context', () => {
    expect(() =>
      parseJsonSafeArray('bad json', itemSchema, { workspaceId: 'ws-2', field: 'f', table: 't' }),
    ).not.toThrow();
  });

  it('does not throw when logging non-array warning with context', () => {
    expect(() =>
      parseJsonSafeArray('{"not":"array"}', itemSchema, {
        workspaceId: 'ws-3',
        field: 'col',
        table: 'tbl',
      }),
    ).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseJsonFallback
// ─────────────────────────────────────────────────────────────────────────────

describe('parseJsonFallback', () => {
  // ── null / undefined / empty inputs ────────────────────────────────────────

  it('returns fallback for null', () => {
    expect(parseJsonFallback(null, [])).toEqual([]);
  });

  it('returns fallback for undefined', () => {
    expect(parseJsonFallback(undefined, {})).toEqual({});
  });

  it('returns fallback for empty string', () => {
    expect(parseJsonFallback('', 42)).toBe(42);
  });

  // ── valid JSON ──────────────────────────────────────────────────────────────

  it('returns parsed data for valid JSON object', () => {
    const raw = JSON.stringify({ a: 1 });
    expect(parseJsonFallback(raw, {})).toEqual({ a: 1 });
  });

  it('parses arrays', () => {
    expect(parseJsonFallback('[1,2,3]', [])).toEqual([1, 2, 3]);
  });

  it('parses string primitives', () => {
    expect(parseJsonFallback('"hello"', '')).toBe('hello');
  });

  it('parses number primitives', () => {
    expect(parseJsonFallback('42', 0)).toBe(42);
  });

  it('parses boolean true', () => {
    expect(parseJsonFallback('true', false)).toBe(true);
  });

  it('parses boolean false', () => {
    expect(parseJsonFallback('false', true)).toBe(false);
  });

  it('parses JSON null (returns null, not fallback)', () => {
    // JSON.parse('null') === null, which is a valid parse result
    expect(parseJsonFallback('null', 'fallback-value')).toBeNull();
  });

  it('parses nested objects', () => {
    const obj = { outer: { inner: [1, 2, 3] } };
    expect(parseJsonFallback(JSON.stringify(obj), {})).toEqual(obj);
  });

  it('parses empty object', () => {
    expect(parseJsonFallback('{}', null)).toEqual({});
  });

  it('parses empty array', () => {
    expect(parseJsonFallback('[]', null)).toEqual([]);
  });

  // ── invalid JSON ────────────────────────────────────────────────────────────

  it('returns fallback for malformed JSON', () => {
    expect(parseJsonFallback('{bad', 'default')).toBe('default');
  });

  it('returns fallback for arbitrary non-JSON text', () => {
    expect(parseJsonFallback('hello world', 99)).toBe(99);
  });

  it('returns fallback for single-quote JSON (not valid JSON)', () => {
    expect(parseJsonFallback("{'key':'value'}", {})).toEqual({});
  });

  it('returns fallback for undefined JSON value (just the word undefined)', () => {
    expect(parseJsonFallback('undefined', 'safe')).toBe('safe');
  });

  it('does not throw on malformed input — degrades gracefully', () => {
    expect(() => parseJsonFallback('%%%', 'safe')).not.toThrow();
  });

  // ── fallback identity ───────────────────────────────────────────────────────

  it('returns the exact fallback reference when input is null', () => {
    const obj = { key: 'value' };
    expect(parseJsonFallback(null, obj)).toBe(obj);
  });

  it('returns the exact fallback reference for invalid JSON', () => {
    const arr: string[] = [];
    expect(parseJsonFallback('bad', arr)).toBe(arr);
  });

  it('supports a number as fallback', () => {
    expect(parseJsonFallback(null, -1)).toBe(-1);
  });

  it('supports null as fallback', () => {
    expect(parseJsonFallback('bad json', null)).toBeNull();
  });

  it('supports a boolean as fallback', () => {
    expect(parseJsonFallback('bad json', true)).toBe(true);
  });

  it('returns parsed value (not fallback) when input is valid', () => {
    const fallbackArr = [1, 2, 3];
    const result = parseJsonFallback('[4,5,6]', fallbackArr);
    expect(result).toEqual([4, 5, 6]);
    expect(result).not.toBe(fallbackArr);
  });
});
