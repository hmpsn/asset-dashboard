import { describe, it, expect } from 'vitest';
import { formatDate, formatDateShort, formatDateTime } from '../../src/utils/formatDates.js';

// Use noon local time (via constructor args) to avoid UTC midnight crossing into prior day
// when running tests in negative-UTC timezones.
const JAN_15_2026 = new Date(2026, 0, 15, 12, 0, 0); // Jan 15, 2026 noon local

describe('formatDate', () => {
  it('formats a valid Date object', () => {
    const result = formatDate(JAN_15_2026);
    expect(result).toContain('2026');
    expect(result).toContain('Jan');
    expect(result).toContain('15');
  });

  it('formats an ISO string (noon UTC stays in correct day everywhere)', () => {
    const result = formatDate('2026-01-15T12:00:00.000Z');
    expect(result).toContain('2026');
  });

  it('returns empty string for null', () => {
    expect(formatDate(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatDate(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(formatDate('')).toBe('');
  });

  it('returns empty string for an invalid date string', () => {
    expect(formatDate('not-a-date')).toBe('');
  });
});

describe('formatDateShort', () => {
  it('omits the year', () => {
    const result = formatDateShort(JAN_15_2026);
    expect(result).not.toContain('2026');
    expect(result).toContain('Jan');
    expect(result).toContain('15');
  });

  it('returns empty string for null', () => {
    expect(formatDateShort(null)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(formatDateShort('')).toBe('');
  });
});

describe('formatDateTime', () => {
  it('includes time component', () => {
    const result = formatDateTime(JAN_15_2026);
    expect(result).toContain('2026');
    expect(result).toMatch(/\d+:\d{2}/);
  });

  it('returns empty string for null', () => {
    expect(formatDateTime(null)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(formatDateTime('')).toBe('');
  });
});
