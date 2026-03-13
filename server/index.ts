import 'dotenv/config';
import { initSentry } from './sentry.js';

// Initialize Sentry before anything else so it can capture startup errors
initSentry();

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
  console.log(`Asset Dashboard running on http://localhost:${PORT} [${IS_PROD ? 'production' : 'development'}]`);
  // Startup diagnostics
  const workspaces = listWorkspaces();
  const hasEnvToken = !!process.env.WEBFLOW_API_TOKEN;
  console.log(`[startup] DATA_ROOT=${DATA_ROOT}`);
  console.log(`[startup] HOME=${process.env.HOME || 'unset'}`);
  console.log(`[startup] NODE_ENV=${process.env.NODE_ENV || 'unset'}`);
  console.log(`[startup] WEBFLOW_API_TOKEN env: ${hasEnvToken ? 'SET' : 'NOT SET'}`);
  console.log(`[startup] OPENAI_API_KEY env: ${process.env.OPENAI_API_KEY ? 'SET' : 'NOT SET'}`);
  console.log(`[startup] GOOGLE_PSI_KEY env: ${process.env.GOOGLE_PSI_KEY ? 'SET' : 'NOT SET'}`);
  console.log(`[startup] STRIPE: ${isStripeConfigured() ? 'CONFIGURED' : 'NOT CONFIGURED (set STRIPE_SECRET_KEY to enable payments)'}`);
  if (!process.env.JWT_SECRET) {
    console.warn('[startup] ⚠️  JWT_SECRET is NOT SET — using insecure hardcoded fallback. Set JWT_SECRET in environment before production launch.');
  } else {
    console.log('[startup] JWT_SECRET: SET');
  }
  console.log(`[startup] Workspaces loaded: ${workspaces.length}`);
  for (const ws of workspaces) {
    console.log(`[startup]   - ${ws.name}: siteId=${ws.webflowSiteId || 'none'}, hasToken=${!!ws.webflowToken}`);
  }
  // Reports directory check
  const reportsDir = path.join(DATA_ROOT, 'reports');
  const reportsExists = fs.existsSync(reportsDir);
  const snapshotCount = reportsExists ? fs.readdirSync(reportsDir).reduce((sum, sd) => sum + fs.readdirSync(path.join(reportsDir, sd)).filter(f => f.endsWith('.json')).length, 0) : 0;
  console.log(`[startup] REPORTS_DIR=${reportsDir} exists=${reportsExists} snapshots=${snapshotCount}`);
});
