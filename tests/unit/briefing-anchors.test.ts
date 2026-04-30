/**
 * Unit tests for server/briefing-anchors.ts — Phase 2.5c phrase formatter.
 *
 * Tests the pure formatting layer. The underlying snapshot module
 * (`getBestValueSinceDate`) is mocked at the module-import boundary so
 * these tests don't touch the DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the snapshot module BEFORE importing the anchors module so the
// hoisted vi.mock() takes effect.
const getBestValueSinceDate = vi.fn();
vi.mock('../../server/workspace-metrics-snapshots.js', () => ({
  getBestValueSinceDate: (...args: unknown[]) => getBestValueSinceDate(...args),
}));

import { findBestWeekSince } from '../../server/briefing-anchors.js';

describe('findBestWeekSince', () => {
  beforeEach(() => {
    getBestValueSinceDate.mockReset();
  });

  it('returns null when the snapshot module returns null (no anchor)', () => {
    getBestValueSinceDate.mockReturnValue(null);
    const r = findBestWeekSince('ws_test', 'total_clicks', 1234);
    expect(r).toBeNull();
  });

  it('formats total_clicks as "best week since Mon DD"', () => {
    getBestValueSinceDate.mockReturnValue({ sinceDate: '2026-03-17' });
    const r = findBestWeekSince('ws_test', 'total_clicks', 1234);
    expect(r).not.toBeNull();
    expect(r!.phrase).toBe('best week since Mar 17');
    expect(r!.sinceDate).toBe('2026-03-17');
  });

  it('formats total_impressions as "best impressions since Mon DD"', () => {
    getBestValueSinceDate.mockReturnValue({ sinceDate: '2026-04-01' });
    const r = findBestWeekSince('ws_test', 'total_impressions', 5000);
    expect(r!.phrase).toBe('best impressions since Apr 1');
  });

  it('formats avg_position with lower-is-better phrasing', () => {
    getBestValueSinceDate.mockReturnValue({ sinceDate: '2026-03-24' });
    const r = findBestWeekSince('ws_test', 'avg_position', 8.2);
    expect(r!.phrase).toBe('lowest avg position since Mar 24');
  });

  it('formats audit_score as "highest site health since Mon DD"', () => {
    getBestValueSinceDate.mockReturnValue({ sinceDate: '2026-03-17' });
    const r = findBestWeekSince('ws_test', 'audit_score', 92);
    expect(r!.phrase).toBe('highest site health since Mar 17');
  });

  it('formats organic_traffic_value as "highest traffic value since Mon DD"', () => {
    getBestValueSinceDate.mockReturnValue({ sinceDate: '2026-03-17' });
    const r = findBestWeekSince('ws_test', 'organic_traffic_value', 4200);
    expect(r!.phrase).toBe('highest traffic value since Mar 17');
  });

  it('passes windowDays through to the underlying module', () => {
    getBestValueSinceDate.mockReturnValue({ sinceDate: '2026-04-01' });
    findBestWeekSince('ws_test', 'total_clicks', 100, 30);
    expect(getBestValueSinceDate).toHaveBeenCalledWith('ws_test', 'total_clicks', 100, 30);
  });

  it('renders day-of-month without leading zero', () => {
    getBestValueSinceDate.mockReturnValue({ sinceDate: '2026-04-01' });
    const r = findBestWeekSince('ws_test', 'total_clicks', 100);
    expect(r!.phrase).toContain('Apr 1');
    expect(r!.phrase).not.toContain('Apr 01');
  });

  it('produces phrases that contain no banned hedge words', () => {
    const HEDGES = /\b(potentially|could|may|appears to|suggests|might|seems)\b/i;
    const cases: Array<['total_clicks' | 'total_impressions' | 'avg_position' | 'audit_score' | 'organic_traffic_value', number]> = [
      ['total_clicks', 1000],
      ['total_impressions', 50_000],
      ['avg_position', 5.5],
      ['audit_score', 88],
      ['organic_traffic_value', 1200],
    ];
    for (const [metric, current] of cases) {
      getBestValueSinceDate.mockReturnValue({ sinceDate: '2026-03-17' });
      const r = findBestWeekSince('ws_test', metric, current);
      expect(r!.phrase).not.toMatch(HEDGES);
    }
  });
});
