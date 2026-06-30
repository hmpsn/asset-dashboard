/**
 * opportunity-regen debounce tests (PR7 · Spine B).
 *
 * Covers:
 *   1. A BURST of triggers within the debounce window collapses into a SINGLE
 *      generateRecommendations() run (anti-thrash, design §5).
 *   2. Distinct workspaces run independently (one regen each).
 *   3. Empty workspace ids are ignored.
 *
 * The debounced fn routes through the shared single-flight scheduler, so we use
 * its test runner override to count invocations without booting the real rec pipeline.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateRecommendations: vi.fn(async () => undefined),
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
import { triggerOpportunityRegen, OPPORTUNITY_REGEN_DEBOUNCE_MS } from '../../server/scoring/opportunity-regen.js';
import { setRecommendationRegenRunnerForTests } from '../../server/recommendation-regen-scheduler.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  setRecommendationRegenRunnerForTests(mocks.generateRecommendations);
});

afterEach(async () => {
  await vi.runOnlyPendingTimersAsync();
  await Promise.resolve();
  setRecommendationRegenRunnerForTests(null);
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('triggerOpportunityRegen — debounce', () => {
  it('collapses a burst of triggers into a single regen', async () => {
    for (let i = 0; i < 5; i++) triggerOpportunityRegen('ws-burst');
    // Nothing runs until the debounce window elapses.
    expect(mocks.generateRecommendations).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(OPPORTUNITY_REGEN_DEBOUNCE_MS + 10);
    await vi.waitFor(() => expect(mocks.generateRecommendations).toHaveBeenCalledTimes(1));
    expect(mocks.generateRecommendations).toHaveBeenCalledWith('ws-burst');
  });

  it('runs distinct workspaces independently', async () => {
    triggerOpportunityRegen('ws-1');
    triggerOpportunityRegen('ws-2');
    await vi.advanceTimersByTimeAsync(OPPORTUNITY_REGEN_DEBOUNCE_MS + 10);
    await vi.waitFor(() => expect(mocks.generateRecommendations).toHaveBeenCalledTimes(2));
    const calledWith = mocks.generateRecommendations.mock.calls.map(c => c[0]).sort();
    expect(calledWith).toEqual(['ws-1', 'ws-2']);
  });

  it('does nothing for an empty workspaceId', async () => {
    triggerOpportunityRegen('');
    await vi.advanceTimersByTimeAsync(OPPORTUNITY_REGEN_DEBOUNCE_MS + 10);
    expect(mocks.generateRecommendations).not.toHaveBeenCalled();
  });
});
