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

  it('supports long labels', () => {
    expect(timeAgo(new Date(Date.now() - 1 * 60_000).toISOString(), { style: 'long' })).toBe('1 minute ago');
    expect(timeAgo(new Date(Date.now() - 2 * 3_600_000).toISOString(), { style: 'long' })).toBe('2 hours ago');
    expect(timeAgo(new Date(Date.now() - 3 * 86_400_000).toISOString(), { style: 'long' })).toBe('3 days ago');
  });

  it('supports calendar labels', () => {
    expect(timeAgo(new Date(Date.now() - 30_000).toISOString(), { style: 'calendar' })).toBe('just now');
    expect(timeAgo(new Date(Date.now() - 2 * 3_600_000).toISOString(), { style: 'calendar' })).toBe('today');
    expect(timeAgo(new Date(Date.now() - 1 * 86_400_000).toISOString(), { style: 'calendar' })).toBe('yesterday');
    expect(timeAgo(new Date(Date.now() - 35 * 86_400_000).toISOString(), { style: 'calendar' })).toBe('1 month ago');
  });

  it('can capitalize "just now"', () => {
    const d = new Date(Date.now() - 30_000).toISOString();
    expect(timeAgo(d, { capitalizeJustNow: true })).toBe('Just now');
  });

  it('can preserve rounded compact labels beyond the default date cutoff', () => {
    expect(timeAgo(new Date(Date.now() - 90 * 60_000).toISOString(), { roundUnits: true })).toBe('2h ago');
    expect(timeAgo(new Date(Date.now() - 35 * 86_400_000).toISOString(), {
      dateAfterDays: Number.POSITIVE_INFINITY,
      roundUnits: true,
    })).toBe('35d ago');
  });
});
