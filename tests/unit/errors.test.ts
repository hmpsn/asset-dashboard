import { describe, expect, it } from 'vitest';
import { isProgrammingError } from '../../server/errors.js';

describe('isProgrammingError', () => {
  it('returns true for programming-oriented error classes', () => {
    expect(isProgrammingError(new TypeError('bad type'))).toBe(true);
    expect(isProgrammingError(new ReferenceError('missing symbol'))).toBe(true);
    expect(isProgrammingError(new SyntaxError('bad syntax'))).toBe(true);
    expect(isProgrammingError(new RangeError('out of range'))).toBe(true);
  });

  it('returns false for generic errors and non-error values', () => {
    expect(isProgrammingError(new Error('generic'))).toBe(false);
    expect(isProgrammingError('boom')).toBe(false);
    expect(isProgrammingError(null)).toBe(false);
    expect(isProgrammingError(undefined)).toBe(false);
    expect(isProgrammingError({ message: 'x' })).toBe(false);
  });
});
