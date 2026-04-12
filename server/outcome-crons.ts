// server/outcome-crons.ts
// Background cron jobs for the Outcome Intelligence Engine.
// Registered at startup via startOutcomeCrons(); safe to call multiple times (idempotent).

import { createLogger } from './logger.js';
import { isFeatureEnabled } from './feature-flags.js';
import { invalidateIntelligenceCache } from './workspace-intelligence.js';
import type * as OutcomeMeasurement from './outcome-measurement.js';
import type * as WorkspaceLearnings from './workspace-learnings.js';
import type * as ExternalDetection from './external-detection.js';
import type * as OutcomePlaybooks from './outcome-playbooks.js';
import type * as OutcomeTracking from './outcome-tracking.js';

const log = createLogger('outcome-crons');

const DAILY_MS = 24 * 60 * 60 * 1000;
const WEEKLY_MS = 7 * DAILY_MS;

let measureInterval: ReturnType<typeof setInterval> | null = null;
let learningsInterval: ReturnType<typeof setInterval> | null = null;
let detectionInterval: ReturnType<typeof setInterval> | null = null;
let archiveInterval: ReturnType<typeof setInterval> | null = null;
let playbooksInterval: ReturnType<typeof setInterval> | null = null;

// Startup timeout handles — stored so stopOutcomeCrons() can cancel them
// if shutdown is called within the first 35s of startup.
let startupTimeouts: ReturnType<typeof setTimeout>[] = [];

export function startOutcomeCrons() {
  if (!isFeatureEnabled('outcome-tracking')) {
    log.info('Outcome tracking disabled — skipping cron registration');
    return;
  }
  if (measureInterval) return; // already started

  const runMeasure = async () => {
    try {
      const { measurePendingOutcomes }: typeof OutcomeMeasurement = await import('./outcome-measurement.js'); // dynamic-import-ok
      const { workspaceIds } = await measurePendingOutcomes();

      // Invalidate cache for every workspace that had pending measurements.
      // workspaceIds comes from the same getPendingActions() call that drives
      // measurement, so it's always in sync — no separate pre-read that can fail.
      for (const wsId of workspaceIds) {
        invalidateIntelligenceCache(wsId);
      }
      if (workspaceIds.length > 0) {
        log.info({ count: workspaceIds.length }, 'Invalidated intelligence cache for measured workspaces');
      }
    } catch (err) {
      log.error({ err }, 'Failed to measure pending outcomes');
    }
  };

  const runLearnings = async () => {
    try {
      const { recomputeAllWorkspaceLearnings, getWorkspaceIdsWithOutcomes }: typeof WorkspaceLearnings = await import('./workspace-learnings.js'); // dynamic-import-ok
      await recomputeAllWorkspaceLearnings();

      // Only invalidate workspaces that have outcome data (same set learnings processes)
      const affectedWsIds = getWorkspaceIdsWithOutcomes();
      for (const wsId of affectedWsIds) {
        invalidateIntelligenceCache(wsId);
      }
      if (affectedWsIds.length > 0) {
        log.info({ count: affectedWsIds.length }, 'Invalidated intelligence cache for learnings workspaces');
      }
    } catch (err) {
      log.error({ err }, 'Failed to compute workspace learnings');
    }
  };

  const runDetection = async () => {
    if (!isFeatureEnabled('outcome-external-detection')) return;
    try {
      const { detectExternalExecutions }: typeof ExternalDetection = await import('./external-detection.js'); // dynamic-import-ok
      await detectExternalExecutions();
    } catch (err) {
      log.error({ err }, 'Failed to detect external executions');
    }
  };

  const runPlaybooks = async () => {
    if (!isFeatureEnabled('outcome-playbooks')) return;
    try {
      const { detectAllWorkspacePlaybooks }: typeof OutcomePlaybooks = await import('./outcome-playbooks.js'); // dynamic-import-ok
      await detectAllWorkspacePlaybooks();
    } catch (err) {
      log.error({ err }, 'Failed to detect playbook patterns');
    }
  };

  const runArchive = () => {
    (import('./outcome-tracking.js') as Promise<typeof OutcomeTracking>).then(m => m.archiveOldActions()).catch(err => {
      log.error({ err }, 'Failed to archive old actions');
    });
  };

  // Run each job once after a short startup delay, then on their normal interval.
  // Store handles so stopOutcomeCrons() can cancel them during early shutdown.
  startupTimeouts = [
    setTimeout(() => void runMeasure(), 15_000),
    setTimeout(() => void runLearnings(), 20_000),
    setTimeout(() => void runDetection(), 25_000),
    setTimeout(() => void runPlaybooks(), 30_000),
    setTimeout(runArchive, 35_000),
  ];

  measureInterval = setInterval(() => void runMeasure(), DAILY_MS);
  learningsInterval = setInterval(() => void runLearnings(), DAILY_MS);
  detectionInterval = setInterval(() => void runDetection(), WEEKLY_MS);
  archiveInterval = setInterval(runArchive, DAILY_MS);

  playbooksInterval = setInterval(() => void runPlaybooks(), 7 * DAILY_MS);

  log.info('Outcome crons started');
}

export function stopOutcomeCrons() {
  for (const t of startupTimeouts) clearTimeout(t);
  startupTimeouts = [];
  if (measureInterval) clearInterval(measureInterval);
  if (learningsInterval) clearInterval(learningsInterval);
  if (detectionInterval) clearInterval(detectionInterval);
  if (archiveInterval) clearInterval(archiveInterval);
  if (playbooksInterval) clearInterval(playbooksInterval);
  measureInterval = null;
  learningsInterval = null;
  detectionInterval = null;
  archiveInterval = null;
  playbooksInterval = null;
  log.info('Outcome crons stopped');
}
