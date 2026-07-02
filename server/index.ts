import 'dotenv/config';
import { initSentry } from './sentry.js';
import { createServer } from 'http';
import path from 'path';
import fs from 'fs';
import { WebSocket } from 'ws';
import { runMigrations } from './db/index.js';
import db from './db/index.js';
import { createApp } from './app.js';
import { initWebSocket } from './websocket.js';
import { startSchedulers } from './startup.js';
import { stopDataRetentionCrons } from './data-retention.js';
import { stopIntelligenceCrons, stopCompetitorMonitoringCron } from './intelligence-crons.js';
import { stopInsightRecomputeCron } from './insight-recompute-cron.js';
import { stopScheduler } from './scheduled-audits.js';
import { stopApprovalReminders } from './approval-reminders.js';
import { stopTrialReminders } from './trial-reminders.js';
import { stopChurnSignalScheduler } from './churn-signals.js';
import { stopAnomalyDetection } from './anomaly-detection.js';
import { stopOutcomeCrons } from './outcome-crons.js';
import { stopRankTrackingScheduler } from './rank-tracking-scheduler.js';
import { stopMonthlyReports } from './monthly-report.js';
import { stopBriefingCron } from './briefing-cron.js';
import { stopThrottleCleanup } from './email-throttle.js';
import { listWorkspaces } from './workspaces.js';
import { isStripeConfigured } from './stripe.js';
import { DATA_BASE } from './data-dir.js';
import { createLogger } from './logger.js';
import { flushToDisk as flushOpenAIUsage } from './openai-helpers.js';
import { flushAll as flushEmailQueue } from './email-queue.js';
import { listJobs, markRunningJobsInterrupted } from './jobs.js';
import { setShuttingDown } from './routes/health.js';

const log = createLogger('startup');

const DATA_ROOT = DATA_BASE || path.join(process.env.HOME || '', '.asset-dashboard');
const IS_PROD = process.env.NODE_ENV === 'production';

// Initialize Sentry early so it can capture errors from migrations onward
initSentry();

// Run pending SQLite migrations before anything touches the database
runMigrations();

// Migrate pageMap data from workspace JSON blobs into the page_keywords table (idempotent)
import { migrateFromJsonBlob } from './page-keywords.js';
migrateFromJsonBlob();

// Migrate keywordStrategy.contentGaps from workspace JSON blobs into the content_gaps table (idempotent)
import { migrateFromJsonBlob as migrateContentGapsFromJsonBlob } from './content-gaps.js';
migrateContentGapsFromJsonBlob();

// Migrate keywordStrategy.quickWins from workspace JSON blobs into the quick_wins table (idempotent)
import { migrateFromJsonBlob as migrateQuickWinsFromJsonBlob } from './quick-wins.js';
migrateQuickWinsFromJsonBlob();

// Migrate keywordStrategy.keywordGaps from workspace JSON blobs into the keyword_gaps table (idempotent)
import { migrateFromJsonBlob as migrateKeywordGapsFromJsonBlob } from './keyword-gaps.js';
migrateKeywordGapsFromJsonBlob();

// Migrate keywordStrategy.topicClusters from workspace JSON blobs into the topic_clusters table (idempotent)
import { migrateFromJsonBlob as migrateTopicClustersFromJsonBlob } from './topic-clusters.js';
migrateTopicClustersFromJsonBlob();

// Migrate keywordStrategy.cannibalization from workspace JSON blobs into the
// cannibalization_issues table (idempotent)
import { migrateFromJsonBlob as migrateCannibalizationFromJsonBlob } from './cannibalization-issues.js';
migrateCannibalizationFromJsonBlob();

// Backfill keywordStrategy.siteKeywordMetrics from workspace JSON blobs into the
// site_keyword_metrics table (idempotent, CAS-guarded). Wave 3b-ii has LANDED: the
// blob strip is done — the table is now the sole store and every write path forces
// keywordStrategy.siteKeywordMetrics undefined. This startup backfill therefore only
// protects LEGACY workspaces whose blob predates the strip and has not yet been
// re-persisted (a re-persist clears the blob array and seeds the table); once every
// workspace has regenerated, this backfill is a no-op and can be retired.
import { migrateSiteKeywordMetricsFromBlob } from './site-keyword-metrics.js';
migrateSiteKeywordMetricsFromBlob();

// Backfill legacy rank_tracking_config.tracked_keywords blobs into the
// tracked_keywords row table (idempotent, CAS-guarded). The row table is now the
// read authority; this protects old environments whose table was never populated.
// The source stamper recovers provenance for legacy UNKNOWN-source rows once via
// the canonical inference ladder. Import the leaf provenance helper directly so
// startup does not load the full KCC facade.
import { migrateTrackedKeywordsFromConfigBlob } from './tracked-keywords-store.js';
import { inferTrackedKeywordSourcesForWorkspace } from './domains/keyword-command-center/tracked-keyword-provenance.js';
migrateTrackedKeywordsFromConfigBlob(inferTrackedKeywordSourcesForWorkspace);

// Backfill legacy recommendation_sets.recommendations blobs into the normalized
// recommendation_items row table (Reconcile R7-PR1, ADDITIVE). Idempotent + mixed-prod-safe:
// any workspace whose recommendation_items already has rows is skipped (count>0 guard) and
// its blob is never re-read, so post-158 regens are never clobbered. Malformed recs are
// dropped-with-reason (never silently), and a per-workspace transaction failure never aborts
// the sweep. Readers are unaffected — the items-win fallback still serves blob data for any
// workspace that fails backfill. MUST run BEFORE runOutcomeRemediation so remediation sees
// materialized rows. Retire once the blob column is dropped in a later Reconcile PR.
import { materializeAllRecommendationItems } from './domains/recommendations/storage.js';
const recBackfill = materializeAllRecommendationItems();
log.info(
  {
    workspaces: recBackfill.workspaces,
    blobRecs: recBackfill.blobRecs,
    rowsWritten: recBackfill.rowsWritten,
    dropped: recBackfill.dropped.length,
  },
  'Recommendation blob → rows backfill sweep complete',
);
if (recBackfill.dropped.length > 0) {
  log.warn(
    { dropped: recBackfill.dropped },
    'Recommendation backfill dropped one or more recs — investigate reasons',
  );
}

// One-time historical outcome-pollution remediation (A1 audit #1): relabel
// recommendation-sourced actions the pre-A1 backfill hardcoded to audit_fix_applied,
// and re-mark phantom-metric neutral/loss outcomes as inconclusive. Idempotent by
// construction — a second run is a natural no-op (relabeled/re-marked rows no longer
// match). Can be retired once every environment has run it post-A1.
import { runOutcomeRemediation } from './outcome-remediation.js';
runOutcomeRemediation();

// Create and configure the Express app (middleware + routes)
const app = createApp();

// Create the HTTP server and wire up WebSocket + broadcast
const server = createServer(app);
const wss = initWebSocket(server);

// Start all background schedulers and queues
startSchedulers();

// ── Graceful Shutdown ──

const SHUTDOWN_TIMEOUT_MS = 10_000;

let isShuttingDown = false;
function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  log.info({ signal }, 'Shutdown signal received, draining...');

  // 1. Mark health endpoint as 503 so load balancer stops routing traffic
  setShuttingDown();

  // 1a. Cancel background cron timers so they cannot fire after db.close()
  stopDataRetentionCrons();
  stopIntelligenceCrons();
  stopCompetitorMonitoringCron();
  stopInsightRecomputeCron();
  stopScheduler();
  stopApprovalReminders();
  stopTrialReminders();
  stopChurnSignalScheduler();
  stopAnomalyDetection();
  stopOutcomeCrons();
  stopRankTrackingScheduler();
  stopMonthlyReports();
  stopBriefingCron();
  stopThrottleCleanup();

  // 2. Mark any in-progress jobs as interrupted in SQLite before shutdown
  const activeJobs = listJobs().filter(j => j.status === 'pending' || j.status === 'running');
  if (activeJobs.length > 0) {
    log.warn({ count: activeJobs.length, jobs: activeJobs.map(j => ({ id: j.id, type: j.type, status: j.status })) },
      'Marking in-progress jobs as interrupted');
    try { markRunningJobsInterrupted(); } catch (err) { log.error({ err }, 'Failed to mark jobs as interrupted'); }
  }

  // 3. Close WebSocket connections gracefully (must happen before server.close()
  //    because server.close() waits for all connections including upgraded WS sockets)
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1001, 'Server shutting down');
    }
  }
  wss.close();

  // 4. Stop accepting new connections and drain existing ones
  server.close(async () => {
    log.info('HTTP server closed');

    // 5. Flush pending data to disk
    try { flushOpenAIUsage(); } catch (err) { log.error({ err }, 'Failed to flush OpenAI usage during shutdown'); }
    try { await flushEmailQueue(); } catch (err) { log.error({ err }, 'Failed to flush email queue during shutdown'); }

    // 6. Close SQLite database (flushes WAL)
    try {
      db.close();
      log.info('SQLite database closed');
    } catch (err) {
      log.error({ err }, 'Error closing SQLite database');
    }

    log.info('Graceful shutdown complete');
    process.exit(0);
  });

  // Force exit after timeout if draining takes too long
  setTimeout(() => {
    log.error('Forced shutdown after timeout');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start
const PORT = parseInt(process.env.PORT || '3001', 10);
server.listen(PORT, '0.0.0.0', () => {
  log.info(`Asset Dashboard running on http://localhost:${PORT} [${IS_PROD ? 'production' : 'development'}]`);
  // Startup diagnostics
  const workspaces = listWorkspaces();
  const hasEnvToken = !!process.env.WEBFLOW_API_TOKEN;
  log.info(`DATA_ROOT=${DATA_ROOT}`);
  log.info(`HOME=${process.env.HOME || 'unset'}`);
  log.info(`NODE_ENV=${process.env.NODE_ENV || 'unset'}`);
  log.info(`WEBFLOW_API_TOKEN env: ${hasEnvToken ? 'SET' : 'NOT SET'}`);
  log.info(`OPENAI_API_KEY env: ${process.env.OPENAI_API_KEY ? 'SET' : 'NOT SET'}`);
  log.info(`GOOGLE_PSI_KEY env: ${process.env.GOOGLE_PSI_KEY ? 'SET' : 'NOT SET'}`);
  log.info(`STRIPE: ${isStripeConfigured() ? 'CONFIGURED' : 'NOT CONFIGURED (set STRIPE_SECRET_KEY to enable payments)'}`);
  if (!process.env.JWT_SECRET) {
    log.warn('JWT_SECRET is NOT SET — using insecure hardcoded fallback. Set JWT_SECRET in environment before production launch.');
  } else {
    log.info('JWT_SECRET: SET');
  }
  log.info(`Workspaces loaded: ${workspaces.length}`);
  for (const ws of workspaces) {
    log.info(`- ${ws.name}: siteId=${ws.webflowSiteId || 'none'}, hasToken=${!!ws.webflowToken}`);
  }
  // Reports directory check
  const reportsDir = path.join(DATA_ROOT, 'reports');
  const reportsExists = fs.existsSync(reportsDir);
  const snapshotCount = reportsExists ? fs.readdirSync(reportsDir).reduce((sum, sd) => sum + fs.readdirSync(path.join(reportsDir, sd)).filter(f => f.endsWith('.json')).length, 0) : 0;
  log.info(`REPORTS_DIR=${reportsDir} exists=${reportsExists} snapshots=${snapshotCount}`);
});
