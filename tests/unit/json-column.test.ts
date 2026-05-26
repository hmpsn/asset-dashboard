import { describe, expect, it } from 'vitest';
import { parseJsonColumn, stringifyJsonColumn } from '../../server/db/json-column.js';

describe('json-column helpers', () => {
  it('parseJsonColumn returns fallback for null/undefined or invalid JSON', () => {
    expect(parseJsonColumn(null, { ok: false })).toEqual({ ok: false });
    expect(parseJsonColumn(undefined, ['x'])).toEqual(['x']);
    expect(parseJsonColumn('{bad', 42)).toBe(42);
  });

  it('parseJsonColumn returns parsed object for valid JSON', () => {
    const parsed = parseJsonColumn<{ a: number; b: string }>('{"a":1,"b":"x"}', { a: 0, b: '' });
    expect(parsed).toEqual({ a: 1, b: 'x' });
  });

  it('stringifyJsonColumn returns null for nullish and stringifies otherwise', () => {
    expect(stringifyJsonColumn(null)).toBeNull();
    expect(stringifyJsonColumn(undefined)).toBeNull();
    expect(stringifyJsonColumn({ a: 1 })).toBe('{"a":1}');
    expect(stringifyJsonColumn([1, 2])).toBe('[1,2]');
  });
});
