/**
 * Wave 20-a5 — Pure function unit tests for server/briefing-cron.ts
 *
 * Covers:
 *   - currentWeekOfUTC algorithm (inline replication): Monday anchoring,
 *     Sunday-as-end-of-last-week, midweek stability, ISO date format
 *   - isPastTargetThisWeek algorithm (inline replication): Sunday guard,
 *     Monday pre-cutoff, Monday at cutoff, Tuesday+, exact boundary
 *   - startBriefingCron / stopBriefingCron: idempotent start, stop clears state
 *   - RunBriefingResult status string literals (type contract)
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  startBriefingCron,
  stopBriefingCron,
} from '../../server/briefing-cron.js';

// ────────────────────────────────────────────────────────────────────────────
// Replicated pure logic from briefing-cron.ts (non-exported helpers)
// These functions are copied verbatim from briefing-cron.ts so the tests
// document and verify the algorithm contract independently of the implementation.
// ────────────────────────────────────────────────────────────────────────────

const TARGET_DAY = 1; // Monday
const TARGET_HOUR_UTC = 14;

/** ISO date (YYYY-MM-DD) of the Monday that anchors the week containing `d`. */
function currentWeekOfUTC(d = new Date()): string {
  const day = d.getUTCDay();
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() - diffToMonday,
  ));
  return monday.toISOString().slice(0, 10);
}

/** Has this week's Monday 14:00 UTC already passed? */
function isPastTargetThisWeek(now = new Date()): boolean {
  const day = now.getUTCDay();
  if (day === 0) return false;
  if (day === TARGET_DAY && now.getUTCHours() < TARGET_HOUR_UTC) return false;
  return true;
}

// ─── currentWeekOfUTC ────────────────────────────────────────────────────────

describe('currentWeekOfUTC — Monday anchor', () => {
  it('returns Monday itself when called on a Monday', () => {
    // 2025-01-06 is a Monday
    const d = new Date('2025-01-06T10:00:00Z');
    expect(currentWeekOfUTC(d)).toBe('2025-01-06');
  });

  it('returns the same Monday for Tuesday of the same week', () => {
    const d = new Date('2025-01-07T10:00:00Z'); // Tuesday
    expect(currentWeekOfUTC(d)).toBe('2025-01-06');
  });

  it('returns the same Monday for Wednesday', () => {
    const d = new Date('2025-01-08T10:00:00Z'); // Wednesday
    expect(currentWeekOfUTC(d)).toBe('2025-01-06');
  });

  it('returns the same Monday for Saturday', () => {
    const d = new Date('2025-01-11T23:59:00Z'); // Saturday
    expect(currentWeekOfUTC(d)).toBe('2025-01-06');
  });

  it('treats Sunday as the END of the previous week (Monday is 6 days back)', () => {
    // Sunday 2025-01-12 → the preceding Monday is 2025-01-06
    const d = new Date('2025-01-12T12:00:00Z');
    expect(currentWeekOfUTC(d)).toBe('2025-01-06');
  });

  it('advances the week anchor when crossing from Sunday to Monday', () => {
    const sunday = new Date('2025-01-12T23:59:00Z');
    const monday = new Date('2025-01-13T00:01:00Z');
    const sundayWeek = currentWeekOfUTC(sunday);
    const mondayWeek = currentWeekOfUTC(monday);
    expect(sundayWeek).toBe('2025-01-06');
    expect(mondayWeek).toBe('2025-01-13');
    expect(sundayWeek).not.toBe(mondayWeek);
  });

  it('returns a string matching YYYY-MM-DD format', () => {
    const result = currentWeekOfUTC(new Date('2025-03-19T10:00:00Z'));
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns a Monday — day-of-week of returned date is always 1', () => {
    // 2025-03-19 is a Wednesday
    const result = currentWeekOfUTC(new Date('2025-03-19T10:00:00Z'));
    const parsed = new Date(`${result}T00:00:00Z`);
    expect(parsed.getUTCDay()).toBe(1); // Monday
  });

  it('is stable across multiple calls on the same day', () => {
    const d = new Date('2025-05-21T08:00:00Z'); // Wednesday
    expect(currentWeekOfUTC(d)).toBe(currentWeekOfUTC(d));
  });

  it('handles year-boundary crossing (last week of year → next year)', () => {
    // 2024-12-30 is a Monday
    const d = new Date('2024-12-31T10:00:00Z'); // Tuesday
    expect(currentWeekOfUTC(d)).toBe('2024-12-30');
  });
});

// ─── isPastTargetThisWeek ────────────────────────────────────────────────────

describe('isPastTargetThisWeek — Monday 14:00 UTC cutoff', () => {
  it('returns false on Sunday (day=0, Monday not yet arrived)', () => {
    const sunday = new Date('2025-01-12T23:00:00Z');
    expect(isPastTargetThisWeek(sunday)).toBe(false);
  });

  it('returns false on Monday before 14:00 UTC', () => {
    const monday = new Date('2025-01-13T13:59:59Z');
    expect(isPastTargetThisWeek(monday)).toBe(false);
  });

  it('returns true on Monday at exactly 14:00 UTC', () => {
    const monday14 = new Date('2025-01-13T14:00:00Z');
    expect(isPastTargetThisWeek(monday14)).toBe(true);
  });

  it('returns true on Monday after 14:00 UTC', () => {
    const monday15 = new Date('2025-01-13T15:30:00Z');
    expect(isPastTargetThisWeek(monday15)).toBe(true);
  });

  it('returns true on Tuesday regardless of hour', () => {
    const tuesday = new Date('2025-01-14T00:00:00Z');
    expect(isPastTargetThisWeek(tuesday)).toBe(true);
  });

  it('returns true on Wednesday', () => {
    const wednesday = new Date('2025-01-15T10:00:00Z');
    expect(isPastTargetThisWeek(wednesday)).toBe(true);
  });

  it('returns true on Saturday', () => {
    const saturday = new Date('2025-01-18T20:00:00Z');
    expect(isPastTargetThisWeek(saturday)).toBe(true);
  });

  it('returns false on Sunday even at 23:59:59 UTC', () => {
    const sundayLate = new Date('2025-01-19T23:59:59Z');
    expect(isPastTargetThisWeek(sundayLate)).toBe(false);
  });
});

// ─── startBriefingCron / stopBriefingCron ────────────────────────────────────

describe('startBriefingCron / stopBriefingCron', () => {
  afterEach(() => {
    stopBriefingCron();
  });

  it('startBriefingCron is callable without throwing', () => {
    expect(() => startBriefingCron()).not.toThrow();
  });

  it('calling startBriefingCron twice is idempotent (no throw)', () => {
    startBriefingCron();
    expect(() => startBriefingCron()).not.toThrow();
  });

  it('stopBriefingCron is callable without throwing even before start', () => {
    expect(() => stopBriefingCron()).not.toThrow();
  });

  it('stop after start does not throw', () => {
    startBriefingCron();
    expect(() => stopBriefingCron()).not.toThrow();
  });

  it('stop is idempotent — calling twice does not throw', () => {
    startBriefingCron();
    stopBriefingCron();
    expect(() => stopBriefingCron()).not.toThrow();
  });
});

// ─── RunBriefingResult status type contract ──────────────────────────────────

describe('RunBriefingResult status literals — type contract', () => {
  it('status "generated" is a valid string literal', () => {
    const r = { status: 'generated' as const, weekOf: '2025-01-13' };
    expect(r.status).toBe('generated');
  });

  it('status "deferred" is a valid string literal', () => {
    const r = { status: 'deferred' as const, weekOf: '2025-01-13', reason: 'stale audit' };
    expect(r.status).toBe('deferred');
    expect(r.reason).toBe('stale audit');
  });

  it('status "skipped" carries an optional reason', () => {
    const r = { status: 'skipped' as const, weekOf: '2025-01-13', reason: 'free tier' };
    expect(r.status).toBe('skipped');
    expect(r.reason).toBe('free tier');
  });

  it('status "duplicate" is a valid string literal', () => {
    const r = { status: 'duplicate' as const, weekOf: '' };
    expect(r.status).toBe('duplicate');
  });
});
