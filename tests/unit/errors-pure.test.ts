// tests/unit/errors-pure.test.ts
// Pure unit tests for server/errors.ts
// No DB or external service dependencies — no vi.mock() needed.

import { describe, it, expect } from 'vitest';
import { isProgrammingError } from '../../server/errors.js';

describe('isProgrammingError', () => {
  it('returns true for TypeError', () => {
    expect(isProgrammingError(new TypeError('cannot read property'))).toBe(true);
  });

  it('returns true for ReferenceError', () => {
    expect(isProgrammingError(new ReferenceError('x is not defined'))).toBe(true);
  });

  it('returns true for SyntaxError', () => {
    expect(isProgrammingError(new SyntaxError('unexpected token'))).toBe(true);
  });

  it('returns true for RangeError', () => {
    expect(isProgrammingError(new RangeError('maximum call stack exceeded'))).toBe(true);
  });

  it('returns false for a plain Error', () => {
    expect(isProgrammingError(new Error('something went wrong'))).toBe(false);
  });

  it('returns false for a string', () => {
    expect(isProgrammingError('not an error')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isProgrammingError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isProgrammingError(undefined)).toBe(false);
  });

  it('returns false for a plain object', () => {
    expect(isProgrammingError({ message: 'fake error' })).toBe(false);
  });

  it('returns false for a number', () => {
    expect(isProgrammingError(42)).toBe(false);
  });

  // Subclass checks — instances of subclasses must also match
  it('returns true for a subclass of TypeError', () => {
    class MyTypeError extends TypeError {}
    expect(isProgrammingError(new MyTypeError('subclass'))).toBe(true);
  });

  it('returns true for a subclass of RangeError', () => {
    class MyRangeError extends RangeError {}
    expect(isProgrammingError(new MyRangeError('subclass'))).toBe(true);
  });

  // Verify the documented caveat — JSON.parse SyntaxErrors are real SyntaxErrors
  // and isProgrammingError() would return true for them, which is why callers that
  // wrap JSON.parse must NOT call isProgrammingError().
  it('returns true for SyntaxError thrown by JSON.parse (documenting the caveat)', () => {
    let err: unknown;
    try {
      JSON.parse('{bad json');
    } catch (e) {
      err = e;
    }
    expect(isProgrammingError(err)).toBe(true);
  });
});
