/**
 * opportunity-regen debounce tests (PR7 · Spine B).
 *
 * Covers:
 *   1. A BURST of triggers within the debounce window collapses into a SINGLE
 *      generateRecommendations() run (anti-thrash, design §5).
 *   2. Distinct workspaces run independently (one regen each).
 *   3. With the events flag OFF, the debounced bridge no-ops (no regen runs) even
 *      if a trigger fires — the underlying executeBridge short-circuits.
 *
 * generateRecommendations is reached via a dynamic import inside the debounced fn,
 * so we mock '../../server/recommendations.js' to count invocations without booting
 * the real rec pipeline.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(),
  generateRecommendations: vi.fn(async () => ({}) as unknown),
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../../server/feature-flags.js', () => ({ isFeatureEnabled: mocks.isFeatureEnabled }));
vi.mock('../../server/recommendations.js', () => ({ generateRecommendations: mocks.generateRecommendations }));

import { triggerOpportunityRegen, OPPORTUNITY_REGEN_DEBOUNCE_MS } from '../../server/scoring/opportunity-regen.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('triggerOpportunityRegen — debounce (flag ON)', () => {
  beforeEach(() => mocks.isFeatureEnabled.mockReturnValue(true));

  it('collapses a burst of triggers into a single regen', async () => {
    for (let i = 0; i < 5; i++) triggerOpportunityRegen('ws-burst');
    // Nothing runs until the debounce window elapses.
    expect(mocks.generateRecommendations).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(OPPORTUNITY_REGEN_DEBOUNCE_MS + 10);
    expect(mocks.generateRecommendations).toHaveBeenCalledTimes(1);
    expect(mocks.generateRecommendations).toHaveBeenCalledWith('ws-burst');
  });

  it('runs distinct workspaces independently', async () => {
    triggerOpportunityRegen('ws-1');
    triggerOpportunityRegen('ws-2');
    await vi.advanceTimersByTimeAsync(OPPORTUNITY_REGEN_DEBOUNCE_MS + 10);
    expect(mocks.generateRecommendations).toHaveBeenCalledTimes(2);
    const calledWith = mocks.generateRecommendations.mock.calls.map(c => c[0]).sort();
    expect(calledWith).toEqual(['ws-1', 'ws-2']);
  });

  it('does nothing for an empty workspaceId', async () => {
    triggerOpportunityRegen('');
    await vi.advanceTimersByTimeAsync(OPPORTUNITY_REGEN_DEBOUNCE_MS + 10);
    expect(mocks.generateRecommendations).not.toHaveBeenCalled();
  });
});

describe('triggerOpportunityRegen — flag OFF', () => {
  beforeEach(() => mocks.isFeatureEnabled.mockReturnValue(false));

  it('does not run a regen when the events flag is OFF', async () => {
    triggerOpportunityRegen('ws-off');
    await vi.advanceTimersByTimeAsync(OPPORTUNITY_REGEN_DEBOUNCE_MS + 10);
    expect(mocks.generateRecommendations).not.toHaveBeenCalled();
  });
});
