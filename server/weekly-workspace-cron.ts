/**
 * Shared scheduling primitives for weekly workspace crons.
 *
 * Keep domain-specific tick logic in each cron file; this module owns only the
 * repeated mechanics that should not drift between weekly jobs.
 */

export interface WeeklyTarget {
  /** UTC day number: Sunday=0, Monday=1. */
  day: number;
  hourUtc: number;
}

/** ISO date (YYYY-MM-DD) of the Monday that anchors the week containing `d`. */
export function currentWeekOfUTC(d = new Date()): string {
  const day = d.getUTCDay();
  // Treat Sunday (0) as the end of last week so its Monday is 6 days back.
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() - diffToMonday,
  ));
  return monday.toISOString().slice(0, 10);
}

/** True once this week's target UTC day/hour has arrived. */
export function isPastWeeklyTarget(now = new Date(), target: WeeklyTarget): boolean {
  const day = now.getUTCDay();
  if (day === 0 && target.day !== 0) return false;
  if (day < target.day) return false;
  if (day === target.day && now.getUTCHours() < target.hourUtc) return false;
  return true;
}

export function runWithWorkspaceSingleFlight<Result>(
  running: Set<string>,
  workspaceId: string,
  duplicateResult: () => Result,
  run: () => Result,
): Result {
  if (running.has(workspaceId)) return duplicateResult();
  running.add(workspaceId);
  try {
    return run();
  } finally {
    running.delete(workspaceId);
  }
}

export async function runAsyncWithWorkspaceSingleFlight<Result>(
  running: Set<string>,
  workspaceId: string,
  duplicateResult: () => Result,
  run: () => Promise<Result>,
): Promise<Result> {
  if (running.has(workspaceId)) return duplicateResult();
  running.add(workspaceId);
  try {
    return await run();
  } finally {
    running.delete(workspaceId);
  }
}

export interface IntervalCronOptions {
  startupDelayMs: number;
  intervalMs: number;
  runStartup: () => void;
  runInterval: () => void;
  onStart?: () => void;
}

export interface IntervalCronLifecycle {
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

export function createIntervalCron(options: IntervalCronOptions): IntervalCronLifecycle {
  let startupTimeout: ReturnType<typeof setTimeout> | null = null;
  let tickInterval: ReturnType<typeof setInterval> | null = null;

  return {
    start(): void {
      if (tickInterval) return;

      startupTimeout = setTimeout(options.runStartup, options.startupDelayMs);
      startupTimeout.unref?.();

      tickInterval = setInterval(options.runInterval, options.intervalMs);
      tickInterval.unref?.();

      options.onStart?.();
    },

    stop(): void {
      if (startupTimeout) {
        clearTimeout(startupTimeout);
        startupTimeout = null;
      }
      if (tickInterval) {
        clearInterval(tickInterval);
        tickInterval = null;
      }
    },

    isRunning(): boolean {
      return tickInterval !== null;
    },
  };
}
