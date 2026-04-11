/**
 * Additional edge-case tests for server/db/json-validation.ts
 *
 * The primary test coverage lives in tests/unit/json-validation.test.ts.
 * This file covers scenarios NOT exercised there:
 *   - null fallback (parseJsonSafe returning null on bad input)
 *   - undefined fallback (parseJsonFallback with undefined default)
 *   - truncated / partially-written JSON strings
 *   - object-fallback with null-chaining (workspace-intelligence.ts pattern)
 *   - string used directly as fallback (workspace-intelligence.ts line 828 pattern)
 *   - parseJsonSafeArray partial-valid filtering with context (table + field logged)
 *   - parseJsonSafeArray with complex nested item schemas
 *   - parseJsonSafe with union / discriminated-union schemas
 *   - parseJsonSafe with deeply nested valid/invalid data
 *   - parseJsonFallback with non-DB input (file-content pattern from churn-signals.ts)
 *   - parseJsonSafeArray stripping extra fields per Zod default behavior
 *   - parseJsonSafe accepting valid JSON number primitive (schema: z.number())
 *   - parseJsonFallback preserving reference equality on fallback return
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  parseJsonSafe,
  parseJsonSafeArray,
  parseJsonFallback,
} from '../../server/db/json-validation.js';

// Silence logger output during these tests
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Schemas that mirror real codebase usage
// ---------------------------------------------------------------------------

/** Mirrors content_pricing column in workspaces.ts */
const contentPricingSchema = z.object({
  briefPrice: z.number(),
  fullPostPrice: z.number(),
  currency: z.string().default('USD'),
});

/** Mirrors a simplified outline item from content-brief.ts */
const outlineItemSchema = z.object({
  heading: z.string(),
  level: z.number().int().min(1).max(6),
  wordCount: z.number().optional(),
});

/** Mirrors a simplified cartItem from stripe.ts */
const cartItemSchema = z.object({
  type: z.enum(['brief', 'full_post', 'issue_check']),
  pageId: z.string(),
  price: z.number(),
});

/** Mirrors competitor_domains / business_priorities usage (array of strings) */
const stringArraySchema = z.array(z.string());

// ---------------------------------------------------------------------------
// parseJsonSafe — null fallback (workspaces.ts publish_target / business_profile)
// ---------------------------------------------------------------------------

describe('parseJsonSafe — null fallback', () => {
  it('returns null for undefined input', () => {
    const result = parseJsonSafe(undefined, contentPricingSchema, null);
    expect(result).toBeNull();
  });

  it('returns null for null input', () => {
    const result = parseJsonSafe(null, contentPricingSchema, null);
    expect(result).toBeNull();
  });

  it('returns null for empty string', () => {
    const result = parseJsonSafe('', contentPricingSchema, null);
    expect(result).toBeNull();
  });

  it('returns null for truncated JSON (disk-corruption simulation)', () => {
    const truncated = '{"briefPrice":10,"fullP'; // truncated mid-key
    const result = parseJsonSafe(truncated, contentPricingSchema, null);
    expect(result).toBeNull();
  });

  it('returns null for schema mismatch (field type wrong)', () => {
    const raw = JSON.stringify({ briefPrice: 'free', fullPostPrice: null, currency: 'USD' });
    const result = parseJsonSafe(raw, contentPricingSchema, null);
    expect(result).toBeNull();
  });

  it('returns the parsed object when JSON and schema are both valid', () => {
    const raw = JSON.stringify({ briefPrice: 25, fullPostPrice: 75, currency: 'USD' });
    const result = parseJsonSafe(raw, contentPricingSchema, null);
    expect(result).not.toBeNull();
    expect(result?.briefPrice).toBe(25);
    expect(result?.currency).toBe('USD');
  });

  it('null result can be safely chained with ?? operator', () => {
    // Pattern from workspace-intelligence.ts line 828: result ?? []
    const result = parseJsonSafe('{bad json', stringArraySchema, null) ?? [];
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseJsonSafe — string used as fallback (workspace-intelligence.ts pattern)
// The 3rd argument is the fallback; when schema fails it returns that value.
// ---------------------------------------------------------------------------

describe('parseJsonSafe — non-null primitive fallback', () => {
  it('returns string fallback when JSON is malformed', () => {
    // workspace-intelligence.ts line 828: parseJsonSafe(raw, z.array(z.string()), 'default_label')
    const result = parseJsonSafe('{bad', z.array(z.string()), 'default_label');
    expect(result).toBe('default_label');
  });

  it('returns number fallback (0) when JSON is invalid', () => {
    const result = parseJsonSafe('not-json', z.number(), 0);
    expect(result).toBe(0);
  });

  it('returns empty array fallback for schema mismatch', () => {
    // stripe.ts pattern: parseJsonSafe(metadata.pageIds, stringArraySchema, [])
    const raw = JSON.stringify({ not: 'an array' });
    const result = parseJsonSafe(raw, stringArraySchema, []);
    expect(result).toEqual([]);
  });

  it('returns parsed string array when input is valid', () => {
    const raw = JSON.stringify(['kw1', 'kw2', 'kw3']);
    const result = parseJsonSafe(raw, stringArraySchema, []);
    expect(result).toEqual(['kw1', 'kw2', 'kw3']);
  });
});

// ---------------------------------------------------------------------------
// parseJsonSafe — truncated / partially-written JSON strings
// ---------------------------------------------------------------------------

describe('parseJsonSafe — truncated JSON inputs', () => {
  const schema = z.object({ id: z.string(), value: z.number() });
  const fallback = { id: '', value: 0 };

  it('handles JSON truncated mid-value', () => {
    expect(parseJsonSafe('{"id":"abc","value":4', schema, fallback)).toBe(fallback);
  });

  it('handles JSON truncated mid-key', () => {
    expect(parseJsonSafe('{"id":"abc","val', schema, fallback)).toBe(fallback);
  });

  it('handles JSON with trailing comma (invalid)', () => {
    expect(parseJsonSafe('{"id":"abc","value":42,}', schema, fallback)).toBe(fallback);
  });

  it('handles only opening brace', () => {
    expect(parseJsonSafe('{', schema, fallback)).toBe(fallback);
  });

  it('handles only closing brace', () => {
    expect(parseJsonSafe('}', schema, fallback)).toBe(fallback);
  });

  it('handles a JSON string containing only whitespace', () => {
    // Not empty string (which returns fallback early), but whitespace-only
    expect(parseJsonSafe('   ', schema, fallback)).toBe(fallback);
  });

  it('handles deeply nested truncated object', () => {
    expect(parseJsonSafe('{"a":{"b":{"c":', schema, fallback)).toBe(fallback);
  });
});

// ---------------------------------------------------------------------------
// parseJsonSafe — union / discriminated union schemas
// ---------------------------------------------------------------------------

describe('parseJsonSafe — union schemas', () => {
  const statusSchema = z.union([
    z.literal('pending'),
    z.literal('active'),
    z.literal('cancelled'),
  ]);

  const discriminatedSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('brief'), title: z.string() }),
    z.object({ type: z.literal('post'), wordCount: z.number() }),
  ]);

  it('returns correct union value for valid input', () => {
    expect(parseJsonSafe('"active"', statusSchema, 'pending')).toBe('active');
  });

  it('returns fallback for value not in union', () => {
    expect(parseJsonSafe('"deleted"', statusSchema, 'pending')).toBe('pending');
  });

  it('parses discriminated union — first variant', () => {
    const raw = JSON.stringify({ type: 'brief', title: 'SEO Brief' });
    const result = parseJsonSafe(raw, discriminatedSchema, null);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('brief');
  });

  it('parses discriminated union — second variant', () => {
    const raw = JSON.stringify({ type: 'post', wordCount: 1200 });
    const result = parseJsonSafe(raw, discriminatedSchema, null);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('post');
  });

  it('returns null fallback for unknown discriminant', () => {
    const raw = JSON.stringify({ type: 'unknown', foo: 'bar' });
    expect(parseJsonSafe(raw, discriminatedSchema, null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseJsonSafe — deeply nested valid/invalid structures
// ---------------------------------------------------------------------------

describe('parseJsonSafe — deeply nested schemas', () => {
  const outlineSchema = z.object({
    title: z.string(),
    sections: z.array(outlineItemSchema),
    meta: z.object({
      wordCount: z.number(),
      lastUpdated: z.string(),
    }),
  });

  const fallback = { title: '', sections: [], meta: { wordCount: 0, lastUpdated: '' } };

  it('parses fully valid nested object', () => {
    const raw = JSON.stringify({
      title: 'SEO Guide',
      sections: [{ heading: 'Intro', level: 2, wordCount: 300 }],
      meta: { wordCount: 1200, lastUpdated: '2026-04-01' },
    });
    const result = parseJsonSafe(raw, outlineSchema, fallback);
    expect(result.title).toBe('SEO Guide');
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].heading).toBe('Intro');
    expect(result.meta.wordCount).toBe(1200);
  });

  it('returns fallback when nested array item has wrong type', () => {
    const raw = JSON.stringify({
      title: 'SEO Guide',
      sections: [{ heading: 'Intro', level: 'two' }], // level should be number
      meta: { wordCount: 1200, lastUpdated: '2026-04-01' },
    });
    const result = parseJsonSafe(raw, outlineSchema, fallback);
    // Zod validates the whole object — one bad nested item fails the parse
    expect(result).toBe(fallback);
  });

  it('returns fallback when nested required field is missing', () => {
    const raw = JSON.stringify({
      title: 'SEO Guide',
      sections: [],
      // meta is missing
    });
    expect(parseJsonSafe(raw, outlineSchema, fallback)).toBe(fallback);
  });
});

// ---------------------------------------------------------------------------
// parseJsonSafe — primitive schema (z.number())
// ---------------------------------------------------------------------------

describe('parseJsonSafe — primitive schemas', () => {
  it('parses a JSON number with z.number()', () => {
    expect(parseJsonSafe('42', z.number(), 0)).toBe(42);
  });

  it('parses a JSON boolean with z.boolean()', () => {
    expect(parseJsonSafe('true', z.boolean(), false)).toBe(true);
  });

  it('returns fallback for wrong primitive type', () => {
    expect(parseJsonSafe('"not-a-number"', z.number(), -1)).toBe(-1);
  });

  it('parses null JSON literal with z.null()', () => {
    // JSON.parse('null') === null; z.null() accepts it
    expect(parseJsonSafe('null', z.null(), undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseJsonSafeArray — partial filtering with complex item schemas (content-brief.ts pattern)
// ---------------------------------------------------------------------------

describe('parseJsonSafeArray — complex item schemas', () => {
  it('keeps only valid outline items, drops items with wrong level type', () => {
    const data = [
      { heading: 'Good heading', level: 2, wordCount: 300 },
      { heading: 'Bad level', level: 'h2' }, // level should be number
      { heading: 'Also good', level: 3 },
    ];
    const result = parseJsonSafeArray(JSON.stringify(data), outlineItemSchema);
    expect(result.length > 0 && result.every((item) => typeof item.level === 'number')).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0].heading).toBe('Good heading');
    expect(result[1].heading).toBe('Also good');
  });

  it('keeps only valid cart items, drops items with unknown type enum', () => {
    const data = [
      { type: 'brief', pageId: 'page-1', price: 25 },
      { type: 'unknown_type', pageId: 'page-2', price: 10 }, // invalid enum
      { type: 'full_post', pageId: 'page-3', price: 75 },
    ];
    const result = parseJsonSafeArray(JSON.stringify(data), cartItemSchema);
    expect(result.length).toBeGreaterThan(0);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('brief');
    expect(result[1].type).toBe('full_post');
  });

  it('strips extra fields per default Zod behavior on array items', () => {
    const data = [
      { heading: 'Valid', level: 1, wordCount: 100, extraField: 'should-be-stripped' },
    ];
    const result = parseJsonSafeArray(JSON.stringify(data), outlineItemSchema);
    expect(result.length).toBeGreaterThan(0);
    expect((result[0] as Record<string, unknown>)['extraField']).toBeUndefined();
  });

  it('returns empty array when all items fail a strict schema', () => {
    const data = [
      { type: 'brief', price: 25 }, // missing pageId
      { type: 'full_post', pageId: 123, price: 75 }, // pageId should be string
    ];
    const result = parseJsonSafeArray(JSON.stringify(data), cartItemSchema);
    expect(result).toEqual([]);
  });

  it('handles large array with one bad item in the middle', () => {
    const good = { heading: 'H', level: 2 };
    const bad = { heading: 'H', level: 'not-a-number' };
    const data = [good, good, good, bad, good, good];
    const result = parseJsonSafeArray(JSON.stringify(data), outlineItemSchema);
    expect(result.length).toBeGreaterThan(0);
    expect(result).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// parseJsonSafeArray — non-array JSON that is valid JSON (various primitives)
// Not covered in existing tests: number and boolean primitives specifically
// ---------------------------------------------------------------------------

describe('parseJsonSafeArray — valid-JSON non-array values', () => {
  const itemSchema = z.string();

  it('returns empty array for JSON number primitive', () => {
    expect(parseJsonSafeArray('123', itemSchema)).toEqual([]);
  });

  it('returns empty array for JSON boolean primitive', () => {
    expect(parseJsonSafeArray('true', itemSchema)).toEqual([]);
    expect(parseJsonSafeArray('false', itemSchema)).toEqual([]);
  });

  it('returns empty array for JSON null primitive', () => {
    // JSON.parse('null') === null; not an array
    expect(parseJsonSafeArray('null', itemSchema)).toEqual([]);
  });

  it('returns empty array for nested object (not array)', () => {
    expect(parseJsonSafeArray(JSON.stringify({ arr: [1, 2, 3] }), itemSchema)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseJsonFallback — undefined fallback (requests.ts / work-orders.ts pattern)
// ---------------------------------------------------------------------------

describe('parseJsonFallback — undefined fallback', () => {
  it('returns undefined for null input', () => {
    expect(parseJsonFallback(null, undefined)).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(parseJsonFallback(undefined, undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(parseJsonFallback('', undefined)).toBeUndefined();
  });

  it('returns undefined for malformed JSON', () => {
    expect(parseJsonFallback('{invalid', undefined)).toBeUndefined();
  });

  it('still parses valid JSON even with undefined fallback', () => {
    expect(parseJsonFallback('{"a":1}', undefined)).toEqual({ a: 1 });
  });
});

// ---------------------------------------------------------------------------
// parseJsonFallback — reference equality on fallback return
// ---------------------------------------------------------------------------

describe('parseJsonFallback — fallback reference identity', () => {
  it('returns the exact same fallback object reference on failure', () => {
    const fallbackArr: string[] = [];
    const result = parseJsonFallback('{bad json}', fallbackArr);
    expect(result).toBe(fallbackArr); // same reference, not a copy
  });

  it('returns the exact same fallback reference for null input', () => {
    const fallbackObj = { siteScore: 0, pages: [] };
    expect(parseJsonFallback(null, fallbackObj)).toBe(fallbackObj);
  });
});

// ---------------------------------------------------------------------------
// parseJsonFallback — file-content pattern (churn-signals.ts reads .json files)
// ---------------------------------------------------------------------------

describe('parseJsonFallback — file-content usage patterns', () => {
  it('parses a well-formed JSON file content string', () => {
    const fileContent = JSON.stringify({ critical: 2, warning: 5, watch: 3, totalDecaying: 10 });
    const result = parseJsonFallback(fileContent, null);
    expect(result).not.toBeNull();
    expect((result as Record<string, unknown>)['critical']).toBe(2);
  });

  it('returns null when file content is corrupted (truncated)', () => {
    const truncated = '{"critical":2,"warning":5,"watch":3,"total';
    expect(parseJsonFallback(truncated, null)).toBeNull();
  });

  it('returns null when file content is empty string', () => {
    expect(parseJsonFallback('', null)).toBeNull();
  });

  it('parses JSON array file content (rank-tracking snapshot pattern)', () => {
    const fileContent = JSON.stringify([{ query: 'seo audit', position: 3 }]);
    const result = parseJsonFallback<{ query: string; position: number }[]>(fileContent, []);
    expect(result).toHaveLength(1);
    expect(result[0].query).toBe('seo audit');
  });
});

// ---------------------------------------------------------------------------
// parseJsonSafe — does not throw on any input (never-throws contract)
// ---------------------------------------------------------------------------

describe('never-throws contract', () => {
  const schema = z.object({ x: z.number() });

  const dangerousInputs: [string, string | null | undefined][] = [
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace', '   '],
    ['NaN literal', 'NaN'],
    ['Infinity literal', 'Infinity'],
    ['single quote JSON', "{'x':1}"],
    ['trailing garbage', '{"x":1}garbage'],
    ['nested truncated', '{"x":{"y":'],
    ['array of nothing', '[,,,]'],
    ['BOM character', '\uFEFF{"x":1}'],
    ['null bytes', '{"x":\u00001}'],
    ['very long garbage', 'x'.repeat(10_000)],
  ];

  for (const [label, input] of dangerousInputs) {
    it(`parseJsonSafe does not throw for: ${label}`, () => {
      expect(() => parseJsonSafe(input, schema, null)).not.toThrow();
    });

    it(`parseJsonFallback does not throw for: ${label}`, () => {
      expect(() => parseJsonFallback(input, null)).not.toThrow();
    });

    it(`parseJsonSafeArray does not throw for: ${label}`, () => {
      expect(() => parseJsonSafeArray(input, z.number())).not.toThrow();
    });
  }
});
