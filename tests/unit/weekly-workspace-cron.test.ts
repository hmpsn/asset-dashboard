import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createIntervalCron,
  currentWeekOfUTC,
  isPastWeeklyTarget,
  runAsyncWithWorkspaceSingleFlight,
  runWithWorkspaceSingleFlight,
} from '../../server/weekly-workspace-cron.js';

describe('weekly-workspace-cron helpers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('anchors all weekdays to the Monday ISO date and treats Sunday as the prior week', () => {
    expect(currentWeekOfUTC(new Date('2025-01-06T10:00:00Z'))).toBe('2025-01-06');
    expect(currentWeekOfUTC(new Date('2025-01-08T10:00:00Z'))).toBe('2025-01-06');
    expect(currentWeekOfUTC(new Date('2025-01-12T23:59:00Z'))).toBe('2025-01-06');
    expect(currentWeekOfUTC(new Date('2025-01-13T00:01:00Z'))).toBe('2025-01-13');
  });

  it('checks whether a weekly UTC target has passed', () => {
    const monday14 = { day: 1, hourUtc: 14 };
    expect(isPastWeeklyTarget(new Date('2025-01-12T23:59:59Z'), monday14)).toBe(false);
    expect(isPastWeeklyTarget(new Date('2025-01-13T13:59:59Z'), monday14)).toBe(false);
    expect(isPastWeeklyTarget(new Date('2025-01-13T14:00:00Z'), monday14)).toBe(true);
    expect(isPastWeeklyTarget(new Date('2025-01-14T00:00:00Z'), monday14)).toBe(true);
  });

  it('serializes synchronous workspace work with a duplicate result', () => {
    const running = new Set<string>(['ws-1']);
    const duplicate = runWithWorkspaceSingleFlight(
      running,
      'ws-1',
      () => 'duplicate',
      () => 'ran',
    );
    expect(duplicate).toBe('duplicate');

    running.clear();
    const result = runWithWorkspaceSingleFlight(
      running,
      'ws-1',
      () => 'duplicate',
      () => {
        expect(running.has('ws-1')).toBe(true);
        return 'ran';
      },
    );
    expect(result).toBe('ran');
    expect(running.has('ws-1')).toBe(false);
  });

  it('serializes async workspace work and clears the mutex after rejection', async () => {
    const running = new Set<string>();
    await expect(
      runAsyncWithWorkspaceSingleFlight(
        running,
        'ws-1',
        () => 'duplicate',
        async () => {
          expect(running.has('ws-1')).toBe(true);
          throw new Error('boom');
        },
      ),
    ).rejects.toThrow('boom');
    expect(running.has('ws-1')).toBe(false);
  });

  it('starts idempotently and stop clears startup + interval timers', () => {
    vi.useFakeTimers();
    const runStartup = vi.fn();
    const runInterval = vi.fn();
    const onStart = vi.fn();
    const cron = createIntervalCron({
      startupDelayMs: 1_000,
      intervalMs: 5_000,
      runStartup,
      runInterval,
      onStart,
    });

    cron.start();
    cron.start();
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(cron.isRunning()).toBe(true);

    vi.advanceTimersByTime(1_000);
    expect(runStartup).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5_000);
    expect(runInterval).toHaveBeenCalledTimes(1);

    cron.stop();
    expect(cron.isRunning()).toBe(false);
    vi.advanceTimersByTime(5_000);
    expect(runInterval).toHaveBeenCalledTimes(1);
  });
});
