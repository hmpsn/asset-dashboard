/**
 * server/cron-registry.ts
 *
 * Single execution-surface registry for boot-wired background schedulers
 * ("crons"). Mirrors the shape of `shared/types/background-jobs.ts`
 * (BACKGROUND_JOB_METADATA): a typed const map from a stable id to metadata
 * plus lifecycle hooks, so `server/startup.ts` and `server/index.ts`
 * (gracefulShutdown) can start/stop every cron generically instead of
 * hand-listing imports that silently drift out of sync (the R10 audit found
 * 5 boot-wired schedulers with a `stop*` export that was never wired into
 * gracefulShutdown, plus 4 module-level timers with no stop hook at all).
 *
 * LAZY CONSTRUCTION — CRITICAL:
 * This module's top-level scope MUST NOT start any timer, and MUST NOT call
 * any start()/stop() function. It only builds `CRON_METADATA`, a metadata
 * object whose `start`/`stop` fields are direct references to each cron
 * module's already-idempotent startX()/stopX() exports. Those functions are
 * only ever invoked by `startAllRegisteredCrons()` / `stopAllRegisteredCrons()`,
 * which callers (server/startup.ts, server/index.ts) invoke explicitly.
 *
 * This matters at import time, not just at call time: tests/unit/startup.test.ts
 * uses `vi.mock` to replace 15 of the 20 scheduler modules startup.ts imports
 * with no-op mocks; the other 5 (insight-recompute-cron, ga4-conversion-
 * snapshot-scheduler, webflow-form-poller, strategy-issue-cron,
 * return-hook-cron) are NOT mocked there. If constructing CRON_METADATA ever
 * called those modules' real startX() eagerly, importing this file inside
 * that test would start real timers inside vitest. Keeping construction
 * (the object literal below) side-effect-free, and gating all invocation
 * behind the exported start/stop helpers, avoids that entirely.
 *
 * Adoption scope (R10-PR1, this file): registers every boot-wired scheduler
 * subsystem and known module-level timer as metadata. It does NOT migrate
 * the 16 hand-rolled interval modules onto the shared `createIntervalCron`
 * execution primitive (server/weekly-workspace-cron.ts) — that consolidation
 * is R10-PR2. Each entry's `start`/`stop` here are thin references to the
 * EXISTING startX()/stopX() exports; no scheduler's internal construction
 * changes in this PR.
 *
 * Deferred adoption: `server/strategy-issue-cron.ts` and
 * `server/outcome-crons.ts` are registered as metadata ENTRIES below (their
 * start/stop exports are already correct — strategy-issue-cron's stop was
 * simply never wired into gracefulShutdown, which this registry fixes) but
 * their internal construction is NOT refactored here — that adoption is
 * deferred to a follow-up commit after B6 lands (measured R4×R10 file
 * collision; see docs/superpowers/plans/2026-07-01-reconcile-migration.md).
 *
 * Exemptions: three module-level timers (server/middleware.ts rate-limit
 * cleanup + login-lockout cleanup, server/ai-deduplication.ts dedup cache
 * cleanup) fire unconditionally at import time as in-process cache sweepers
 * with no existing stop/lifecycle hook of any kind — every consumer of
 * createApp() (including most integration tests) relies on them running
 * immediately. Restructuring them to be lazily start()-able is a real
 * behavior change to import-time semantics outside this ticket's "additive,
 * no data changes" scope, so they are registered with `stopHook: false` and
 * an explicit `exemptReason` instead of being force-fit into the lifecycle
 * API. The MCP TTL sweeper (server/mcp/handles.ts) is similar — its
 * `NODE_ENV=test` guard exists specifically so an always-on timer doesn't
 * break test teardown — but it already skips itself under test, so it is
 * registered the same way: metadata-only, `stopHook: false`, documented
 * exemption.
 */

import { startThrottleCleanup, stopThrottleCleanup } from './email-throttle.js';
import { startScheduler, stopScheduler } from './scheduled-audits.js';
import { startApprovalReminders, stopApprovalReminders } from './approval-reminders.js';
import { startMonthlyReports, stopMonthlyReports } from './monthly-report.js';
import { startBackupScheduler, stopBackupScheduler } from './backup.js';
import { startTrialReminders, stopTrialReminders } from './trial-reminders.js';
import { startChurnSignalScheduler, stopChurnSignalScheduler } from './churn-signals.js';
import { startAnomalyDetection, stopAnomalyDetection } from './anomaly-detection.js';
import { startOutcomeCrons, stopOutcomeCrons } from './outcome-crons.js';
import { startDataRetentionCrons, stopDataRetentionCrons } from './data-retention.js';
import {
  startIntelligenceCrons,
  stopIntelligenceCrons,
  startCompetitorMonitoringCron,
  stopCompetitorMonitoringCron,
} from './intelligence-crons.js';
import { startInsightRecomputeCron, stopInsightRecomputeCron } from './insight-recompute-cron.js';
import { startRankTrackingScheduler, stopRankTrackingScheduler } from './rank-tracking-scheduler.js';
import {
  startGa4ConversionSnapshotScheduler,
  stopGa4ConversionSnapshotScheduler,
} from './ga4-conversion-snapshot-scheduler.js';
import { startWebflowFormPoller, stopWebflowFormPoller } from './webflow-form-poller.js';
import { startBriefingCron, stopBriefingCron } from './briefing-cron.js';
import { startStrategyIssueCron, stopStrategyIssueCron } from './strategy-issue-cron.js';
import { startReturnHookCron, stopReturnHookCron } from './return-hook-cron.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Stable identifiers for every registered cron. Extend this union (and
 * CRON_METADATA below) when a new boot-wired scheduler is added — the
 * tests/contract/cron-registry-census.test.ts anti-drift guard fails the
 * build if a startup.ts import or known module-level timer has no entry. */
export type CronId =
  | 'email-throttle-cleanup'
  | 'scheduled-audits'
  | 'approval-reminders'
  | 'monthly-reports'
  | 'backup'
  | 'trial-reminders'
  | 'churn-signals'
  | 'anomaly-detection'
  | 'outcome-crons'
  | 'data-retention'
  | 'intelligence-cache-refresh'
  | 'competitor-monitoring'
  | 'insight-recompute'
  | 'rank-tracking'
  | 'ga4-conversion-snapshot'
  | 'webflow-form-poller'
  | 'briefing-cron'
  | 'strategy-issue-cron'
  | 'return-hook-cron'
  | 'mcp-handle-ttl-sweeper'
  | 'middleware-rate-limit-cleanup'
  | 'middleware-login-lockout-cleanup'
  | 'ai-deduplication-cache-cleanup';

export interface CronMetadataEntry {
  /** Human-readable label for logs / future ops surfacing. */
  label: string;
  /** Server module path (relative to repo root, `.js` specifier form) that owns this cron. */
  module: string;
  /** Recurring tick interval in milliseconds. */
  intervalMs: number;
  /** What this cron does and why it exists. */
  description: string;
  /** True if this cron has a registered start()/stop() lifecycle wired through
   * this registry (and therefore through gracefulShutdown). False means the
   * timer fires as an unconditional module-level side effect with no
   * lifecycle hook — see `exemptReason`. */
  stopHook: boolean;
  /** Idempotent start function. For stopHook:false entries this is a no-op
   * (the timer already started at module import time). */
  start: () => void;
  /** Idempotent stop function. For stopHook:false entries this is a no-op —
   * stopAllRegisteredCrons() intentionally skips calling it (see
   * stopAllRegisteredCrons below) so this exists only to satisfy the shape. */
  stop: () => void;
  /** Required when stopHook is false: why this timer is exempt from the
   * registry lifecycle instead of being force-fit into start()/stop(). */
  exemptReason?: string;
}

const noop = () => {};

export const CRON_METADATA: Record<CronId, CronMetadataEntry> = {
  'email-throttle-cleanup': {
    label: 'Email Throttle Cleanup',
    module: 'server/email-throttle.js',
    intervalMs: DAY_MS,
    description: 'Daily cleanup of expired email_sends throttle rows.',
    stopHook: true,
    start: startThrottleCleanup,
    stop: stopThrottleCleanup,
  },
  'scheduled-audits': {
    label: 'Scheduled Audits',
    module: 'server/scheduled-audits.js',
    intervalMs: HOUR_MS,
    description: 'Hourly tick that runs due DB-configured audit_schedules via runSeoAudit.',
    stopHook: true,
    start: startScheduler,
    stop: stopScheduler,
  },
  'approval-reminders': {
    label: 'Approval Reminders',
    module: 'server/approval-reminders.js',
    intervalMs: 12 * HOUR_MS,
    description: 'Sends reminder emails for approval batches awaiting client action.',
    stopHook: true,
    start: startApprovalReminders,
    stop: stopApprovalReminders,
  },
  'monthly-reports': {
    label: 'Monthly Reports',
    module: 'server/monthly-report.js',
    intervalMs: 6 * HOUR_MS,
    description: 'Checks for and triggers due monthly client reports.',
    stopHook: true,
    start: startMonthlyReports,
    stop: stopMonthlyReports,
  },
  backup: {
    label: 'Database + Uploads Backup',
    module: 'server/backup.js',
    intervalMs: DAY_MS,
    description: 'Daily local (+ optional S3) backup of dashboard.db and uploads, then prunes old backups.',
    stopHook: true,
    start: startBackupScheduler,
    stop: stopBackupScheduler,
  },
  'trial-reminders': {
    label: 'Trial Reminders',
    module: 'server/trial-reminders.js',
    intervalMs: 6 * HOUR_MS,
    description: 'Sends reminder emails for workspaces nearing trial expiry.',
    stopHook: true,
    start: startTrialReminders,
    stop: stopTrialReminders,
  },
  'churn-signals': {
    label: 'Churn Signal Detection',
    module: 'server/churn-signals.js',
    intervalMs: 6 * HOUR_MS,
    description: 'Scans workspaces for churn risk signals.',
    stopHook: true,
    start: startChurnSignalScheduler,
    stop: stopChurnSignalScheduler,
  },
  'anomaly-detection': {
    label: 'Anomaly Detection',
    module: 'server/anomaly-detection.js',
    intervalMs: 12 * HOUR_MS,
    description: 'Scans analytics for anomalies (min 6h between scans).',
    stopHook: true,
    start: startAnomalyDetection,
    stop: stopAnomalyDetection,
  },
  'outcome-crons': {
    label: 'Outcome Intelligence Engine Crons',
    module: 'server/outcome-crons.js',
    intervalMs: DAY_MS,
    description:
      'Owns 12 staggered intervals (measure/learnings/archive/decayScan/rankDeclineScan/stalenessScan/divergenceSweep daily; ' +
      'detection/backfill/emvCalibration/platformPriors weekly; playbooks 7d) under one start/stop pair. ' +
      'Registered as a single entry — internal construction is unchanged in this PR; adoption of the shared ' +
      'execution surface is deferred to a follow-up commit (measured R4×R10 lane collision).',
    stopHook: true,
    start: startOutcomeCrons,
    stop: stopOutcomeCrons,
  },
  'data-retention': {
    label: 'Data Retention',
    module: 'server/data-retention.js',
    intervalMs: DAY_MS,
    description: 'Daily enforcement of data retention policies.',
    stopHook: true,
    start: startDataRetentionCrons,
    stop: stopDataRetentionCrons,
  },
  'intelligence-cache-refresh': {
    label: 'Intelligence Cache Refresh',
    module: 'server/intelligence-crons.js',
    intervalMs: 6 * HOUR_MS,
    description: 'Warms the in-memory workspace intelligence LRU cache every 6h.',
    stopHook: true,
    start: startIntelligenceCrons,
    stop: stopIntelligenceCrons,
  },
  'competitor-monitoring': {
    label: 'Competitor Monitoring',
    module: 'server/intelligence-crons.js',
    intervalMs: DAY_MS,
    description: 'Daily competitor visibility check.',
    stopHook: true,
    start: startCompetitorMonitoringCron,
    stop: stopCompetitorMonitoringCron,
  },
  'insight-recompute': {
    label: 'Insight Recompute',
    module: 'server/insight-recompute-cron.js',
    intervalMs: DAY_MS,
    description:
      'Daily activity-gated insight recompute (signal-auto-recompute flag-gated). ' +
      'The only cron that enqueues real background jobs.',
    stopHook: true,
    start: startInsightRecomputeCron,
    stop: stopInsightRecomputeCron,
  },
  'rank-tracking': {
    label: 'Rank Tracking',
    module: 'server/rank-tracking-scheduler.js',
    intervalMs: DAY_MS,
    description: 'Daily keyword rank tracking refresh.',
    stopHook: true,
    start: startRankTrackingScheduler,
    stop: stopRankTrackingScheduler,
  },
  'ga4-conversion-snapshot': {
    label: 'GA4 Conversion Snapshot',
    module: 'server/ga4-conversion-snapshot-scheduler.js',
    intervalMs: DAY_MS,
    description: 'Daily GA4 conversion snapshot capture.',
    stopHook: true,
    start: startGa4ConversionSnapshotScheduler,
    stop: stopGa4ConversionSnapshotScheduler,
  },
  'webflow-form-poller': {
    label: 'Webflow Form Poller',
    module: 'server/webflow-form-poller.js',
    intervalMs: DAY_MS,
    description: 'Daily poll for new Webflow form submissions.',
    stopHook: true,
    start: startWebflowFormPoller,
    stop: stopWebflowFormPoller,
  },
  'briefing-cron': {
    label: 'Client Briefing Cron',
    module: 'server/briefing-cron.js',
    intervalMs: HOUR_MS,
    description: 'Hourly tick that generates the weekly client briefing (target Monday 14:00 UTC).',
    stopHook: true,
    start: startBriefingCron,
    stop: stopBriefingCron,
  },
  'strategy-issue-cron': {
    label: 'Strategy Issue Push Cron',
    module: 'server/strategy-issue-cron.js',
    intervalMs: HOUR_MS,
    description:
      'Hourly tick that publishes the weekly Strategy Issue + trust-ladder autosend. ' +
      'Registered here (fixes the stop-hook gap: stopStrategyIssueCron existed but was never wired ' +
      'into gracefulShutdown) — internal construction unchanged; execution-surface adoption deferred.',
    stopHook: true,
    start: startStrategyIssueCron,
    stop: stopStrategyIssueCron,
  },
  'return-hook-cron': {
    label: 'Return Hook Cron',
    module: 'server/return-hook-cron.js',
    intervalMs: HOUR_MS,
    description: 'Hourly tick that sends return-hook emails.',
    stopHook: true,
    start: startReturnHookCron,
    stop: stopReturnHookCron,
  },

  // ── Module-level timers outside startSchedulers() ────────────────────────
  // These fire unconditionally at import time as in-process cache sweepers.
  // They predate this registry and have no existing lifecycle hook; see the
  // file header for why they are documented exemptions rather than force-fit
  // into start()/stop(). stopAllRegisteredCrons() skips these (stopHook:false).
  'mcp-handle-ttl-sweeper': {
    label: 'MCP Handle TTL Sweeper',
    module: 'server/mcp/handles.js',
    intervalMs: 5 * 60 * 1000,
    description: 'Deletes expired MCP content-authoring handles every 5 minutes.',
    stopHook: false,
    start: noop,
    stop: noop,
    exemptReason:
      'Module-level setInterval, unref\'d, already self-guarded under NODE_ENV=test (an always-on timer ' +
      'breaks test teardown). No existing stop export. Bringing it under start()/stop() lifecycle would ' +
      'require restructuring the sweeper\'s always-on-at-import posture, which is out of scope for an ' +
      'additive, no-behavior-change registry PR.',
  },
  'middleware-rate-limit-cleanup': {
    label: 'Rate Limit Bucket Cleanup',
    module: 'server/middleware.js',
    intervalMs: 5 * 60 * 1000,
    description: 'Deletes stale rate-limit bucket entries every 5 minutes.',
    stopHook: false,
    start: noop,
    stop: noop,
    exemptReason:
      'Module-level setInterval that fires unconditionally on import of server/middleware.ts (every ' +
      'createApp() consumer, including most integration tests, relies on it running immediately). Not ' +
      'unref\'d, no existing stop export. Security-relevant in-process cache sweeper; restructuring its ' +
      'import-time start semantics is out of scope for this additive registry PR.',
  },
  'middleware-login-lockout-cleanup': {
    label: 'Login Lockout Cleanup',
    module: 'server/middleware.js',
    intervalMs: 10 * 60 * 1000,
    description: 'Clears expired login-failure lockout tracking every 10 minutes.',
    stopHook: false,
    start: noop,
    stop: noop,
    exemptReason:
      'Same posture as middleware-rate-limit-cleanup: module-level setInterval firing unconditionally on ' +
      'import, not unref\'d, no existing stop export, security-relevant (login lockout state). Excluded from ' +
      'this additive registry PR\'s lifecycle for the same reason.',
  },
  'ai-deduplication-cache-cleanup': {
    label: 'AI Request Dedup Cache Cleanup',
    module: 'server/ai-deduplication.js',
    intervalMs: 60 * 1000,
    description: 'Clears expired AI request-deduplication cache entries every 60 seconds.',
    stopHook: false,
    start: noop,
    stop: noop,
    exemptReason:
      'Module-level setInterval firing unconditionally on import of server/ai-deduplication.ts, not unref\'d, ' +
      'no existing stop export. Same register-or-exempt decision as the middleware.ts sweepers — deferred ' +
      'restructuring, not silently dropped (this entry is what makes the gap visible and enforced by the ' +
      'census contract test).',
  },
};

/** Idempotent — invokes start() on every registered cron. Each underlying
 * startX() is itself idempotent (guards on its own internal timer handle),
 * so calling this more than once is safe. Entries with stopHook:false use a
 * no-op start() since their timer already began at module import time. */
export function startAllRegisteredCrons(): void {
  for (const entry of Object.values(CRON_METADATA)) {
    entry.start();
  }
}

/** Stops every registered cron that has a real lifecycle hook (stopHook:true).
 * Entries with stopHook:false are intentionally skipped — see each entry's
 * `exemptReason`; there is nothing to stop through this registry for them. */
export function stopAllRegisteredCrons(): void {
  for (const entry of Object.values(CRON_METADATA)) {
    if (!entry.stopHook) continue;
    entry.stop();
  }
}
