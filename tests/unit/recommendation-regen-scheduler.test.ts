import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  queueDelayedRecommendationRegen,
  runRecommendationRegen,
  setRecommendationRegenRunnerForTests,
} from '../../server/recommendation-regen-scheduler.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  setRecommendationRegenRunnerForTests(null);
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('recommendation regen scheduler', () => {
  it('shares one in-flight regen per workspace', async () => {
    let release!: () => void;
    const generateRecommendations = vi.fn(
      () =>
        new Promise<void>(resolve => {
          release = resolve;
        }),
    );
    setRecommendationRegenRunnerForTests(generateRecommendations);

    const first = runRecommendationRegen('ws-shared', 'first');
    const second = runRecommendationRegen('ws-shared', 'second');

    expect(first).toBe(second);
    await vi.waitFor(() => {
      expect(generateRecommendations).toHaveBeenCalledTimes(1);
    });

    release();
    await first;
  });

  it('lets different workspaces regen independently', async () => {
    const generateRecommendations = vi.fn(async () => undefined);
    setRecommendationRegenRunnerForTests(generateRecommendations);

    const first = runRecommendationRegen('ws-1', 'a');
    const second = runRecommendationRegen('ws-2', 'b');

    expect(first).not.toBe(second);
    await Promise.all([first, second]);
    expect(generateRecommendations).toHaveBeenCalledTimes(2);
    expect(generateRecommendations.mock.calls.map(call => call[0]).sort()).toEqual(['ws-1', 'ws-2']);
  });

  it('queues one post-flight rerun when retriggered mid-flight', async () => {
    let release!: () => void;
    const generateRecommendations = vi.fn(
      () =>
        new Promise<void>(resolve => {
          release = resolve;
        }),
    );
    setRecommendationRegenRunnerForTests(generateRecommendations);

    const first = runRecommendationRegen('ws-rerun', 'initial');
    await vi.waitFor(() => {
      expect(generateRecommendations).toHaveBeenCalledTimes(1);
    });

    const secondTrigger = runRecommendationRegen('ws-rerun', 'follow_up');
    expect(secondTrigger).toBe(first);

    release();
    await first;
    await vi.waitFor(() => {
      expect(generateRecommendations).toHaveBeenCalledTimes(2);
    });
  });

  it('drops duplicate delayed queue requests before the timer fires', async () => {
    const generateRecommendations = vi.fn(async () => undefined);
    setRecommendationRegenRunnerForTests(generateRecommendations);

    queueDelayedRecommendationRegen('ws-delayed', 'one', 1000);
    queueDelayedRecommendationRegen('ws-delayed', 'two', 1000);
    expect(generateRecommendations).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1001);
    expect(generateRecommendations).toHaveBeenCalledTimes(1);
    expect(generateRecommendations).toHaveBeenCalledWith('ws-delayed');
  });
});
