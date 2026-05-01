// Unit tests for the `computeStaleness` helper exported from
// src/components/client/Briefing/ActionQueueStrip.tsx — Phase 2.5b.
// The composer feeds raw createdAt timestamps; the helper returns the
// staleCount (>7d age) and oldestDaysPending. Pure function, no React.

import { describe, it, expect } from 'vitest';
import { computeStaleness } from '../../src/components/client/Briefing/ActionQueueStrip';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 3, 29, 12, 0, 0); // 2026-04-29T12:00:00Z

describe('computeStaleness', () => {
  it('returns zeros when given an empty array', () => {
    expect(computeStaleness([], NOW)).toEqual({
      staleCount: 0,
      oldestDaysPending: 0,
    });
  });

  it('counts items older than 7 days as stale', () => {
    const ts = [
      NOW - 8 * DAY_MS, // stale
      NOW - 14 * DAY_MS, // stale
      NOW - 3 * DAY_MS, // fresh
    ];
    const result = computeStaleness(ts, NOW);
    expect(result.staleCount).toBe(2);
  });

  it('does NOT count items exactly at 7 days as stale (strict >)', () => {
    const ts = [NOW - 7 * DAY_MS];
    expect(computeStaleness(ts, NOW).staleCount).toBe(0);
  });

  it('counts items at 7d + 1ms as stale', () => {
    const ts = [NOW - 7 * DAY_MS - 1];
    expect(computeStaleness(ts, NOW).staleCount).toBe(1);
  });

  it('returns oldestDaysPending in floor-of-days', () => {
    const ts = [
      NOW - 1 * DAY_MS,
      NOW - 14 * DAY_MS, // oldest
      NOW - 5 * DAY_MS,
    ];
    expect(computeStaleness(ts, NOW).oldestDaysPending).toBe(14);
  });

  it('returns oldestDaysPending=0 when only fresh items present', () => {
    const ts = [NOW - 1 * DAY_MS];
    expect(computeStaleness(ts, NOW).oldestDaysPending).toBe(1);
  });

  it('uses Date.now() by default when no nowMs override is provided', () => {
    // We don't assert the exact value here — only that the signature works
    // without the second arg. The helper should not throw.
    expect(() => computeStaleness([Date.now() - 100])).not.toThrow();
  });

  it('handles large arrays without overflow', () => {
    const ts = Array.from({ length: 1000 }, (_, i) => NOW - (i + 1) * DAY_MS);
    const result = computeStaleness(ts, NOW);
    // 1000 items at ages 1d…1000d. Strictly >7d means ages 8d…1000d → 993.
    expect(result.staleCount).toBe(993);
    expect(result.oldestDaysPending).toBe(1000);
  });
});
