import { describe, it, expect } from 'vitest';
import { findPriorOutcomeSnapshot } from '../../server/roi.js';
import type { Ga4ConversionSnapshot } from '../../shared/types/the-issue.js';

function snap(daysAgoFromLatest: number, latestIso: string): Ga4ConversionSnapshot {
  const ms = new Date(latestIso).getTime() - daysAgoFromLatest * 24 * 60 * 60 * 1000;
  return {
    workspaceId: 'ws_test',
    capturedAt: new Date(ms).toISOString(),
    totalConversions: 0,
    totalUsers: 0,
    byEvent: [],
  };
}

describe('findPriorOutcomeSnapshot', () => {
  const latest = '2026-06-21T00:00:00.000Z';

  it('returns the snapshot closest to 30 days before latest when inside the 15–45 day window', () => {
    const history = [snap(30, latest), snap(5, latest), snap(0, latest)];
    const result = findPriorOutcomeSnapshot(history, latest);
    expect(result?.capturedAt).toBe(history[0].capturedAt); // the 30-day-prior one
  });

  it('returns null when the nearest candidate is outside the window (e.g. only a 5-day-old snapshot)', () => {
    const history = [snap(5, latest), snap(0, latest)];
    expect(findPriorOutcomeSnapshot(history, latest)).toBeNull();
  });

  it('never returns the latest snapshot itself', () => {
    const history = [snap(0, latest)];
    expect(findPriorOutcomeSnapshot(history, latest)).toBeNull();
  });

  it('accepts a snapshot 44 days prior (just inside the window) and rejects 46 days', () => {
    expect(findPriorOutcomeSnapshot([snap(44, latest)], latest)).not.toBeNull();
    expect(findPriorOutcomeSnapshot([snap(46, latest)], latest)).toBeNull();
  });
});
