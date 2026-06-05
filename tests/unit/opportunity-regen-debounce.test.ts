/**
 * opportunity-regen debounce tests (PR7 · Spine B).
 *
 * Covers:
 *   1. A BURST of triggers within the debounce window collapses into a SINGLE
 *      generateRecommendations() run (anti-thrash, design §5).
 *   2. Distinct workspaces run independently (one regen each).
 *   3. Empty workspace ids are ignored.
 *
 * The debounced fn now routes through the shared single-flight scheduler, so we
 * mock '../../server/recommendation-regen-scheduler.js' to count invocations
 * without booting the real rec pipeline.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runRecommendationRegen: vi.fn(async () => undefined),
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../../server/recommendation-regen-scheduler.js', () => ({
  runRecommendationRegen: mocks.runRecommendationRegen,
}));

import { triggerOpportunityRegen, OPPORTUNITY_REGEN_DEBOUNCE_MS } from '../../server/scoring/opportunity-regen.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('triggerOpportunityRegen — debounce', () => {
  it('collapses a burst of triggers into a single regen', async () => {
    for (let i = 0; i < 5; i++) triggerOpportunityRegen('ws-burst');
    // Nothing runs until the debounce window elapses.
    expect(mocks.runRecommendationRegen).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(OPPORTUNITY_REGEN_DEBOUNCE_MS + 10);
    expect(mocks.runRecommendationRegen).toHaveBeenCalledTimes(1);
    expect(mocks.runRecommendationRegen).toHaveBeenCalledWith('ws-burst', 'opportunity_value_event');
  });

  it('runs distinct workspaces independently', async () => {
    triggerOpportunityRegen('ws-1');
    triggerOpportunityRegen('ws-2');
    await vi.advanceTimersByTimeAsync(OPPORTUNITY_REGEN_DEBOUNCE_MS + 10);
    expect(mocks.runRecommendationRegen).toHaveBeenCalledTimes(2);
    const calledWith = mocks.runRecommendationRegen.mock.calls.map(c => c[0]).sort();
    expect(calledWith).toEqual(['ws-1', 'ws-2']);
  });

  it('does nothing for an empty workspaceId', async () => {
    triggerOpportunityRegen('');
    await vi.advanceTimersByTimeAsync(OPPORTUNITY_REGEN_DEBOUNCE_MS + 10);
    expect(mocks.runRecommendationRegen).not.toHaveBeenCalled();
  });
});
