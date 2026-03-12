import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getWorkspace, listWorkspaces } from './workspaces.js';
import { getUploadRoot, getOptRoot, DATA_BASE } from './data-dir.js';
import { startWatcher } from './processor.js';
import { constructWebhookEvent, handleWebhookEvent, clearTestModeCustomerIds, initStripeBroadcast, isStripeConfigured } from './stripe.js';
import { verifyToken as verifyJwtToken, optionalAuth } from './auth.js';
import { verifyClientToken } from './client-users.js';
import { initEmailQueue } from './email.js';
import { initActivityBroadcast } from './activity-log.js';
import { startScheduler } from './scheduled-audits.js';
import { startApprovalReminders } from './approval-reminders.js';
import { startTrialReminders } from './trial-reminders.js';
import { startBackupScheduler } from './backup.js';
import { startMonthlyReports } from './monthly-report.js';
import { startChurnSignalScheduler } from './churn-signals.js';
import { startAnomalyDetection, initAnomalyBroadcast } from './anomaly-detection.js';
import { initJobs } from './jobs.js';
import { setBroadcast } from './broadcast.js';
import {
  publicApiLimiter,
  publicWriteLimiter,
  verifyAdminToken,
  verifyClientSession,
} from './middleware.js';

// ─── Route modules ───
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import healthRoutes from './routes/health.js';
import workspacesRoutes from './routes/workspaces.js';
import settingsRoutes from './routes/settings.js';
import webflowRoutes from './routes/webflow.js';
import webflowSeoRoutes from './routes/webflow-seo.js';
import webflowSchemaRoutes from './routes/webflow-schema.js';
import webflowPagespeedRoutes from './routes/webflow-pagespeed.js';
import webflowAnalysisRoutes from './routes/webflow-analysis.js';
import reportsRoutes from './routes/reports.js';
import googleRoutes from './routes/google.js';
import aiRoutes from './routes/ai.js';
import keywordStrategyRoutes from './routes/keyword-strategy.js';
import semrushRoutes from './routes/semrush.js';
import approvalsRoutes from './routes/approvals.js';
import publicPortalRoutes from './routes/public-portal.js';
import publicAuthRoutes from './routes/public-auth.js';
import publicContentRoutes from './routes/public-content.js';
import publicAnalyticsRoutes from './routes/public-analytics.js';
import publicChatRoutes from './routes/public-chat.js';
import publicRequestsRoutes from './routes/public-requests.js';
import contentRequestsRoutes from './routes/content-requests.js';
import contentBriefsRoutes from './routes/content-briefs.js';
import contentPostsRoutes from './routes/content-posts.js';
import requestsRoutes from './routes/requests.js';
import activityRoutes from './routes/activity.js';
import jobsRoutes from './routes/jobs.js';
import roadmapRoutes from './routes/roadmap.js';
import annotationsRoutes from './routes/annotations.js';
import rankTrackingRoutes from './routes/rank-tracking.js';
import auditSchedulesRoutes from './routes/audit-schedules.js';
import stripeRoutes from './routes/stripe.js';
import workOrdersRoutes from './routes/work-orders.js';
import recommendationsRoutes from './routes/recommendations.js';
import churnSignalsRoutes from './routes/churn-signals.js';
import anomaliesRoutes from './routes/anomalies.js';
import miscRoutes from './routes/misc.js';
import feedbackRoutes from './routes/feedback.js';
import publicFeedbackRoutes from './routes/public-feedback.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = DATA_BASE || path.join(process.env.HOME || '', '.asset-dashboard');

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const IS_PROD = process.env.NODE_ENV === 'production';

// Ensure data directories exist
for (const dir of [getUploadRoot(), getOptRoot()]) {
  fs.mkdirSync(dir, { recursive: true });
}

// Rate limiting, session signing, and admin token verification are all
// imported from middleware.ts — the single source of truth.
// Route files also import from middleware.ts, so they share the same
// SESSION_SECRET and rate-limit buckets.

// --- Core middleware (must come before auth) ---

// HTTPS enforcement in production (trust proxy for Render/Heroku/etc.)
if (IS_PROD) {
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') return next();
    res.redirect(301, `https://${req.headers.host}${req.url}`);
  });
}

// Security headers via Helmet
app.use(helmet({
  contentSecurityPolicy: IS_PROD ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://js.stripe.com'],
      frameSrc: ["'self'", 'https://js.stripe.com', 'https://hooks.stripe.com'],
      connectSrc: ["'self'", 'https://api.stripe.com', 'wss:', 'ws:'],
      imgSrc: ["'self'", 'data:', 'https:'],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  } : false, // Disable CSP in dev (Vite HMR needs inline scripts)
  crossOriginEmbedderPolicy: false, // Allow loading external images/resources
}));

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : undefined; // undefined = allow all in dev
app.use(cors(ALLOWED_ORIGINS ? {
  origin: (origin, cb) => {
    // No origin = same-origin request (always allow)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) cb(null, true);
    else { console.warn(`[CORS] Blocked origin: ${origin}`); cb(null, false); }
  },
  credentials: true,
} : undefined));
app.use(cookieParser());

// Stripe webhook must receive raw body (before express.json parses it)
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'] as string;
  if (!sig) return res.status(400).json({ error: 'Missing stripe-signature header' });
  try {
    const event = constructWebhookEvent(req.body, sig);
    await handleWebhookEvent(event);
    res.json({ received: true });
  } catch (err) {
    console.error('[stripe] Webhook error:', err instanceof Error ? err.message : err);
    res.status(400).json({ error: 'Webhook verification failed' });
  }
});

app.use(express.json({ limit: '10mb' }));

// --- Rate limiting for public API routes ---
// Limiters imported from middleware.ts (shared buckets with route files)
app.use('/api/public/', publicApiLimiter);
app.use((req, res, next) => {
  if (req.path.startsWith('/api/public/') && (req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE')) {
    return publicWriteLimiter(req, res, next);
  }
  next();
});

// --- Input validation helpers ---
/** Sanitize a string field: trim, limit length, strip control characters */
/** Validate that a value is one of the allowed options */

// --- Populate req.user from JWT when present (non-blocking) ---
app.use(optionalAuth);

// --- Auth middleware (password gate) ---
const APP_PASSWORD = process.env.APP_PASSWORD;
if (APP_PASSWORD) {
  app.use((req, res, next) => {
    // Allow health check without auth (diag only in non-prod)
    if (req.path === '/api/health') return next();
    if (req.path === '/api/health/diag' && !IS_PROD) return next();
    // Check header or cookie (support both legacy raw password and new HMAC token)
    const token = (req.headers['x-auth-token'] || req.cookies?.auth_token || '') as string;
    if (token === APP_PASSWORD || verifyAdminToken(token)) return next();
    // Also accept new JWT user tokens (from cookie or Authorization header)
    const jwtToken = req.cookies?.token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '');
    if (jwtToken) {
      const payload = verifyJwtToken(jwtToken);
      if (payload) return next();
    }
    // Allow auth endpoints through
    if (req.path === '/api/auth/login' && req.method === 'POST') return next();
    if (req.path === '/api/auth/check') return next();
    if (req.path.startsWith('/api/auth/setup') || req.path === '/api/auth/user-login') return next();
    // Allow Google OAuth callback (Google redirects here without our auth token)
    if (req.path === '/api/google/callback') return next();
    // Allow public report and client routes
    if (req.path.startsWith('/report/') || req.path.startsWith('/client/')) return next();
    if (req.path.startsWith('/api/public/')) return next();
    // In production, serve the frontend without auth (it handles login UI)
    if (IS_PROD && !req.path.startsWith('/api') && !req.path.startsWith('/ws')) return next();
    // Reject API calls without auth
    if (req.path.startsWith('/api')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  });
}

// --- Client dashboard session enforcement ---
// For password-protected workspaces, public data endpoints require a valid session cookie
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/public/')) return next();
  // Extract workspace ID from path: /api/public/<resource>/<workspaceId>
  const parts = req.path.split('/');
  // Patterns: /api/public/workspace/:id, /api/public/auth/:id, /api/public/<resource>/:workspaceId/...
  // Allow auth and workspace-info endpoints through (needed before login)
  if (parts[3] === 'auth' || parts[3] === 'workspace' || parts[3] === 'client-login' || parts[3] === 'client-logout' || parts[3] === 'client-me' || parts[3] === 'auth-mode') return next();
  const workspaceId = parts[4]; // /api/public/<resource>/<workspaceId>
  if (!workspaceId) return next();
  const ws = getWorkspace(workspaceId);
  if (!ws || !ws.clientPassword) return next(); // No password = open access
  // Allow admin users through (they have their own auth layer)
  const adminToken = (req.headers['x-auth-token'] || req.cookies?.auth_token || '') as string;
  if (adminToken && (adminToken === APP_PASSWORD || verifyAdminToken(adminToken))) return next();
  const jwtToken = req.cookies?.token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '');
  if (jwtToken) {
    const jwtPayload = verifyJwtToken(jwtToken);
    if (jwtPayload) return next();
  }
  // Verify session cookie (legacy shared password)
  const sessionToken = req.cookies?.[`client_session_${workspaceId}`];
  if (sessionToken && verifyClientSession(workspaceId, sessionToken)) return next();
  // Verify client user JWT token
  const clientToken = req.cookies?.[`client_user_token_${workspaceId}`];
  if (clientToken) {
    const payload = verifyClientToken(clientToken);
    if (payload && payload.workspaceId === workspaceId) return next();
  }
  return res.status(401).json({ error: 'Authentication required. Please log in to the dashboard.' });
});

// Auth login endpoint

// Serve optimized files for preview
app.use('/files', express.static(getOptRoot()));

// --- WebSocket ---
const clients = new Set<WebSocket>();
// Track which workspaces each client has subscribed to
const clientWorkspaces = new Map<WebSocket, Set<string>>();

// --- User Presence Tracking ---
interface PresenceInfo {
  userId: string;
  email: string;
  name?: string;
  workspaceId: string;
  role: 'client' | 'admin';
  connectedAt: string;
  lastSeen: string;
}
const clientPresence = new Map<WebSocket, PresenceInfo>();

/** Get all currently online users, grouped by workspace. */
function getPresence(): Record<string, Array<{ userId: string; email: string; name?: string; role: string; connectedAt: string; lastSeen: string }>> {
  const result: Record<string, Array<{ userId: string; email: string; name?: string; role: string; connectedAt: string; lastSeen: string }>> = {};
  for (const [ws, info] of clientPresence) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (!result[info.workspaceId]) result[info.workspaceId] = [];
    // Deduplicate by userId (user might have multiple tabs)
    if (!result[info.workspaceId].some(u => u.userId === info.userId)) {
      result[info.workspaceId].push({
        userId: info.userId,
        email: info.email,
        name: info.name,
        role: info.role,
        connectedAt: info.connectedAt,
        lastSeen: info.lastSeen,
      });
    }
  }
  return result;
}

/** Broadcast presence update to all admin clients. */
function broadcastPresenceUpdate() {
  const presence = getPresence();
  _broadcast('presence:update', presence);
}

wss.on('connection', (ws) => {
  clients.add(ws);
  clientWorkspaces.set(ws, new Set());

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg.action === 'subscribe' && typeof msg.workspaceId === 'string') {
        clientWorkspaces.get(ws)?.add(msg.workspaceId);
      } else if (msg.action === 'unsubscribe' && typeof msg.workspaceId === 'string') {
        clientWorkspaces.get(ws)?.delete(msg.workspaceId);
      } else if (msg.action === 'identify' && typeof msg.userId === 'string' && typeof msg.workspaceId === 'string') {
        const now = new Date().toISOString();
        clientPresence.set(ws, {
          userId: msg.userId,
          email: msg.email || '',
          name: msg.name,
          workspaceId: msg.workspaceId,
          role: msg.role || 'client',
          connectedAt: now,
          lastSeen: now,
        });
        broadcastPresenceUpdate();
      } else if (msg.action === 'heartbeat') {
        const info = clientPresence.get(ws);
        if (info) info.lastSeen = new Date().toISOString();
      }
    } catch { /* ignore malformed messages */ }
  });

  ws.on('close', () => {
    const hadPresence = clientPresence.has(ws);
    clients.delete(ws);
    clientWorkspaces.delete(ws);
    clientPresence.delete(ws);
    if (hadPresence) broadcastPresenceUpdate();
  });
});

// Wire up the broadcast singleton so route files (which import from broadcast.ts)
// use the same WebSocket-backed functions defined here.
function _broadcast(event: string, data: unknown) {
  const msg = JSON.stringify({ event, data });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}
function _broadcastToWorkspace(workspaceId: string, event: string, data: unknown) {
  const msg = JSON.stringify({ event, data, workspaceId });
  for (const [ws, subs] of clientWorkspaces) {
    if (ws.readyState === WebSocket.OPEN && subs.has(workspaceId)) {
      ws.send(msg);
    }
  }
}
setBroadcast(_broadcast, _broadcastToWorkspace);

// --- User Presence API (admin) ---
app.get('/api/presence', (_req, res) => {
  res.json(getPresence());
});

// --- Background Jobs ---
initJobs(_broadcast);

// --- Activity broadcast (every addActivity auto-notifies subscribed WS clients) ---
initActivityBroadcast(_broadcastToWorkspace);
// --- Anomaly broadcast (notify workspace clients when new anomalies detected) ---
initAnomalyBroadcast(_broadcastToWorkspace);
initStripeBroadcast(_broadcastToWorkspace);


// ─── Mount route modules ───
app.use(authRoutes);
app.use(usersRoutes);
app.use(healthRoutes);
app.use(workspacesRoutes);
app.use(settingsRoutes);
app.use(webflowRoutes);
app.use(webflowSeoRoutes);
app.use(webflowSchemaRoutes);
app.use(webflowPagespeedRoutes);
app.use(webflowAnalysisRoutes);
app.use(reportsRoutes);
app.use(googleRoutes);
app.use(aiRoutes);
app.use(keywordStrategyRoutes);
app.use(semrushRoutes);
app.use(approvalsRoutes);
app.use(publicPortalRoutes);
app.use(publicAuthRoutes);
app.use(publicContentRoutes);
app.use(publicAnalyticsRoutes);
app.use(publicChatRoutes);
app.use(publicRequestsRoutes);
app.use(contentRequestsRoutes);
app.use(contentBriefsRoutes);
app.use(contentPostsRoutes);
app.use(requestsRoutes);
app.use(activityRoutes);
app.use(jobsRoutes);
app.use(roadmapRoutes);
app.use(annotationsRoutes);
app.use(rankTrackingRoutes);
app.use(auditSchedulesRoutes);
app.use(stripeRoutes);
app.use(workOrdersRoutes);
app.use(recommendationsRoutes);
app.use(churnSignalsRoutes);
app.use(anomaliesRoutes);
app.use(miscRoutes);
app.use(feedbackRoutes);
app.use(publicFeedbackRoutes);


// --- Serve frontend in production (MUST be after all API routes) ---
if (IS_PROD) {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Initialize email batching queue
initEmailQueue();
// Start audit scheduler
startScheduler();
// Start approval reminders
startApprovalReminders();
// Start monthly reports
startMonthlyReports();
// Start daily data backups
startBackupScheduler();
// Clear stale test-mode Stripe customer IDs (one-time on startup when using live keys)
clearTestModeCustomerIds();
// Start trial expiry reminders (day 10 + day 13)
startTrialReminders();
// Start churn prevention signal checks (every 6h)
startChurnSignalScheduler();
// Start anomaly detection (every 12h)
startAnomalyDetection();

// Start
const PORT = parseInt(process.env.PORT || '3001', 10);
startWatcher(_broadcast);
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
