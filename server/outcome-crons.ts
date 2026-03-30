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

  // Run each job once after a short startup delay, then on their normal interval
  setTimeout(() => void runMeasure(), 15_000);
  setTimeout(() => void runLearnings(), 20_000);
  setTimeout(() => void runDetection(), 25_000);
  setTimeout(() => void runPlaybooks(), 30_000);

  measureInterval = setInterval(() => void runMeasure(), DAILY_MS);
  learningsInterval = setInterval(() => void runLearnings(), DAILY_MS);
  detectionInterval = setInterval(() => void runDetection(), TWELVE_HOURS_MS);
  archiveInterval = setInterval(runArchive, DAILY_MS);

  // Playbook pattern detection runs weekly (no separate interval var needed — piggybacks on learnings cadence)
  setInterval(() => void runPlaybooks(), 7 * DAILY_MS);

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
