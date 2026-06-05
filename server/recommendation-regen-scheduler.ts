import { createLogger } from './logger.js';

const log = createLogger('recommendation-regen');

export const RECOMMENDATION_REFRESH_DELAY_MS = 30_000;

const inflight = new Map<string, Promise<void>>();
const delayed = new Map<string, ReturnType<typeof setTimeout>>();
const reading = new Set<string>();
const postFlightReasons = new Map<string, Set<string>>();
let testGenerateRecommendationsOverride: ((workspaceId: string) => Promise<unknown>) | null = null;

export function setRecommendationRegenRunnerForTests(
  runner: ((workspaceId: string) => Promise<unknown>) | null,
): void {
  testGenerateRecommendationsOverride = runner;
  inflight.clear();
  reading.clear();
  postFlightReasons.clear();
  for (const timer of delayed.values()) clearTimeout(timer);
  delayed.clear();
}

async function loadGenerateRecommendations(): Promise<(workspaceId: string) => Promise<unknown>> {
  if (testGenerateRecommendationsOverride) return testGenerateRecommendationsOverride;
  const { generateRecommendations } = await import('./recommendations.js'); // dynamic-import-ok
  return generateRecommendations;
}

function queuePostFlightRerun(workspaceId: string, reason: string): void {
  const reasons = postFlightReasons.get(workspaceId) ?? new Set<string>();
  reasons.add(reason);
  postFlightReasons.set(workspaceId, reasons);
}

function takePostFlightReason(workspaceId: string): string | null {
  const reasons = postFlightReasons.get(workspaceId);
  if (!reasons || reasons.size === 0) return null;
  postFlightReasons.delete(workspaceId);
  return Array.from(reasons).join(',');
}

async function executeRecommendationRegen(workspaceId: string, reason: string): Promise<void> {
  try {
    const generateRecommendations = await loadGenerateRecommendations();
    reading.add(workspaceId);
    await generateRecommendations(workspaceId);
    log.info({ workspaceId, reason }, 'recommendation regen complete');
  } catch (err) {
    log.warn(
      { workspaceId, reason, err: err instanceof Error ? err.message : String(err) },
      'recommendation regen failed (non-fatal)',
    );
  } finally {
    reading.delete(workspaceId);
  }
}

/**
 * Runs at most one recommendation regen per workspace at a time.
 * Concurrent callers for the same workspace share the same Promise.
 */
export function runRecommendationRegen(workspaceId: string, reason: string): Promise<void> {
  if (!workspaceId) return Promise.resolve();

  const existing = inflight.get(workspaceId);
  if (existing) {
    if (reading.has(workspaceId)) queuePostFlightRerun(workspaceId, reason);
    return existing;
  }

  const promise = executeRecommendationRegen(workspaceId, reason).finally(() => {
    if (inflight.get(workspaceId) === promise) {
      inflight.delete(workspaceId);
    }

    const rerunReason = takePostFlightReason(workspaceId);
    if (rerunReason) {
      void runRecommendationRegen(workspaceId, `post_flight:${rerunReason}`);
    }
  });

  inflight.set(workspaceId, promise);
  return promise;
}

/**
 * Queues a delayed recommendation regen if one is not already scheduled for the
 * workspace. When the timer fires, execution still serializes through
 * `runRecommendationRegen()` so delayed and event-driven callers share the same
 * single-flight authority.
 */
export function queueDelayedRecommendationRegen(workspaceId: string, reason: string, delayMs: number = RECOMMENDATION_REFRESH_DELAY_MS): void {
  if (!workspaceId || delayed.has(workspaceId)) return;

  delayed.set(
    workspaceId,
    setTimeout(() => {
      delayed.delete(workspaceId);
      void runRecommendationRegen(workspaceId, reason);
    }, delayMs),
  );
}
