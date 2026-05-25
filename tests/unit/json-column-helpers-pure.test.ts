/**
 * Pure unit tests for DB JSON column parsing helpers.
 * Covers both server/db/json-validation.ts and server/db/json-column.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

// Mock the logger — json-validation.ts imports it at module level
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

import { parseJsonSafe, parseJsonSafeArray, parseJsonFallback } from '../../server/db/json-validation.js';
import { parseJsonColumn, stringifyJsonColumn } from '../../server/db/json-column.js';

// ── Shared test schema ──
const idSchema = z.object({ id: z.string() });
type IdObj = z.infer<typeof idSchema>;
const idFallback: IdObj = { id: '' };

// ── parseJsonSafe ──

describe('parseJsonSafe', () => {
  describe('valid input', () => {
    it('returns parsed object for valid JSON matching schema', () => {
      const raw = JSON.stringify({ id: 'abc' });
      expect(parseJsonSafe(raw, idSchema, idFallback)).toEqual({ id: 'abc' });
    });

    it('strips extra fields (default Zod strip behavior)', () => {
      const raw = JSON.stringify({ id: 'abc', extra: true });
      const result = parseJsonSafe(raw, idSchema, idFallback);
      expect(result).toEqual({ id: 'abc' });
      expect((result as Record<string, unknown>).extra).toBeUndefined();
    });

    it('returns the to value for convenient chaining', () => {
      const raw = JSON.stringify({ id: 'xyz' });
      const result = parseJsonSafe(raw, idSchema, idFallback);
      expect(result.id).toBe('xyz');
    });

    it('handles optional fields — missing optional returns undefined', () => {
      const schema = z.object({ id: z.string(), tag: z.string().optional() });
      const raw = JSON.stringify({ id: 'abc' });
      const result = parseJsonSafe(raw, schema, { id: '' });
      expect(result).toEqual({ id: 'abc' });
      expect(result.tag).toBeUndefined();
    });

    it('works with array schemas', () => {
      const arraySchema = z.array(z.string());
      const raw = JSON.stringify(['a', 'b', 'c']);
      expect(parseJsonSafe(raw, arraySchema, [])).toEqual(['a', 'b', 'c']);
    });

    it('works with nested schemas', () => {
      const schema = z.object({ meta: z.object({ score: z.number() }) });
      const raw = JSON.stringify({ meta: { score: 42 } });
      const result = parseJsonSafe(raw, schema, { meta: { score: 0 } });
      expect(result.meta.score).toBe(42);
    });

    it('accepts context parameter without throwing', () => {
      const raw = JSON.stringify({ id: 'ctx-test' });
      expect(() =>
        parseJsonSafe(raw, idSchema, idFallback, { workspaceId: 'ws1', field: 'data', table: 'items' }),
      ).not.toThrow();
    });
  });

  describe('null / undefined / empty inputs', () => {
    it('returns fallback for null', () => {
      expect(parseJsonSafe(null, idSchema, idFallback)).toBe(idFallback);
    });

    it('returns fallback for undefined', () => {
      expect(parseJsonSafe(undefined, idSchema, idFallback)).toBe(idFallback);
    });

    it('returns fallback for empty string', () => {
      expect(parseJsonSafe('', idSchema, idFallback)).toBe(idFallback);
    });
  });

  describe('invalid JSON', () => {
    it('returns fallback for malformed JSON (does not throw)', () => {
      expect(parseJsonSafe('{not-valid', idSchema, idFallback)).toBe(idFallback);
    });

    it('returns fallback for bare text', () => {
      expect(parseJsonSafe('hello', idSchema, idFallback)).toBe(idFallback);
    });
  });

  describe('schema validation failures', () => {
    it('returns fallback when required field has wrong type', () => {
      const raw = JSON.stringify({ id: 123 }); // id should be string
      expect(parseJsonSafe(raw, idSchema, idFallback)).toBe(idFallback);
    });

    it('returns fallback when required field is missing', () => {
      const raw = JSON.stringify({ name: 'no-id-here' });
      expect(parseJsonSafe(raw, idSchema, idFallback)).toBe(idFallback);
    });

    it('returns fallback for null JSON value (parsed as null)', () => {
      expect(parseJsonSafe('null', idSchema, idFallback)).toBe(idFallback);
    });

    it('logs warning context when schema validation fails (does not throw)', () => {
      const raw = JSON.stringify({ id: 999 });
      expect(() =>
        parseJsonSafe(raw, idSchema, idFallback, { workspaceId: 'ws-fail', field: 'col', table: 'tbl' }),
      ).not.toThrow();
    });
  });

  describe('fallback type flexibility', () => {
    it('accepts null as fallback value', () => {
      const result = parseJsonSafe('{bad', idSchema, null);
      expect(result).toBeNull();
    });

    it('accepts array as fallback for array schema', () => {
      const arraySchema = z.array(z.string());
      const result = parseJsonSafe('{bad', arraySchema, []);
      expect(result).toEqual([]);
    });
  });
});

// ── parseJsonSafeArray ──

describe('parseJsonSafeArray', () => {
  const itemSchema = z.object({ id: z.string(), value: z.number() });

  describe('valid arrays', () => {
    it('returns all items when every item is valid', () => {
      const data = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }];
      const result = parseJsonSafeArray(JSON.stringify(data), itemSchema);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: 'a', value: 1 });
    });

    it('returns empty array for valid empty JSON array', () => {
      expect(parseJsonSafeArray('[]', itemSchema)).toEqual([]);
    });

    it('works with scalar item schemas (z.string())', () => {
      const data = ['x', 'y', 'z'];
      expect(parseJsonSafeArray(JSON.stringify(data), z.string())).toEqual(['x', 'y', 'z']);
    });
  });

  describe('partial validity — bad items are filtered, good ones kept', () => {
    it('keeps valid items and drops invalid ones', () => {
      const data = [
        { id: 'good', value: 10 },
        { id: 'bad', value: 'not-a-number' },
      ];
      const result = parseJsonSafeArray(JSON.stringify(data), itemSchema);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('good');
    });

    it('drops all items when all are invalid', () => {
      const data = [{ id: 1, value: 'x' }, { id: 2, value: 'y' }];
      expect(parseJsonSafeArray(JSON.stringify(data), itemSchema)).toEqual([]);
    });

    it('mixed scalar array — only valid scalars kept', () => {
      const data = ['ok', 42, null, 'also-ok'];
      const result = parseJsonSafeArray(JSON.stringify(data), z.string());
      expect(result).toEqual(['ok', 'also-ok']);
    });
  });

  describe('non-array JSON values → empty array', () => {
    it('returns empty array when JSON is a plain object', () => {
      expect(parseJsonSafeArray(JSON.stringify({ id: 'a', value: 1 }), itemSchema)).toEqual([]);
    });

    it('returns empty array when JSON is a number', () => {
      expect(parseJsonSafeArray('42', itemSchema)).toEqual([]);
    });

    it('returns empty array when JSON is a string', () => {
      expect(parseJsonSafeArray('"just-a-string"', itemSchema)).toEqual([]);
    });

    it('returns empty array when JSON is null', () => {
      expect(parseJsonSafeArray('null', itemSchema)).toEqual([]);
    });

    it('returns empty array when JSON is boolean', () => {
      expect(parseJsonSafeArray('true', itemSchema)).toEqual([]);
    });
  });

  describe('null / undefined / empty / invalid raw inputs', () => {
    it('returns empty array for null', () => {
      expect(parseJsonSafeArray(null, itemSchema)).toEqual([]);
    });

    it('returns empty array for undefined', () => {
      expect(parseJsonSafeArray(undefined, itemSchema)).toEqual([]);
    });

    it('returns empty array for empty string', () => {
      expect(parseJsonSafeArray('', itemSchema)).toEqual([]);
    });

    it('returns empty array for malformed JSON', () => {
      expect(parseJsonSafeArray('{bad json', itemSchema)).toEqual([]);
    });
  });

  describe('context parameter', () => {
    it('accepts context without throwing', () => {
      const data = [{ id: 'ok', value: 5 }, { id: 99, value: 'bad' }];
      expect(() =>
        parseJsonSafeArray(JSON.stringify(data), itemSchema, {
          workspaceId: 'ws-1',
          field: 'items',
          table: 'records',
        }),
      ).not.toThrow();
    });
  });
});

// ── parseJsonFallback ──

describe('parseJsonFallback', () => {
  describe('valid JSON', () => {
    it('parses a JSON object', () => {
      expect(parseJsonFallback<Record<string, number>>('{"x":1}', {})).toEqual({ x: 1 });
    });

    it('parses a JSON array', () => {
      expect(parseJsonFallback<number[]>('[1,2,3]', [])).toEqual([1, 2, 3]);
    });

    it('parses a JSON string primitive', () => {
      expect(parseJsonFallback<string>('"hello"', '')).toBe('hello');
    });

    it('parses a JSON number primitive', () => {
      expect(parseJsonFallback<number>('99', 0)).toBe(99);
    });

    it('parses a JSON boolean', () => {
      expect(parseJsonFallback<boolean>('true', false)).toBe(true);
    });

    it('parses null JSON as null (no fallback)', () => {
      // JSON.parse('null') === null, which is falsy, but parseJsonFallback doesn't guard on
      // parsed value — it just returns it cast to T.
      expect(parseJsonFallback<null>('null', null)).toBeNull();
    });
  });

  describe('null / undefined / empty inputs', () => {
    it('returns fallback for null', () => {
      expect(parseJsonFallback(null, [])).toEqual([]);
    });

    it('returns fallback for undefined', () => {
      expect(parseJsonFallback(undefined, 'default')).toBe('default');
    });

    it('returns fallback for empty string', () => {
      expect(parseJsonFallback('', 0)).toBe(0);
    });
  });

  describe('malformed JSON', () => {
    it('returns fallback for malformed JSON (does not throw)', () => {
      expect(parseJsonFallback('{bad', 'fallback')).toBe('fallback');
    });

    it('returns fallback for bare text', () => {
      expect(parseJsonFallback('not json', [])).toEqual([]);
    });
  });
});

// ── parseJsonColumn (server/db/json-column.ts) ──

describe('parseJsonColumn', () => {
  describe('valid inputs', () => {
    it('parses a valid JSON object string', () => {
      const raw = JSON.stringify({ key: 'value', count: 3 });
      expect(parseJsonColumn<{ key: string; count: number }>(raw, { key: '', count: 0 })).toEqual({
        key: 'value',
        count: 3,
      });
    });

    it('parses a valid JSON array string', () => {
      expect(parseJsonColumn<string[]>('["a","b","c"]', [])).toEqual(['a', 'b', 'c']);
    });

    it('parses a JSON number', () => {
      expect(parseJsonColumn<number>('42', 0)).toBe(42);
    });

    it('parses a JSON boolean', () => {
      expect(parseJsonColumn<boolean>('true', false)).toBe(true);
    });
  });

  describe('null inputs', () => {
    it('returns fallback for null', () => {
      expect(parseJsonColumn<string[]>(null, [])).toEqual([]);
    });

    it('returns fallback for undefined', () => {
      expect(parseJsonColumn<string[]>(undefined, [])).toEqual([]);
    });
  });

  describe('malformed JSON', () => {
    it('returns fallback for invalid JSON (does not throw)', () => {
      expect(parseJsonColumn<Record<string, unknown>>('{bad', {})).toEqual({});
    });

    it('returns fallback for bare text', () => {
      expect(parseJsonColumn<number[]>('not-json', [])).toEqual([]);
    });

    it('returns fallback for truncated JSON', () => {
      expect(parseJsonColumn<Record<string, unknown>>('{"key":', {})).toEqual({});
    });
  });

  describe('fallback is returned by reference', () => {
    it('returns the exact fallback object for null input', () => {
      const fallback = { a: 1 };
      expect(parseJsonColumn(null, fallback)).toBe(fallback);
    });

    it('returns the exact fallback array for invalid JSON', () => {
      const fallback: string[] = [];
      expect(parseJsonColumn('{bad', fallback)).toBe(fallback);
    });
  });
});

// ── stringifyJsonColumn (server/db/json-column.ts) ──

describe('stringifyJsonColumn', () => {
  describe('valid values', () => {
    it('stringifies a plain object', () => {
      expect(stringifyJsonColumn({ id: 'abc', score: 95 })).toBe('{"id":"abc","score":95}');
    });

    it('stringifies an array', () => {
      expect(stringifyJsonColumn([1, 2, 3])).toBe('[1,2,3]');
    });

    it('stringifies a string', () => {
      expect(stringifyJsonColumn('hello')).toBe('"hello"');
    });

    it('stringifies a number', () => {
      expect(stringifyJsonColumn(42)).toBe('42');
    });

    it('stringifies a boolean', () => {
      expect(stringifyJsonColumn(true)).toBe('true');
    });

    it('stringifies an empty object', () => {
      expect(stringifyJsonColumn({})).toBe('{}');
    });

    it('stringifies an empty array', () => {
      expect(stringifyJsonColumn([])).toBe('[]');
    });
  });

  describe('null / undefined inputs', () => {
    it('returns null for null input', () => {
      expect(stringifyJsonColumn(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(stringifyJsonColumn(undefined)).toBeNull();
    });
  });

  describe('round-trip contract', () => {
    it('round-trips an object through stringify then parse', () => {
      const original = { name: 'test', values: [1, 2, 3], nested: { ok: true } };
      const stringified = stringifyJsonColumn(original);
      expect(stringified).not.toBeNull();
      const parsed = parseJsonColumn<typeof original>(stringified!, original);
      expect(parsed).toEqual(original);
    });

    it('returns null from stringify → parseJsonColumn with null returns fallback', () => {
      const fallback = { default: true };
      const stringified = stringifyJsonColumn(null); // → null
      const result = parseJsonColumn<typeof fallback>(stringified, fallback);
      expect(result).toBe(fallback);
    });
  });
});
