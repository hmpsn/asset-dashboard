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
import type * as ActivityLog from './activity-log.js';

const log = createLogger('outcome-crons');

const DAILY_MS = 24 * 60 * 60 * 1000;
const WEEKLY_MS = 7 * DAILY_MS;

const ACTION_BACKLOG_THRESHOLD = 20;
const ACTION_AGE_THRESHOLD_DAYS = 14;

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

      // Build workspace priority map from cached intelligence: lowest compositeHealthScore = highest priority.
      // Uses read-only cache peek — does NOT invoke the intelligence assembler to avoid circular dependency risk.
      let workspacePriority: Map<string, number> | undefined;
      try {
        const { getPendingActions }: typeof OutcomeTracking = await import('./outcome-tracking.js'); // dynamic-import-ok
        const pending = getPendingActions();
        const wsIds = [...new Set(pending.map(a => a.workspaceId))];
        if (wsIds.length > 1) {
          const { getWorkspaceHealthScore } = await import('./workspace-intelligence.js'); // dynamic-import-ok
          workspacePriority = new Map<string, number>();
          for (const wsId of wsIds) {
            const score = getWorkspaceHealthScore(wsId);
            if (score != null) workspacePriority.set(wsId, score);
          }
          if (workspacePriority.size === 0) workspacePriority = undefined;
        }
      } catch (prioErr) {
        log.debug({ err: prioErr }, 'Failed to build workspace priority map — proceeding without prioritization');
      }

      const { workspaceIds } = await measurePendingOutcomes(undefined, workspacePriority);

      // Invalidate cache for every workspace that had pending measurements.
      // workspaceIds comes from the same getPendingActions() call that drives
      // measurement, so it's always in sync — no separate pre-read that can fail.
      for (const wsId of workspaceIds) {
        invalidateIntelligenceCache(wsId);
      }
      if (workspaceIds.length > 0) {
        log.info({ count: workspaceIds.length }, 'Invalidated intelligence cache for measured workspaces');
      }

      // Check action backlog thresholds per workspace.
      // Alert when pending count exceeds ACTION_BACKLOG_THRESHOLD or the oldest
      // pending item is older than ACTION_AGE_THRESHOLD_DAYS days.
      // Groups the already-fetched getPendingActions() data by workspaceId to avoid
      // redundant per-workspace DB queries (getWorkspaceCounts + getActionsByWorkspace).
      try {
        const { getPendingActions }: typeof OutcomeTracking = await import('./outcome-tracking.js'); // dynamic-import-ok
        const { addActivity, countActivityByType }: typeof ActivityLog = await import('./activity-log.js'); // dynamic-import-ok
        const allPending = getPendingActions();
        const nowMs = Date.now();
        const ageThresholdMs = ACTION_AGE_THRESHOLD_DAYS * DAILY_MS;

        // Group pending actions by workspaceId — single pass, no per-workspace DB queries.
        const pendingByWs = new Map<string, (typeof allPending)[number][]>();
        for (const action of allPending) {
          const group = pendingByWs.get(action.workspaceId) ?? [];
          group.push(action);
          pendingByWs.set(action.workspaceId, group);
        }

        for (const [wsId, wsPending] of pendingByWs) {
          const pendingActions = wsPending.filter(a => !a.measurementComplete);
          const pendingCount = pendingActions.length;
          if (pendingCount === 0) continue;

          // Find the age of the oldest pending action
          const oldestMs = pendingActions.reduce((min, a) => {
            const t = new Date(a.createdAt).getTime();
            return t < min ? t : min;
          }, Infinity);
          const oldestAgeDays = isFinite(oldestMs) ? Math.floor((nowMs - oldestMs) / DAILY_MS) : 0;

          const countBreached = pendingCount >= ACTION_BACKLOG_THRESHOLD;
          const ageBreached = isFinite(oldestMs) && (nowMs - oldestMs) >= ageThresholdMs;

          if (countBreached || ageBreached) {
            log.warn(
              { workspaceId: wsId, pendingCount, oldestAgeDays, countBreached, ageBreached },
              'Action backlog threshold exceeded',
            );
            // Deduplicate: only fire the alert if no alert was sent in the last 7 days.
            const recentAlerts = countActivityByType(wsId, 'action_backlog_alert', 7);
            if (recentAlerts === 0) {
              addActivity(
                wsId,
                'action_backlog_alert',
                'Action backlog threshold exceeded',
                `${pendingCount} pending action(s); oldest is ${oldestAgeDays} day(s) old.`,
                { pendingCount, oldestAgeDays, countBreached, ageBreached },
              );
            }
          }
        }
      } catch (alertErr) {
        log.warn({ err: alertErr }, 'Failed to check action backlog thresholds');
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
