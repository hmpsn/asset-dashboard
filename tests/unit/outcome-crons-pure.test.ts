/**
 * Unit tests for server/outcome-crons.ts — backlog threshold logic.
 *
 * outcome-crons.ts is almost entirely scheduling glue (dynamic imports + setInterval/setTimeout).
 * Importing it triggers the full module dependency chain (DB open, logger init), so the
 * scheduling lifecycle and module-level constants cannot be tested by importing the module.
 *
 * These tests cover the backlog-alert threshold decision logic, extracted here as a pure
 * function that mirrors the production closure in outcome-crons.ts. If the thresholds or
 * algorithm change in production, update the replica below and its tests accordingly.
 */

import { describe, it, expect } from 'vitest';

// ── Backlog alert logic (inline-extracted pure functions) ────────────────────
// The age and count threshold logic lives inside an async closure in outcome-crons.ts.
// We replicate it here as a pure function and verify the decision logic exhaustively.

type PendingAction = { workspaceId: string; createdAt: string };

function checkBacklogThresholds(
  wsPending: PendingAction[],
  nowMs: number,
  opts: { countThreshold: number; ageDays: number },
): { countBreached: boolean; ageBreached: boolean; oldestAgeDays: number } {
  const DAILY_MS = 24 * 60 * 60 * 1000;
  const ageThresholdMs = opts.ageDays * DAILY_MS;

  const oldestMs = wsPending.reduce((min, a) => {
    const t = new Date(a.createdAt).getTime();
    return t < min ? t : min;
  }, Infinity);

  const oldestAgeDays = isFinite(oldestMs) ? Math.floor((nowMs - oldestMs) / DAILY_MS) : 0;
  const countBreached = wsPending.length >= opts.countThreshold;
  const ageBreached = isFinite(oldestMs) && (nowMs - oldestMs) >= ageThresholdMs;

  return { countBreached, ageBreached, oldestAgeDays };
}

describe('backlog threshold detection logic', () => {
  const NOW = new Date('2026-05-26T12:00:00.000Z').getTime();

  function daysAgo(n: number) {
    return new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();
  }

  function makeActions(n: number, createdAt: string): PendingAction[] {
    return Array.from({ length: n }, (_, i) => ({ workspaceId: 'ws_test', createdAt }));
  }

  it('no breach when count < 20 and age < 14 days', () => {
    const actions = makeActions(5, daysAgo(3));
    const result = checkBacklogThresholds(actions, NOW, { countThreshold: 20, ageDays: 14 });
    expect(result.countBreached).toBe(false);
    expect(result.ageBreached).toBe(false);
  });

  it('count breach fires at exactly 20 actions', () => {
    const actions = makeActions(20, daysAgo(1));
    const result = checkBacklogThresholds(actions, NOW, { countThreshold: 20, ageDays: 14 });
    expect(result.countBreached).toBe(true);
    expect(result.ageBreached).toBe(false);
  });

  it('count breach fires above 20 actions', () => {
    const actions = makeActions(25, daysAgo(1));
    const result = checkBacklogThresholds(actions, NOW, { countThreshold: 20, ageDays: 14 });
    expect(result.countBreached).toBe(true);
  });

  it('age breach fires when oldest action is ≥ 14 days old', () => {
    const actions = makeActions(2, daysAgo(14));
    const result = checkBacklogThresholds(actions, NOW, { countThreshold: 20, ageDays: 14 });
    expect(result.ageBreached).toBe(true);
    expect(result.countBreached).toBe(false);
    expect(result.oldestAgeDays).toBe(14);
  });

  it('both breaches fire simultaneously', () => {
    const actions = makeActions(20, daysAgo(20));
    const result = checkBacklogThresholds(actions, NOW, { countThreshold: 20, ageDays: 14 });
    expect(result.countBreached).toBe(true);
    expect(result.ageBreached).toBe(true);
    expect(result.oldestAgeDays).toBe(20);
  });

  it('empty array: no breach, oldestAgeDays = 0', () => {
    const result = checkBacklogThresholds([], NOW, { countThreshold: 20, ageDays: 14 });
    expect(result.countBreached).toBe(false);
    expect(result.ageBreached).toBe(false);
    expect(result.oldestAgeDays).toBe(0);
  });

  it('single action at 13 days old: no age breach', () => {
    const actions = makeActions(1, daysAgo(13));
    const result = checkBacklogThresholds(actions, NOW, { countThreshold: 20, ageDays: 14 });
    expect(result.ageBreached).toBe(false);
    expect(result.oldestAgeDays).toBe(13);
  });

  it('oldestAgeDays picks the minimum createdAt across mixed ages', () => {
    const actions: PendingAction[] = [
      { workspaceId: 'ws', createdAt: daysAgo(5) },
      { workspaceId: 'ws', createdAt: daysAgo(20) },
      { workspaceId: 'ws', createdAt: daysAgo(2) },
    ];
    const result = checkBacklogThresholds(actions, NOW, { countThreshold: 20, ageDays: 14 });
    expect(result.oldestAgeDays).toBe(20);
    expect(result.ageBreached).toBe(true);
  });
});

// Note: startOutcomeCrons/stopOutcomeCrons scheduling lifecycle tests are omitted
// here because they require vi.resetModules() + dynamic import which re-executes
// the full module dependency chain (DB open, logger init) and causes timeouts in CI.
