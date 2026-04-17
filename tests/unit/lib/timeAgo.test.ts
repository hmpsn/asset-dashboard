import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { timeAgo } from '../../../src/lib/timeAgo';

describe('timeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for < 1 minute', () => {
    const d = new Date(Date.now() - 30_000).toISOString();
    expect(timeAgo(d)).toBe('just now');
  });

  it('returns "Xm ago" for < 1 hour', () => {
    const d = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(timeAgo(d)).toBe('5m ago');
  });

  it('returns "Xh ago" for < 24 hours', () => {
    const d = new Date(Date.now() - 3 * 3_600_000).toISOString();
    expect(timeAgo(d)).toBe('3h ago');
  });

  it('returns "yesterday" for exactly 1 day', () => {
    const d = new Date(Date.now() - 1 * 86_400_000).toISOString();
    expect(timeAgo(d)).toBe('yesterday');
  });

  it('returns "Xd ago" for < 30 days', () => {
    const d = new Date(Date.now() - 5 * 86_400_000).toISOString();
    expect(timeAgo(d)).toBe('5d ago');
  });

  it('returns formatted date for >= 30 days', () => {
    const d = new Date(Date.now() - 35 * 86_400_000).toISOString();
    expect(timeAgo(d)).not.toMatch(/^\d+d ago$/);
    expect(timeAgo(d)).toMatch(/^[A-Za-z]+ \d+$/); // e.g. "May 11"
  });
});
