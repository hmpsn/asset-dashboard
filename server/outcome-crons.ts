// server/outcome-crons.ts
// Background cron jobs for the Outcome Intelligence Engine.
// Registered at startup via startOutcomeCrons(); safe to call multiple times (idempotent).

import { createLogger } from './logger.js';
import { isFeatureEnabled } from './feature-flags.js';

const log = createLogger('outcome-crons');

const DAILY_MS = 24 * 60 * 60 * 1000;
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

let measureInterval: ReturnType<typeof setInterval> | null = null;
let learningsInterval: ReturnType<typeof setInterval> | null = null;
let detectionInterval: ReturnType<typeof setInterval> | null = null;
let archiveInterval: ReturnType<typeof setInterval> | null = null;

export function startOutcomeCrons() {
  if (!isFeatureEnabled('outcome-tracking')) {
    log.info('Outcome tracking disabled — skipping cron registration');
    return;
  }
  if (measureInterval) return; // already started

  // Measure pending outcomes daily
  measureInterval = setInterval(async () => {
    try {
      const { measurePendingOutcomes } = await import('./outcome-measurement.js');
      await measurePendingOutcomes();
    } catch (err) {
      log.error({ err }, 'Failed to measure pending outcomes');
    }
  }, DAILY_MS);

  // Recompute workspace learnings daily
  learningsInterval = setInterval(async () => {
    try {
      const { recomputeAllWorkspaceLearnings } = await import('./workspace-learnings.js');
      await recomputeAllWorkspaceLearnings();
    } catch (err) {
      log.error({ err }, 'Failed to compute workspace learnings');
    }
  }, DAILY_MS);

  // Detect external executions every 12 hours
  detectionInterval = setInterval(async () => {
    try {
      const { detectExternalExecutions } = await import('./external-detection.js');
      await detectExternalExecutions();
    } catch (err) {
      log.error({ err }, 'Failed to detect external executions');
    }
  }, TWELVE_HOURS_MS);

  // Archive old actions daily
  archiveInterval = setInterval(() => {
    import('./outcome-tracking.js').then(m => m.archiveOldActions()).catch(err => {
      log.error({ err }, 'Failed to archive old actions');
    });
  }, DAILY_MS);

  log.info('Outcome crons started');
}

export function stopOutcomeCrons() {
  if (measureInterval) clearInterval(measureInterval);
  if (learningsInterval) clearInterval(learningsInterval);
  if (detectionInterval) clearInterval(detectionInterval);
  if (archiveInterval) clearInterval(archiveInterval);
  measureInterval = null;
  learningsInterval = null;
  detectionInterval = null;
  archiveInterval = null;
  log.info('Outcome crons stopped');
}
