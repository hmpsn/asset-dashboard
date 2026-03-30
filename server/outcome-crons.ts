// server/outcome-crons.ts
// Background cron jobs for the Outcome Intelligence Engine.
// Registered at startup via startOutcomeCrons(); safe to call multiple times (idempotent).

import { createLogger } from './logger.js';
import { isFeatureEnabled } from './feature-flags.js';

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
      const { measurePendingOutcomes } = await import('./outcome-measurement.js');
      await measurePendingOutcomes();
    } catch (err) {
      log.error({ err }, 'Failed to measure pending outcomes');
    }
  };

  const runLearnings = async () => {
    try {
      const { recomputeAllWorkspaceLearnings } = await import('./workspace-learnings.js');
      await recomputeAllWorkspaceLearnings();
    } catch (err) {
      log.error({ err }, 'Failed to compute workspace learnings');
    }
  };

  const runDetection = async () => {
    try {
      const { detectExternalExecutions } = await import('./external-detection.js');
      await detectExternalExecutions();
    } catch (err) {
      log.error({ err }, 'Failed to detect external executions');
    }
  };

  const runPlaybooks = async () => {
    try {
      const { detectAllWorkspacePlaybooks } = await import('./outcome-playbooks.js');
      await detectAllWorkspacePlaybooks();
    } catch (err) {
      log.error({ err }, 'Failed to detect playbook patterns');
    }
  };

  const runArchive = () => {
    import('./outcome-tracking.js').then(m => m.archiveOldActions()).catch(err => {
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
