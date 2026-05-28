import { describe, it, expect } from 'vitest';
import { daysSince } from '../../src/utils/formatDates.js';

describe('daysSince', () => {
  it('returns 0 for today', () => {
    const now = new Date().toISOString();
    expect(daysSince(now)).toBe(0);
  });

  it('returns ~1 for yesterday', () => {
    const yesterday = new Date(Date.now() - 86_400_000 - 1000).toISOString();
    expect(daysSince(yesterday)).toBe(1);
  });

  it('returns ~7 for one week ago', () => {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000 - 1000).toISOString();
    expect(daysSince(weekAgo)).toBe(7);
  });

  it('returns 0 for a future date', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(daysSince(future)).toBe(0);
  });

  it('returns 0 for an invalid string', () => {
    expect(daysSince('not-a-date')).toBe(0);
  });
});
