import 'dotenv/config';
import { createServer } from 'http';
import path from 'path';
import fs from 'fs';
import { runMigrations } from './db/index.js';
import { createApp } from './app.js';
import { initWebSocket } from './websocket.js';
import { startSchedulers } from './startup.js';
import { listWorkspaces } from './workspaces.js';
import { isStripeConfigured } from './stripe.js';
import { DATA_BASE } from './data-dir.js';
import { createLogger } from './logger.js';

const log = createLogger('startup');

const DATA_ROOT = DATA_BASE || path.join(process.env.HOME || '', '.asset-dashboard');
const IS_PROD = process.env.NODE_ENV === 'production';

// Run pending SQLite migrations before anything touches the database
runMigrations();

// Create and configure the Express app (middleware + routes)
const app = createApp();

// Create the HTTP server and wire up WebSocket + broadcast
const server = createServer(app);
initWebSocket(server);

// Start all background schedulers and queues
startSchedulers();

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
    log.warn('⚠️  JWT_SECRET is NOT SET — using insecure hardcoded fallback. Set JWT_SECRET in environment before production launch.');
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
