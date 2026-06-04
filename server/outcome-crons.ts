// server/outcome-crons.ts
// Background cron jobs for the Outcome Intelligence Engine.
// Registered at startup via startOutcomeCrons(); safe to call multiple times (idempotent).

import { createLogger } from './logger.js';
import { invalidateIntelligenceCache } from './workspace-intelligence.js';
import { queueKeywordStrategyPostUpdateFollowOns } from './keyword-strategy-follow-ons.js';
import { runBackfill } from './outcome-backfill.js';
import type * as OutcomeMeasurement from './outcome-measurement.js';
import type * as WorkspaceLearnings from './workspace-learnings.js';
import type * as ExternalDetection from './external-detection.js';
import type * as OutcomePlaybooks from './outcome-playbooks.js';
import type * as OutcomeTracking from './outcome-tracking.js';
import type * as ActivityLog from './activity-log.js';
import type * as OpportunityDetectors from './scoring/opportunity-detectors.js';

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
let backfillInterval: ReturnType<typeof setInterval> | null = null;
let decayScanInterval: ReturnType<typeof setInterval> | null = null;
let rankDeclineScanInterval: ReturnType<typeof setInterval> | null = null;

// Startup timeout handles — stored so stopOutcomeCrons() can cancel them
// if shutdown is called within the first 35s of startup.
let startupTimeouts: ReturnType<typeof setTimeout>[] = [];

export function startOutcomeCrons() {
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

      // Enqueue a recommendation regen for each measured workspace so ranking
      // reflects the new outcomes. NOTE: recsInFlight only dedupes concurrent
      // regens for the SAME workspace — this loop still issues one regen per
      // distinct measured workspace, bounded by the number measured this run
      // (a handful at current scale, acceptable). If the client count grows
      // materially, add cross-workspace concurrency limiting/staggering here.
      for (const wsId of workspaceIds) {
        queueKeywordStrategyPostUpdateFollowOns({ workspaceId: wsId });
      }

      // Check action backlog thresholds per workspace.
      // Alert when pending count exceeds ACTION_BACKLOG_THRESHOLD or the oldest
      // pending item is older than ACTION_AGE_THRESHOLD_DAYS days.
      // Makes a fresh getPendingActions() call and groups by workspaceId to check thresholds
      // without redundant per-workspace DB queries (getWorkspaceCounts + getActionsByWorkspace).
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
          const pendingCount = wsPending.length;
          if (pendingCount === 0) continue;

          // Find the age of the oldest pending action
          const oldestMs = wsPending.reduce((min, a) => {
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

      // Enqueue a recommendation regen after the learnings update. As above,
      // recsInFlight dedupes only per-workspace; this issues one regen per
      // distinct affected workspace (bounded by the run, acceptable at current
      // scale — revisit with concurrency limiting if client count grows).
      for (const wsId of affectedWsIds) {
        queueKeywordStrategyPostUpdateFollowOns({ workspaceId: wsId });
      }
    } catch (err) {
      log.error({ err }, 'Failed to compute workspace learnings');
    }
  };

  const runDetection = async () => {
    try {
      const { detectExternalExecutions }: typeof ExternalDetection = await import('./external-detection.js'); // dynamic-import-ok
      await detectExternalExecutions();
    } catch (err) {
      log.error({ err }, 'Failed to detect external executions');
    }
  };

  const runPlaybooks = async () => {
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

  // Backfill sets only a MINIMAL baseline (not GSC) — it is a recovery net for
  // missed recordAction calls on existing content/insights/recommendations, NOT a
  // substitute for the live publish-path recordAction that fires at content publish
  // time and captures real GSC baseline data. Run weekly so any newly published
  // posts that slipped through the live path get caught quickly.
  const runBackfillJob = () => {
    try {
      const result = runBackfill();
      log.info({ backfilledCount: result.backfilledCount, errors: result.errors }, 'Outcome backfill cron complete');
    } catch (err) {
      log.error({ err }, 'Outcome backfill cron failed');
    }
  };

  // ── PR7 · Spine B — decay → opportunity-event detector (24h). ──
  // Thin cron wrapper around runDecayDetector (see opportunity-detectors.ts): reads
  // the PERSISTED decay analysis (no crawl), emits DECAYING `decay` events for
  // critical / repeat-decay pages, and enqueues a debounced regen. ENTIRELY gated by
  // the default-on detector path — an empty event ledger remains a natural no-op.
  // Loaded via dynamic import so the cron module doesn't pull the detector's
  // transitive deps at startup.
  const runDecayScan = async () => {
    try {
      const { runDecayDetector }: typeof OpportunityDetectors = await import('./scoring/opportunity-detectors.js'); // dynamic-import-ok
      runDecayDetector();
    } catch (err) {
      log.error({ err }, 'Decay opportunity-event scan failed');
    }
  };

  // ── PR7 · Spine B — rank-decline → opportunity-event detector (24h). ──
  // Thin cron wrapper around runRankDeclineDetector: a LIGHT check over the
  // already-persisted rank snapshots (no crawl) that emits DECAYING `rank_drop`
  // events for tracked keywords that crossed the decline threshold, then enqueues a
  // debounced regen. Flag-gated inside the detector — flag OFF is a no-op.
  const runRankDeclineScan = async () => {
    try {
      const { runRankDeclineDetector }: typeof OpportunityDetectors = await import('./scoring/opportunity-detectors.js'); // dynamic-import-ok
      runRankDeclineDetector();
    } catch (err) {
      log.error({ err }, 'Rank-decline opportunity-event scan failed');
    }
  };

  // Run each job once after a short startup delay, then on their normal interval.
  // Store handles so stopOutcomeCrons() can cancel them during early shutdown.
  startupTimeouts = [
    setTimeout(() => void runMeasure(), 15_000),
    setTimeout(() => void runLearnings(), 20_000),
    setTimeout(() => void runDetection(), 25_000),
    setTimeout(() => void runPlaybooks(), 30_000),
    setTimeout(runArchive, 35_000),
    setTimeout(runBackfillJob, 40_000),
    setTimeout(() => void runDecayScan(), 45_000),
    setTimeout(() => void runRankDeclineScan(), 50_000),
  ];

  measureInterval = setInterval(() => void runMeasure(), DAILY_MS);
  learningsInterval = setInterval(() => void runLearnings(), DAILY_MS);
  detectionInterval = setInterval(() => void runDetection(), WEEKLY_MS);
  archiveInterval = setInterval(runArchive, DAILY_MS);
  backfillInterval = setInterval(runBackfillJob, WEEKLY_MS);
  decayScanInterval = setInterval(() => void runDecayScan(), DAILY_MS);
  rankDeclineScanInterval = setInterval(() => void runRankDeclineScan(), DAILY_MS);

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
  if (backfillInterval) clearInterval(backfillInterval);
  if (decayScanInterval) clearInterval(decayScanInterval);
  if (rankDeclineScanInterval) clearInterval(rankDeclineScanInterval);
  measureInterval = null;
  learningsInterval = null;
  detectionInterval = null;
  archiveInterval = null;
  playbooksInterval = null;
  backfillInterval = null;
  decayScanInterval = null;
  rankDeclineScanInterval = null;
  log.info('Outcome crons stopped');
}
