// server/outcome-crons.ts
// Background cron jobs for the Outcome Intelligence Engine.
// Registered at startup via startOutcomeCrons(); safe to call multiple times (idempotent).

import { createLogger } from './logger.js';
import { invalidateIntelligenceCache } from './intelligence/cache-invalidation.js';
import { queueKeywordStrategyPostUpdateFollowOns } from './keyword-strategy-follow-ons.js';
import { runBackfill } from './outcome-backfill.js';
import type * as OutcomeMeasurement from './outcome-measurement.js';
import type * as WorkspaceLearnings from './workspace-learnings.js';
import type * as ExternalDetection from './external-detection.js';
import type * as OutcomePlaybooks from './outcome-playbooks.js';
import type * as OutcomeTracking from './outcome-tracking.js';
import type * as ActivityLog from './activity-log.js';
import type * as OpportunityDetectors from './scoring/opportunity-detectors.js';
import type * as OutcomeEmvCalibration from './outcome-emv-calibration.js';
import type * as PlatformLearningsPriors from './platform-learnings-priors.js';
import type * as RecommendationStaleness from './recommendation-staleness.js';
import type * as DeliverableDivergenceSweep from './deliverable-divergence-sweep.js';

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
let emvCalibrationInterval: ReturnType<typeof setInterval> | null = null;
let platformPriorsInterval: ReturnType<typeof setInterval> | null = null;
let stalenessScanInterval: ReturnType<typeof setInterval> | null = null;
let divergenceSweepInterval: ReturnType<typeof setInterval> | null = null;

// Startup timeout handles — stored so stopOutcomeCrons() can cancel them
// if shutdown is called during the startup warmup window (currently up to ~60s).
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
      // reflects the new outcomes. The shared scheduler serializes per workspace,
      // while this loop still issues one refresh per distinct measured workspace
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
      // the shared scheduler only serializes per workspace; this still issues
      // one refresh per distinct affected workspace (bounded by the run,
      // acceptable at current scale — revisit with concurrency limiting if
      // client count grows).
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

  // ── A5 (audit #20) — P6 realized-vs-predicted EMV calibration + effort priors. ──
  // Weekly recompute of outcome_emv_calibration from the predictedEmv snapshots +
  // realized attributed_value pairs, plus the per-actionType time-to-completion effort
  // priors. Runs AFTER the backfill startup pass (55s > 40s) so freshly snapshotted
  // backfill rows are included in the first computation. Derived data only — honest
  // `inconclusive` below the pair floor, never fabricated (FM-2).
  const runEmvCalibrationJob = async () => {
    try {
      const { runEmvCalibration }: typeof OutcomeEmvCalibration = await import('./outcome-emv-calibration.js'); // dynamic-import-ok
      const result = runEmvCalibration();
      log.info(
        {
          workspacesProcessed: result.workspacesProcessed,
          conclusiveEntries: result.conclusiveEntries,
          inconclusiveEntries: result.inconclusiveEntries,
          errors: result.errors,
        },
        'EMV calibration cron complete',
      );
    } catch (err) {
      log.error({ err }, 'EMV calibration cron failed');
    }
  };

  // A6 (audit #22): recompute the anonymized cross-workspace win-rate priors — the
  // no_data/degraded FALLBACK tier for the Outcome Learning default path. Aggregates
  // every workspace's scored outcomes per action type, publishing only above the cohort
  // + sample floors (FM-2: below either floor -> absent, never fabricated). Runs AFTER
  // EMV calibration (60s > 55s) so it sees the same settled cross-workspace dataset.
  const runPlatformPriorsJob = async () => {
    try {
      const { recomputePlatformPriors }: typeof PlatformLearningsPriors = await import('./platform-learnings-priors.js'); // dynamic-import-ok
      const result = recomputePlatformPriors();
      log.info(
        { publishedEntries: result.publishedEntries, suppressedBelowFloor: result.suppressedBelowFloor },
        'Platform learnings priors cron complete',
      );
    } catch (err) {
      log.error({ err }, 'Platform learnings priors cron failed');
    }
  };

  // ── Strategy v3 P3 — sent-rec staleness scan (24h). ──
  // Thin cron wrapper around runSentRecStalenessScan: derives stale_sent / superseded nudges
  // from the persisted rec sets (no crawl, no AI) and writes deduplicated admin-only activity.
  // Per-workspace flag-gated INSIDE the scan ('strategy-staleness-scan') — flag OFF = no-op for
  // that workspace. Loaded via dynamic import so the cron module doesn't pull recommendation
  // transitive deps at startup.
  const runStalenessScanJob = async () => {
    try {
      const { runSentRecStalenessScan }: typeof RecommendationStaleness = await import('./recommendation-staleness.js'); // dynamic-import-ok
      const result = runSentRecStalenessScan();
      log.info(
        { workspacesScanned: result.workspacesScanned, nudgesWritten: result.nudgesWritten },
        'Sent-rec staleness scan cron complete',
      );
    } catch (err) {
      log.error({ err }, 'Sent-rec staleness scan cron failed');
    }
  };

  // ── Reconcile R4-PR1 — rec↔deliverable divergence sweep (24h). ──
  // READ-ONLY: compares each sent/decided rec's clientStatus against its recommendation:<id>
  // deliverable mirror and reports the pairs that disagree. Mutates NOTHING (no repair, no
  // broadcast, no activity) — repair is the R4-PR2 trigger + backfill PR. Per-workspace flag-gated
  // INSIDE the sweep ('strategy-divergence-sweep') — flag OFF = no-op for that workspace. Dynamic
  // import so the cron module doesn't pull recommendation transitive deps at startup.
  const runDivergenceSweepJob = async () => {
    try {
      const { runDeliverableDivergenceSweep }: typeof DeliverableDivergenceSweep = await import('./deliverable-divergence-sweep.js'); // dynamic-import-ok
      const result = runDeliverableDivergenceSweep();
      log.info(
        { workspacesScanned: result.workspacesScanned, pairsChecked: result.pairsChecked, divergentPairs: result.divergentPairs.length },
        'Deliverable divergence sweep cron complete',
      );
    } catch (err) {
      log.error({ err }, 'Deliverable divergence sweep cron failed');
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
    setTimeout(() => void runEmvCalibrationJob(), 55_000),
    setTimeout(() => void runPlatformPriorsJob(), 60_000),
    setTimeout(() => void runStalenessScanJob(), 65_000),
    setTimeout(() => void runDivergenceSweepJob(), 70_000),
  ];

  measureInterval = setInterval(() => void runMeasure(), DAILY_MS);
  learningsInterval = setInterval(() => void runLearnings(), DAILY_MS);
  detectionInterval = setInterval(() => void runDetection(), WEEKLY_MS);
  archiveInterval = setInterval(runArchive, DAILY_MS);
  backfillInterval = setInterval(runBackfillJob, WEEKLY_MS);
  decayScanInterval = setInterval(() => void runDecayScan(), DAILY_MS);
  rankDeclineScanInterval = setInterval(() => void runRankDeclineScan(), DAILY_MS);
  emvCalibrationInterval = setInterval(() => void runEmvCalibrationJob(), WEEKLY_MS);
  platformPriorsInterval = setInterval(() => void runPlatformPriorsJob(), WEEKLY_MS);
  stalenessScanInterval = setInterval(() => void runStalenessScanJob(), DAILY_MS);
  divergenceSweepInterval = setInterval(() => void runDivergenceSweepJob(), DAILY_MS);

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
  if (emvCalibrationInterval) clearInterval(emvCalibrationInterval);
  if (platformPriorsInterval) clearInterval(platformPriorsInterval);
  if (stalenessScanInterval) clearInterval(stalenessScanInterval);
  if (divergenceSweepInterval) clearInterval(divergenceSweepInterval);
  measureInterval = null;
  learningsInterval = null;
  detectionInterval = null;
  archiveInterval = null;
  playbooksInterval = null;
  backfillInterval = null;
  decayScanInterval = null;
  rankDeclineScanInterval = null;
  emvCalibrationInterval = null;
  platformPriorsInterval = null;
  stalenessScanInterval = null;
  divergenceSweepInterval = null;
  log.info('Outcome crons stopped');
}
