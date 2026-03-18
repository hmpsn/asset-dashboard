import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getWorkspace } from './workspaces.js';
import { getUploadRoot, getOptRoot } from './data-dir.js';
import { constructWebhookEvent, handleWebhookEvent } from './stripe.js';
import { verifyToken as verifyJwtToken, optionalAuth } from './auth.js';
import { verifyClientToken } from './client-users.js';
import {
  publicApiLimiter,
  publicWriteLimiter,
  globalPublicLimiter,
  verifyAdminToken,
  verifyClientSession,
} from './middleware.js';
import { fingerprintMiddleware } from './middleware/fingerprint.js';
import { getPresence } from './websocket.js';
import { setupSentryErrorHandler } from './sentry.js';
import { requestLogger } from './middleware/request-logger.js';
import { createLogger } from './logger.js';

const log = createLogger('app');

// ─── Route modules ───
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import healthRoutes from './routes/health.js';
import workspacesRoutes from './routes/workspaces.js';
import settingsRoutes from './routes/settings.js';
import webflowRoutes from './routes/webflow.js';
import webflowAuditRoutes from './routes/webflow-audit.js';
import webflowKeywordsRoutes from './routes/webflow-keywords.js';
import webflowAltTextRoutes from './routes/webflow-alt-text.js';
import webflowOrganizeRoutes from './routes/webflow-organize.js';
import webflowCmsRoutes from './routes/webflow-cms.js';
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
import aeoReviewRoutes from './routes/aeo-review.js';
import seoChangeTrackerRoutes from './routes/seo-change-tracker.js';
import contentDecayRoutes from './routes/content-decay.js';
import contentPublishRoutes from './routes/content-publish.js';
import contentSubscriptionRoutes from './routes/content-subscriptions.js';
import dataExportRoutes from './routes/data-export.js';
import revenueRoutes from './routes/revenue.js';
import brandDocsRoutes from './routes/brand-docs.js';
import backlinksRoutes from './routes/backlinks.js';
import workspaceHomeRoutes from './routes/workspace-home.js';
import workspaceBadgesRoutes from './routes/workspace-badges.js';
import rewriteChatRoutes from './routes/rewrite-chat.js';
import contentTemplatesRoutes from './routes/content-templates.js';
import contentMatricesRoutes from './routes/content-matrices.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const IS_PROD = process.env.NODE_ENV === 'production';

/** Create and configure the Express application with all middleware and routes. */
export function createApp(): express.Express {
  const app = express();

  // Ensure data directories exist
  for (const dir of [getUploadRoot(), getOptRoot()]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // --- Core middleware (must come before auth) ---

  // HTTPS enforcement in production (trust proxy for Render/Heroku/etc.)
  if (IS_PROD) {
    app.set('trust proxy', 1);
    app.use((req, res, next) => {
      if (req.secure || req.headers['x-forwarded-proto'] === 'https') return next();
      // Only redirect when behind a reverse proxy (Render, Heroku, etc.).
      // Direct connections (CI, local) have no x-forwarded-proto header —
      // redirecting those to HTTPS would break health-check polling.
      if (!req.headers['x-forwarded-proto']) return next();
      res.redirect(301, `https://${req.headers.host}${req.url}`);
    });
  }

  // Security headers via Helmet
  app.use(helmet({
    contentSecurityPolicy: IS_PROD ? {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://js.stripe.com', 'https://challenges.cloudflare.com'],
        frameSrc: ["'self'", 'https://js.stripe.com', 'https://hooks.stripe.com', 'https://challenges.cloudflare.com'],
        connectSrc: ["'self'", 'https://api.stripe.com', 'https://*.ingest.sentry.io', 'wss:', 'ws:'],
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
      else { log.warn({ origin }, 'Blocked CORS origin'); cb(null, false); }
    },
    credentials: true,
  } : undefined));
  app.use(cookieParser());

  // --- Request logging (safe before Stripe webhook — only logs method/path/status, does not consume body) ---
  app.use(requestLogger);

  // Stripe webhook must receive raw body (before express.json parses it)
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'] as string;
    if (!sig) return res.status(400).json({ error: 'Missing stripe-signature header' });
    try {
      const event = constructWebhookEvent(req.body, sig);
      await handleWebhookEvent(event);
      res.json({ received: true });
    } catch (err) {
      log.error({ err }, 'Stripe webhook error');
      res.status(400).json({ error: 'Webhook verification failed' });
    }
  });

  app.use(express.json({ limit: '10mb' }));

  // --- Request fingerprinting (attaches req.fingerprint for abuse detection) ---
  app.use(fingerprintMiddleware);

  // --- Rate limiting for public API routes ---
  app.use('/api/public/', globalPublicLimiter);
  app.use('/api/public/', publicApiLimiter);
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/public/') && (req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE')) {
      return publicWriteLimiter(req, res, next);
    }
    next();
  });

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
      if (IS_PROD && !req.path.startsWith('/api') && !req.path.startsWith('/ws/') && req.path !== '/ws') return next();
      // Reject API calls without auth
      if (req.path.startsWith('/api')) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      next();
    });
  }

  // --- Client dashboard session enforcement ---
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/public/')) return next();
    const parts = req.path.split('/');
    if (parts[3] === 'auth' || parts[3] === 'workspace' || parts[3] === 'client-login' || parts[3] === 'client-logout' || parts[3] === 'client-me' || parts[3] === 'auth-mode' || parts[3] === 'forgot-password' || parts[3] === 'reset-password') return next();
    const workspaceId = parts[4];
    if (!workspaceId) return next();
    const ws = getWorkspace(workspaceId);
    if (!ws || !ws.clientPassword) return next();
    const adminToken = (req.headers['x-auth-token'] || req.cookies?.auth_token || '') as string;
    if (adminToken && (adminToken === APP_PASSWORD || verifyAdminToken(adminToken))) return next();
    const jwtToken = req.cookies?.token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '');
    if (jwtToken) {
      const jwtPayload = verifyJwtToken(jwtToken);
      if (jwtPayload) return next();
    }
    const sessionToken = req.cookies?.[`client_session_${workspaceId}`];
    if (sessionToken && verifyClientSession(workspaceId, sessionToken)) return next();
    const clientToken = req.cookies?.[`client_user_token_${workspaceId}`];
    if (clientToken) {
      const payload = verifyClientToken(clientToken);
      if (payload && payload.workspaceId === workspaceId) return next();
    }
    return res.status(401).json({ error: 'Authentication required. Please log in to the dashboard.' });
  });

  // Serve optimized files for preview
  app.use('/files', express.static(getOptRoot()));

  // --- User Presence API (admin) ---
  app.get('/api/presence', (_req, res) => {
    res.json(getPresence());
  });

  // ─── Mount route modules ───
  app.use(authRoutes);
  app.use(usersRoutes);
  app.use(healthRoutes);
  app.use(workspacesRoutes);
  app.use(settingsRoutes);
  app.use(webflowRoutes);
  app.use(webflowAuditRoutes);
  app.use(webflowKeywordsRoutes);
  app.use(webflowAltTextRoutes);
  app.use(webflowOrganizeRoutes);
  app.use(webflowCmsRoutes);
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
  app.use(aeoReviewRoutes);
  app.use(seoChangeTrackerRoutes);
  app.use(contentDecayRoutes);
  app.use(contentPublishRoutes);
  app.use(contentSubscriptionRoutes);
  app.use(dataExportRoutes);
  app.use(revenueRoutes);
  app.use(brandDocsRoutes);
  app.use(backlinksRoutes);
  app.use(workspaceHomeRoutes);
  app.use(workspaceBadgesRoutes);
  app.use(rewriteChatRoutes);
  app.use(contentTemplatesRoutes);
  app.use(contentMatricesRoutes);

  // --- Sentry error handler (must be after all route mounts, before frontend catch-all) ---
  setupSentryErrorHandler(app);

  // --- Serve frontend in production (MUST be after all API routes) ---
  if (IS_PROD) {
    const distPath = path.join(__dirname, '..', 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}
