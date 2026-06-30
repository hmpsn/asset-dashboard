import { describe, expect, it } from 'vitest';
import { extractErrorMessage } from '../../../src/lib/extractErrorMessage';

describe('extractErrorMessage', () => {
  it('returns Error.message when present', () => {
    expect(extractErrorMessage(new Error('Network timeout'), 'Fallback')).toBe('Network timeout');
  });

  it('returns non-empty string errors', () => {
    expect(extractErrorMessage('Plain failure', 'Fallback')).toBe('Plain failure');
  });

  it('reads common API error fields from objects', () => {
    expect(extractErrorMessage({ error: 'Bad request' }, 'Fallback')).toBe('Bad request');
    expect(extractErrorMessage({ message: 'Not found' }, 'Fallback')).toBe('Not found');
    expect(extractErrorMessage({ detail: 'Invalid field' }, 'Fallback')).toBe('Invalid field');
  });

  it('reads nested body error fields', () => {
    expect(extractErrorMessage({ body: { error: 'Nested API error' } }, 'Fallback')).toBe('Nested API error');
  });

  it('falls back for blank or unsupported values', () => {
    expect(extractErrorMessage('', 'Fallback')).toBe('Fallback');
    expect(extractErrorMessage({ error: '' }, 'Fallback')).toBe('Fallback');
    expect(extractErrorMessage(null, 'Fallback')).toBe('Fallback');
    expect(extractErrorMessage(42, 'Fallback')).toBe('Fallback');
  });
});
