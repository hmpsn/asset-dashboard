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
import { listWorkspaces } from './workspaces.js';
import { isStripeConfigured } from './stripe.js';
import { DATA_BASE } from './data-dir.js';
import { createLogger } from './logger.js';
import { flushToDisk as flushOpenAIUsage } from './openai-helpers.js';
import { flushCreditsToDisk as flushSemrushCredits } from './semrush.js';
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
    try { flushSemrushCredits(); } catch (err) { log.error({ err }, 'Failed to flush SEMRush credits during shutdown'); }
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
