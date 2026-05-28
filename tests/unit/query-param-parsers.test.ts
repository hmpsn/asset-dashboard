import { describe, expect, it } from 'vitest';

import { parseNonNegativeIntQuery, parsePositiveIntQuery } from '../../server/query-param-parsers.js';

describe('parsePositiveIntQuery', () => {
  it('returns fallback when raw value is nullish', () => {
    expect(parsePositiveIntQuery(undefined, 28)).toBe(28);
    expect(parsePositiveIntQuery(null, 100)).toBe(100);
  });

  it('returns null when raw value is nullish and no fallback is provided', () => {
    expect(parsePositiveIntQuery(undefined)).toBeNull();
    expect(parsePositiveIntQuery(null)).toBeNull();
  });

  it('accepts positive integers', () => {
    expect(parsePositiveIntQuery('7')).toBe(7);
    expect(parsePositiveIntQuery(42)).toBe(42);
  });

  it('rejects non-integers and non-positive values', () => {
    expect(parsePositiveIntQuery('7.5')).toBeNull();
    expect(parsePositiveIntQuery(0)).toBeNull();
    expect(parsePositiveIntQuery(-1)).toBeNull();
    expect(parsePositiveIntQuery('abc')).toBeNull();
  });
});

describe('parseNonNegativeIntQuery', () => {
  it('returns fallback when raw value is nullish', () => {
    expect(parseNonNegativeIntQuery(undefined, 0)).toBe(0);
    expect(parseNonNegativeIntQuery(null, 3)).toBe(3);
  });

  it('accepts non-negative integers', () => {
    expect(parseNonNegativeIntQuery('0')).toBe(0);
    expect(parseNonNegativeIntQuery(9)).toBe(9);
  });

  it('rejects negatives and decimals', () => {
    expect(parseNonNegativeIntQuery(-1)).toBeNull();
    expect(parseNonNegativeIntQuery('2.5')).toBeNull();
    expect(parseNonNegativeIntQuery('abc')).toBeNull();
  });
});
