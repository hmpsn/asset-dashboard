import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import multer from 'multer';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  listWorkspaces,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  getWorkspace,
  getUploadRoot,
  getOptRoot,
  getTokenForSite,
} from './workspaces.js';
import { buildSeoContext, buildKeywordMapContext } from './seo-context.js';
import { startWatcher, getQueue, triggerOptimize, getMetadata } from './processor.js';
import {
  listSites,
  listAssets,
  updateAsset,
  deleteAsset,
  scanAssetUsage,
  listCollections,
  getCollectionSchema,
  listCollectionItems,
  updateCollectionItem,
  publishCollectionItems,
  listPages,
  filterPublishedPages,
  getPageDom,
  updatePageSeo,
  publishSite,
  publishSchemaToPage,
  publishRawSchemaToPage,
  uploadAsset,
  listAssetFolders,
  createAssetFolder,
  moveAssetToFolder,
  getSiteSubdomain,
  discoverSitemapUrls,
} from './webflow.js';
import { generateAltText } from './alttext.js';
import { runSeoAudit } from './seo-audit.js';
import { checkSiteLinks } from './link-checker.js';
import { scanRedirects } from './redirect-scanner.js';
import { saveRedirectSnapshot, getRedirectSnapshot } from './redirect-store.js';
import { analyzeInternalLinks } from './internal-links.js';
import {
  saveSnapshot, getSnapshot, listSnapshots, getLatestSnapshot, renderReportHTML,
  addActionItem, updateActionItem, deleteActionItem, getActionItems, extractSiteLogo,
} from './reports.js';
import { runSiteSpeed, runSinglePageSpeed } from './pagespeed.js';
import { generateSchemaSuggestions, generateSchemaForPage, generateCmsTemplateSchema, type SchemaContext } from './schema-suggester.js';
import { saveSchemaSnapshot, getSchemaSnapshot } from './schema-store.js';
import { runSalesAudit } from './sales-audit.js';
import { initJobs, createJob, updateJob, getJob, listJobs, cancelJob, registerAbort, isJobCancelled } from './jobs.js';
import { createBatch, listBatches, getBatch, updateItem, markBatchApplied, deleteBatch } from './approvals.js';
import { listRequests, createRequest, updateRequest, addNote, deleteRequest, getRequest, getAttachmentsDir, addAttachmentsToRequest, type RequestAttachment } from './requests.js';
import { notifyTeamNewRequest, notifyClientTeamResponse, notifyClientStatusChange, notifyTeamContentRequest, notifyClientBriefReady, isEmailConfigured } from './email.js';
import { addActivity, listActivity } from './activity-log.js';
import { getSchedule, listSchedules, upsertSchedule, deleteSchedule, startScheduler } from './scheduled-audits.js';
import { getTrackedKeywords, addTrackedKeyword, removeTrackedKeyword, togglePinKeyword, storeRankSnapshot, getRankHistory, getLatestRanks } from './rank-tracking.js';
import { listAnnotations, addAnnotation, deleteAnnotation } from './annotations.js';
import { startApprovalReminders } from './approval-reminders.js';
import { startMonthlyReports, triggerMonthlyReport } from './monthly-report.js';
import { listBriefs, getBrief, deleteBrief, generateBrief } from './content-brief.js';
import { renderBriefHTML } from './brief-export-html.js';
import { listContentRequests, getContentRequest, createContentRequest, updateContentRequest, deleteContentRequest, addComment } from './content-requests.js';
import { isSemrushConfigured, getKeywordOverview, getDomainOrganicKeywords, getKeywordGap, getRelatedKeywords, estimateCreditCost, clearSemrushCache } from './semrush.js';
import { renderSalesReportHTML } from './sales-report-html.js';
import { getAuthUrl, exchangeCode, isConnected, disconnect, getGoogleCredentials, getGlobalAuthUrl, isGlobalConnected, disconnectGlobal, getGlobalToken, GLOBAL_KEY } from './google-auth.js';
import { listGscSites, getSearchOverview, getPerformanceTrend, getQueryPageData, getAllGscPages } from './search-console.js';
import { listGA4Properties, getGA4Overview, getGA4DailyTrend, getGA4TopPages, getGA4TopSources, getGA4DeviceBreakdown, getGA4Countries, getGA4KeyEvents, getGA4EventTrend, getGA4Conversions, getGA4EventsByPage } from './google-analytics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const IS_PROD = process.env.NODE_ENV === 'production';

// Ensure data directories exist
for (const dir of [getUploadRoot(), getOptRoot()]) {
  fs.mkdirSync(dir, { recursive: true });
}

// --- Security utilities ---

// In-memory rate limiter (per IP)
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(windowMs: number, maxRequests: number) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${ip}:${req.path}`;
    const now = Date.now();
    const bucket = rateLimitBuckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    bucket.count++;
    if (bucket.count > maxRequests) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    next();
  };
}
// Clean up stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitBuckets) {
    if (now > bucket.resetAt) rateLimitBuckets.delete(key);
  }
}, 5 * 60 * 1000);

// Session signing for client dashboard auth
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.APP_PASSWORD || crypto.randomBytes(32).toString('hex');
function signClientSession(workspaceId: string): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update(`client:${workspaceId}`).digest('hex');
}
function verifyClientSession(workspaceId: string, token: string): boolean {
  const expected = signClientSession(workspaceId);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token || ''.padEnd(expected.length)));
}

// Admin auth token (HMAC instead of raw password)
function signAdminToken(): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update('admin').digest('hex');
}
function verifyAdminToken(token: string): boolean {
  const expected = signAdminToken();
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token || '')); }
  catch { return false; }
}

// --- Core middleware (must come before auth) ---
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
app.use(express.json({ limit: '10mb' }));

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
    // Allow auth endpoints through
    if (req.path === '/api/auth/login' && req.method === 'POST') return next();
    if (req.path === '/api/auth/check') return next();
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
  if (parts[3] === 'auth' || parts[3] === 'workspace') return next();
  const workspaceId = parts[4]; // /api/public/<resource>/<workspaceId>
  if (!workspaceId) return next();
  const ws = getWorkspace(workspaceId);
  if (!ws || !ws.clientPassword) return next(); // No password = open access
  // Verify session cookie
  const sessionToken = req.cookies?.[`client_session_${workspaceId}`];
  if (sessionToken && verifyClientSession(workspaceId, sessionToken)) return next();
  return res.status(401).json({ error: 'Authentication required. Please log in to the dashboard.' });
});

// Auth login endpoint
const loginLimiter = rateLimit(60 * 1000, 5); // 5 attempts per minute
app.post('/api/auth/login', loginLimiter, express.json(), (req, res) => {
  const { password } = req.body;
  if (!APP_PASSWORD) return res.json({ ok: true });
  if (password === APP_PASSWORD) {
    const token = signAdminToken();
    res.cookie('auth_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      secure: IS_PROD,
    });
    res.json({ ok: true, token });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('auth_token');
  res.json({ ok: true });
});

app.get('/api/auth/check', (req, res) => {
  if (!APP_PASSWORD) return res.json({ required: false });
  const token = (req.headers['x-auth-token'] || req.cookies?.auth_token || '') as string;
  res.json({ required: true, authenticated: token === APP_PASSWORD || verifyAdminToken(token) });
});

// Diagnostic endpoint - test Webflow API connection
app.get('/api/health/diag', async (_req, res) => {
  const envToken = process.env.WEBFLOW_API_TOKEN;
  const workspaces = listWorkspaces();
  const diag: Record<string, unknown> = {
    dataDir: process.env.DATA_DIR || (IS_PROD ? '/tmp/asset-dashboard' : 'local'),
    configFile: path.join(getUploadRoot(), '.workspaces.json'),
    configExists: fs.existsSync(path.join(getUploadRoot(), '.workspaces.json')),
    envTokenSet: !!envToken,
    workspaceCount: workspaces.length,
    workspaces: workspaces.map(ws => ({
      id: ws.id,
      name: ws.name,
      siteId: ws.webflowSiteId || null,
      hasToken: !!ws.webflowToken,
    })),
  };

  // Test token resolution for each workspace's siteId
  const tokenTests: Record<string, unknown>[] = [];
  for (const ws of workspaces) {
    if (ws.webflowSiteId) {
      const resolved = getTokenForSite(ws.webflowSiteId);
      const test: Record<string, unknown> = {
        workspace: ws.name,
        siteId: ws.webflowSiteId,
        hasResolvedToken: !!resolved,
        source: ws.webflowToken ? 'workspace' : (envToken ? 'env' : 'none'),
      };
      // Actually test the Webflow API with the resolved token
      if (resolved) {
        try {
          const r = await fetch(`https://api.webflow.com/v2/sites/${ws.webflowSiteId}`, {
            headers: { Authorization: `Bearer ${resolved}`, 'Content-Type': 'application/json' },
          });
          test.apiStatus = r.status;
          test.apiOk = r.ok;
          if (!r.ok) test.apiError = (await r.text()).slice(0, 200);
          else test.siteName = ((await r.json()) as { displayName?: string }).displayName;
        } catch (err) {
          test.apiError = err instanceof Error ? err.message : String(err);
        }
      }
      tokenTests.push(test);
    }
  }
  diag.tokenTests = tokenTests;

  // Also test env token directly
  if (envToken) {
    try {
      const r = await fetch('https://api.webflow.com/v2/sites', {
        headers: { Authorization: `Bearer ${envToken}`, 'Content-Type': 'application/json' },
      });
      diag.envTokenStatus = r.status;
      diag.envTokenOk = r.ok;
      if (r.ok) {
        const data = await r.json() as { sites?: { id: string; displayName?: string }[] };
        diag.envTokenSites = (data.sites || []).map(s => ({ id: s.id, name: s.displayName }));
      }
    } catch (err) {
      diag.envTokenError = err instanceof Error ? err.message : String(err);
    }
  }
  res.json(diag);
});

// Serve optimized files for preview
app.use('/files', express.static(getOptRoot()));

// --- WebSocket ---
const clients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});

function broadcast(event: string, data: unknown) {
  const msg = JSON.stringify({ event, data });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

// --- Data directory helper (single source of truth) ---
const DATA_ROOT = process.env.DATA_DIR || (IS_PROD ? '/tmp/asset-dashboard' : path.join(process.env.HOME || '', '.asset-dashboard'));
function getDataDir(subdir: string): string {
  const dir = path.join(DATA_ROOT, subdir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// --- Background Jobs ---
initJobs(broadcast);

// --- File Upload ---
const tmpDir = path.join(getUploadRoot(), '.tmp');
fs.mkdirSync(tmpDir, { recursive: true });
const upload = multer({ dest: tmpDir });

function moveUploadedFiles(
  files: Express.Multer.File[],
  workspaceId: string,
  isMeta: boolean
): string[] {
  const workspaces = listWorkspaces();
  const ws = workspaces.find(w => w.id === workspaceId || w.folder === workspaceId);

  let dest: string;
  if (ws) {
    dest = isMeta
      ? path.join(getUploadRoot(), ws.folder, 'meta')
      : path.join(getUploadRoot(), ws.folder);
  } else {
    dest = path.join(getUploadRoot(), '_unsorted');
  }
  fs.mkdirSync(dest, { recursive: true });

  const paths: string[] = [];
  for (const f of files) {
    const target = path.join(dest, f.originalname);
    fs.renameSync(f.path, target);
    paths.push(target);
  }
  return paths;
}


// Workspaces
app.get('/api/workspaces', (_req, res) => {
  const workspaces = listWorkspaces().map(ws => ({ ...ws, webflowToken: undefined, clientPassword: undefined, hasPassword: !!ws.clientPassword }));
  res.json(workspaces);
});

// Workspace overview: aggregated metrics for all workspaces
app.get('/api/workspace-overview', (_req, res) => {
  const workspaces = listWorkspaces();
  const overview = workspaces.map(ws => {
    // Audit
    let audit: { score: number; totalPages: number; errors: number; warnings: number; previousScore?: number; lastAuditDate?: string } | null = null;
    if (ws.webflowSiteId) {
      const snap = getLatestSnapshot(ws.webflowSiteId);
      if (snap) {
        audit = {
          score: snap.audit.siteScore,
          totalPages: snap.audit.totalPages,
          errors: snap.audit.errors,
          warnings: snap.audit.warnings,
          previousScore: snap.previousScore,
          lastAuditDate: snap.createdAt,
        };
      }
    }
    // Requests
    const reqs = listRequests(ws.id);
    const reqNew = reqs.filter(r => r.status === 'new').length;
    const reqActive = reqs.filter(r => r.status === 'in_review' || r.status === 'in_progress').length;
    const reqTotal = reqs.length;
    const latestReq = reqs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
    // Approvals
    const batches = listBatches(ws.id);
    const pendingApprovals = batches.reduce((sum, b) => sum + b.items.filter((i: { status: string }) => i.status === 'pending').length, 0);
    const totalApprovalItems = batches.reduce((sum, b) => sum + b.items.length, 0);
    // Content requests (from client portal)
    const contentReqs = listContentRequests(ws.id);
    const pendingContentReqs = contentReqs.filter(r => r.status === 'requested').length;

    return {
      id: ws.id,
      name: ws.name,
      webflowSiteId: ws.webflowSiteId || null,
      webflowSiteName: ws.webflowSiteName || null,
      hasGsc: !!ws.gscPropertyUrl,
      hasGa4: !!ws.ga4PropertyId,
      hasPassword: !!ws.clientPassword,
      audit,
      requests: { total: reqTotal, new: reqNew, active: reqActive, latestDate: latestReq?.updatedAt || null },
      approvals: { pending: pendingApprovals, total: totalApprovalItems },
      contentRequests: { pending: pendingContentReqs, total: contentReqs.length },
    };
  });
  res.json(overview);
});

app.get('/api/workspaces/:id', (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: 'Not found' });
  const safe = { ...ws, webflowToken: undefined, clientPassword: undefined, hasPassword: !!ws.clientPassword };
  res.json(safe);
});

app.post('/api/workspaces', (req, res) => {
  const { name, webflowSiteId, webflowSiteName } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const ws = createWorkspace(name, webflowSiteId, webflowSiteName);
  broadcast('workspace:created', ws);
  res.json(ws);
});

app.patch('/api/workspaces/:id', async (req, res) => {
  const updates = { ...req.body };
  // When unlinking, clear the token too
  if (updates.webflowSiteId === null || updates.webflowSiteId === '') {
    updates.webflowToken = '';
    updates.liveDomain = '';
  }
  // Auto-resolve live domain when linking a site
  if (updates.webflowSiteId && updates.webflowSiteId !== '') {
    try {
      const token = updates.webflowToken || getTokenForSite(updates.webflowSiteId) || process.env.WEBFLOW_API_TOKEN || '';
      if (token) {
        const domRes = await fetch(`https://api.webflow.com/v2/sites/${updates.webflowSiteId}/custom_domains`, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        if (domRes.ok) {
          const domData = await domRes.json() as { customDomains?: { url?: string }[] };
          const domains = domData.customDomains || [];
          if (domains.length > 0 && domains[0].url) {
            const d = domains[0].url;
            updates.liveDomain = d.startsWith('http') ? d : `https://${d}`;
          }
        }
      }
    } catch { /* best-effort live domain resolution */ }
  }
  const ws = updateWorkspace(req.params.id, updates);
  if (!ws) return res.status(404).json({ error: 'Not found' });
  // Strip token from response to avoid leaking to frontend
  const safe = { ...ws, webflowToken: undefined, clientPassword: undefined, hasPassword: !!ws.clientPassword };
  broadcast('workspace:updated', safe);
  res.json(safe);
});

app.delete('/api/workspaces/:id', (req, res) => {
  const ok = deleteWorkspace(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  broadcast('workspace:deleted', { id: req.params.id });
  res.json({ ok: true });
});

// File upload
app.post('/api/upload/:workspaceId', upload.array('files'), (req, res) => {
  const files = req.files as Express.Multer.File[];
  const filePaths = moveUploadedFiles(files, req.params.workspaceId, false);

  broadcast('files:uploaded', {
    workspace: req.params.workspaceId,
    type: 'asset',
    count: files.length,
    names: files.map(f => f.originalname),
  });

  for (const fp of filePaths) {
    triggerOptimize(fp).catch(err => console.error('Optimize error:', err));
  }

  res.json({ uploaded: files.length });
});

app.post('/api/upload/:workspaceId/meta', upload.array('files'), (req, res) => {
  const files = req.files as Express.Multer.File[];
  const filePaths = moveUploadedFiles(files, req.params.workspaceId, true);

  broadcast('files:uploaded', {
    workspace: req.params.workspaceId,
    type: 'meta',
    count: files.length,
    names: files.map(f => f.originalname),
  });

  for (const fp of filePaths) {
    triggerOptimize(fp).catch(err => console.error('Optimize error:', err));
  }

  res.json({ uploaded: files.length });
});

// Processing queue
app.get('/api/queue', (_req, res) => {
  res.json(getQueue());
});

// Webflow sites
app.get('/api/webflow/sites', async (req, res) => {
  try {
    const tokenParam = req.query.token as string | undefined;
    const sites = await listSites(tokenParam || undefined);
    res.json(sites);
  } catch {
    res.json([]);
  }
});

// Settings: read/write Webflow API token
const ENV_PATH = path.resolve(process.cwd(), '.env');

function readEnvFile(): Record<string, string> {
  const vars: Record<string, string> = {};
  if (fs.existsSync(ENV_PATH)) {
    for (const line of fs.readFileSync(ENV_PATH, 'utf-8').split('\n')) {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) vars[match[1].trim()] = match[2].trim();
    }
  }
  return vars;
}

function writeEnvFile(vars: Record<string, string>) {
  const content = Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  fs.writeFileSync(ENV_PATH, content);
}

app.get('/api/settings', (_req, res) => {
  const vars = readEnvFile();
  res.json({
    webflowToken: vars.WEBFLOW_API_TOKEN ? '••••' + vars.WEBFLOW_API_TOKEN.slice(-4) : '',
    hasWebflowToken: !!vars.WEBFLOW_API_TOKEN,
    hasAnthropicKey: !!vars.ANTHROPIC_API_KEY,
  });
});

app.post('/api/settings/webflow-token', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required' });

  const vars = readEnvFile();
  vars.WEBFLOW_API_TOKEN = token;
  writeEnvFile(vars);

  // Update runtime env
  process.env.WEBFLOW_API_TOKEN = token;

  res.json({ ok: true });
});

// --- Asset Browser ---
app.get('/api/webflow/assets/:siteId', async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId);
    const assets = await listAssets(req.params.siteId, token || undefined);
    res.json(assets);
  } catch {
    res.status(500).json({ error: 'Failed to list assets' });
  }
});

app.patch('/api/webflow/assets/:assetId', async (req, res) => {
  const { altText, displayName, siteId } = req.body;
  const token = siteId ? getTokenForSite(siteId) : null;
  const result = await updateAsset(req.params.assetId, { altText, displayName }, token || undefined);
  res.json(result);
});

app.delete('/api/webflow/assets/:assetId', async (req, res) => {
  const siteId = req.query.siteId as string;
  const token = siteId ? getTokenForSite(siteId) : null;
  const result = await deleteAsset(req.params.assetId, token || undefined);
  res.json(result);
});

// Bulk update alt text
app.post('/api/webflow/assets/bulk-alt', async (req, res) => {
  const { updates, siteId } = req.body as { updates: Array<{ assetId: string; altText: string }>; siteId?: string };
  const token = siteId ? getTokenForSite(siteId) : null;
  const results = [];
  for (const u of updates) {
    const r = await updateAsset(u.assetId, { altText: u.altText }, token || undefined);
    results.push({ assetId: u.assetId, ...r });
  }
  res.json(results);
});

// Bulk delete assets
app.post('/api/webflow/assets/bulk-delete', async (req, res) => {
  const { assetIds, siteId } = req.body as { assetIds: string[]; siteId?: string };
  const token = siteId ? getTokenForSite(siteId) : null;
  const results = [];
  for (const id of assetIds) {
    const r = await deleteAsset(id, token || undefined);
    results.push({ assetId: id, ...r });
  }
  res.json(results);
});

// --- Asset Audit ---
app.get('/api/webflow/audit/:siteId', async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const [assets, usageMap] = await Promise.all([
      listAssets(req.params.siteId, token),
      scanAssetUsage(req.params.siteId, token),
    ]);

    const issues: Array<{
      assetId: string;
      fileName: string;
      url?: string;
      fileSize: number;
      issues: string[];
      usedIn: string[];
    }> = [];

    // Pre-compute duplicate detection: group by file size
    const sizeGroups = new Map<number, typeof assets>();
    for (const asset of assets) {
      if (asset.size > 0) {
        const group = sizeGroups.get(asset.size) || [];
        group.push(asset);
        sizeGroups.set(asset.size, group);
      }
    }
    const duplicateIds = new Set<string>();
    for (const group of sizeGroups.values()) {
      if (group.length < 2) continue;
      // Same size — check for similar names (strip extension + normalize)
      const normalize = (n: string) => (n || '').replace(/\.[^.]+$/, '').replace(/[-_\s]+/g, '').toLowerCase();
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = normalize(group[i].displayName || group[i].originalFileName || '');
          const b = normalize(group[j].displayName || group[j].originalFileName || '');
          if (a === b || group[i].size === group[j].size) {
            duplicateIds.add(group[i].id);
            duplicateIds.add(group[j].id);
          }
        }
      }
    }

    // Pre-compute alt text quality: collect all alt texts to find duplicates
    const altTextCounts = new Map<string, number>();
    for (const asset of assets) {
      const alt = (asset.altText || '').trim().toLowerCase();
      if (alt) altTextCounts.set(alt, (altTextCounts.get(alt) || 0) + 1);
    }

    for (const asset of assets) {
      const assetIssues: string[] = [];
      const name = asset.displayName || asset.originalFileName || '';
      const ext = name.split('.').pop()?.toLowerCase();
      const alt = (asset.altText || '').trim();

      // Check for missing alt text
      if (!alt) {
        assetIssues.push('missing-alt');
      } else {
        // Alt text quality checks
        const altLower = alt.toLowerCase();
        const nameBase = name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').toLowerCase();
        if (alt.length < 10) {
          assetIssues.push('low-quality-alt');
        } else if (altLower.startsWith('image of') || altLower.startsWith('an image of') || altLower.startsWith('photo of')) {
          assetIssues.push('low-quality-alt');
        } else if (altLower === nameBase || altLower.replace(/\s+/g, '') === nameBase.replace(/\s+/g, '')) {
          assetIssues.push('low-quality-alt');
        } else if ((altTextCounts.get(altLower) || 0) > 1) {
          assetIssues.push('duplicate-alt');
        }
      }

      // Check for oversized files (>500KB)
      if (asset.size > 500 * 1024) {
        assetIssues.push('oversized');
      }
      // Check for unoptimized formats
      if (ext === 'png' && asset.size > 100 * 1024) {
        assetIssues.push('unoptimized-png');
      }
      if (ext === 'bmp' || ext === 'tiff' || ext === 'tif') {
        assetIssues.push('legacy-format');
      }
      // Check for potential duplicates
      if (duplicateIds.has(asset.id)) {
        assetIssues.push('duplicate');
      }

      // Check usage — primary match by assetId, fallback by URL containing the asset ID
      const usedIn: string[] = [];
      if (usageMap.has(asset.id)) usedIn.push(...usageMap.get(asset.id)!);
      for (const [key, refs] of usageMap.entries()) {
        if (key.includes(asset.id)) {
          for (const r of refs) {
            if (!usedIn.includes(r)) usedIn.push(r);
          }
        }
      }

      if (usedIn.length === 0) {
        assetIssues.push('unused');
      }

      if (assetIssues.length > 0 || usedIn.length === 0) {
        issues.push({
          assetId: asset.id,
          fileName: name,
          url: asset.hostedUrl || asset.url,
          fileSize: asset.size || 0,
          issues: assetIssues,
          usedIn: [...new Set(usedIn)],
        });
      }
    }

    res.json({
      totalAssets: assets.length,
      issueCount: issues.length,
      missingAlt: issues.filter(i => i.issues.includes('missing-alt')).length,
      oversized: issues.filter(i => i.issues.includes('oversized')).length,
      unused: issues.filter(i => i.issues.includes('unused')).length,
      duplicates: issues.filter(i => i.issues.includes('duplicate')).length,
      lowQualityAlt: issues.filter(i => i.issues.includes('low-quality-alt')).length,
      duplicateAlt: issues.filter(i => i.issues.includes('duplicate-alt')).length,
      issues,
    });
  } catch (e) {
    console.error('Audit error:', e);
    res.status(500).json({ error: 'Audit failed' });
  }
});

// --- Page Weight Dashboard ---
app.get('/api/webflow/page-weight/:siteId', async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const [assets, usageMap] = await Promise.all([
      listAssets(req.params.siteId, token),
      scanAssetUsage(req.params.siteId, token),
    ]);

    // Build asset lookup by ID
    const assetById = new Map(assets.map(a => [a.id, a]));

    // Invert the usageMap: for each page, collect all asset IDs used
    const pageAssets = new Map<string, Set<string>>();
    for (const [assetId, refs] of usageMap.entries()) {
      for (const ref of refs) {
        if (!pageAssets.has(ref)) pageAssets.set(ref, new Set());
        pageAssets.get(ref)!.add(assetId);
      }
    }

    // Build per-page stats
    const pages: Array<{
      page: string;
      totalSize: number;
      assetCount: number;
      assets: Array<{ id: string; name: string; size: number; contentType: string }>;
    }> = [];

    for (const [page, assetIds] of pageAssets.entries()) {
      let totalSize = 0;
      const pageAssetList: Array<{ id: string; name: string; size: number; contentType: string }> = [];
      for (const id of assetIds) {
        const asset = assetById.get(id);
        if (asset) {
          totalSize += asset.size || 0;
          pageAssetList.push({
            id: asset.id,
            name: asset.displayName || asset.originalFileName || '',
            size: asset.size || 0,
            contentType: asset.contentType || '',
          });
        }
      }
      pageAssetList.sort((a, b) => b.size - a.size);
      pages.push({ page, totalSize, assetCount: pageAssetList.length, assets: pageAssetList });
    }

    pages.sort((a, b) => b.totalSize - a.totalSize);

    res.json({
      totalPages: pages.length,
      totalAssetSize: assets.reduce((sum, a) => sum + (a.size || 0), 0),
      pages,
    });
  } catch {
    res.status(500).json({ error: 'Page weight analysis failed' });
  }
});

// --- SEO Audit ---
app.get('/api/webflow/seo-audit/:siteId', async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    if (!token) {
      console.error('SEO audit: No token available for site', req.params.siteId);
      return res.status(500).json({ error: 'No Webflow API token configured. Please link a workspace to this site in Settings, or set WEBFLOW_API_TOKEN environment variable.' });
    }
    const result = await runSeoAudit(req.params.siteId, token);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('SEO audit error:', msg);
    res.status(500).json({ error: `SEO audit failed: ${msg}` });
  }
});

// --- Sales Report (URL-based, no Webflow API needed) ---
app.post('/api/sales-report', async (req, res) => {
  try {
    const { url, maxPages } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    console.log(`[sales-report] Starting audit for ${url}`);
    const result = await runSalesAudit(url, maxPages || 25);

    // Save to disk
    const reportsDir = getDataDir('sales-reports');
    const id = `sr_${Date.now()}`;
    const report = { id, ...result };
    fs.writeFileSync(path.join(reportsDir, `${id}.json`), JSON.stringify(report, null, 2));

    res.json(report);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Sales report error:', msg);
    res.status(500).json({ error: `Sales report failed: ${msg}` });
  }
});

app.get('/api/sales-reports', (_req, res) => {
  try {
    const reportsDir = getDataDir('sales-reports');
    if (!fs.existsSync(reportsDir)) return res.json([]);
    const files = fs.readdirSync(reportsDir).filter(f => f.endsWith('.json')).sort().reverse();
    const summaries = files.map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(reportsDir, f), 'utf-8'));
        return { id: data.id, url: data.url, siteName: data.siteName, siteScore: data.siteScore, totalPages: data.totalPages, errors: data.errors, warnings: data.warnings, generatedAt: data.generatedAt };
      } catch { return null; }
    }).filter(Boolean);
    res.json(summaries);
  } catch { res.json([]); }
});

app.get('/api/sales-report/:id', (req, res) => {
  try {
    const reportsDir = getDataDir('sales-reports');
    const filePath = path.join(reportsDir, `${req.params.id}.json`);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Report not found' });
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    res.json(data);
  } catch { res.status(500).json({ error: 'Failed to load report' }); }
});

app.get('/api/sales-report/:id/html', (req, res) => {
  try {
    const reportsDir = getDataDir('sales-reports');
    const filePath = path.join(reportsDir, `${req.params.id}.json`);
    if (!fs.existsSync(filePath)) return res.status(404).send('Report not found');
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const html = renderSalesReportHTML(data);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch { res.status(500).send('Failed to render report'); }
});

// --- Competitor SEO Comparison ---
app.post('/api/competitor-compare', async (req, res) => {
  const { myUrl, competitorUrl, maxPages } = req.body as { myUrl: string; competitorUrl: string; maxPages?: number };
  if (!myUrl || !competitorUrl) return res.status(400).json({ error: 'myUrl and competitorUrl required' });
  const limit = Math.min(maxPages || 20, 30);
  try {
    console.log(`[competitor] Comparing ${myUrl} vs ${competitorUrl} (max ${limit} pages each)`);
    const [myAudit, theirAudit] = await Promise.all([
      runSalesAudit(myUrl, limit),
      runSalesAudit(competitorUrl, limit),
    ]);

    // Build comparison metrics
    const buildMetrics = (audit: typeof myAudit) => {
      const allIssues = [...audit.siteWideIssues, ...audit.pages.flatMap(p => p.issues)];
      const checks = new Map<string, number>();
      for (const i of allIssues) checks.set(i.check, (checks.get(i.check) || 0) + 1);

      // Compute averages
      const titles = audit.pages.map(p => {
        const titleIssue = p.issues.find(i => i.check === 'title');
        return titleIssue?.value?.length || 0;
      });
      const descs = audit.pages.map(p => {
        const descIssue = p.issues.find(i => i.check === 'meta-description');
        return descIssue?.value?.length || 0;
      });
      const pagesWithOG = audit.pages.filter(p => !p.issues.some(i => i.check === 'og-tags' && i.severity === 'error')).length;
      const pagesWithSchema = audit.pages.filter(p => !p.issues.some(i => i.check === 'structured-data')).length;
      const pagesWithH1 = audit.pages.filter(p => !p.issues.some(i => i.check === 'h1' && i.severity === 'error')).length;

      return {
        score: audit.siteScore,
        totalPages: audit.totalPages,
        errors: audit.errors,
        warnings: audit.warnings,
        infos: audit.infos,
        avgTitleLen: titles.length ? Math.round(titles.reduce((a, b) => a + b, 0) / titles.length) : 0,
        avgDescLen: descs.length ? Math.round(descs.reduce((a, b) => a + b, 0) / descs.length) : 0,
        ogCoverage: audit.totalPages ? Math.round((pagesWithOG / audit.totalPages) * 100) : 0,
        schemaCoverage: audit.totalPages ? Math.round((pagesWithSchema / audit.totalPages) * 100) : 0,
        h1Coverage: audit.totalPages ? Math.round((pagesWithH1 / audit.totalPages) * 100) : 0,
        issueCounts: Object.fromEntries(checks),
      };
    };

    const myMetrics = buildMetrics(myAudit);
    const theirMetrics = buildMetrics(theirAudit);

    // Identify advantages and disadvantages
    const advantages: string[] = [];
    const disadvantages: string[] = [];
    const opportunities: string[] = [];

    if (myMetrics.score > theirMetrics.score) advantages.push(`Higher overall SEO score (${myMetrics.score} vs ${theirMetrics.score})`);
    else if (myMetrics.score < theirMetrics.score) disadvantages.push(`Lower overall SEO score (${myMetrics.score} vs ${theirMetrics.score})`);

    if (myMetrics.errors < theirMetrics.errors) advantages.push(`Fewer SEO errors (${myMetrics.errors} vs ${theirMetrics.errors})`);
    else if (myMetrics.errors > theirMetrics.errors) disadvantages.push(`More SEO errors (${myMetrics.errors} vs ${theirMetrics.errors})`);

    if (myMetrics.ogCoverage > theirMetrics.ogCoverage) advantages.push(`Better Open Graph coverage (${myMetrics.ogCoverage}% vs ${theirMetrics.ogCoverage}%)`);
    else if (myMetrics.ogCoverage < theirMetrics.ogCoverage) {
      disadvantages.push(`Lower Open Graph coverage (${myMetrics.ogCoverage}% vs ${theirMetrics.ogCoverage}%)`);
      opportunities.push('Add Open Graph tags to improve social media sharing previews');
    }

    if (myMetrics.schemaCoverage > theirMetrics.schemaCoverage) advantages.push(`Better structured data coverage (${myMetrics.schemaCoverage}% vs ${theirMetrics.schemaCoverage}%)`);
    else if (myMetrics.schemaCoverage < theirMetrics.schemaCoverage) {
      disadvantages.push(`Lower structured data coverage (${myMetrics.schemaCoverage}% vs ${theirMetrics.schemaCoverage}%)`);
      opportunities.push('Add JSON-LD structured data to earn rich snippets in search results');
    }

    if (myMetrics.h1Coverage > theirMetrics.h1Coverage) advantages.push(`Better H1 tag coverage (${myMetrics.h1Coverage}% vs ${theirMetrics.h1Coverage}%)`);
    else if (myMetrics.h1Coverage < theirMetrics.h1Coverage) {
      disadvantages.push(`Lower H1 tag coverage (${myMetrics.h1Coverage}% vs ${theirMetrics.h1Coverage}%)`);
      opportunities.push('Ensure every page has a unique H1 heading');
    }

    if (myMetrics.totalPages > theirMetrics.totalPages * 1.5) advantages.push(`More indexed content (${myMetrics.totalPages} vs ${theirMetrics.totalPages} pages)`);
    else if (theirMetrics.totalPages > myMetrics.totalPages * 1.5) {
      disadvantages.push(`Less indexed content (${myMetrics.totalPages} vs ${theirMetrics.totalPages} pages)`);
      opportunities.push('Expand content strategy — competitor has significantly more pages');
    }

    // Check for issues competitor doesn't have
    for (const [check, count] of Object.entries(myMetrics.issueCounts)) {
      const theirCount = theirMetrics.issueCounts[check] || 0;
      if (count > 0 && theirCount === 0) {
        opportunities.push(`Fix "${check}" issues — competitor has none (you have ${count})`);
      }
    }

    res.json({
      mySite: { url: myAudit.url, name: myAudit.siteName, metrics: myMetrics, quickWins: myAudit.quickWins },
      competitor: { url: theirAudit.url, name: theirAudit.siteName, metrics: theirMetrics, quickWins: theirAudit.quickWins },
      advantages: advantages.slice(0, 8),
      disadvantages: disadvantages.slice(0, 8),
      opportunities: opportunities.slice(0, 8),
      comparedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Competitor compare error:', err);
    res.status(500).json({ error: 'Comparison failed' });
  }
});

// --- JSON-LD Schema Suggester (internal tool, not client-visible) ---
// Helper: build SchemaContext from workspace data for schema generation
function buildSchemaContext(siteId: string): { ctx: SchemaContext; pageKeywordMap?: { pagePath: string; primaryKeyword: string; secondaryKeywords: string[]; searchIntent?: string }[] } {
  const allWs = listWorkspaces();
  const ws = allWs.find(w => w.webflowSiteId === siteId);
  const ctx: SchemaContext = {};
  if (ws) {
    ctx.companyName = ws.name;
    ctx.liveDomain = ws.liveDomain;
    ctx.brandVoice = ws.brandVoice;
    ctx.businessContext = ws.keywordStrategy?.businessContext;
    ctx.siteKeywords = ws.keywordStrategy?.siteKeywords;
    ctx.logoUrl = ws.brandLogoUrl;
  }
  const pageKeywordMap = ws?.keywordStrategy?.pageMap?.map(p => ({
    pagePath: p.pagePath,
    primaryKeyword: p.primaryKeyword,
    secondaryKeywords: p.secondaryKeywords || [],
    searchIntent: p.searchIntent,
  }));
  return { ctx, pageKeywordMap };
}

app.get('/api/webflow/schema-suggestions/:siteId', async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const { ctx, pageKeywordMap } = buildSchemaContext(req.params.siteId);
    const result = await generateSchemaSuggestions(req.params.siteId, token, ctx, pageKeywordMap);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Schema suggester error:', msg, err);
    res.status(500).json({ error: `Schema suggestion failed: ${msg}` });
  }
});

// Load previously saved schema results from disk
app.get('/api/webflow/schema-snapshot/:siteId', (req, res) => {
  const snapshot = getSchemaSnapshot(req.params.siteId);
  if (!snapshot) return res.json(null);
  res.json(snapshot);
});

app.post('/api/webflow/schema-suggestions/:siteId/page', async (req, res) => {
  const { pageId } = req.body;
  if (!pageId) return res.status(400).json({ error: 'pageId required' });
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const { ctx } = buildSchemaContext(req.params.siteId);
    const result = await generateSchemaForPage(req.params.siteId, pageId, token, ctx);
    if (!result) return res.status(404).json({ error: 'Page not found' });
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Single-page schema error:', msg, err);
    res.status(500).json({ error: `Schema generation failed: ${msg}` });
  }
});

// --- Publish Schema to Webflow Page ---
app.post('/api/webflow/schema-publish/:siteId', async (req, res) => {
  const { pageId, schema, publishAfter } = req.body;
  if (!pageId || !schema) return res.status(400).json({ error: 'pageId and schema required' });
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const result = await publishSchemaToPage(req.params.siteId, pageId, schema, token);
    if (!result.success) return res.status(500).json(result);

    // Optionally publish the site so changes go live
    let published = false;
    if (publishAfter) {
      const pubResult = await publishSite(req.params.siteId, token);
      published = pubResult.success;
      if (!pubResult.success) {
        console.error('[schema-publish] Site publish failed:', pubResult.error);
      }
    }

    // Log to activity feed
    const pubWs = listWorkspaces().find(w => w.webflowSiteId === req.params.siteId);
    if (pubWs) {
      addActivity(pubWs.id, 'schema_published', 'Schema published to Webflow', `Page ${pageId.slice(0, 8)}… — ${published ? 'site published' : 'saved as draft'}`, { pageId });
    }

    res.json({ success: true, published });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Schema publish error:', msg, err);
    res.status(500).json({ error: `Schema publish failed: ${msg}` });
  }
});

// --- CMS Template Schema ---
app.post('/api/webflow/schema-cms-template/:siteId', async (req, res) => {
  const { collectionId } = req.body;
  if (!collectionId) return res.status(400).json({ error: 'collectionId required' });
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const { ctx } = buildSchemaContext(req.params.siteId);
    const result = await generateCmsTemplateSchema(req.params.siteId, collectionId, token, ctx);
    if (!result) return res.status(500).json({ error: 'Failed to generate CMS template schema' });
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('CMS template schema error:', msg, err);
    res.status(500).json({ error: `CMS template schema failed: ${msg}` });
  }
});

app.post('/api/webflow/schema-cms-template/:siteId/publish', async (req, res) => {
  const { pageId, templateString, publishAfter } = req.body;
  if (!pageId || !templateString) return res.status(400).json({ error: 'pageId and templateString required' });
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const result = await publishRawSchemaToPage(req.params.siteId, pageId, templateString, token);
    if (!result.success) return res.status(500).json(result);

    let published = false;
    if (publishAfter) {
      const pubResult = await publishSite(req.params.siteId, token);
      published = pubResult.success;
    }

    res.json({ success: true, published });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('CMS template publish error:', msg, err);
    res.status(500).json({ error: `CMS template publish failed: ${msg}` });
  }
});

// --- List CMS template pages (pages with collectionId) ---
app.get('/api/webflow/cms-template-pages/:siteId', async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const allPages = await listPages(req.params.siteId, token);
    const collections = await listCollections(req.params.siteId, token);
    const collMap = new Map(collections.map(c => [c.id, c]));

    const templatePages = allPages
      .filter(p => p.collectionId)
      .map(p => ({
        pageId: p.id,
        pageTitle: p.title,
        slug: p.slug,
        collectionId: p.collectionId,
        collectionName: collMap.get(p.collectionId!)?.displayName || '',
        collectionSlug: collMap.get(p.collectionId!)?.slug || '',
      }));

    res.json(templatePages);
  } catch (err) {
    console.error('CMS template pages error:', err);
    res.json([]);
  }
});

// --- PageSpeed / Core Web Vitals ---
app.get('/api/webflow/pagespeed/:siteId', async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const strategy = (req.query.strategy as 'mobile' | 'desktop') || 'mobile';
    const maxPages = parseInt(req.query.maxPages as string) || 5;
    const result = await runSiteSpeed(req.params.siteId, strategy, maxPages, token);
    res.json(result);
  } catch (err) {
    console.error('PageSpeed error:', err);
    res.status(500).json({ error: 'PageSpeed analysis failed' });
  }
});

// Single-page PageSpeed test (resolves URL from siteId + slug)
app.post('/api/webflow/pagespeed-single/:siteId', async (req, res) => {
  try {
    const { siteId } = req.params;
    const { pageSlug, strategy, pageTitle } = req.body;
    const token = getTokenForSite(siteId) || process.env.WEBFLOW_API_TOKEN || '';

    // Resolve subdomain to build full URL
    const siteRes = await fetch(`https://api.webflow.com/v2/sites/${siteId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!siteRes.ok) return res.status(400).json({ error: 'Could not resolve site URL' });
    const siteData = await siteRes.json() as { shortName?: string };
    const subdomain = siteData.shortName;
    if (!subdomain) return res.status(400).json({ error: 'Site has no subdomain' });

    const url = pageSlug ? `https://${subdomain}.webflow.io/${pageSlug}` : `https://${subdomain}.webflow.io`;
    const result = await runSinglePageSpeed(url, strategy || 'mobile', pageTitle || '');
    if (!result) return res.status(502).json({ error: 'PageSpeed API returned no data. It may be rate-limited.' });
    res.json(result);
  } catch (err) {
    console.error('Single PageSpeed error:', err);
    res.status(500).json({ error: 'PageSpeed analysis failed' });
  }
});

// --- Reports & Snapshots ---
// Save audit as snapshot (run audit + save + extract logo)
app.post('/api/reports/:siteId/save', async (req, res) => {
  try {
    const { siteId } = req.params;
    const { siteName } = req.body;
    const token = getTokenForSite(siteId) || undefined;
    const audit = await runSeoAudit(siteId, token);

    // Extract client logo from their site
    let logoUrl: string | undefined;
    if (audit.totalPages > 0) {
      try {
        const siteRes = await fetch(`https://api.webflow.com/v2/sites/${siteId}`, {
          headers: { Authorization: `Bearer ${token || process.env.WEBFLOW_API_TOKEN}`, 'Content-Type': 'application/json' },
        });
        if (siteRes.ok) {
          const siteData = await siteRes.json() as { shortName?: string };
          if (siteData.shortName) {
            logoUrl = (await extractSiteLogo(`https://${siteData.shortName}.webflow.io`)) || undefined;
          }
        }
      } catch { /* logo extraction is best-effort */ }
    }

    const snapshot = saveSnapshot(siteId, siteName || siteId, audit, logoUrl);
    // Log activity
    const auditWs = listWorkspaces().find(w => w.webflowSiteId === siteId);
    if (auditWs) {
      addActivity(auditWs.id, 'audit_completed', `Site audit completed — score ${audit.siteScore}`,
        `${audit.totalPages} pages scanned, ${audit.errors} errors, ${audit.warnings} warnings`,
        { score: audit.siteScore, previousScore: snapshot.previousScore });
    }
    res.json({ id: snapshot.id, createdAt: snapshot.createdAt, siteScore: audit.siteScore, previousScore: snapshot.previousScore });
  } catch (err) {
    console.error('Report save error:', err);
    res.status(500).json({ error: 'Failed to save report' });
  }
});

// Save existing audit data as snapshot (no re-run)
app.post('/api/reports/:siteId/snapshot', (req, res) => {
  try {
    const { siteId } = req.params;
    const { siteName, audit } = req.body;
    if (!audit) return res.status(400).json({ error: 'Missing audit data' });
    const snapshot = saveSnapshot(siteId, siteName || siteId, audit);
    res.json({ id: snapshot.id, createdAt: snapshot.createdAt, siteScore: audit.siteScore });
  } catch (err) {
    console.error('Snapshot save error:', err);
    res.status(500).json({ error: 'Failed to save snapshot' });
  }
});

// Get latest full snapshot for a site (used by admin SeoAudit to restore after deploy)
app.get('/api/reports/:siteId/latest', (req, res) => {
  const latest = getLatestSnapshot(req.params.siteId);
  if (!latest) return res.json(null);
  res.json(latest);
});

// List snapshots for a site
app.get('/api/reports/:siteId/history', (req, res) => {
  const history = listSnapshots(req.params.siteId);
  res.json(history);
});

// Get a specific snapshot
app.get('/api/reports/snapshot/:id', (req, res) => {
  const snapshot = getSnapshot(req.params.id);
  if (!snapshot) return res.status(404).json({ error: 'Report not found' });
  res.json(snapshot);
});

// --- Action Items ---
app.get('/api/reports/snapshot/:id/actions', (req, res) => {
  res.json(getActionItems(req.params.id));
});

app.post('/api/reports/snapshot/:id/actions', (req, res) => {
  const { title, description, priority, category } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  const item = addActionItem(req.params.id, {
    title,
    description: description || '',
    priority: priority || 'medium',
    category,
  });
  if (!item) return res.status(404).json({ error: 'Snapshot not found' });
  res.json(item);
});

app.patch('/api/reports/snapshot/:id/actions/:actionId', (req, res) => {
  const item = updateActionItem(req.params.id, req.params.actionId, req.body);
  if (!item) return res.status(404).json({ error: 'Action item not found' });
  res.json(item);
});

app.delete('/api/reports/snapshot/:id/actions/:actionId', (req, res) => {
  const ok = deleteActionItem(req.params.id, req.params.actionId);
  if (!ok) return res.status(404).json({ error: 'Action item not found' });
  res.json({ success: true });
});

// Public: HTML report page (no auth required)
app.get('/report/:id', (req, res) => {
  const snapshot = getSnapshot(req.params.id);
  if (!snapshot) return res.status(404).send('<h1>Report not found</h1>');
  res.type('html').send(renderReportHTML(snapshot));
});

// Public: JSON report data (no auth required)
app.get('/api/public/report/:id', (req, res) => {
  const snapshot = getSnapshot(req.params.id);
  if (!snapshot) return res.status(404).json({ error: 'Report not found' });
  res.json(snapshot);
});

// Public: Latest audit for a site (client dashboard)
app.get('/api/public/client/:siteId', (req, res) => {
  const latest = getLatestSnapshot(req.params.siteId);
  if (!latest) return res.status(404).json({ error: 'No audits found for this site' });
  const history = listSnapshots(req.params.siteId);
  res.json({ latest: latest.audit, siteName: latest.siteName, history });
});

// Audit report HTML page (renamed from /client/ to avoid conflict with SPA client dashboard)
app.get('/report/audit/:siteId', (req, res) => {
  const latest = getLatestSnapshot(req.params.siteId);
  if (!latest) return res.status(404).send('<h1>No audits found</h1>');
  res.type('html').send(renderReportHTML(latest));
});

// --- Page SEO Editing ---
app.get('/api/webflow/pages/:siteId', async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const allPages = await listPages(req.params.siteId, token);
    const published = filterPublishedPages(allPages);
    console.log(`Pages: ${allPages.length} total, ${published.length} published (filtered out ${allPages.length - published.length} drafts/collections/unpublished)`);
    res.json(published);
  } catch (err) {
    console.error('Pages list error:', err);
    res.status(500).json({ error: 'Failed to list pages' });
  }
});

app.put('/api/webflow/pages/:pageId/seo', async (req, res) => {
  try {
    const { siteId, seo, openGraph, title } = req.body;
    const token = siteId ? (getTokenForSite(siteId) || undefined) : undefined;
    const result = await updatePageSeo(req.params.pageId, { seo, openGraph, title }, token);
    // Log activity
    if (siteId) {
      const seoWs = listWorkspaces().find(w => w.webflowSiteId === siteId);
      if (seoWs) {
        const fields = [seo?.title && 'title', seo?.description && 'description', openGraph && 'OG'].filter(Boolean).join(', ');
        addActivity(seoWs.id, 'seo_updated', `Updated SEO ${fields} for a page`, undefined, { pageId: req.params.pageId });
      }
    }
    res.json(result);
  } catch (err) {
    console.error('Page SEO update error:', err);
    res.status(500).json({ error: 'Failed to update page SEO' });
  }
});

app.post('/api/webflow/publish/:siteId', async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const result = await publishSite(req.params.siteId, token);
    res.json(result);
  } catch (err) {
    console.error('Publish error:', err);
    res.status(500).json({ error: 'Failed to publish site' });
  }
});

// --- Dead Link Checker ---
app.get('/api/webflow/link-check/:siteId', async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const result = await checkSiteLinks(req.params.siteId, token);
    res.json(result);
  } catch (err) {
    console.error('Link check error:', err);
    res.status(500).json({ error: 'Link check failed' });
  }
});

// --- Redirect Scanner ---
app.get('/api/webflow/redirect-scan/:siteId', async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    // Resolve live domain + GSC property from workspace
    const allWs = listWorkspaces();
    const ws = allWs.find(w => w.webflowSiteId === req.params.siteId);

    // Fetch GSC ghost URLs — pages Google indexes that may no longer exist
    let gscGhostUrls: Array<{ url: string; path: string; clicks: number; impressions: number }> | undefined;
    if (ws?.gscPropertyUrl) {
      try {
        const gscPages = await getAllGscPages(ws.id, ws.gscPropertyUrl, 90);
        if (gscPages.length > 0) {
          gscGhostUrls = gscPages.map(p => {
            try {
              const parsed = new URL(p.page);
              return { url: p.page, path: parsed.pathname, clicks: p.clicks, impressions: p.impressions };
            } catch { return null; }
          }).filter(Boolean) as typeof gscGhostUrls;
          console.log(`[redirect-scan] Found ${gscPages.length} GSC pages to cross-check`);
        }
      } catch (err) {
        console.log('[redirect-scan] GSC ghost URL fetch skipped:', err instanceof Error ? err.message : String(err));
      }
    }

    const result = await scanRedirects(req.params.siteId, token, ws?.liveDomain, gscGhostUrls);
    // Persist to disk so results survive deploys
    saveRedirectSnapshot(req.params.siteId, result);

    // Log to activity feed
    if (ws) {
      addActivity(ws.id, 'redirects_scanned', 'Redirect scan completed', `${result.summary.totalPages} pages scanned — ${result.summary.redirecting} redirects, ${result.summary.notFound} not found, ${result.chains.length} chains`);
    }

    res.json(result);
  } catch (err) {
    console.error('Redirect scan error:', err);
    res.status(500).json({ error: 'Redirect scan failed' });
  }
});

// Load previously saved redirect scan results from disk
app.get('/api/webflow/redirect-snapshot/:siteId', (req, res) => {
  const snapshot = getRedirectSnapshot(req.params.siteId);
  if (!snapshot) return res.json(null);
  res.json(snapshot);
});

// --- Internal Linking Suggestions ---
app.get('/api/webflow/internal-links/:siteId', async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const workspaceId = req.query.workspaceId as string | undefined;
    const result = await analyzeInternalLinks(req.params.siteId, workspaceId, token);
    res.json(result);
  } catch (err) {
    console.error('Internal links error:', err);
    res.status(500).json({ error: 'Internal link analysis failed' });
  }
});

// --- AI SEO Rewrite ---
app.post('/api/webflow/seo-rewrite', async (req, res) => {
  const { pageTitle, currentSeoTitle, currentDescription, pageContent, siteContext, field, workspaceId, pagePath } = req.body;
  if (!pageTitle) return res.status(400).json({ error: 'pageTitle required' });

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  // Build shared keyword strategy + brand voice context
  const { keywordBlock: keywordContext, brandVoiceBlock } = buildSeoContext(workspaceId, pagePath);

  try {
    let prompt: string;
    if (field === 'description') {
      prompt = `You are an expert SEO copywriter. Write a compelling meta description for this web page.

Page title: ${pageTitle}
Current meta description: ${currentDescription || '(none)'}
Site context: ${siteContext || 'N/A'}
Page content excerpt: ${pageContent ? pageContent.slice(0, 1500) : 'N/A'}${keywordContext}${brandVoiceBlock}

Requirements:
- Between 150-160 characters (hard limit: 160)
- Include a clear call to action or value proposition
- Natural, not keyword-stuffed
- Compelling enough to increase click-through rate from search results
- If keyword strategy is provided, naturally incorporate the primary keyword

Return ONLY the meta description text, nothing else.`;
    } else {
      prompt = `You are an expert SEO copywriter. Write an optimized SEO title tag for this web page.

Page title: ${pageTitle}
Current SEO title: ${currentSeoTitle || '(none)'}
Current meta description: ${currentDescription || '(none)'}
Site context: ${siteContext || 'N/A'}
Page content excerpt: ${pageContent ? pageContent.slice(0, 1500) : 'N/A'}${keywordContext}${brandVoiceBlock}

Requirements:
- Between 50-60 characters (hard limit: 60)
- Front-load the most important keywords
- Include brand name at end if appropriate (use pipe separator: |)
- Compelling and descriptive
- If keyword strategy is provided, front-load the primary keyword

Return ONLY the title tag text, nothing else.`;
    }

    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.7,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      return res.status(500).json({ error: `OpenAI error: ${errText.slice(0, 200)}` });
    }

    const aiData = await aiRes.json() as { choices?: Array<{ message?: { content?: string } }> };
    let text = aiData.choices?.[0]?.message?.content?.trim() || '';
    // Strip surrounding quotes if the model wrapped its output
    text = text.replace(/^["']|["']$/g, '');
    // Enforce hard character limits
    const maxLen = field === 'description' ? 160 : 60;
    if (text.length > maxLen) {
      // Truncate at last word boundary before the limit
      const truncated = text.slice(0, maxLen);
      const lastSpace = truncated.lastIndexOf(' ');
      text = lastSpace > maxLen * 0.6 ? truncated.slice(0, lastSpace) : truncated;
    }
    res.json({ text, field });
  } catch (err) {
    console.error('SEO rewrite error:', err);
    res.status(500).json({ error: 'AI rewrite failed' });
  }
});

// --- Bulk AI SEO Fix ---
app.post('/api/webflow/seo-bulk-fix/:siteId', async (req, res) => {
  const { pages, field, workspaceId } = req.body as { pages: Array<{ pageId: string; title: string; slug?: string; currentSeoTitle?: string; currentDescription?: string }>; field: 'title' | 'description'; workspaceId?: string };
  if (!pages?.length) return res.status(400).json({ error: 'pages required' });

  const openaiKey = process.env.OPENAI_API_KEY;
  const siteId = req.params.siteId;
  const token = getTokenForSite(siteId) || undefined;

  if (!openaiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  const results = [];
  for (const page of pages) {
    try {
      const { keywordBlock, brandVoiceBlock: bvBlock } = buildSeoContext(workspaceId, page.slug ? `/${page.slug}` : undefined);
      const prompt = field === 'description'
        ? `Write a compelling meta description (150-160 chars max) for a page titled "${page.title}". Current description: "${page.currentDescription || 'none'}".${keywordBlock}${bvBlock}\nReturn ONLY the text.`
        : `Write an SEO title tag (50-60 chars max) for a page titled "${page.title}". Current SEO title: "${page.currentSeoTitle || 'none'}".${keywordBlock}${bvBlock}\nReturn ONLY the text.`;

      const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 200,
          temperature: 0.7,
        }),
      });
      const aiData = await aiRes.json() as { choices?: Array<{ message?: { content?: string } }> };
      let text = aiData.choices?.[0]?.message?.content?.trim() || '';
      // Strip surrounding quotes and enforce character limits
      text = text.replace(/^["']|["']$/g, '');
      const maxLen = field === 'description' ? 160 : 60;
      if (text.length > maxLen) {
        const truncated = text.slice(0, maxLen);
        const lastSpace = truncated.lastIndexOf(' ');
        text = lastSpace > maxLen * 0.6 ? truncated.slice(0, lastSpace) : truncated;
      }

      if (text) {
        const seoFields = field === 'description'
          ? { seo: { description: text } }
          : { seo: { title: text } };
        await updatePageSeo(page.pageId, seoFields, token);
        results.push({ pageId: page.pageId, text, applied: true });
      } else {
        results.push({ pageId: page.pageId, text: '', applied: false, error: 'Empty AI response' });
      }
    } catch (err) {
      results.push({ pageId: page.pageId, text: '', applied: false, error: String(err) });
    }
  }

  res.json({ results, field });
});

// --- Fetch page HTML body text (for keyword analysis) ---
app.get('/api/webflow/page-html/:siteId', async (req, res) => {
  const { siteId } = req.params;
  const pagePath = req.query.path as string;
  if (!pagePath) return res.status(400).json({ error: 'path query param required' });
  const token = getTokenForSite(siteId) || undefined;
  try {
    const subdomain = await getSiteSubdomain(siteId, token);
    if (!subdomain) return res.status(400).json({ error: 'Could not resolve site subdomain' });
    const url = `https://${subdomain}.webflow.io${pagePath}`;
    const htmlRes = await fetch(url, { redirect: 'follow' });
    if (!htmlRes.ok) return res.status(htmlRes.status).json({ error: `Failed to fetch page: ${htmlRes.status}` });
    const html = await htmlRes.text();
    // Extract body text: strip tags, scripts, styles
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const body = bodyMatch ? bodyMatch[1] : html;
    const text = body
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 8000);
    res.json({ text });
  } catch (e) {
    console.error('Page HTML fetch error:', e);
    res.status(500).json({ error: 'Failed to fetch page content' });
  }
});

// --- Per-Page SEO Copy Generator ---
app.post('/api/webflow/seo-copy', async (req, res) => {
  const { pagePath, pageTitle, currentSeoTitle, currentDescription, currentH1, pageContent, workspaceId } = req.body;
  if (!pagePath || !workspaceId) return res.status(400).json({ error: 'pagePath and workspaceId required' });

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  // Build full context: keywords + brand voice + keyword map
  const { keywordBlock, brandVoiceBlock, strategy } = buildSeoContext(workspaceId, pagePath);
  const kwMapContext = buildKeywordMapContext(workspaceId);

  // If no page content was passed, try to fetch it from the live domain
  let content = pageContent || '';
  if (!content) {
    const ws = getWorkspace(workspaceId);
    const domain = ws?.liveDomain;
    if (domain) {
      try {
        const url = `https://${domain}${pagePath === '/' ? '' : pagePath}`;
        const r = await fetch(url, { headers: { 'User-Agent': 'AssetDashboard-SEOCopy/1.0' }, signal: AbortSignal.timeout(10000) });
        if (r.ok) {
          const html = await r.text();
          const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
          const body = bodyMatch ? bodyMatch[1] : html;
          content = body
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[\s\S]*?<\/nav>/gi, '')
            .replace(/<footer[\s\S]*?<\/footer>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 4000);
        }
      } catch { /* non-critical — proceed without content */ }
    }
  }

  // Find this page's keyword data
  const pageKw = strategy?.pageMap?.find(
    p => p.pagePath === pagePath || pagePath.includes(p.pagePath) || p.pagePath.includes(pagePath)
  );

  const prompt = `You are an expert SEO copywriter. Generate optimized SEO copy for this specific web page.

PAGE: ${pagePath}
Current title: ${pageTitle || '(none)'}
Current SEO title: ${currentSeoTitle || '(same as title)'}
Current meta description: ${currentDescription || '(none)'}
Current H1: ${currentH1 || '(none)'}
${pageKw ? `Primary keyword: "${pageKw.primaryKeyword}"
Secondary keywords: ${pageKw.secondaryKeywords?.join(', ') || 'none'}
Search intent: ${pageKw.searchIntent || 'unknown'}
${pageKw.currentPosition ? `Current Google position: #${pageKw.currentPosition.toFixed(0)}` : ''}
${pageKw.impressions ? `Monthly impressions: ${pageKw.impressions}` : ''}` : ''}
${content ? `\nPage content:\n${content.slice(0, 3000)}` : ''}${keywordBlock}${brandVoiceBlock}${kwMapContext}

Generate optimized copy in this exact JSON format:
{
  "seoTitle": "Optimized SEO title tag (50-60 chars, front-load primary keyword)",
  "metaDescription": "Compelling meta description (150-160 chars, include CTA, naturally incorporate keywords)",
  "h1": "Optimized H1 heading (clear, keyword-rich, matches search intent)",
  "introParagraph": "Rewritten opening paragraph (2-3 sentences, hook the reader, incorporate primary keyword naturally within first sentence, set clear expectations for the page content)",
  "internalLinkSuggestions": [
    { "targetPath": "/page-path", "anchorText": "suggested link text", "context": "Where/why to place this link" }
  ],
  "changes": [
    "Brief bullet explaining each change you made and why it will improve rankings"
  ]
}

CRITICAL RULES:
- PRESERVE the existing brand voice and tone exactly — do NOT make it sound generic or corporate
- Every piece of copy must sound like it was written by the same person/team who wrote the existing content
- Incorporate keywords NATURALLY — never stuff or force them
- The intro paragraph should feel like a natural improvement, not a complete rewrite from scratch
- Internal link suggestions should reference real pages from the keyword map
- Changes array should explain your reasoning so the team can learn

Return ONLY valid JSON, no markdown fences.`;

  try {
    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are an expert SEO copywriter who preserves brand voice while optimizing for search. Return valid JSON only.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 1500,
        temperature: 0.6,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      return res.status(500).json({ error: `OpenAI error: ${errText.slice(0, 200)}` });
    }

    const aiData = await aiRes.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = aiData.choices?.[0]?.message?.content?.trim() || '{}';
    const cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '');

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: 'AI returned invalid JSON', raw: raw.slice(0, 500) });
    }

    // Enforce character limits
    if (parsed.seoTitle && parsed.seoTitle.length > 60) {
      const t = parsed.seoTitle.slice(0, 60);
      const ls = t.lastIndexOf(' ');
      parsed.seoTitle = ls > 36 ? t.slice(0, ls) : t;
    }
    if (parsed.metaDescription && parsed.metaDescription.length > 160) {
      const t = parsed.metaDescription.slice(0, 160);
      const ls = t.lastIndexOf(' ');
      parsed.metaDescription = ls > 96 ? t.slice(0, ls) : t;
    }

    res.json(parsed);
  } catch (err) {
    console.error('SEO copy generator error:', err);
    res.status(500).json({ error: 'SEO copy generation failed' });
  }
});

// --- AI Keyword Analysis ---
app.post('/api/webflow/keyword-analysis', async (req, res) => {
  const { pageTitle, seoTitle, metaDescription, pageContent, slug, siteContext, workspaceId } = req.body;
  if (!pageTitle) return res.status(400).json({ error: 'pageTitle required' });

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  const { keywordBlock, brandVoiceBlock: bvBlock2 } = buildSeoContext(workspaceId, slug ? `/${slug}` : undefined);
  const kwMapContext = buildKeywordMapContext(workspaceId);

  try {
    const prompt = `You are an expert SEO strategist and keyword researcher. Analyze this web page and provide a comprehensive keyword analysis.

Page title: ${pageTitle}
SEO title: ${seoTitle || '(same as page title)'}
Meta description: ${metaDescription || '(none)'}
URL slug: /${slug || ''}
Site context: ${siteContext || 'N/A'}
Page content excerpt: ${pageContent ? pageContent.slice(0, 3000) : 'N/A'}${keywordBlock}${bvBlock2}${kwMapContext}

Provide your analysis as a JSON object with exactly these fields:
{
  "primaryKeyword": "the single best target keyword for this page",
  "primaryKeywordPresence": { "inTitle": true/false, "inMeta": true/false, "inContent": true/false, "inSlug": true/false },
  "secondaryKeywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "longTailKeywords": ["long tail phrase 1", "long tail phrase 2", "long tail phrase 3"],
  "searchIntent": "informational | transactional | navigational | commercial",
  "searchIntentConfidence": 0.0-1.0,
  "contentGaps": ["topic or angle the page should cover but doesn't"],
  "competitorKeywords": ["keywords competitors likely target for similar pages"],
  "optimizationScore": 0-100,
  "optimizationIssues": ["specific actionable issues with keyword optimization"],
  "recommendations": ["specific actionable recommendation 1", "recommendation 2", "recommendation 3"],
  "estimatedDifficulty": "low | medium | high",
  "topicCluster": "the broader topic cluster this page belongs to"
}

Return ONLY valid JSON, no markdown, no explanation.`;

    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1000,
        temperature: 0.4,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      return res.status(500).json({ error: `OpenAI error: ${errText.slice(0, 200)}` });
    }

    const aiData = await aiRes.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = aiData.choices?.[0]?.message?.content?.trim() || '';
    try {
      const analysis = JSON.parse(raw);
      res.json(analysis);
    } catch {
      res.json({ error: 'Failed to parse AI response', raw: raw.slice(0, 500) });
    }
  } catch (err) {
    console.error('Keyword analysis error:', err);
    res.status(500).json({ error: 'Keyword analysis failed' });
  }
});

// --- AI Content Score ---
app.post('/api/webflow/content-score', async (req, res) => {
  const { pageContent, pageTitle, seoTitle, metaDescription } = req.body;
  if (!pageContent && !pageTitle) return res.status(400).json({ error: 'pageContent or pageTitle required' });

  try {
    // Compute readability metrics server-side (no AI needed)
    const text = (pageContent || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const sentences = text.split(/[.!?]+/).filter((s: string) => s.trim().length > 5);
    const words = text.split(/\s+/).filter((w: string) => w.length > 0);
    const syllables = words.reduce((sum: number, w: string) => {
      const s = w.toLowerCase().replace(/[^a-z]/g, '');
      const count = s.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').match(/[aeiouy]{1,2}/g);
      return sum + Math.max(1, count ? count.length : 1);
    }, 0);

    const avgWordsPerSentence = sentences.length > 0 ? words.length / sentences.length : 0;
    const avgSyllablesPerWord = words.length > 0 ? syllables / words.length : 0;
    const fleschKincaid = sentences.length > 0
      ? Math.max(0, Math.min(100, 206.835 - 1.015 * avgWordsPerSentence - 84.6 * avgSyllablesPerWord))
      : 0;

    // Heading structure
    const headings = (pageContent || '').match(/<h[1-6][^>]*>.*?<\/h[1-6]>/gi) || [];
    const h1Count = headings.filter((h: string) => h.startsWith('<h1')).length;
    const h2Count = headings.filter((h: string) => h.startsWith('<h2')).length;
    const headingTexts = headings.map((h: string) => h.replace(/<[^>]+>/g, '').trim());

    // Word frequency (top keywords from content)
    const stopWords = new Set(['the','a','an','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','could','should','may','might','shall','can','to','of','in','for','on','with','at','by','from','as','into','through','during','before','after','above','below','between','out','off','over','under','again','further','then','once','here','there','when','where','why','how','all','both','each','few','more','most','other','some','such','no','nor','not','only','own','same','so','than','too','very','and','but','or','if','this','that','these','those','it','its','i','we','you','they','them','their','my','your','our','his','her','what','which','who','whom']);
    const wordFreq: Record<string, number> = {};
    words.forEach((w: string) => {
      const lower = w.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (lower.length > 2 && !stopWords.has(lower)) {
        wordFreq[lower] = (wordFreq[lower] || 0) + 1;
      }
    });
    const topKeywords = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([word, count]) => ({ word, count, density: +(count / words.length * 100).toFixed(2) }));

    // Title analysis
    const titleLength = (seoTitle || pageTitle || '').length;
    const descLength = (metaDescription || '').length;

    res.json({
      wordCount: words.length,
      sentenceCount: sentences.length,
      avgWordsPerSentence: +avgWordsPerSentence.toFixed(1),
      readabilityScore: +fleschKincaid.toFixed(1),
      readabilityGrade: fleschKincaid >= 60 ? 'Easy' : fleschKincaid >= 30 ? 'Moderate' : 'Difficult',
      headings: { total: headings.length, h1: h1Count, h2: h2Count, texts: headingTexts },
      topKeywords,
      titleLength,
      descLength,
      titleOk: titleLength >= 30 && titleLength <= 60,
      descOk: descLength >= 120 && descLength <= 160,
    });
  } catch (err) {
    console.error('Content score error:', err);
    res.status(500).json({ error: 'Content scoring failed' });
  }
});

// --- AI Alt Text Generation for existing assets ---
app.post('/api/webflow/generate-alt/:assetId', async (req, res) => {
  const { imageUrl, siteId } = req.body;
  if (!imageUrl) return res.status(400).json({ error: 'imageUrl required' });

  try {
    // Build context from pages that use this image
    let context = '';
    if (siteId) {
      try {
        const tkn = getTokenForSite(siteId) || undefined;
        const pages = await listPages(siteId, tkn);
        const assetId = req.params.assetId;
        const contextParts: string[] = [];

        for (const page of pages.slice(0, 20)) {
          try {
            const dom = await getPageDom(page.id, tkn);
            if (dom.includes(assetId) || dom.includes(imageUrl)) {
              // Extract only nearby text: find the asset reference, grab surrounding text
              const plainText = dom.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
              const idx = plainText.indexOf(assetId) !== -1
                ? plainText.indexOf(assetId)
                : plainText.indexOf(imageUrl.split('/').pop() || '');
              const start = Math.max(0, idx - 100);
              const snippet = plainText.slice(start, start + 200).trim();
              contextParts.push(`Page "${page.title}": ${snippet}`);
              if (contextParts.length >= 2) break;
            }
          } catch { /* skip */ }
        }

        if (contextParts.length > 0) {
          context = contextParts.join('\n');
        } else {
          // Fallback: use site name as minimal context
          const sites = await listSites(tkn);
          const site = sites.find(s => s.id === siteId);
          if (site) context = `Website: ${site.displayName}`;
        }
      } catch {
        // Context fetch failed, proceed without it
      }
    }

    // Download the image to a temp file
    const response = await fetch(imageUrl);
    const buffer = Buffer.from(await response.arrayBuffer());
    const ext = path.extname(imageUrl).split('?')[0] || '.jpg';
    const tmpPath = `/tmp/alt_gen_${Date.now()}${ext}`;
    fs.writeFileSync(tmpPath, buffer);

    const altText = await generateAltText(tmpPath, context || undefined);
    fs.unlinkSync(tmpPath);

    if (altText) {
      // Also update in Webflow
      const altToken = siteId ? (getTokenForSite(siteId) || undefined) : undefined;
      const writeResult = await updateAsset(req.params.assetId, { altText }, altToken);
      if (!writeResult.success) {
        console.error(`Alt text generated but Webflow write-back failed for ${req.params.assetId}:`, writeResult.error);
        res.json({ altText, updated: false, writeError: writeResult.error });
      } else {
        console.log(`Alt text generated and saved for ${req.params.assetId}: "${altText}"`);
        res.json({ altText, updated: true });
      }
    } else {
      console.warn(`Alt text generation returned null for ${req.params.assetId}`);
      res.json({ altText: null, updated: false });
    }
  } catch (e) {
    console.error('Generate alt error:', e);
    res.status(500).json({ error: 'Failed to generate alt text' });
  }
});

// --- Bulk AI Alt Text Generation (fetches context once) ---
app.post('/api/webflow/bulk-generate-alt', async (req, res) => {
  const { assets, siteId } = req.body as {
    assets: Array<{ assetId: string; imageUrl: string }>;
    siteId?: string;
  };
  if (!assets?.length) return res.status(400).json({ error: 'assets required' });

  const token = siteId ? (getTokenForSite(siteId) || undefined) : undefined;

  // Fetch site context ONCE for all images
  let siteContext = '';
  if (siteId) {
    try {
      const sites = await listSites(token);
      const site = sites.find(s => s.id === siteId);
      if (site) siteContext = `Website: ${site.displayName}`;
    } catch { /* proceed without context */ }
  }

  // Build a mapping of assetId → page context by scanning pages once
  const assetContextMap = new Map<string, string>();
  if (siteId) {
    try {
      const pages = await listPages(siteId, token);
      for (const page of pages.slice(0, 15)) {
        try {
          const dom = await getPageDom(page.id, token);
          const plainText = dom.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          for (const asset of assets) {
            if (assetContextMap.has(asset.assetId)) continue; // already have context
            if (dom.includes(asset.assetId) || dom.includes(asset.imageUrl)) {
              const idx = plainText.indexOf(asset.assetId) !== -1
                ? plainText.indexOf(asset.assetId)
                : plainText.indexOf(asset.imageUrl.split('/').pop() || '');
              const start = Math.max(0, idx - 100);
              const snippet = plainText.slice(start, start + 200).trim();
              assetContextMap.set(asset.assetId, `Page "${page.title}": ${snippet}`);
            }
          }
        } catch { /* skip page */ }
      }
    } catch { /* proceed without page context */ }
  }

  // Stream NDJSON progress events as each image is processed
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data: Record<string, unknown>) => {
    res.write(JSON.stringify(data) + '\n');
  };

  send({ type: 'status', message: 'Processing images...', done: 0, total: assets.length });

  let done = 0;
  for (const asset of assets) {
    try {
      const response = await fetch(asset.imageUrl);
      if (!response.ok) {
        done++;
        send({ type: 'result', assetId: asset.assetId, altText: null, updated: false, error: `Download failed: ${response.status}`, done, total: assets.length });
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const ext = path.extname(asset.imageUrl).split('?')[0] || '.jpg';
      const tmpPath = `/tmp/bulk_alt_${Date.now()}${ext}`;
      fs.writeFileSync(tmpPath, buffer);

      const context = assetContextMap.get(asset.assetId) || siteContext || undefined;
      const altText = await generateAltText(tmpPath, context);
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }

      done++;
      if (altText) {
        const writeResult = await updateAsset(asset.assetId, { altText }, token);
        if (!writeResult.success) {
          console.error(`Bulk alt: generated but write-back failed for ${asset.assetId}:`, writeResult.error);
          send({ type: 'result', assetId: asset.assetId, altText, updated: false, error: writeResult.error, done, total: assets.length });
        } else {
          send({ type: 'result', assetId: asset.assetId, altText, updated: true, done, total: assets.length });
        }
      } else {
        send({ type: 'result', assetId: asset.assetId, altText: null, updated: false, error: 'Generation returned null', done, total: assets.length });
      }
    } catch (err) {
      done++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Bulk alt error for ${asset.assetId}:`, msg);
      send({ type: 'result', assetId: asset.assetId, altText: null, updated: false, error: msg, done, total: assets.length });
    }
  }

  send({ type: 'done', done, total: assets.length });
  res.end();
});

// --- Image Compression ---
app.post('/api/webflow/compress/:assetId', async (req, res) => {
  const { imageUrl, siteId, altText, fileName } = req.body;
  if (!imageUrl || !siteId) return res.status(400).json({ error: 'imageUrl and siteId required' });
  const compressToken = getTokenForSite(siteId) || undefined;

  try {
    const sharp = (await import('sharp')).default;

    // Download the original image
    const response = await fetch(imageUrl);
    const originalBuffer = Buffer.from(await response.arrayBuffer());
    const originalSize = originalBuffer.length;

    // Determine output format: convert PNG/BMP/TIFF to WebP, keep JPEG as JPEG but optimize
    const ext = (fileName || imageUrl).split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
    let compressed: Buffer;
    let newFileName: string;
    const baseName = (fileName || 'image').replace(/\.[^.]+$/, '');

    if (ext === 'svg') {
      // Use SVGO library to optimize SVG
      const svgo = await import('svgo');
      let compressedSvg: Buffer;
      try {
        const svgString = originalBuffer.toString('utf-8');
        const result = svgo.optimize(svgString, {
          multipass: true,
          plugins: [
            'preset-default',
          ],
        } as Parameters<typeof svgo.optimize>[1]);
        compressedSvg = Buffer.from(result.data, 'utf-8');
      } catch (svgoErr) {
        console.error('SVGO error:', svgoErr);
        return res.json({ skipped: true, reason: 'SVGO optimization failed: ' + (svgoErr instanceof Error ? svgoErr.message : String(svgoErr)) });
      }

      const svgNewSize = compressedSvg.length;
      const svgSavings = originalSize - svgNewSize;
      const svgSavingsPercent = Math.round((svgSavings / originalSize) * 100);

      if (svgSavingsPercent < 3) {
        return res.json({
          skipped: true,
          reason: `Already optimized (only ${svgSavingsPercent}% savings)`,
          originalSize,
          newSize: svgNewSize,
        });
      }

      const svgFileName = `${baseName}.svg`;
      const svgTmpPath = `/tmp/compressed_${Date.now()}_${svgFileName}`;
      fs.writeFileSync(svgTmpPath, compressedSvg);
      const svgUpload = await uploadAsset(siteId, svgTmpPath, svgFileName, altText, compressToken);
      fs.unlinkSync(svgTmpPath);

      if (!svgUpload.success) {
        return res.status(500).json({ error: svgUpload.error });
      }

      await deleteAsset(req.params.assetId, compressToken);

      return res.json({
        success: true,
        newAssetId: svgUpload.assetId,
        newHostedUrl: svgUpload.hostedUrl,
        originalSize,
        newSize: svgNewSize,
        savings: svgSavings,
        savingsPercent: svgSavingsPercent,
        newFileName: svgFileName,
      });
    }

    if (ext === 'jpg' || ext === 'jpeg') {
      compressed = await sharp(originalBuffer)
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer();
      newFileName = `${baseName}.jpg`;
    } else if (ext === 'png') {
      // Try WebP first, fall back to optimized PNG
      const webpBuffer = await sharp(originalBuffer)
        .webp({ quality: 80 })
        .toBuffer();
      const pngBuffer = await sharp(originalBuffer)
        .png({ compressionLevel: 9, palette: true })
        .toBuffer();
      if (webpBuffer.length < pngBuffer.length) {
        compressed = webpBuffer;
        newFileName = `${baseName}.webp`;
      } else {
        compressed = pngBuffer;
        newFileName = `${baseName}.png`;
      }
    } else {
      // Everything else: convert to WebP
      compressed = await sharp(originalBuffer)
        .webp({ quality: 80 })
        .toBuffer();
      newFileName = `${baseName}.webp`;
    }

    const newSize = compressed.length;
    const savings = originalSize - newSize;
    const savingsPercent = Math.round((savings / originalSize) * 100);

    // Skip if savings are negligible (<5%)
    if (savingsPercent < 5) {
      return res.json({
        skipped: true,
        reason: `Already optimized (only ${savingsPercent}% savings)`,
        originalSize,
        newSize,
      });
    }

    // Write compressed file to temp, upload to Webflow
    const tmpPath = `/tmp/compressed_${Date.now()}_${newFileName}`;
    fs.writeFileSync(tmpPath, compressed);

    const uploadResult = await uploadAsset(siteId, tmpPath, newFileName, altText, compressToken);
    fs.unlinkSync(tmpPath);

    if (!uploadResult.success) {
      return res.status(500).json({ error: uploadResult.error });
    }

    // Delete the old asset
    await deleteAsset(req.params.assetId, compressToken);

    res.json({
      success: true,
      newAssetId: uploadResult.assetId,
      newHostedUrl: uploadResult.hostedUrl,
      originalSize,
      newSize,
      savings,
      savingsPercent,
      newFileName,
    });
  } catch (e) {
    console.error('Compress error:', e);
    res.status(500).json({ error: 'Compression failed' });
  }
});

// --- Organize Assets into Folders ---

// Preview: builds a plan of which assets go into which folders
app.get('/api/webflow/organize-preview/:siteId', async (req, res) => {
  const { siteId } = req.params;
  const token = getTokenForSite(siteId) || undefined;
  if (!token) return res.status(400).json({ error: 'No token for site' });

  try {
    // 1. Fetch assets and existing folders
    const [assets, existingFolders] = await Promise.all([
      listAssets(siteId, token),
      listAssetFolders(siteId, token),
    ]);

    // 2. Scan usage: which assets appear on which pages
    const usage = await scanAssetUsage(siteId, token);

    // Build assetId → page titles mapping
    const assetPageMap = new Map<string, string[]>();
    for (const [assetId, refs] of usage.entries()) {
      const pageTitles = refs.filter(r => r.startsWith('page:')).map(r => r.slice(5));
      if (pageTitles.length > 0) assetPageMap.set(assetId, pageTitles);
    }

    // 2b. Detect OG/meta image assets from published HTML
    const ogAssetIds = new Set<string>();
    const allAssetIds = new Set(assets.map(a => a.id));
    try {
      const subdomain = await getSiteSubdomain(siteId, token);
      if (subdomain) {
        const baseUrl = `https://${subdomain}.webflow.io`;
        const pages = await listPages(siteId, token);
        const pageUrls = [
          baseUrl,
          ...pages.filter(p => p.slug && p.slug !== 'index' && !p.draft && !p.archived).map(p => `${baseUrl}/${p.slug}`),
        ];
        for (let i = 0; i < pageUrls.length; i += 10) {
          await Promise.allSettled(pageUrls.slice(i, i + 10).map(async (url) => {
            try {
              const r = await fetch(url, { redirect: 'follow' });
              if (!r.ok) return;
              const html = await r.text();
              const ogMatches = html.match(/<meta\s+(?:property|name)=["'](?:og:image|twitter:image)["']\s+content=["']([^"']+)["']/gi) || [];
              for (const tag of ogMatches) {
                const m = tag.match(/content=["']([^"']+)["']/i);
                if (!m) continue;
                for (const id of allAssetIds) { if (m[1].includes(id)) ogAssetIds.add(id); }
              }
            } catch { /* skip */ }
          }));
        }
      }
    } catch { /* proceed without OG detection */ }

    // 3. Build the organization plan
    const existingFolderNames = new Set(existingFolders.map(f => f.displayName));
    const plan: {
      foldersToCreate: string[];
      moves: Array<{ assetId: string; assetName: string; targetFolder: string; currentFolder?: string }>;
      summary: { totalAssets: number; assetsToMove: number; foldersToCreate: number; alreadyOrganized: number; unused: number; shared: number; ogImages: number };
    } = {
      foldersToCreate: [],
      moves: [],
      summary: { totalAssets: assets.length, assetsToMove: 0, foldersToCreate: 0, alreadyOrganized: 0, unused: 0, shared: 0, ogImages: 0 },
    };

    const foldersNeeded = new Set<string>();

    for (const asset of assets) {
      const pageTitles = assetPageMap.get(asset.id);

      if (asset.parentFolder) {
        plan.summary.alreadyOrganized++;
        continue;
      }

      let targetFolder: string;
      if (ogAssetIds.has(asset.id)) {
        targetFolder = '_Social / OG Images';
        plan.summary.ogImages++;
      } else if (!pageTitles || pageTitles.length === 0) {
        targetFolder = '_Unused Assets';
        plan.summary.unused++;
      } else if (pageTitles.length > 1) {
        targetFolder = '_Shared Assets';
        plan.summary.shared++;
      } else {
        targetFolder = pageTitles[0];
      }

      foldersNeeded.add(targetFolder);
      plan.moves.push({
        assetId: asset.id,
        assetName: asset.displayName || asset.originalFileName || asset.id,
        targetFolder,
        currentFolder: undefined,
      });
    }

    // Determine which folders need to be created
    for (const folder of foldersNeeded) {
      if (!existingFolderNames.has(folder)) {
        plan.foldersToCreate.push(folder);
      }
    }

    plan.summary.assetsToMove = plan.moves.length;
    plan.summary.foldersToCreate = plan.foldersToCreate.length;

    res.json(plan);
  } catch (err) {
    console.error('Organize preview error:', err);
    res.status(500).json({ error: 'Failed to build organization plan' });
  }
});

// Execute: creates folders and moves assets according to a plan
app.post('/api/webflow/organize-execute/:siteId', async (req, res) => {
  const { siteId } = req.params;
  const { moves, foldersToCreate } = req.body as {
    moves: Array<{ assetId: string; assetName: string; targetFolder: string }>;
    foldersToCreate: string[];
  };
  const token = getTokenForSite(siteId) || undefined;
  if (!token) return res.status(400).json({ error: 'No token for site' });
  if (!moves?.length) return res.status(400).json({ error: 'No moves to execute' });

  try {
    // 1. Get existing folders to avoid duplicates
    const existingFolders = await listAssetFolders(siteId, token);
    const folderNameToId = new Map(existingFolders.map(f => [f.displayName, f.id]));

    // 2. Create any new folders needed
    const createResults: Array<{ folder: string; success: boolean; error?: string }> = [];
    for (const folderName of (foldersToCreate || [])) {
      if (folderNameToId.has(folderName)) {
        createResults.push({ folder: folderName, success: true });
        continue;
      }
      const result = await createAssetFolder(siteId, folderName, undefined, token);
      if (result.success && result.folderId) {
        folderNameToId.set(folderName, result.folderId);
        createResults.push({ folder: folderName, success: true });
      } else {
        createResults.push({ folder: folderName, success: false, error: result.error });
      }
    }

    // 3. Move assets into their target folders
    const moveResults: Array<{ assetId: string; assetName: string; targetFolder: string; success: boolean; error?: string }> = [];
    for (const move of moves) {
      const folderId = folderNameToId.get(move.targetFolder);
      if (!folderId) {
        moveResults.push({ ...move, success: false, error: `Folder "${move.targetFolder}" not found` });
        continue;
      }
      const result = await moveAssetToFolder(move.assetId, folderId, token);
      moveResults.push({ ...move, success: result.success, error: result.error });
    }

    const successCount = moveResults.filter(r => r.success).length;
    const failCount = moveResults.filter(r => !r.success).length;

    res.json({
      success: true,
      foldersCreated: createResults,
      moveResults,
      summary: { moved: successCount, failed: failCount, total: moves.length },
    });
  } catch (err) {
    console.error('Organize execute error:', err);
    res.status(500).json({ error: 'Failed to execute organization plan' });
  }
});

// --- Smart Naming (AI Vision Enhanced) ---
app.post('/api/smart-name', async (req, res) => {
  const { originalName, altText, pageTitle, contentType, imageUrl, siteId, assetId } = req.body;
  if (!originalName) return res.status(400).json({ error: 'originalName required' });

  try {
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const ext = originalName.split('.').pop()?.toLowerCase() || 'jpg';
    const contextParts: string[] = [];
    if (altText) contextParts.push(`Alt text: "${altText}"`);
    if (pageTitle) contextParts.push(`Used on page: "${pageTitle}"`);
    if (contentType) contextParts.push(`Type: ${contentType}`);

    // Fetch site name + scan pages for usage context
    if (siteId) {
      try {
        const tkn = getTokenForSite(siteId) || undefined;
        const sites = await listSites(tkn);
        const site = sites.find(s => s.id === siteId);
        if (site) contextParts.push(`Website: "${site.displayName}"`);

        // Scan pages to find where this asset is used
        if (assetId || imageUrl) {
          const pages = await listPages(siteId, tkn);
          const usedOnPages: string[] = [];
          for (const page of pages.slice(0, 15)) {
            try {
              const dom = await getPageDom(page.id, tkn);
              const matchId = assetId && dom.includes(assetId);
              const matchUrl = imageUrl && dom.includes(imageUrl);
              if (matchId || matchUrl) {
                // Extract surrounding text for context
                const plainText = dom.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                const needle = assetId || imageUrl.split('/').pop() || '';
                const idx = plainText.indexOf(needle);
                if (idx !== -1) {
                  const start = Math.max(0, idx - 120);
                  const snippet = plainText.slice(start, start + 250).trim();
                  usedOnPages.push(`Page "${page.title}": ...${snippet}...`);
                } else {
                  usedOnPages.push(`Page "${page.title}"`);
                }
                if (usedOnPages.length >= 3) break;
              }
            } catch { /* skip page */ }
          }
          if (usedOnPages.length > 0) {
            contextParts.push(`Used on these pages:\n${usedOnPages.join('\n')}`);
          }
        }
      } catch { /* skip context fetch */ }
    }

    const promptText = `Suggest an SEO-friendly filename for this web image.
Current name: "${originalName}"
${contextParts.length > 0 ? contextParts.join('\n') : ''}

Rules:
- lowercase, hyphens between words, no special chars
- Descriptive and specific to what the image shows
- 3-5 words max, do NOT include the file extension
- Prioritize what the image actually depicts over generic terms
- Include brand/business name if visible in the image
Just output the filename slug, nothing else.`;

    // Try vision-enhanced naming if we have an image URL
    let suggestion: string | null = null;
    if (imageUrl && !contentType?.includes('svg')) {
      try {
        // Download and prepare image for vision
        const sharp = (await import('sharp')).default;
        const imgRes = await fetch(imageUrl);
        if (imgRes.ok) {
          const imgBuf = Buffer.from(await imgRes.arrayBuffer());
          const smallBuf = await sharp(imgBuf)
            .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 50 })
            .toBuffer();
          const base64 = smallBuf.toString('base64');

          const visionRes = await client.chat.completions.create({
            model: 'gpt-4o-mini',
            max_tokens: 60,
            messages: [{
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'low' } },
                { type: 'text', text: promptText },
              ],
            }],
          });
          suggestion = visionRes.choices[0]?.message?.content?.trim() || null;
        }
      } catch (vErr) {
        console.log('Vision naming fallback to text-only:', vErr instanceof Error ? vErr.message : vErr);
      }
    }

    // Fallback to text-only if vision didn't work
    if (!suggestion) {
      const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 60,
        messages: [{ role: 'user', content: promptText }],
      });
      suggestion = response.choices[0]?.message?.content?.trim() || originalName.replace(/\.[^.]+$/, '');
    }

    // Clean up: remove quotes, extension if accidentally included, ensure valid slug
    const raw = suggestion || originalName.replace(/\.[^.]+$/, '');
    suggestion = raw.replace(/['"]/g, '').replace(/\.[a-z]+$/i, '').replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    res.json({ suggestion, extension: ext, fullName: `${suggestion}.${ext}` });
  } catch (e) {
    console.error('Smart name error:', e);
    res.status(500).json({ error: 'Failed to generate name' });
  }
});

// --- Rename Asset ---
app.patch('/api/webflow/rename/:assetId', async (req, res) => {
  const { displayName, siteId } = req.body;
  if (!displayName) return res.status(400).json({ error: 'displayName required' });

  try {
    const token = siteId ? getTokenForSite(siteId) : null;
    const result = await updateAsset(req.params.assetId, { displayName }, token || undefined);
    res.json(result);
  } catch (e) {
    console.error('Rename error:', e);
    res.status(500).json({ error: 'Failed to rename asset' });
  }
});

// --- Clipboard Upload (with HDPI 2x resize) ---
app.post('/api/upload/:workspaceId/clipboard', upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file' });

  const workspaces = listWorkspaces();
  const wsMatch = workspaces.find(w => w.id === req.params.workspaceId || w.folder === req.params.workspaceId);
  const destFolder = wsMatch ? path.join(getUploadRoot(), wsMatch.folder) : path.join(getUploadRoot(), '_unsorted');
  fs.mkdirSync(destFolder, { recursive: true });

  const originalName = req.body.fileName || file.originalname || `clipboard-${Date.now()}.png`;
  const targetPath = path.join(destFolder, originalName);

  try {
    // Resize to 2x for HDPI: halve dimensions so it's crisp at 2x
    const { execFileSync } = await import('child_process');
    // Get current dimensions
    const sipsInfo = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file.path], { encoding: 'utf-8' });
    const widthMatch = sipsInfo.match(/pixelWidth:\s*(\d+)/);
    const heightMatch = sipsInfo.match(/pixelHeight:\s*(\d+)/);

    if (widthMatch && heightMatch) {
      const w = Math.round(parseInt(widthMatch[1]) / 2);
      const h = Math.round(parseInt(heightMatch[1]) / 2);
      execFileSync('sips', ['-z', String(h), String(w), file.path, '--out', targetPath], { stdio: 'pipe' });
    } else {
      fs.renameSync(file.path, targetPath);
    }
  } catch {
    // Fallback: just move without resize
    fs.renameSync(file.path, targetPath);
  }

  // Clean up temp file if still exists
  try { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch { /* ignore */ }

  broadcast('files:uploaded', {
    workspace: req.params.workspaceId,
    type: 'asset',
    count: 1,
    names: [originalName],
  });

  triggerOptimize(targetPath).catch(err => console.error('Optimize error:', err));
  res.json({ uploaded: 1, fileName: originalName });
});

// --- CMS Collections ---
app.get('/api/webflow/collections/:siteId', async (req, res) => {
  try {
    const collections = await listCollections(req.params.siteId);
    res.json(collections);
  } catch {
    res.json([]);
  }
});

app.get('/api/webflow/collections/:collectionId/schema', async (req, res) => {
  try {
    const schema = await getCollectionSchema(req.params.collectionId);
    res.json(schema);
  } catch {
    res.json({ fields: [] });
  }
});

app.get('/api/webflow/collections/:collectionId/items', async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const offset = parseInt(req.query.offset as string) || 0;
  try {
    const result = await listCollectionItems(req.params.collectionId, limit, offset);
    res.json(result);
  } catch {
    res.json({ items: [], total: 0 });
  }
});

app.patch('/api/webflow/collections/:collectionId/items/:itemId', async (req, res) => {
  const result = await updateCollectionItem(req.params.collectionId, req.params.itemId, req.body.fieldData);
  res.json(result);
});

// --- CMS SEO Editor: list all collections with SEO-relevant fields and items ---
app.get('/api/webflow/cms-seo/:siteId', async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const collections = await listCollections(req.params.siteId, token);
    const SEO_FIELD_PATTERNS = ['seo title', 'meta title', 'title tag', 'seo description', 'meta description', 'og title', 'og description', 'open graph'];

    const results: Array<{
      collectionId: string;
      collectionName: string;
      collectionSlug: string;
      seoFields: Array<{ id: string; slug: string; displayName: string; type: string }>;
      items: Array<{ id: string; fieldData: Record<string, unknown> }>;
      total: number;
    }> = [];

    for (const coll of collections) {
      const schema = await getCollectionSchema(coll.id, token);
      // Identify SEO-relevant fields: name, slug, plus any field matching SEO patterns
      const seoFields = schema.fields.filter(f => {
        const name = f.displayName.toLowerCase();
        const slug = f.slug.toLowerCase();
        if (f.slug === 'name' || f.slug === 'slug') return true;
        if (f.type === 'PlainText' || f.type === 'RichText') {
          return SEO_FIELD_PATTERNS.some(p => name.includes(p) || slug.includes(p.replace(/\s/g, '-')));
        }
        return false;
      });

      // Only include collections that have published items (skip utility/empty collections)
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;
      const { items, total } = await listCollectionItems(coll.id, limit, offset, token);
      if (total === 0) continue;

      // Filter to only live (published, non-draft, non-archived) items
      const liveItems = items.filter(item => {
        const draft = item.isDraft as boolean | undefined;
        const archived = item.isArchived as boolean | undefined;
        return !draft && !archived;
      });
      if (liveItems.length === 0) continue;

      // Extract only the relevant field data from each item
      const cleanItems = liveItems.map(item => {
        const fd = (item.fieldData || item) as Record<string, unknown>;
        const relevant: Record<string, unknown> = {};
        relevant['name'] = fd['name'] || '';
        relevant['slug'] = fd['slug'] || '';
        for (const sf of seoFields) {
          if (sf.slug !== 'name' && sf.slug !== 'slug') {
            relevant[sf.slug] = fd[sf.slug] || '';
          }
        }
        return { id: item.id as string || (item as Record<string, unknown>)._id as string, fieldData: relevant };
      });

      results.push({
        collectionId: coll.id,
        collectionName: coll.displayName,
        collectionSlug: coll.slug,
        seoFields,
        items: cleanItems,
        total: liveItems.length,
      });
    }

    res.json(results);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('CMS SEO list error:', msg);
    res.status(500).json({ error: msg });
  }
});

// --- CMS SEO: Publish collection items after editing ---
app.post('/api/webflow/collections/:collectionId/publish', async (req, res) => {
  try {
    const { itemIds } = req.body;
    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({ error: 'itemIds array required' });
    }
    const result = await publishCollectionItems(req.params.collectionId, itemIds);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Persistent metadata (alt text, upload history)
app.get('/api/metadata', (_req, res) => {
  res.json(getMetadata());
});

// --- Google Search Console / GA4 ---
app.get('/api/google/status/:siteId', (req, res) => {
  const creds = getGoogleCredentials();
  res.json({
    configured: !!creds,
    connected: isConnected(req.params.siteId),
  });
});

// --- Global Google Auth (configure once, use everywhere) ---
app.get('/api/google/auth-url', (_req, res) => {
  const url = getGlobalAuthUrl();
  if (!url) return res.status(400).json({ error: 'Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.' });
  res.json({ url });
});

app.get('/api/google/status', (_req, res) => {
  res.json({ connected: isGlobalConnected(), configured: !!getGoogleCredentials() });
});

app.post('/api/google/disconnect', (_req, res) => {
  disconnectGlobal();
  res.json({ success: true });
});

app.get('/api/google/gsc-sites', async (_req, res) => {
  try {
    const token = await getGlobalToken();
    if (!token) return res.status(401).json({ error: 'Google not connected' });
    const sites = await listGscSites(GLOBAL_KEY);
    res.json(sites);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Legacy per-site auth (kept for backward compat)
app.get('/api/google/auth-url/:siteId', (req, res) => {
  const url = getAuthUrl(req.params.siteId);
  if (!url) return res.status(400).json({ error: 'Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.' });
  res.json({ url });
});

app.get('/api/google/callback', async (req, res) => {
  // Google may redirect back with an error instead of a code
  const error = req.query.error as string;
  if (error) {
    console.error(`[google-auth] OAuth error from Google: ${error}`);
    return res.status(400).send(`Google auth error: ${error}. Check your OAuth consent screen and API settings in Google Cloud Console.`);
  }
  const code = req.query.code as string;
  const siteId = req.query.state as string;
  console.log(`[google-auth] Callback received, code=${code ? 'present' : 'missing'}, siteId=${siteId || 'missing'}`);
  if (!code || !siteId) return res.status(400).send('Missing code or state');
  const result = await exchangeCode(code, siteId);
  if (result.success) {
    // Redirect back to the app
    const redirectUrl = IS_PROD ? '/' : 'http://localhost:5173/';
    res.redirect(`${redirectUrl}?google=connected&siteId=${siteId}`);
  } else {
    res.status(500).send(`Google auth failed: ${result.error}`);
  }
});

app.post('/api/google/disconnect/:siteId', (req, res) => {
  disconnect(req.params.siteId);
  res.json({ success: true });
});

// GA4 Analytics
app.get('/api/google/ga4-properties', async (_req, res) => {
  try {
    const properties = await listGA4Properties();
    res.json(properties);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.get('/api/google/gsc-sites/:siteId', async (req, res) => {
  try {
    const sites = await listGscSites(req.params.siteId);
    res.json(sites);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.post('/api/google/search-chat/:siteId', async (req, res) => {
  const { question, context } = req.body;
  if (!question) return res.status(400).json({ error: 'question required' });
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(400).json({ error: 'OPENAI_API_KEY not configured' });

  try {
    const systemPrompt = `You are an expert SEO analyst embedded in a search analytics dashboard. The user is a website owner or client asking about their Google Search Console data.

You have access to their real search data which is provided as context. Give specific, actionable, data-driven answers. Reference actual queries, pages, and numbers from their data. Be concise but thorough. Use markdown formatting.

When giving recommendations:
- Be specific about which queries/pages to optimize
- Explain the "why" behind recommendations
- Prioritize by potential impact
- Suggest concrete next steps

Current search data context:
${JSON.stringify(context, null, 2)}`;

    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question },
        ],
        temperature: 0.7,
        max_tokens: 1500,
      }),
    });

    if (!aiRes.ok) {
      const err = await aiRes.text();
      throw new Error(`OpenAI error: ${err}`);
    }

    const aiData = await aiRes.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    const answer = aiData.choices?.[0]?.message?.content || 'No response generated.';
    res.json({ answer });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.get('/api/google/search-overview/:siteId', async (req, res) => {
  const gscSiteUrl = req.query.gscSiteUrl as string;
  const days = parseInt(req.query.days as string) || 28;
  if (!gscSiteUrl) return res.status(400).json({ error: 'gscSiteUrl query param required' });
  try {
    const overview = await getSearchOverview(req.params.siteId, gscSiteUrl, days);
    res.json(overview);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.get('/api/google/performance-trend/:siteId', async (req, res) => {
  const gscSiteUrl = req.query.gscSiteUrl as string;
  const days = parseInt(req.query.days as string) || 28;
  if (!gscSiteUrl) return res.status(400).json({ error: 'gscSiteUrl query param required' });
  try {
    const trend = await getPerformanceTrend(req.params.siteId, gscSiteUrl, days);
    res.json(trend);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// --- Keyword Strategy Generation (SSE progress) ---
app.post('/api/webflow/keyword-strategy/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (!ws.webflowSiteId) return res.status(400).json({ error: 'No Webflow site linked' });

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  const businessContext = (req.body?.businessContext as string) || ws.keywordStrategy?.businessContext || '';
  const semrushMode = (req.body?.semrushMode as string) || 'none'; // 'quick', 'full', 'none'
  const competitorDomains = (req.body?.competitorDomains as string[]) || ws.competitorDomains || [];
  const token = getTokenForSite(ws.webflowSiteId) || undefined;

  // Save competitor domains if provided
  if (req.body?.competitorDomains) {
    updateWorkspace(ws.id, { competitorDomains });
  }

  // Check if client wants SSE streaming
  const wantsStream = req.headers.accept === 'text/event-stream';
  if (wantsStream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
  }
  const sendProgress = (step: string, detail: string, progress: number) => {
    console.log(`[Strategy][${step}] ${detail} (${Math.round(progress * 100)}%)`);
    if (wantsStream) {
      try { res.write(`data: ${JSON.stringify({ step, detail, progress })}\n\n`); } catch { /* connection dropped */ }
    }
  };

  try {
    // 1. Resolve site base URL — auto-resolve liveDomain if missing
    sendProgress('discovery', 'Resolving site URL...', 0.02);
    let liveDomain = ws.liveDomain || '';
    if (!liveDomain && token) {
      try {
        const domRes = await fetch(`https://api.webflow.com/v2/sites/${ws.webflowSiteId}/custom_domains`, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        if (domRes.ok) {
          const domData = await domRes.json() as { customDomains?: { url?: string }[] };
          const domains = domData.customDomains || [];
          if (domains.length > 0 && domains[0].url) {
            const d = domains[0].url;
            liveDomain = d.startsWith('http') ? d : `https://${d}`;
            // Persist so we don't re-resolve every time
            updateWorkspace(ws.id, { liveDomain });
            console.log(`[Strategy] Auto-resolved liveDomain: ${liveDomain}`);
          }
        }
      } catch { /* best-effort */ }
    }
    const subdomain = await getSiteSubdomain(ws.webflowSiteId, token);
    const baseUrl = liveDomain
      ? (liveDomain.startsWith('http') ? liveDomain : `https://${liveDomain}`)
      : subdomain ? `https://${subdomain}.webflow.io` : '';
    console.log(`[Strategy] Using baseUrl: ${baseUrl}`);

    // 2. Discover pages: sitemap is the SOURCE OF TRUTH for live pages.
    //    Webflow API is only used for metadata enrichment (SEO title, meta desc).
    sendProgress('discovery', 'Crawling sitemap for live pages...', 0.05);

    // Build Webflow API metadata lookup (for enrichment only, not page discovery)
    const wfMetaByPath = new Map<string, { title: string; seoTitle: string; seoDesc: string }>();
    try {
      const allPages = await listPages(ws.webflowSiteId, token);
      const published = filterPublishedPages(allPages);
      for (const p of published) {
        const pagePath = p.publishedPath || `/${p.slug || ''}`;
        wfMetaByPath.set(pagePath, {
          title: p.title || p.slug || '',
          seoTitle: p.seo?.title || '',
          seoDesc: p.seo?.description || '',
        });
      }
      console.log(`[Strategy] Webflow API: ${wfMetaByPath.size} pages with metadata`);
    } catch (err) {
      console.log('[Strategy] Webflow API metadata fetch failed, continuing without it:', err);
    }

    // Sitemap = authoritative list of live pages
    // Filter out utility/thin/legal pages that don't need keyword strategy
    const SKIP_PATHS = new Set(['/404', '/search', '/password', '/offline', '/thank-you', '/thanks', '/confirmation']);
    const SKIP_PREFIXES = ['/tag/', '/category/', '/author/', '/page/'];
    const SKIP_SUFFIXES = ['/rss', '/feed', '/rss.xml', '/feed.xml'];
    const SKIP_PATTERNS = [/\/404$/i, /\/search$/i, /\/password$/i];

    const allPaths = new Set<string>();
    if (baseUrl) {
      try {
        const sitemapUrls = await discoverSitemapUrls(baseUrl);
        console.log(`[Strategy] Sitemap discovered ${sitemapUrls.length} URLs from ${baseUrl}`);
        let skippedUtility = 0;
        for (const url of sitemapUrls) {
          try {
            const rawPath = new URL(url).pathname || '/';
            // Normalize: strip trailing slash (except root)
            const path = rawPath === '/' ? '/' : rawPath.replace(/\/$/, '');

            // Skip utility pages
            if (SKIP_PATHS.has(path.toLowerCase())) { skippedUtility++; continue; }
            if (SKIP_PREFIXES.some(p => path.toLowerCase().startsWith(p))) { skippedUtility++; continue; }
            if (SKIP_SUFFIXES.some(s => path.toLowerCase().endsWith(s))) { skippedUtility++; continue; }
            if (SKIP_PATTERNS.some(r => r.test(path))) { skippedUtility++; continue; }

            allPaths.add(path);
          } catch { /* skip invalid URLs */ }
        }
        if (skippedUtility > 0) console.log(`[Strategy] Skipped ${skippedUtility} utility/index pages`);
      } catch (err) {
        console.log('[Strategy] Sitemap discovery failed:', err);
      }
    }
    // Fallback: if sitemap found nothing, use Webflow API pages
    if (allPaths.size === 0 && wfMetaByPath.size > 0) {
      console.log('[Strategy] Sitemap empty — falling back to Webflow API pages');
      for (const path of wfMetaByPath.keys()) allPaths.add(path);
    }
    sendProgress('discovery', `Found ${allPaths.size} live pages`, 0.12);
    console.log(`[Strategy] Total live pages: ${allPaths.size}`);

    // 3. Fetch actual page content for ALL discovered pages (parallel, batched)
    sendProgress('content', `Fetching content from ${allPaths.size} pages...`, 0.15);
    const pageInfo: Array<{ path: string; title: string; seoTitle: string; seoDesc: string; contentSnippet: string }> = [];
    const pathArray = Array.from(allPaths);
    const contentBatch = 6;
    for (let i = 0; i < pathArray.length; i += contentBatch) {
      const chunk = pathArray.slice(i, i + contentBatch);
      const fetched = Math.min(i + contentBatch, pathArray.length);
      sendProgress('content', `Fetching page content... ${fetched}/${pathArray.length}`, 0.15 + (fetched / pathArray.length) * 0.30);
      const contents = await Promise.all(chunk.map(async (pagePath): Promise<{ path: string; title: string; seoTitle: string; seoDesc: string; contentSnippet: string } | null> => {
        const wfMeta = wfMetaByPath.get(pagePath);
        let contentSnippet = '';
        let htmlTitle = '';
        let htmlMetaDesc = '';
        const url = baseUrl ? `${baseUrl}${pagePath === '/' ? '' : pagePath}` : '';
        if (url) {
          try {
            const htmlRes = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
            if (!htmlRes.ok) {
              // Non-200 = page doesn't exist on live site (e.g. non-live CMS collection)
              if (!wfMeta) return null; // Skip sitemap-only pages that 404
            } else {
              const html = await htmlRes.text();
              // Extract title and meta description from HTML for pages without Webflow metadata
              if (!wfMeta) {
                const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
                if (titleMatch) htmlTitle = titleMatch[1].trim();
                const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)
                  || html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i);
                if (descMatch) htmlMetaDesc = descMatch[1].trim();
              }
              const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
              const body = bodyMatch ? bodyMatch[1] : html;
              contentSnippet = body
                .replace(/<script[\s\S]*?<\/script>/gi, '')
                .replace(/<style[\s\S]*?<\/style>/gi, '')
                .replace(/<nav[\s\S]*?<\/nav>/gi, '')
                .replace(/<footer[\s\S]*?<\/footer>/gi, '')
                .replace(/<header[\s\S]*?<\/header>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/&[a-z]+;/gi, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 1200);
            }
          } catch {
            if (!wfMeta) return null; // Skip unreachable sitemap-only pages
          }
        }
        const pathName = pagePath.replace(/^\//, '').replace(/\/$/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Home';
        return {
          path: pagePath,
          title: wfMeta?.title || htmlTitle || pathName,
          seoTitle: wfMeta?.seoTitle || htmlTitle || '',
          seoDesc: wfMeta?.seoDesc || htmlMetaDesc || '',
          contentSnippet,
        };
      }));
      pageInfo.push(...contents.filter((c): c is NonNullable<typeof c> => c !== null));
    }
    const skipped = pathArray.length - pageInfo.length;
    if (skipped > 0) console.log(`[Strategy] Filtered out ${skipped} non-live pages (404/unreachable)`);

    // Post-fetch: filter out pages with very thin content (utility/legal pages with < 50 chars)
    const beforeThinFilter = pageInfo.length;
    const thinPages = pageInfo.filter(p => p.contentSnippet.length < 50 && p.path !== '/');
    if (thinPages.length > 0) {
      console.log(`[Strategy] Thin content pages (< 50 chars): ${thinPages.map(p => p.path).join(', ')}`);
      // Remove thin pages from the array
      for (const thin of thinPages) {
        const idx = pageInfo.indexOf(thin);
        if (idx >= 0) pageInfo.splice(idx, 1);
      }
      console.log(`[Strategy] Removed ${thinPages.length} thin content pages`);
    }

    sendProgress('content', `Fetched ${pageInfo.length} live pages (${skipped} non-live, ${beforeThinFilter - pageInfo.length} thin filtered)`, 0.46);

    // 4. Try to gather GSC data if connected
    sendProgress('search_data', 'Fetching Google Search Console data...', 0.48);
    let gscData: Array<{ query: string; page: string; clicks: number; impressions: number; position: number }> = [];
    if (ws.gscPropertyUrl) {
      try {
        gscData = await getQueryPageData(ws.webflowSiteId, ws.gscPropertyUrl, 90);
        sendProgress('search_data', `Got ${gscData.length} search query rows from GSC`, 0.52);
      } catch {
        sendProgress('search_data', 'GSC unavailable — continuing without it', 0.52);
        console.log('Keyword strategy: GSC data unavailable, proceeding without it');
      }
    } else {
      sendProgress('search_data', 'No GSC connected — skipping', 0.52);
    }

    // 5. SEMRush data gathering (based on mode)
    let semrushContext = '';
    let semrushDomainData: Awaited<ReturnType<typeof getDomainOrganicKeywords>> = [];
    let keywordGaps: Awaited<ReturnType<typeof getKeywordGap>> = [];
    const relatedKws: Awaited<ReturnType<typeof getRelatedKeywords>> = [];

    if (semrushMode !== 'none' && isSemrushConfigured()) {
      sendProgress('semrush', 'Fetching SEMRush keyword intelligence...', 0.55);
      // Derive domain from baseUrl so SEMRush always hits the live site (not webflow.io staging)
      const siteDomain = baseUrl ? new URL(baseUrl).hostname : '';

      if (siteDomain) {
        // Both quick and full: get domain organic keywords
        try {
          console.log(`[SEMRush] Fetching domain organic keywords for ${siteDomain}...`);
          semrushDomainData = await getDomainOrganicKeywords(siteDomain, ws.id, semrushMode === 'full' ? 200 : 100);
          console.log(`[SEMRush] Got ${semrushDomainData.length} domain keywords`);

          if (semrushDomainData.length > 0) {
            semrushContext += `\n\nSEMRush Domain Organic Keywords (real search volume + difficulty data):\n`;
            semrushContext += semrushDomainData.slice(0, 100).map(k =>
              `- "${k.keyword}" → ${k.url} (pos: #${k.position}, vol: ${k.volume}/mo, KD: ${k.difficulty}%, CPC: $${k.cpc}, traffic: ${k.traffic})`
            ).join('\n');
          }
        } catch (err) {
          console.error('[SEMRush] Domain organic error:', err);
        }

        // Full mode: competitor gap analysis + related keywords
        if (semrushMode === 'full' && competitorDomains.length > 0) {
          try {
            sendProgress('semrush', `Running competitor gap analysis vs ${competitorDomains.length} competitors...`, 0.60);
            console.log(`[SEMRush] Running keyword gap analysis vs ${competitorDomains.join(', ')}...`);
            keywordGaps = await getKeywordGap(siteDomain, competitorDomains, ws.id, 50);
            console.log(`[SEMRush] Found ${keywordGaps.length} keyword gaps`);

            if (keywordGaps.length > 0) {
              semrushContext += `\n\nCOMPETITOR KEYWORD GAPS (keywords competitors rank for but YOU don't — high-priority opportunities):\n`;
              semrushContext += keywordGaps.slice(0, 30).map(g =>
                `- "${g.keyword}" (vol: ${g.volume}/mo, KD: ${g.difficulty}%) — ${g.competitorDomain} ranks #${g.competitorPosition}`
              ).join('\n');
            }
          } catch (err) {
            console.error('[SEMRush] Keyword gap error:', err);
          }

          // Get related keywords for top 5 seed terms
          try {
            sendProgress('semrush', 'Fetching related keyword ideas...', 0.65);
            const seedKeywords = semrushDomainData.slice(0, 5).map(k => k.keyword);
            for (const seed of seedKeywords) {
              const related = await getRelatedKeywords(seed, ws.id, 10);
              relatedKws.push(...related);
            }
            if (relatedKws.length > 0) {
              const unique = relatedKws.filter((k, i, arr) => arr.findIndex(x => x.keyword === k.keyword) === i);
              semrushContext += `\n\nSEMRush Related Keywords (expansion ideas with real volume):\n`;
              semrushContext += unique.slice(0, 30).map(k =>
                `- "${k.keyword}" (vol: ${k.volume}/mo, KD: ${k.difficulty}%)`
              ).join('\n');
            }
          } catch (err) {
            console.error('[SEMRush] Related keywords error:', err);
          }
        }
      }
    }

    // 6. BATCHED AI STRATEGY — parallel page analysis + master synthesis
    //    Step 1: Split pages into batches, analyze each batch in parallel (per-page keyword mapping)
    //    Step 2: Master synthesis call merges all mappings + GSC + SEMRush into final strategy

    // Helper: call OpenAI with retry + timeout
    const callOpenAI = async (messages: Array<{ role: string; content: string }>, maxTokens: number, label: string): Promise<string> => {
      const body = JSON.stringify({ model: 'gpt-4o-mini', messages, max_tokens: maxTokens, temperature: 0.3 });
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const r = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
            body,
            signal: AbortSignal.timeout(90_000),
          });
          if (!r.ok) {
            const errText = await r.text();
            throw new Error(`OpenAI ${r.status}: ${errText.slice(0, 200)}`);
          }
          const data = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
          const raw = data.choices?.[0]?.message?.content?.trim() || '';
          return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
        } catch (err) {
          console.error(`[Strategy][${label}] Attempt ${attempt} failed:`, err instanceof Error ? err.message : err);
          if (attempt === 2) throw err;
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      throw new Error('Unreachable');
    };

    // Keepalive pings to prevent Render proxy from killing idle SSE connection
    const keepalive = wantsStream ? setInterval(() => {
      try { res.write(`: keepalive\n\n`); } catch { /* connection closed */ }
    }, 10_000) : null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let strategy: any;
    try {
    // --- STEP 1: Parallel page analysis batches ---
    const BATCH_SIZE = 20;
    const batches: typeof pageInfo[] = [];
    for (let i = 0; i < pageInfo.length; i += BATCH_SIZE) {
      batches.push(pageInfo.slice(i, i + BATCH_SIZE));
    }
    console.log(`[Strategy] Splitting ${pageInfo.length} pages into ${batches.length} batches of ~${BATCH_SIZE}`);
    sendProgress('ai', `Analyzing pages in ${batches.length} parallel batches...`, 0.55);

    let businessSection = '';
    if (businessContext) {
      businessSection = `\nBUSINESS CONTEXT: ${businessContext}\n`;
    }

    // Build per-page GSC context lookup
    const gscByPath = new Map<string, Array<{ query: string; position: number; clicks: number; impressions: number }>>();
    for (const r of gscData) {
      try {
        const p = new URL(r.page).pathname;
        if (!gscByPath.has(p)) gscByPath.set(p, []);
        gscByPath.get(p)!.push({ query: r.query, position: r.position, clicks: r.clicks, impressions: r.impressions });
      } catch { /* skip */ }
    }

    const runBatch = async (batch: typeof pageInfo, batchIdx: number) => {
      const batchPages = batch.map(p => {
        let entry = `- ${p.path}: "${p.title}"`;
        if (p.seoTitle) entry += ` | SEO: "${p.seoTitle}"`;
        if (p.seoDesc) entry += ` | Desc: "${p.seoDesc.slice(0, 150)}"`;
        if (p.contentSnippet) entry += `\n  Content: ${p.contentSnippet.slice(0, 400)}`;
        const pageGsc = gscByPath.get(p.path);
        if (pageGsc && pageGsc.length > 0) {
          const topGsc = pageGsc.sort((a, b) => b.impressions - a.impressions).slice(0, 5);
          entry += `\n  GSC: ${topGsc.map(g => `"${g.query}" pos:${g.position.toFixed(1)} clicks:${g.clicks} imp:${g.impressions}`).join(', ')}`;
        }
        return entry;
      }).join('\n');

      const batchPrompt = `You are an expert SEO strategist. Analyze these ${batch.length} web pages and assign optimal keyword targets for each.
${businessSection}
Pages to analyze:
${batchPages}

Return a JSON array with one entry per page:
[
  {
    "pagePath": "/exact-path",
    "pageTitle": "Page Title",
    "primaryKeyword": "specific, high-intent keyword (unique per page, no cannibalization)",
    "secondaryKeywords": ["4-6 supporting keywords: long-tail, question-based, location variants"],
    "searchIntent": "commercial|informational|transactional|navigational"
  }
]

Rules:
- Each primaryKeyword must be UNIQUE across all pages — no keyword cannibalization
- Keywords should be specific and high-intent, NOT generic
- If business has locations, include location modifiers
- If GSC data is available, leverage it: high impressions + poor position = opportunity
- Cover ALL ${batch.length} pages — do not skip any
- Return ONLY valid JSON array, no markdown, no explanation`;

      console.log(`[Strategy] Batch ${batchIdx + 1}/${batches.length}: ${batch.length} pages, ${batchPrompt.length} chars`);
      const raw = await callOpenAI([
        { role: 'system', content: 'You are an expert SEO strategist. Return valid JSON only.' },
        { role: 'user', content: batchPrompt },
      ], 3000, `batch-${batchIdx + 1}`);

      try {
        const parsed = JSON.parse(raw);
        console.log(`[Strategy] Batch ${batchIdx + 1} returned ${Array.isArray(parsed) ? parsed.length : 0} page mappings`);
        sendProgress('ai', `Batch ${batchIdx + 1}/${batches.length} complete (${Array.isArray(parsed) ? parsed.length : 0} pages)`, 0.55 + ((batchIdx + 1) / batches.length) * 0.20);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        console.error(`[Strategy] Batch ${batchIdx + 1} returned invalid JSON:`, raw.slice(0, 200));
        return batch.map(p => ({
          pagePath: p.path,
          pageTitle: p.title,
          primaryKeyword: p.title.toLowerCase(),
          secondaryKeywords: [],
          searchIntent: 'informational',
        }));
      }
    };

    // Run batches with limited concurrency (3 at a time)
    const CONCURRENCY = 3;
    const allPageMappings: Array<{ pagePath: string; pageTitle: string; primaryKeyword: string; secondaryKeywords: string[]; searchIntent: string }> = [];
    for (let i = 0; i < batches.length; i += CONCURRENCY) {
      const chunk = batches.slice(i, i + CONCURRENCY);
      const results = await Promise.all(chunk.map((batch, ci) => runBatch(batch, i + ci)));
      allPageMappings.push(...results.flat());
    }
    console.log(`[Strategy] All batches complete: ${allPageMappings.length} total page mappings`);

    // --- STEP 2: Master synthesis — site-level strategy only ---
    // The batch results ARE the pageMap. Master only generates siteKeywords, contentGaps, quickWins, opportunities.
    // This keeps output small (~2K tokens) and fast.
    sendProgress('ai', 'Synthesizing site-level strategy...', 0.78);

    // Detect keyword conflicts from batch results (batches don't know about each other)
    const kwCount = new Map<string, string[]>();
    for (const pm of allPageMappings) {
      const kw = pm.primaryKeyword.toLowerCase();
      if (!kwCount.has(kw)) kwCount.set(kw, []);
      kwCount.get(kw)!.push(pm.pagePath);
    }
    const conflicts = [...kwCount.entries()].filter(([, pages]) => pages.length > 1);
    if (conflicts.length > 0) {
      console.log(`[Strategy] Found ${conflicts.length} keyword conflicts to resolve`);
    }

    // Compact summary: just keywords per page (no secondary details — keep prompt small)
    const kwSummary = allPageMappings.map(pm => `${pm.pagePath}: "${pm.primaryKeyword}"`).join('\n');

    // GSC: top queries only
    let gscSummary = '';
    if (gscData.length > 0) {
      const topGsc = [...gscData].sort((a, b) => b.impressions - a.impressions).slice(0, 30);
      gscSummary = `\n\nTop GSC queries (last 90 days):\n` +
        topGsc.map(r => `- "${r.query}" → ${new URL(r.page).pathname} (pos: ${r.position.toFixed(1)}, clicks: ${r.clicks}, imp: ${r.impressions})`).join('\n');
    }

    const hasSemrush = semrushContext.length > 0;
    const conflictNote = conflicts.length > 0
      ? `\n\nKEYWORD CONFLICTS to resolve (same keyword assigned to multiple pages):\n${conflicts.map(([kw, pages]) => `- "${kw}" → ${pages.join(', ')}`).join('\n')}\nFor each conflict, include a fix in "keywordFixes" — reassign one page to a different keyword.\n`
      : '';

    const masterPrompt = `You are a senior SEO strategist. Page-level keywords have already been assigned. Now provide the site-level strategy.
${businessSection}
Current keyword assignments (${allPageMappings.length} pages):
${kwSummary}
${conflictNote}${gscSummary}
${semrushContext}

Return JSON with this EXACT structure (do NOT include a pageMap — it's already done):
{
  "siteKeywords": ["8-15 primary keywords this site should target overall"],
  "opportunities": ["5-8 specific keyword opportunities the site is missing"],
  "contentGaps": [
    {
      "topic": "New content piece to create",
      "targetKeyword": "primary keyword",
      "intent": "informational|commercial|transactional|navigational",
      "priority": "high|medium|low",
      "rationale": "Why and expected impact"
    }
  ],
  "quickWins": [
    {
      "pagePath": "/exact-path-from-list-above",
      "action": "Specific actionable fix",
      "estimatedImpact": "high|medium|low",
      "rationale": "Why this improves rankings"
    }
  ]${conflicts.length > 0 ? `,
  "keywordFixes": [
    { "pagePath": "/path", "newPrimaryKeyword": "better unique keyword" }
  ]` : ''}
}

Rules:
- siteKeywords: 8-15 broad themes covering the full site
- contentGaps: 6-10 NEW pages/posts to create. Vary intent (informational, commercial, transactional). Mix high and medium priority${hasSemrush ? '. Prioritize competitor gap keywords.' : ''}
- quickWins: 3-5 existing pages where small changes boost rankings. Use GSC data if available (high impressions + poor position = opportunity).
${hasSemrush ? '- Use SEMRush data to inform priorities. KD < 40% = quick wins.' : ''}
- Return ONLY valid JSON, no markdown`;

    console.log(`[Strategy] Master prompt: ${masterPrompt.length} chars (~${Math.ceil(masterPrompt.length / 4)} tokens)`);

    const masterRaw = await callOpenAI([
      { role: 'system', content: 'You are an expert SEO strategist. Return valid JSON only.' },
      { role: 'user', content: masterPrompt },
    ], 3000, 'master');

    let masterData;
    try {
      masterData = JSON.parse(masterRaw);
    } catch {
      console.error('[Strategy] Master returned invalid JSON:', masterRaw.slice(0, 300));
      const errMsg = 'AI returned invalid JSON in master synthesis';
      if (wantsStream) { try { res.write(`data: ${JSON.stringify({ error: errMsg })}\n\n`); res.end(); } catch { /* closed */ } return; }
      return res.status(500).json({ error: errMsg, raw: masterRaw.slice(0, 500) });
    }

    // Apply keyword conflict fixes from master
    if (masterData.keywordFixes?.length) {
      const fixMap = new Map(masterData.keywordFixes.map((f: { pagePath: string; newPrimaryKeyword: string }) => [f.pagePath, f.newPrimaryKeyword]));
      for (const pm of allPageMappings) {
        const fix = fixMap.get(pm.pagePath);
        if (fix) pm.primaryKeyword = fix as string;
      }
      console.log(`[Strategy] Applied ${masterData.keywordFixes.length} keyword conflict fixes`);
    }

    // Assemble final strategy: batch pageMap + master site-level data
    strategy = {
      siteKeywords: masterData.siteKeywords || [],
      pageMap: allPageMappings,
      opportunities: masterData.opportunities || [],
      contentGaps: masterData.contentGaps || [],
      quickWins: masterData.quickWins || [],
    };
    console.log(`[Strategy] Final strategy: ${strategy.pageMap.length} pages, ${strategy.siteKeywords.length} site keywords, ${strategy.contentGaps.length} content gaps, ${strategy.quickWins.length} quick wins`);

    } finally {
      if (keepalive) clearInterval(keepalive);
    }

    if (!strategy?.pageMap) {
      const errMsg = 'Strategy generation produced no results';
      if (wantsStream) { try { res.write(`data: ${JSON.stringify({ error: errMsg })}\n\n`); res.end(); } catch { /* closed */ } return; }
      return res.status(500).json({ error: errMsg });
    }

    // Enrich pageMap with GSC metrics if available
    sendProgress('enrichment', 'Enriching strategy with ranking data...', 0.90);
    if (gscData.length > 0) {
      for (const pm of strategy.pageMap) {
        const matchingRows = gscData.filter(r => {
          try { return new URL(r.page).pathname === pm.pagePath; } catch { return false; }
        });
        if (matchingRows.length > 0) {
          const kwMatch = matchingRows.find(r => r.query.toLowerCase().includes(pm.primaryKeyword.toLowerCase()));
          const best = kwMatch || matchingRows.sort((a, b) => b.impressions - a.impressions)[0];
          pm.currentPosition = best.position;
          pm.impressions = matchingRows.reduce((s, r) => s + r.impressions, 0);
          pm.clicks = matchingRows.reduce((s, r) => s + r.clicks, 0);
        }
      }
    }

    // Enrich pageMap with SEMRush volume/difficulty data
    if (semrushDomainData.length > 0) {
      // Build lookup: keyword → metrics
      const kwLookup = new Map(semrushDomainData.map(k => [k.keyword.toLowerCase(), k]));
      for (const pm of strategy.pageMap) {
        const match = kwLookup.get(pm.primaryKeyword.toLowerCase());
        if (match) {
          pm.volume = match.volume;
          pm.difficulty = match.difficulty;
          pm.cpc = match.cpc;
        } else {
          // Try partial match
          const partial = semrushDomainData.find(k =>
            k.keyword.toLowerCase().includes(pm.primaryKeyword.toLowerCase()) ||
            pm.primaryKeyword.toLowerCase().includes(k.keyword.toLowerCase())
          );
          if (partial) {
            pm.volume = partial.volume;
            pm.difficulty = partial.difficulty;
            pm.cpc = partial.cpc;
          }
        }
        // Enrich secondary keywords
        if (pm.secondaryKeywords?.length) {
          pm.secondaryMetrics = pm.secondaryKeywords
            .map((sk: string) => {
              const m = kwLookup.get(sk.toLowerCase());
              return m ? { keyword: sk, volume: m.volume, difficulty: m.difficulty } : null;
            })
            .filter(Boolean) as { keyword: string; volume: number; difficulty: number }[];
        }
      }
    }

    // If we still have keywords without volume data and SEMRush is available, bulk-fetch them
    if (isSemrushConfigured() && semrushMode !== 'none') {
      const needsVolume = strategy.pageMap
        .filter((pm: { volume?: number; primaryKeyword: string }) => !pm.volume)
        .map((pm: { primaryKeyword: string }) => pm.primaryKeyword);
      if (needsVolume.length > 0) {
        try {
          const metrics = await getKeywordOverview(needsVolume.slice(0, 30), ws.id);
          const metricMap = new Map(metrics.map(m => [m.keyword.toLowerCase(), m]));
          for (const pm of strategy.pageMap) {
            if (!pm.volume) {
              const m = metricMap.get(pm.primaryKeyword.toLowerCase());
              if (m) {
                pm.volume = m.volume;
                pm.difficulty = m.difficulty;
                pm.cpc = m.cpc;
              }
            }
          }
        } catch (err) {
          console.error('[SEMRush] Keyword overview enrichment error:', err);
        }
      }
    }

    // Enrich siteKeywords with volume/difficulty
    let siteKeywordMetrics: { keyword: string; volume: number; difficulty: number }[] = [];
    if (isSemrushConfigured() && semrushMode !== 'none' && strategy.siteKeywords?.length) {
      const kwLookup = new Map(semrushDomainData.map(k => [k.keyword.toLowerCase(), k]));
      const found: typeof siteKeywordMetrics = [];
      const missing: string[] = [];
      for (const kw of strategy.siteKeywords) {
        const m = kwLookup.get(kw.toLowerCase());
        if (m) {
          found.push({ keyword: kw, volume: m.volume, difficulty: m.difficulty });
        } else {
          missing.push(kw);
        }
      }
      if (missing.length > 0) {
        try {
          const extra = await getKeywordOverview(missing.slice(0, 15), ws.id);
          for (const m of extra) {
            found.push({ keyword: m.keyword, volume: m.volume, difficulty: m.difficulty });
          }
        } catch { /* non-critical */ }
      }
      siteKeywordMetrics = found;
    }

    // 7. Save to workspace
    sendProgress('complete', 'Strategy complete!', 1.0);
    const keywordStrategy = {
      ...strategy,
      siteKeywordMetrics: siteKeywordMetrics.length > 0 ? siteKeywordMetrics : undefined,
      keywordGaps: keywordGaps.length > 0 ? keywordGaps.slice(0, 30) : undefined,
      businessContext: businessContext || undefined,
      semrushMode: semrushMode as 'quick' | 'full' | 'none',
      generatedAt: new Date().toISOString(),
    };
    updateWorkspace(ws.id, { keywordStrategy });

    if (wantsStream) {
      res.write(`data: ${JSON.stringify({ done: true, strategy: keywordStrategy })}\n\n`);
      return res.end();
    }
    res.json(keywordStrategy);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : '';
    console.error('Keyword strategy error:', msg, stack);
    if (wantsStream) {
      try { res.write(`data: ${JSON.stringify({ error: msg })}\n\n`); res.end(); } catch { /* already closed */ }
      return;
    }
    res.status(500).json({ error: msg });
  }
});

// --- SEMRush Utilities ---
app.get('/api/semrush/status', (_req, res) => {
  res.json({ configured: isSemrushConfigured() });
});

app.post('/api/semrush/estimate', (req, res) => {
  const { mode, competitorCount, keywordCount } = req.body;
  res.json({ credits: estimateCreditCost({ mode: mode || 'quick', competitorCount, keywordCount }) });
});

app.delete('/api/semrush/cache/:workspaceId', (req, res) => {
  clearSemrushCache(req.params.workspaceId);
  res.json({ ok: true });
});

// Get stored keyword strategy
app.get('/api/webflow/keyword-strategy/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  res.json(ws.keywordStrategy || null);
});

// Update keyword strategy (manual edits)
app.patch('/api/webflow/keyword-strategy/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const updated = { ...(ws.keywordStrategy || {}), ...req.body, generatedAt: new Date().toISOString() };
  updateWorkspace(ws.id, { keywordStrategy: updated });
  res.json(updated);
});

// --- Approvals (admin, authenticated) ---
app.post('/api/approvals/:workspaceId', (req, res) => {
  const { siteId, name, items } = req.body;
  if (!siteId || !items?.length) return res.status(400).json({ error: 'siteId and items required' });
  const batch = createBatch(req.params.workspaceId, siteId, name || 'SEO Changes', items);
  res.json(batch);
});

app.get('/api/approvals/:workspaceId', (req, res) => {
  res.json(listBatches(req.params.workspaceId));
});

app.get('/api/approvals/:workspaceId/:batchId', (req, res) => {
  const batch = getBatch(req.params.workspaceId, req.params.batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  res.json(batch);
});

app.delete('/api/approvals/:workspaceId/:batchId', (req, res) => {
  deleteBatch(req.params.workspaceId, req.params.batchId);
  res.json({ ok: true });
});

// --- Public Client Dashboard API (no auth required) ---
app.get('/api/public/workspace/:id', (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (ws.clientPortalEnabled != null && !ws.clientPortalEnabled) return res.status(403).json({ error: 'Client portal is disabled for this workspace' });
  // Only expose safe fields for client view
  res.json({
    id: ws.id,
    name: ws.name,
    webflowSiteId: ws.webflowSiteId,
    webflowSiteName: ws.webflowSiteName,
    gscPropertyUrl: ws.gscPropertyUrl,
    ga4PropertyId: ws.ga4PropertyId,
    liveDomain: ws.liveDomain,
    eventConfig: ws.eventConfig || [],
    eventGroups: ws.eventGroups || [],
    requiresPassword: !!ws.clientPassword,
    // Feature toggles
    clientPortalEnabled: ws.clientPortalEnabled != null ? !!ws.clientPortalEnabled : true,
    seoClientView: !!ws.seoClientView,
    analyticsClientView: !!ws.analyticsClientView,
    autoReports: !!ws.autoReports,
    // Branding
    brandLogoUrl: ws.brandLogoUrl || '',
    brandAccentColor: ws.brandAccentColor || '',
    // Content pricing
    contentPricing: ws.contentPricing || null,
  });
});

const clientLoginLimiter = rateLimit(60 * 1000, 5); // 5 attempts per minute per IP
app.post('/api/public/auth/:id', clientLoginLimiter, (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: 'Not found' });
  if (!ws.clientPassword) return res.json({ ok: true });
  const { password } = req.body;
  if (password === ws.clientPassword) {
    // Issue signed session cookie for server-side verification
    const sessionToken = signClientSession(ws.id);
    res.cookie(`client_session_${ws.id}`, sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      secure: IS_PROD,
    });
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Incorrect password' });
});

// --- Public SEO Strategy (client dashboard, gated behind seoClientView) ---
app.get('/api/public/seo-strategy/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (!ws.seoClientView) return res.status(403).json({ error: 'SEO strategy view is not enabled' });
  const strategy = ws.keywordStrategy;
  if (!strategy) return res.json(null);
  // Return client-safe subset (no semrushMode, no internal-only fields)
  res.json({
    siteKeywords: strategy.siteKeywords || [],
    siteKeywordMetrics: strategy.siteKeywordMetrics || undefined,
    pageMap: (strategy.pageMap || []).map(p => ({
      pagePath: p.pagePath,
      pageTitle: p.pageTitle,
      primaryKeyword: p.primaryKeyword,
      secondaryKeywords: p.secondaryKeywords || [],
      searchIntent: p.searchIntent,
      currentPosition: p.currentPosition,
      impressions: p.impressions,
      clicks: p.clicks,
      volume: p.volume,
      difficulty: p.difficulty,
    })),
    opportunities: strategy.opportunities || [],
    contentGaps: (strategy.contentGaps || []).map(g => ({
      topic: g.topic,
      targetKeyword: g.targetKeyword,
      intent: g.intent,
      priority: g.priority,
      rationale: g.rationale,
    })),
    quickWins: (strategy.quickWins || []).map(q => ({
      pagePath: q.pagePath,
      action: q.action,
      estimatedImpact: q.estimatedImpact,
      rationale: q.rationale,
    })),
    keywordGaps: (strategy.keywordGaps || []).slice(0, 20).map(g => ({
      keyword: g.keyword,
      volume: g.volume,
      difficulty: g.difficulty,
    })),
    businessContext: strategy.businessContext || '',
    generatedAt: strategy.generatedAt,
  });
});

// --- Public Content Topic Requests (client picks topics from strategy) ---
app.post('/api/public/content-request/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const { topic, targetKeyword, intent, priority, rationale, clientNote, serviceType } = req.body;
  if (!topic || !targetKeyword) return res.status(400).json({ error: 'topic and targetKeyword are required' });
  const request = createContentRequest(req.params.workspaceId, { topic, targetKeyword, intent, priority, rationale, clientNote, serviceType });
  addActivity(req.params.workspaceId, 'content_requested', `Content topic requested: "${topic}"`, `Keyword: "${targetKeyword}" · Priority: ${priority}`, { requestId: request.id });
  notifyTeamContentRequest({ workspaceName: ws.name, topic, targetKeyword, priority, rationale: rationale || '' }).catch(() => {});
  res.json(request);
});

// Client can see their own requests (with comments and brief access for review)
app.get('/api/public/content-requests/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const requests = listContentRequests(req.params.workspaceId);
  res.json(requests.map(r => ({
    id: r.id, topic: r.topic, targetKeyword: r.targetKeyword, intent: r.intent,
    priority: r.priority, status: r.status, source: r.source,
    serviceType: r.serviceType || 'brief_only', upgradedAt: r.upgradedAt,
    comments: r.comments || [], requestedAt: r.requestedAt, updatedAt: r.updatedAt,
    // Include briefId only when in client_review or later
    briefId: ['client_review', 'approved', 'changes_requested', 'in_progress', 'delivered'].includes(r.status) ? r.briefId : undefined,
  })));
});

// Client submits their own topic request
app.post('/api/public/content-request/:workspaceId/submit', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const { topic, targetKeyword, notes, serviceType } = req.body;
  if (!topic || !targetKeyword) return res.status(400).json({ error: 'topic and targetKeyword are required' });
  const request = createContentRequest(req.params.workspaceId, {
    topic, targetKeyword, intent: 'informational', priority: 'medium',
    rationale: notes || `Client-submitted topic: ${topic}`,
    clientNote: notes, source: 'client', serviceType: serviceType || 'brief_only',
  });
  addActivity(req.params.workspaceId, 'content_requested', `Client submitted topic: "${topic}"`, `Keyword: "${targetKeyword}"`, { requestId: request.id });
  notifyTeamContentRequest({ workspaceName: ws.name, topic, targetKeyword, priority: 'medium', rationale: notes || '' }).catch(() => {});
  res.json(request);
});

// Client declines a recommended topic
app.post('/api/public/content-request/:workspaceId/:id/decline', (req, res) => {
  const { reason } = req.body;
  const updated = updateContentRequest(req.params.workspaceId, req.params.id, {
    status: 'declined', declineReason: reason || '',
  });
  if (!updated) return res.status(404).json({ error: 'Request not found' });
  addActivity(req.params.workspaceId, 'content_declined', `Client declined topic: "${updated.topic}"`, reason || 'No reason given', { requestId: updated.id });
  res.json(updated);
});

// Client approves a brief
app.post('/api/public/content-request/:workspaceId/:id/approve', (req, res) => {
  const updated = updateContentRequest(req.params.workspaceId, req.params.id, { status: 'approved' });
  if (!updated) return res.status(404).json({ error: 'Request not found' });
  addActivity(req.params.workspaceId, 'brief_approved', `Client approved brief for "${updated.topic}"`, '', { requestId: updated.id, briefId: updated.briefId });
  res.json(updated);
});

// Client requests changes on a brief
app.post('/api/public/content-request/:workspaceId/:id/request-changes', (req, res) => {
  const { feedback } = req.body;
  const updated = updateContentRequest(req.params.workspaceId, req.params.id, {
    status: 'changes_requested', clientFeedback: feedback || '',
  });
  if (!updated) return res.status(404).json({ error: 'Request not found' });
  addActivity(req.params.workspaceId, 'changes_requested', `Client requested changes on "${updated.topic}"`, feedback || '', { requestId: updated.id });
  res.json(updated);
});

// Client upgrades from brief_only to full_post
app.post('/api/public/content-request/:workspaceId/:id/upgrade', (req, res) => {
  const updated = updateContentRequest(req.params.workspaceId, req.params.id, {
    serviceType: 'full_post',
    upgradedAt: new Date().toISOString(),
  });
  if (!updated) return res.status(404).json({ error: 'Request not found' });
  addActivity(req.params.workspaceId, 'content_upgraded', `Client upgraded "${updated.topic}" to full blog post`, '', { requestId: updated.id });
  res.json(updated);
});

// Client or team adds a comment
app.post('/api/public/content-request/:workspaceId/:id/comment', (req, res) => {
  const { content, author } = req.body;
  if (!content) return res.status(400).json({ error: 'content is required' });
  const updated = addComment(req.params.workspaceId, req.params.id, author || 'client', content);
  if (!updated) return res.status(404).json({ error: 'Request not found' });
  res.json(updated);
});

// Client can view a brief (for review)
app.get('/api/public/content-brief/:workspaceId/:briefId', (req, res) => {
  const brief = getBrief(req.params.workspaceId, req.params.briefId);
  if (!brief) return res.status(404).json({ error: 'Brief not found' });
  // Return client-safe view (exclude internal fields if any)
  res.json(brief);
});

// --- Internal Content Request Management ---
app.get('/api/content-requests/:workspaceId', (req, res) => {
  res.json(listContentRequests(req.params.workspaceId));
});

app.get('/api/content-requests/:workspaceId/:id', (req, res) => {
  const request = getContentRequest(req.params.workspaceId, req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  res.json(request);
});

app.patch('/api/content-requests/:workspaceId/:id', (req, res) => {
  const { status, internalNote } = req.body;
  const updated = updateContentRequest(req.params.workspaceId, req.params.id, { status, internalNote });
  if (!updated) return res.status(404).json({ error: 'Request not found' });
  // Send email when brief is sent to client review
  if (status === 'client_review') {
    const wsInfo = getWorkspace(req.params.workspaceId);
    if (wsInfo?.clientEmail) {
      const origin = req.get('origin') || req.get('referer')?.replace(/\/[^/]*$/, '') || '';
      const dashUrl = origin ? `${origin}/dashboard/${req.params.workspaceId}?tab=content` : undefined;
      notifyClientBriefReady({ clientEmail: wsInfo.clientEmail, workspaceName: wsInfo.name, topic: updated.topic, targetKeyword: updated.targetKeyword, dashboardUrl: dashUrl }).catch(() => {});
    }
  }
  res.json(updated);
});

// Delete a content request
app.delete('/api/content-requests/:workspaceId/:id', (req, res) => {
  const deleted = deleteContentRequest(req.params.workspaceId, req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Request not found' });
  res.json({ ok: true });
});

// Generate a brief for a content request
app.post('/api/content-requests/:workspaceId/:id/generate-brief', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const request = getContentRequest(req.params.workspaceId, req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });

  try {
    // Gather GSC context if available
    let relatedQueries: { query: string; position: number; clicks: number; impressions: number }[] = [];
    if (ws.gscPropertyUrl && ws.webflowSiteId) {
      try {
        const gscData = await getQueryPageData(ws.webflowSiteId, ws.gscPropertyUrl, 90);
        relatedQueries = gscData
          .filter(r => r.query.toLowerCase().includes(request.targetKeyword.split(' ')[0].toLowerCase()))
          .slice(0, 20)
          .map(r => ({ query: r.query, position: r.position, clicks: r.clicks, impressions: r.impressions }));
      } catch { /* GSC unavailable */ }
    }

    const existingPages = ws.keywordStrategy?.pageMap?.map(p => p.pagePath) || [];
    const brief = await generateBrief(req.params.workspaceId, request.targetKeyword, {
      relatedQueries,
      businessContext: ws.keywordStrategy?.businessContext || '',
      existingPages,
    });

    // Link brief to request and update status
    updateContentRequest(req.params.workspaceId, req.params.id, {
      status: 'brief_generated',
      briefId: brief.id,
    });

    addActivity(req.params.workspaceId, 'brief_generated', `Content brief generated for "${request.targetKeyword}"`, `Title: ${brief.suggestedTitle}`, { requestId: request.id, briefId: brief.id });
    res.json(brief);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

// --- Public Approvals (client dashboard, no auth required) ---
app.get('/api/public/approvals/:workspaceId', (req, res) => {
  res.json(listBatches(req.params.workspaceId));
});

app.get('/api/public/approvals/:workspaceId/:batchId', (req, res) => {
  const batch = getBatch(req.params.workspaceId, req.params.batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  res.json(batch);
});

app.patch('/api/public/approvals/:workspaceId/:batchId/:itemId', (req, res) => {
  const { status, clientValue, clientNote } = req.body;
  const batch = updateItem(req.params.workspaceId, req.params.batchId, req.params.itemId, { status, clientValue, clientNote });
  if (!batch) return res.status(404).json({ error: 'Item not found' });
  res.json(batch);
});

// Apply approved items to Webflow
app.post('/api/public/approvals/:workspaceId/:batchId/apply', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.webflowSiteId) return res.status(400).json({ error: 'No site linked' });
  const batch = getBatch(req.params.workspaceId, req.params.batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });

  const token = getTokenForSite(ws.webflowSiteId) || undefined;
  if (!token) return res.status(400).json({ error: 'No Webflow API token' });

  const approved = batch.items.filter(i => i.status === 'approved');
  if (!approved.length) return res.status(400).json({ error: 'No approved items to apply' });

  const results: Array<{ itemId: string; pageId: string; success: boolean; error?: string }> = [];
  const appliedIds: string[] = [];

  for (const item of approved) {
    try {
      const value = item.clientValue || item.proposedValue;
      if (item.field === 'schema') {
        // Schema item — publish JSON-LD to page via schema publisher
        const schema = JSON.parse(value);
        const result = await publishSchemaToPage(ws.webflowSiteId, item.pageId, schema, token);
        if (!result.success) throw new Error(result.error || 'Schema publish failed');
      } else if (item.collectionId) {
        // CMS item — update via collection API
        const result = await updateCollectionItem(item.collectionId, item.pageId, { [item.field]: value }, token);
        if (!result.success) throw new Error(result.error || 'CMS update failed');
      } else {
        // Static page — update via page SEO API
        const fields = item.field === 'seoTitle'
          ? { seo: { title: value } }
          : { seo: { description: value } };
        await updatePageSeo(item.pageId, fields, token);
      }
      appliedIds.push(item.id);
      results.push({ itemId: item.id, pageId: item.pageId, success: true });
    } catch (err) {
      results.push({ itemId: item.id, pageId: item.pageId, success: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (appliedIds.length > 0) {
    markBatchApplied(req.params.workspaceId, req.params.batchId, appliedIds);
    // Log activity
    const batchData = getBatch(req.params.workspaceId, req.params.batchId);
    addActivity(req.params.workspaceId, 'approval_applied',
      `Applied ${appliedIds.length} approved SEO changes`,
      batchData ? `Batch: ${batchData.name}` : undefined,
      { batchId: req.params.batchId, appliedCount: appliedIds.length });
  }

  res.json({ results, applied: appliedIds.length, failed: results.length - appliedIds.length });
});

// --- Client Requests ---
// Public: client creates a request
app.post('/api/public/requests/:workspaceId', (req, res) => {
  const { title, description, category, priority, pageUrl, submittedBy } = req.body;
  if (!title || !description || !category) return res.status(400).json({ error: 'title, description, and category required' });
  const request = createRequest(req.params.workspaceId, { title, description, category, priority, pageUrl, submittedBy });
  broadcast('request:created', request);
  // Email team
  const ws = getWorkspace(req.params.workspaceId);
  if (ws) {
    notifyTeamNewRequest({ workspaceName: ws.name, title, description, category, submittedBy, pageUrl }).catch(() => {});
  }
  res.json(request);
});

// Public: client lists their requests
app.get('/api/public/requests/:workspaceId', (req, res) => {
  res.json(listRequests(req.params.workspaceId));
});

// Public: client views a single request (with notes)
app.get('/api/public/requests/:workspaceId/:requestId', (req, res) => {
  const r = getRequest(req.params.requestId);
  if (!r || r.workspaceId !== req.params.workspaceId) return res.status(404).json({ error: 'Not found' });
  res.json(r);
});

// Public: client adds a note
app.post('/api/public/requests/:workspaceId/:requestId/notes', (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });
  const r = getRequest(req.params.requestId);
  if (!r || r.workspaceId !== req.params.workspaceId) return res.status(404).json({ error: 'Not found' });
  const updated = addNote(req.params.requestId, 'client', content);
  broadcast('request:updated', updated);
  res.json(updated);
});

// Internal: create request (e.g. from audit finding)
app.post('/api/requests', (req, res) => {
  const { workspaceId, title, description, category, priority, pageUrl } = req.body;
  if (!workspaceId || !title || !description) return res.status(400).json({ error: 'workspaceId, title, and description required' });
  const request = createRequest(workspaceId, { title, description, category: category || 'seo', priority, pageUrl, submittedBy: 'Web Team' });
  broadcast('request:created', request);
  res.json(request);
});

// Internal: batch create requests (from audit findings)
app.post('/api/requests/batch', (req, res) => {
  const { workspaceId, items } = req.body as { workspaceId: string; items: Array<{ title: string; description: string; category?: string; priority?: string; pageUrl?: string }> };
  if (!workspaceId || !Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'workspaceId and items[] required' });
  const created = items.map(item =>
    createRequest(workspaceId, { title: item.title, description: item.description, category: (item.category as 'seo') || 'seo', priority: (item.priority as 'high') || 'medium', pageUrl: item.pageUrl, submittedBy: 'Web Team' })
  );
  broadcast('request:batch_created', { count: created.length });
  res.json({ created: created.length, ids: created.map(r => r.id) });
});

// Internal: bulk update request status
app.patch('/api/requests/bulk', (req, res) => {
  const { ids, status, priority } = req.body as { ids: string[]; status?: string; priority?: string };
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids[] required' });
  const updates: Record<string, string> = {};
  if (status) updates.status = status;
  if (priority) updates.priority = priority;
  const results = ids.map(id => updateRequest(id, updates));
  const succeeded = results.filter(Boolean).length;
  broadcast('request:bulk_updated', { count: succeeded, status });
  res.json({ updated: succeeded, total: ids.length });
});

// Internal: list all requests (optionally filtered by workspace)
app.get('/api/requests', (req, res) => {
  const wsId = req.query.workspaceId as string | undefined;
  res.json(listRequests(wsId));
});

// Internal: get single request
app.get('/api/requests/:id', (req, res) => {
  const r = getRequest(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json(r);
});

// Internal: update request status/priority/category
app.patch('/api/requests/:id', (req, res) => {
  const { status, priority, category } = req.body;
  const prev = getRequest(req.params.id);
  const updated = updateRequest(req.params.id, { status, priority, category });
  if (!updated) return res.status(404).json({ error: 'Not found' });
  broadcast('request:updated', updated);
  // Email client on status change
  if (status && prev && status !== prev.status) {
    const ws = getWorkspace(updated.workspaceId);
    if (ws?.clientEmail) {
      const dashUrl = ws.liveDomain ? `${ws.liveDomain.startsWith('http') ? '' : 'https://'}${ws.liveDomain}/client/${ws.id}` : undefined;
      notifyClientStatusChange({ clientEmail: ws.clientEmail, workspaceName: ws.name, requestTitle: updated.title, newStatus: status, dashboardUrl: dashUrl }).catch(() => {});
    }
    // Log activity for completed/closed
    if (status === 'completed' || status === 'closed') {
      addActivity(updated.workspaceId, 'request_resolved', `Resolved request: ${updated.title}`,
        updated.description?.slice(0, 120), { requestId: updated.id, category: updated.category });
    }
  }
  res.json(updated);
});

// Internal: team adds a note
app.post('/api/requests/:id/notes', (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });
  const updated = addNote(req.params.id, 'team', content);
  if (!updated) return res.status(404).json({ error: 'Not found' });
  broadcast('request:updated', updated);
  // Email client
  const ws = getWorkspace(updated.workspaceId);
  if (ws?.clientEmail) {
    const dashUrl = ws.liveDomain ? `${ws.liveDomain.startsWith('http') ? '' : 'https://'}${ws.liveDomain}/client/${ws.id}` : undefined;
    notifyClientTeamResponse({ clientEmail: ws.clientEmail, workspaceName: ws.name, requestTitle: updated.title, noteContent: content, dashboardUrl: dashUrl }).catch(() => {});
  }
  res.json(updated);
});

// Internal: delete request
app.delete('/api/requests/:id', (req, res) => {
  const ok = deleteRequest(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  broadcast('request:deleted', { id: req.params.id });
  res.json({ ok: true });
});

// --- Activity Log ---
// Public: client views activity for their workspace
app.get('/api/public/activity/:workspaceId', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  res.json(listActivity(req.params.workspaceId, limit));
});

// Internal: list activity (optionally filtered by workspace)
app.get('/api/activity', (req, res) => {
  const wsId = req.query.workspaceId as string | undefined;
  const limit = parseInt(req.query.limit as string) || 50;
  res.json(listActivity(wsId, limit));
});

// Internal: manually add an activity entry
app.post('/api/activity', (req, res) => {
  const { workspaceId, type, title, description } = req.body;
  if (!workspaceId || !type || !title) return res.status(400).json({ error: 'workspaceId, type, and title required' });
  const entry = addActivity(workspaceId, type, title, description);
  res.json(entry);
});

// --- Request Attachments ---
function processUploadedAttachments(files: Express.Multer.File[]): RequestAttachment[] {
  const dir = getAttachmentsDir();
  return files.map(f => {
    const id = `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const ext = path.extname(f.originalname) || '';
    const filename = `${id}${ext}`;
    fs.renameSync(f.path, path.join(dir, filename));
    return { id, filename, originalName: f.originalname, mimeType: f.mimetype, size: f.size };
  });
}

// Serve attachment files (public — needed for client dashboard)
app.get('/api/request-attachments/:filename', (req, res) => {
  const filePath = path.join(getAttachmentsDir(), path.basename(req.params.filename));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(filePath);
});

// Upload attachments to an existing request (client or team)
app.post('/api/public/requests/:workspaceId/:requestId/attachments', upload.array('files', 5), (req, res) => {
  const files = req.files as Express.Multer.File[];
  if (!files?.length) return res.status(400).json({ error: 'No files' });
  const r = getRequest(req.params.requestId);
  if (!r || r.workspaceId !== req.params.workspaceId) return res.status(404).json({ error: 'Not found' });
  const atts = processUploadedAttachments(files);
  const updated = addAttachmentsToRequest(req.params.requestId, atts);
  broadcast('request:updated', updated);
  res.json(updated);
});

// Upload attachments with a note (public client)
app.post('/api/public/requests/:workspaceId/:requestId/notes-with-files', upload.array('files', 5), (req, res) => {
  const content = req.body.content || '';
  const files = req.files as Express.Multer.File[];
  if (!content && !files?.length) return res.status(400).json({ error: 'content or files required' });
  const r = getRequest(req.params.requestId);
  if (!r || r.workspaceId !== req.params.workspaceId) return res.status(404).json({ error: 'Not found' });
  const atts = files?.length ? processUploadedAttachments(files) : undefined;
  const updated = addNote(req.params.requestId, 'client', content, atts);
  broadcast('request:updated', updated);
  res.json(updated);
});

// Upload attachments with a note (internal team)
app.post('/api/requests/:id/notes-with-files', upload.array('files', 5), (req, res) => {
  const content = req.body.content || '';
  const files = req.files as Express.Multer.File[];
  if (!content && !files?.length) return res.status(400).json({ error: 'content or files required' });
  const atts = files?.length ? processUploadedAttachments(files) : undefined;
  const updated = addNote(req.params.id, 'team', content, atts);
  if (!updated) return res.status(404).json({ error: 'Not found' });
  broadcast('request:updated', updated);
  // Email client
  const ws = getWorkspace(updated.workspaceId);
  if (ws?.clientEmail && content) {
    const dashUrl = ws.liveDomain ? `${ws.liveDomain.startsWith('http') ? '' : 'https://'}${ws.liveDomain}/client/${ws.id}` : undefined;
    notifyClientTeamResponse({ clientEmail: ws.clientEmail, workspaceName: ws.name, requestTitle: updated.title, noteContent: content, dashboardUrl: dashUrl }).catch(() => {});
  }
  res.json(updated);
});

app.get('/api/public/search-overview/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.webflowSiteId || !ws.gscPropertyUrl) return res.status(400).json({ error: 'Search Console not configured for this workspace' });
  const days = parseInt(req.query.days as string) || 28;
  try {
    const overview = await getSearchOverview(ws.webflowSiteId, ws.gscPropertyUrl, days);
    res.json(overview);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.get('/api/public/performance-trend/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.webflowSiteId || !ws.gscPropertyUrl) return res.status(400).json({ error: 'Search Console not configured' });
  const days = parseInt(req.query.days as string) || 28;
  try {
    const trend = await getPerformanceTrend(ws.webflowSiteId, ws.gscPropertyUrl, days);
    res.json(trend);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.get('/api/public/audit-summary/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.webflowSiteId) return res.status(400).json({ error: 'No site linked' });
  const latest = getLatestSnapshot(ws.webflowSiteId);
  if (!latest) return res.json(null);
  // Return a safe summary
  res.json({
    id: latest.id,
    createdAt: latest.createdAt,
    siteScore: latest.audit.siteScore,
    totalPages: latest.audit.totalPages,
    errors: latest.audit.errors,
    warnings: latest.audit.warnings,
    previousScore: latest.previousScore,
  });
});

app.get('/api/public/audit-detail/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.webflowSiteId) return res.status(400).json({ error: 'No site linked' });
  const latest = getLatestSnapshot(ws.webflowSiteId);
  if (!latest) return res.json(null);
  const history = listSnapshots(ws.webflowSiteId);
  res.json({
    id: latest.id,
    createdAt: latest.createdAt,
    siteName: latest.siteName,
    logoUrl: latest.logoUrl,
    previousScore: latest.previousScore,
    audit: latest.audit,
    scoreHistory: history.map(h => ({ id: h.id, createdAt: h.createdAt, siteScore: h.siteScore })),
  });
});

app.post('/api/public/search-chat/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(400).json({ error: 'Workspace not configured' });
  const { question, context } = req.body;
  if (!question) return res.status(400).json({ error: 'question required' });
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(400).json({ error: 'AI not configured' });

  try {
    const hasSearch = !!(context?.search);
    const hasGA4 = !!(context?.ga4);

    const teamName = 'your web team';
    const systemPrompt = `You are a smart, friendly analytics advisor embedded in a client's website performance dashboard. You work alongside ${teamName} who manages this client's website. Your job is to help the client understand their data, spot opportunities, and feel confident about their website's direction.

${hasSearch ? 'You have access to their Google Search Console data (search queries, clicks, impressions, CTR, positions).' : ''}
${hasGA4 ? `You have access to their Google Analytics 4 data including:
- Site overview (users, sessions, pageviews, bounce rate, session duration)
- Top pages by pageviews
- Traffic sources and mediums
- Device breakdown (desktop, mobile, tablet)
- Tracked events (form submissions, button clicks, custom events, etc.) with event counts and user numbers
- Conversion/key events with conversion rates
- Top countries by users` : ''}

YOUR APPROACH:
1. **Be specific and data-driven** — Always reference actual numbers, queries, pages, and percentages from their data. Vague answers are useless. Show you've actually looked at their data.
2. **Identify clear opportunities** — Don't just report numbers. Tell them what the data MEANS for their business. "Your top query has 10K impressions but 0 clicks — that's a huge untapped audience" is better than "your CTR is low."
3. **Prioritize impact** — Lead with the biggest opportunities. If they ask a general question, highlight the 2-3 things that would move the needle most.
4. **Give quick wins they can do themselves** — Small, non-technical things like "update your Google Business Profile" or "add this topic to your blog calendar" are great to share.
5. **Naturally direct to ${teamName} for deeper work** — For anything involving technical SEO, site redesign, conversion optimization, content strategy, or development work, warmly recommend they bring it up with ${teamName}. Frame it as "this is exactly the kind of thing ${teamName} can help you capitalize on" — never pushy, always helpful.

TONE & STYLE:
- Conversational and warm, like a knowledgeable colleague — not robotic or corporate
- Confident in your analysis but not arrogant
- Use markdown formatting (bold for emphasis, numbered lists for action items, bullet points for data)
- Keep responses focused and scannable — aim for 150-300 words unless the question demands more
- When you see a genuine opportunity, show enthusiasm — "This is really promising" or "There's a great opportunity here"

CRITICAL RULES:
- NEVER give step-by-step technical implementation instructions (code, meta tags, schema markup, etc.)
- NEVER suggest specific tools, plugins, or third-party services by name
- When the opportunity is big or complex, always close with a natural nudge: something like "This could be a great topic to bring up with ${teamName} — they can map out the best approach for your specific situation."
- If directly asked "how do I do this?", share the general direction and what to expect, then say "${teamName} can handle the implementation and make sure it's done right."
- Be honest if the data shows problems — clients respect candor. But always pair problems with the path forward.

Site: ${ws.webflowSiteName || ws.name}
Date range: last ${context?.days || 28} days
Current data context:
${JSON.stringify(context, null, 2)}`;

    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question },
        ],
        temperature: 0.7,
        max_tokens: 1500,
      }),
    });

    if (!aiRes.ok) throw new Error('AI request failed');
    const aiData = await aiRes.json() as { choices: Array<{ message: { content: string } }> };
    res.json({ answer: aiData.choices?.[0]?.message?.content || 'No response generated.' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// --- Public GA4 Analytics API ---
app.get('/api/public/analytics-overview/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.ga4PropertyId) return res.status(400).json({ error: 'GA4 not configured for this workspace' });
  const days = parseInt(req.query.days as string) || 28;
  try {
    const overview = await getGA4Overview(ws.ga4PropertyId, days);
    res.json(overview);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.get('/api/public/analytics-trend/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.ga4PropertyId) return res.status(400).json({ error: 'GA4 not configured' });
  const days = parseInt(req.query.days as string) || 28;
  try {
    const trend = await getGA4DailyTrend(ws.ga4PropertyId, days);
    res.json(trend);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.get('/api/public/analytics-top-pages/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.ga4PropertyId) return res.status(400).json({ error: 'GA4 not configured' });
  const days = parseInt(req.query.days as string) || 28;
  try {
    const pages = await getGA4TopPages(ws.ga4PropertyId, days, 200);
    res.json(pages);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.get('/api/public/analytics-sources/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.ga4PropertyId) return res.status(400).json({ error: 'GA4 not configured' });
  const days = parseInt(req.query.days as string) || 28;
  try {
    const sources = await getGA4TopSources(ws.ga4PropertyId, days);
    res.json(sources);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.get('/api/public/analytics-devices/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.ga4PropertyId) return res.status(400).json({ error: 'GA4 not configured' });
  const days = parseInt(req.query.days as string) || 28;
  try {
    const devices = await getGA4DeviceBreakdown(ws.ga4PropertyId, days);
    res.json(devices);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.get('/api/public/analytics-countries/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.ga4PropertyId) return res.status(400).json({ error: 'GA4 not configured' });
  const days = parseInt(req.query.days as string) || 28;
  try {
    const countries = await getGA4Countries(ws.ga4PropertyId, days);
    res.json(countries);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// --- GA4 Key Events & Conversions ---
app.get('/api/public/analytics-events/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.ga4PropertyId) return res.status(400).json({ error: 'GA4 not configured' });
  const days = parseInt(req.query.days as string) || 28;
  try {
    const events = await getGA4KeyEvents(ws.ga4PropertyId, days);
    res.json(events);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.get('/api/public/analytics-event-trend/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.ga4PropertyId) return res.status(400).json({ error: 'GA4 not configured' });
  const days = parseInt(req.query.days as string) || 28;
  const eventName = req.query.event as string;
  if (!eventName) return res.status(400).json({ error: 'event query param required' });
  try {
    const trend = await getGA4EventTrend(ws.ga4PropertyId, eventName, days);
    res.json(trend);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.get('/api/public/analytics-conversions/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.ga4PropertyId) return res.status(400).json({ error: 'GA4 not configured' });
  const days = parseInt(req.query.days as string) || 28;
  try {
    const conversions = await getGA4Conversions(ws.ga4PropertyId, days);
    res.json(conversions);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// --- GA4 Event Explorer ---
app.get('/api/public/analytics-event-explorer/:workspaceId', async (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.ga4PropertyId) return res.status(400).json({ error: 'GA4 not configured' });
  const days = parseInt(req.query.days as string) || 28;
  const eventName = req.query.event as string | undefined;
  const pagePath = req.query.page as string | undefined;
  try {
    const data = await getGA4EventsByPage(ws.ga4PropertyId, days, { eventName, pagePath });
    res.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Health check
// --- Background Job Endpoints ---
app.get('/api/jobs', (_req, res) => {
  const wsId = _req.query.workspaceId as string | undefined;
  res.json(listJobs(wsId));
});

app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

app.delete('/api/jobs/:id', (req, res) => {
  const job = cancelJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

app.post('/api/jobs', async (req, res) => {
  const { type, params } = req.body as { type: string; params: Record<string, unknown> };
  if (!type) return res.status(400).json({ error: 'type required' });

  try {
    switch (type) {
      case 'seo-audit': {
        const siteId = params.siteId as string;
        if (!siteId) return res.status(400).json({ error: 'siteId required' });
        const token = getTokenForSite(siteId) || undefined;
        if (!token) return res.status(400).json({ error: 'No Webflow API token configured' });
        const job = createJob('seo-audit', { message: 'Running SEO audit...', workspaceId: params.workspaceId as string });
        res.json({ jobId: job.id });
        // Fire and forget
        (async () => {
          try {
            updateJob(job.id, { status: 'running', message: 'Scanning pages...' });
            const result = await runSeoAudit(siteId, token);
            // Auto-save snapshot so overview + client dashboard stay in sync
            const ws = getWorkspace(params.workspaceId as string);
            const siteName = ws?.webflowSiteName || ws?.name || siteId;
            const snapshot = saveSnapshot(siteId, siteName, result);
            if (ws) {
              addActivity(ws.id, 'audit_completed', `Site audit completed — score ${result.siteScore}`,
                `${result.totalPages} pages scanned, ${result.errors} errors, ${result.warnings} warnings`,
                { score: result.siteScore, previousScore: snapshot.previousScore });
            }
            updateJob(job.id, { status: 'done', result: { ...result, snapshotId: snapshot.id }, message: `Audit complete — score ${result.siteScore}` });
          } catch (err) {
            updateJob(job.id, { status: 'error', error: err instanceof Error ? err.message : String(err), message: 'Audit failed' });
          }
        })();
        break;
      }

      case 'compress': {
        const { assetId, imageUrl, siteId, altText, fileName } = params as { assetId: string; imageUrl: string; siteId: string; altText?: string; fileName?: string };
        if (!assetId || !imageUrl || !siteId) return res.status(400).json({ error: 'assetId, imageUrl, siteId required' });
        const compressToken = getTokenForSite(siteId) || undefined;
        const job = createJob('compress', { message: `Compressing ${fileName || 'image'}...`, workspaceId: params.workspaceId as string });
        res.json({ jobId: job.id });
        (async () => {
          try {
            updateJob(job.id, { status: 'running' });
            const sharp = (await import('sharp')).default;
            const response = await fetch(imageUrl);
            const originalBuffer = Buffer.from(await response.arrayBuffer());
            const originalSize = originalBuffer.length;
            const ext = (fileName || imageUrl).split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
            let compressed: Buffer;
            let newFileName: string;
            const baseName = (fileName || 'image').replace(/\.[^.]+$/, '');

            if (ext === 'svg') {
              const svgo = await import('svgo');
              const svgString = originalBuffer.toString('utf-8');
              const svgResult = svgo.optimize(svgString, { multipass: true, plugins: ['preset-default'] } as Parameters<typeof svgo.optimize>[1]);
              compressed = Buffer.from(svgResult.data, 'utf-8');
              newFileName = `${baseName}.svg`;
            } else if (ext === 'jpg' || ext === 'jpeg') {
              compressed = await sharp(originalBuffer).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
              newFileName = `${baseName}.jpg`;
            } else if (ext === 'png') {
              const webpBuffer = await sharp(originalBuffer).webp({ quality: 80 }).toBuffer();
              const pngBuffer = await sharp(originalBuffer).png({ compressionLevel: 9, palette: true }).toBuffer();
              if (webpBuffer.length < pngBuffer.length) { compressed = webpBuffer; newFileName = `${baseName}.webp`; }
              else { compressed = pngBuffer; newFileName = `${baseName}.png`; }
            } else {
              compressed = await sharp(originalBuffer).webp({ quality: 80 }).toBuffer();
              newFileName = `${baseName}.webp`;
            }

            const newSize = compressed.length;
            const savings = originalSize - newSize;
            const savingsPercent = Math.round((savings / originalSize) * 100);

            if (savingsPercent < 3) {
              updateJob(job.id, { status: 'done', result: { skipped: true, reason: `Already optimized (only ${savingsPercent}% savings)` }, message: 'Already optimized' });
              return;
            }

            const tmpPath = `/tmp/compressed_${Date.now()}_${newFileName}`;
            fs.writeFileSync(tmpPath, compressed);
            const uploadResult = await uploadAsset(siteId, tmpPath, newFileName, altText, compressToken);
            try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }

            if (!uploadResult.success) {
              updateJob(job.id, { status: 'error', error: uploadResult.error, message: 'Upload failed' });
              return;
            }
            await deleteAsset(assetId, compressToken);
            updateJob(job.id, {
              status: 'done',
              result: { success: true, newAssetId: uploadResult.assetId, originalSize, newSize, savings, savingsPercent, newFileName },
              message: `Saved ${Math.round(savings / 1024)}KB (${savingsPercent}%)`,
            });
          } catch (err) {
            updateJob(job.id, { status: 'error', error: err instanceof Error ? err.message : String(err), message: 'Compression failed' });
          }
        })();
        break;
      }

      case 'bulk-compress': {
        const { assets, siteId } = params as { assets: Array<{ assetId: string; imageUrl: string; altText?: string; fileName?: string }>; siteId: string };
        if (!assets?.length || !siteId) return res.status(400).json({ error: 'assets and siteId required' });
        const job = createJob('bulk-compress', { message: `Compressing ${assets.length} assets...`, total: assets.length, workspaceId: params.workspaceId as string });
        res.json({ jobId: job.id });
        (async () => {
          try {
            updateJob(job.id, { status: 'running', progress: 0 });
            let totalSaved = 0;
            const results: unknown[] = [];
            for (let i = 0; i < assets.length; i++) {
              const asset = assets[i];
              try {
                const compressRes = await fetch(`http://localhost:${PORT}/api/webflow/compress/${asset.assetId}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', ...(APP_PASSWORD ? { 'x-auth-token': APP_PASSWORD } : {}) },
                  body: JSON.stringify({ imageUrl: asset.imageUrl, siteId, altText: asset.altText, fileName: asset.fileName }),
                });
                const r = await compressRes.json() as Record<string, unknown>;
                results.push({ assetId: asset.assetId, ...r });
                if (typeof r.savings === 'number') totalSaved += r.savings;
              } catch (err) {
                results.push({ assetId: asset.assetId, error: String(err) });
              }
              updateJob(job.id, { progress: i + 1, message: `Compressed ${i + 1}/${assets.length} (${Math.round(totalSaved / 1024)}KB saved)` });
            }
            updateJob(job.id, { status: 'done', result: { results, totalSaved }, progress: assets.length, message: `Done — saved ${Math.round(totalSaved / 1024)}KB total` });
          } catch (err) {
            updateJob(job.id, { status: 'error', error: err instanceof Error ? err.message : String(err), message: 'Bulk compress failed' });
          }
        })();
        break;
      }

      case 'bulk-alt': {
        const { assets: altAssets, siteId: altSiteId } = params as { assets: Array<{ assetId: string; imageUrl: string }>; siteId?: string };
        if (!altAssets?.length) return res.status(400).json({ error: 'assets required' });
        const job = createJob('bulk-alt', { message: `Generating alt text for ${altAssets.length} images...`, total: altAssets.length, workspaceId: params.workspaceId as string });
        res.json({ jobId: job.id });
        (async () => {
          try {
            updateJob(job.id, { status: 'running', progress: 0 });
            const token = altSiteId ? (getTokenForSite(altSiteId) || undefined) : undefined;
            const results: Array<{ assetId: string; altText?: string; updated: boolean; error?: string }> = [];
            for (let i = 0; i < altAssets.length; i++) {
              const asset = altAssets[i];
              try {
                const imgRes = await fetch(asset.imageUrl);
                if (!imgRes.ok) { results.push({ assetId: asset.assetId, updated: false, error: `Download failed: ${imgRes.status}` }); continue; }
                const buffer = Buffer.from(await imgRes.arrayBuffer());
                const imgExt = path.extname(asset.imageUrl).split('?')[0] || '.jpg';
                const tmpPath = `/tmp/bulk_alt_${Date.now()}${imgExt}`;
                fs.writeFileSync(tmpPath, buffer);
                const altTextResult = await generateAltText(tmpPath);
                try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
                if (altTextResult) {
                  await updateAsset(asset.assetId, { altText: altTextResult }, token);
                  results.push({ assetId: asset.assetId, altText: altTextResult, updated: true });
                } else {
                  results.push({ assetId: asset.assetId, updated: false, error: 'Generation returned null' });
                }
              } catch (err) {
                results.push({ assetId: asset.assetId, updated: false, error: String(err) });
              }
              updateJob(job.id, { progress: i + 1, message: `Generated ${i + 1}/${altAssets.length} alt texts` });
            }
            updateJob(job.id, { status: 'done', result: results, progress: altAssets.length, message: `Done — ${results.filter(r => r.updated).length}/${altAssets.length} updated` });
          } catch (err) {
            updateJob(job.id, { status: 'error', error: err instanceof Error ? err.message : String(err), message: 'Bulk alt text failed' });
          }
        })();
        break;
      }

      case 'bulk-seo-fix': {
        const { siteId: seoSiteId, pages, field, workspaceId: bwsId } = params as { siteId: string; pages: Array<{ pageId: string; title: string; slug?: string; currentSeoTitle?: string; currentDescription?: string }>; field: 'title' | 'description'; workspaceId?: string };
        if (!seoSiteId || !pages?.length || !field) return res.status(400).json({ error: 'siteId, pages, field required' });
        const job = createJob('bulk-seo-fix', { message: `Fixing ${field}s for ${pages.length} pages...`, total: pages.length, workspaceId: bwsId });
        res.json({ jobId: job.id });
        (async () => {
          try {
            updateJob(job.id, { status: 'running', progress: 0 });
            const openaiKey = process.env.OPENAI_API_KEY;
            const token = getTokenForSite(seoSiteId) || undefined;
            if (!openaiKey) { updateJob(job.id, { status: 'error', error: 'OPENAI_API_KEY not configured', message: 'Missing API key' }); return; }
            const results: Array<{ pageId: string; text: string; applied: boolean; error?: string }> = [];
            for (let i = 0; i < pages.length; i++) {
              const page = pages[i];
              try {
                const { keywordBlock: kwb, brandVoiceBlock: bvb } = buildSeoContext(bwsId, page.slug ? `/${page.slug}` : undefined);
                const prompt = field === 'description'
                  ? `Write a compelling meta description (150-160 chars max) for a page titled "${page.title}". Current description: "${page.currentDescription || 'none'}".${kwb}${bvb}\nReturn ONLY the text.`
                  : `Write an SEO title tag (50-60 chars max) for a page titled "${page.title}". Current SEO title: "${page.currentSeoTitle || 'none'}".${kwb}${bvb}\nReturn ONLY the text.`;
                const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: 200, temperature: 0.7 }),
                });
                const aiData = await aiRes.json() as { choices?: Array<{ message?: { content?: string } }> };
                let text = aiData.choices?.[0]?.message?.content?.trim() || '';
                text = text.replace(/^["']|["']$/g, '');
                const maxLen = field === 'description' ? 160 : 60;
                if (text.length > maxLen) { const t = text.slice(0, maxLen); const ls = t.lastIndexOf(' '); text = ls > maxLen * 0.6 ? t.slice(0, ls) : t; }
                if (text) {
                  const seoFields = field === 'description' ? { seo: { description: text } } : { seo: { title: text } };
                  await updatePageSeo(page.pageId, seoFields, token);
                  results.push({ pageId: page.pageId, text, applied: true });
                } else {
                  results.push({ pageId: page.pageId, text: '', applied: false, error: 'Empty AI response' });
                }
              } catch (err) {
                results.push({ pageId: page.pageId, text: '', applied: false, error: String(err) });
              }
              updateJob(job.id, { progress: i + 1, message: `Fixed ${i + 1}/${pages.length} ${field}s` });
            }
            updateJob(job.id, { status: 'done', result: { results, field }, progress: pages.length, message: `Done — ${results.filter(r => r.applied).length}/${pages.length} ${field}s updated` });
          } catch (err) {
            updateJob(job.id, { status: 'error', error: err instanceof Error ? err.message : String(err), message: 'Bulk SEO fix failed' });
          }
        })();
        break;
      }

      case 'sales-report': {
        const { url, maxPages } = params as { url: string; maxPages?: number };
        if (!url) return res.status(400).json({ error: 'url required' });
        const job = createJob('sales-report', { message: `Auditing ${url}...` });
        res.json({ jobId: job.id });
        (async () => {
          try {
            updateJob(job.id, { status: 'running', message: 'Crawling site...' });
            const result = await runSalesAudit(url, maxPages || 25);
            const reportsDir = getDataDir('sales-reports');
            const reportId = `sr_${Date.now()}`;
            const reportFile = path.join(reportsDir, `${reportId}.json`);
            fs.writeFileSync(reportFile, JSON.stringify({ id: reportId, ...result, createdAt: new Date().toISOString() }));
            updateJob(job.id, { status: 'done', result: { id: reportId, ...result }, message: `Audit complete — score ${result.siteScore}` });
          } catch (err) {
            updateJob(job.id, { status: 'error', error: err instanceof Error ? err.message : String(err), message: 'Sales report failed' });
          }
        })();
        break;
      }

      case 'keyword-strategy': {
        const wsId = params.workspaceId as string;
        if (!wsId) return res.status(400).json({ error: 'workspaceId required' });
        const stratWs = getWorkspace(wsId);
        if (!stratWs) return res.status(404).json({ error: 'Workspace not found' });
        if (!stratWs.webflowSiteId) return res.status(400).json({ error: 'No Webflow site linked' });
        if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
        const job = createJob('keyword-strategy', { message: 'Generating keyword strategy...', workspaceId: wsId });
        res.json({ jobId: job.id });
        (async () => {
          try {
            updateJob(job.id, { status: 'running', message: 'Fetching pages and analyzing keywords...' });
            // Call the existing strategy endpoint internally
            const stratUrl = `http://localhost:${PORT}/api/webflow/keyword-strategy/${wsId}`;
            const businessContext = (params.businessContext as string) || stratWs.keywordStrategy?.businessContext || '';
            const semrushMode = (params.semrushMode as string) || 'none';
            const competitorDomains = (params.competitorDomains as string[]) || stratWs.competitorDomains || [];
            const stratRes = await fetch(stratUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(APP_PASSWORD ? { 'x-auth-token': APP_PASSWORD } : {}) },
              body: JSON.stringify({ businessContext, semrushMode, competitorDomains }),
            });
            if (!stratRes.ok) {
              const errText = await stratRes.text();
              throw new Error(`Strategy generation failed: ${errText.slice(0, 200)}`);
            }
            const stratResult = await stratRes.json();
            const pageCount = (stratResult as Record<string, unknown[]>).pageMap?.length || 0;
            updateJob(job.id, {
              status: 'done',
              result: stratResult,
              message: `Strategy complete — ${pageCount} pages mapped`,
            });
            addActivity(wsId, 'strategy_generated', 'Keyword strategy generated', `${pageCount} pages mapped with keywords and search intent`);
          } catch (err) {
            updateJob(job.id, { status: 'error', error: err instanceof Error ? err.message : String(err), message: 'Strategy generation failed' });
          }
        })();
        break;
      }

      case 'schema-generator': {
        const schemaSiteId = params.siteId as string;
        if (!schemaSiteId) return res.status(400).json({ error: 'siteId required' });
        const schemaToken = getTokenForSite(schemaSiteId) || undefined;
        if (!schemaToken) return res.status(400).json({ error: 'No Webflow API token configured' });
        const job = createJob('schema-generator', { message: 'Generating schemas...', workspaceId: params.workspaceId as string });
        registerAbort(job.id);
        res.json({ jobId: job.id });
        (async () => {
          try {
            updateJob(job.id, { status: 'running', message: 'Scanning pages and generating unified schemas...' });
            const { ctx, pageKeywordMap } = buildSchemaContext(schemaSiteId);
            const schemaWsId = (params.workspaceId as string) || '';
            // Debounced incremental save — persist partial results every 10s
            let lastSaveTime = 0;
            const SAVE_INTERVAL = 10_000;
            const result = await generateSchemaSuggestions(schemaSiteId, schemaToken, ctx, pageKeywordMap, (partial, _done, message) => {
              updateJob(job.id, { status: 'running', result: partial, message, progress: partial.length });
              const now = Date.now();
              if (partial.length > 0 && now - lastSaveTime >= SAVE_INTERVAL) {
                lastSaveTime = now;
                saveSchemaSnapshot(schemaSiteId, schemaWsId, partial);
              }
            }, () => isJobCancelled(job.id));
            // Final save — always write the complete result
            if (result.length > 0) {
              saveSchemaSnapshot(schemaSiteId, schemaWsId, result);
            }
            if (isJobCancelled(job.id)) {
              updateJob(job.id, { status: 'cancelled', result, message: `Cancelled — ${result.length} pages completed before stop` });
            } else {
              updateJob(job.id, {
                status: 'done',
                result,
                message: `Done — ${result.length} page schemas generated`,
                progress: result.length,
                total: result.length,
              });
            }
            // Log to activity feed
            if (schemaWsId && result.length > 0) {
              addActivity(schemaWsId, 'schema_generated', `Schema generated for ${result.length} pages`, isJobCancelled(job.id) ? 'Partially completed (cancelled)' : 'All pages processed');
            }
          } catch (err) {
            if (!isJobCancelled(job.id)) {
              updateJob(job.id, { status: 'error', error: err instanceof Error ? err.message : String(err), message: 'Schema generation failed' });
            }
          }
        })();
        break;
      }

      default:
        return res.status(400).json({ error: `Unknown job type: ${type}` });
    }
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    hasWebflowToken: !!process.env.WEBFLOW_API_TOKEN,
    hasGoogleAuth: !!getGoogleCredentials(),
    hasEmailConfig: isEmailConfigured(),
    notificationEmail: process.env.NOTIFICATION_EMAIL || null,
  });
});

// --- Annotations ---
// Public: list annotations for a workspace
app.get('/api/public/annotations/:workspaceId', (req, res) => {
  res.json(listAnnotations(req.params.workspaceId));
});

// Internal: list annotations
app.get('/api/annotations/:workspaceId', (req, res) => {
  res.json(listAnnotations(req.params.workspaceId));
});

// Internal: add annotation
app.post('/api/annotations/:workspaceId', (req, res) => {
  const { date, label, description, color } = req.body;
  if (!date || !label) return res.status(400).json({ error: 'date and label required' });
  res.json(addAnnotation(req.params.workspaceId, date, label, description, color));
});

// Internal: delete annotation
app.delete('/api/annotations/:workspaceId/:id', (req, res) => {
  deleteAnnotation(req.params.workspaceId, req.params.id);
  res.json({ ok: true });
});

// --- Rank Tracking ---
// Get tracked keywords for a workspace
app.get('/api/rank-tracking/:workspaceId/keywords', (req, res) => {
  res.json(getTrackedKeywords(req.params.workspaceId));
});

// Add a tracked keyword
app.post('/api/rank-tracking/:workspaceId/keywords', (req, res) => {
  const { query, pinned } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });
  res.json(addTrackedKeyword(req.params.workspaceId, query, pinned));
});

// Remove a tracked keyword
app.delete('/api/rank-tracking/:workspaceId/keywords/:query', (req, res) => {
  res.json(removeTrackedKeyword(req.params.workspaceId, decodeURIComponent(req.params.query)));
});

// Toggle pin on a tracked keyword
app.patch('/api/rank-tracking/:workspaceId/keywords/:query/pin', (req, res) => {
  res.json(togglePinKeyword(req.params.workspaceId, decodeURIComponent(req.params.query)));
});

// Capture a rank snapshot from current GSC data
app.post('/api/rank-tracking/:workspaceId/snapshot', async (req, res) => {
  try {
    const ws = getWorkspace(req.params.workspaceId);
    if (!ws?.gscPropertyUrl) return res.status(400).json({ error: 'No GSC property linked' });
    const overview = await getSearchOverview(ws.id, ws.gscPropertyUrl, 7);
    const date = new Date().toISOString().split('T')[0];
    const queries = overview.topQueries.map(q => ({
      query: q.query, position: q.position, clicks: q.clicks, impressions: q.impressions, ctr: q.ctr,
    }));
    storeRankSnapshot(req.params.workspaceId, date, queries);
    addActivity(req.params.workspaceId, 'rank_snapshot', 'Rank snapshot captured', `${queries.length} keyword positions recorded for ${date}`);
    res.json({ date, count: queries.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to capture snapshot' });
  }
});

// Get rank history (for charting)
app.get('/api/rank-tracking/:workspaceId/history', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 90;
  const queries = req.query.queries ? (req.query.queries as string).split(',') : undefined;
  res.json(getRankHistory(req.params.workspaceId, queries, limit));
});

// Get latest ranks with change indicators
app.get('/api/rank-tracking/:workspaceId/latest', (req, res) => {
  res.json(getLatestRanks(req.params.workspaceId));
});

// Public: client can view rank history
app.get('/api/public/rank-tracking/:workspaceId/history', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 90;
  const queries = req.query.queries ? (req.query.queries as string).split(',') : undefined;
  res.json(getRankHistory(req.params.workspaceId, queries, limit));
});

// Public: client can view latest ranks
app.get('/api/public/rank-tracking/:workspaceId/latest', (req, res) => {
  res.json(getLatestRanks(req.params.workspaceId));
});

// --- Scheduled Audits ---
app.get('/api/audit-schedules', (_req, res) => {
  res.json(listSchedules());
});

app.get('/api/audit-schedules/:workspaceId', (req, res) => {
  const schedule = getSchedule(req.params.workspaceId);
  if (!schedule) return res.status(404).json({ error: 'No schedule found' });
  res.json(schedule);
});

app.put('/api/audit-schedules/:workspaceId', (req, res) => {
  const { enabled, intervalDays, scoreDropThreshold } = req.body;
  const schedule = upsertSchedule(req.params.workspaceId, { enabled, intervalDays, scoreDropThreshold });
  res.json(schedule);
});

app.delete('/api/audit-schedules/:workspaceId', (req, res) => {
  deleteSchedule(req.params.workspaceId);
  res.json({ ok: true });
});

// --- Content Briefs ---
// List all briefs for a workspace
app.get('/api/content-briefs/:workspaceId', (req, res) => {
  const briefs = listBriefs(req.params.workspaceId);
  console.log(`[Briefs] LIST ${req.params.workspaceId}: ${briefs.length} briefs found`);
  res.json(briefs);
});

// Get a specific brief
app.get('/api/content-briefs/:workspaceId/:briefId', (req, res) => {
  console.log(`[Briefs] GET ${req.params.workspaceId}/${req.params.briefId}`);
  const brief = getBrief(req.params.workspaceId, req.params.briefId);
  if (!brief) {
    console.log(`[Briefs] NOT FOUND: ${req.params.briefId} in workspace ${req.params.workspaceId}`);
    return res.status(404).json({ error: 'Brief not found' });
  }
  console.log(`[Briefs] FOUND: "${brief.targetKeyword}"`);
  res.json(brief);
});

// Generate a new content brief
app.post('/api/content-briefs/:workspaceId/generate', async (req, res) => {
  try {
    const { targetKeyword, businessContext } = req.body;
    if (!targetKeyword) return res.status(400).json({ error: 'targetKeyword required' });

    const ws = getWorkspace(req.params.workspaceId);
    let relatedQueries: { query: string; position: number; clicks: number; impressions: number }[] = [];
    let existingPages: string[] = [];

    // Fetch GSC data if available
    if (ws?.gscPropertyUrl) {
      try {
        const overview = await getSearchOverview(ws.id, ws.gscPropertyUrl, 28);
        relatedQueries = overview.topQueries
          .filter(q => q.query.toLowerCase().includes(targetKeyword.toLowerCase().split(' ')[0]))
          .slice(0, 20);
        existingPages = overview.topPages.map(p => {
          try { return new URL(p.page).pathname; } catch { return p.page; }
        });
      } catch { /* GSC not available */ }
    }

    const brief = await generateBrief(req.params.workspaceId, targetKeyword, {
      relatedQueries,
      businessContext: businessContext || ws?.keywordStrategy?.businessContext,
      existingPages,
    });
    res.json(brief);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to generate brief' });
  }
});

// Export a brief as branded HTML
app.get('/api/content-briefs/:workspaceId/:briefId/export', (req, res) => {
  const brief = getBrief(req.params.workspaceId, req.params.briefId);
  if (!brief) return res.status(404).json({ error: 'Brief not found' });
  const html = renderBriefHTML(brief);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// Delete a brief
app.delete('/api/content-briefs/:workspaceId/:briefId', (req, res) => {
  deleteBrief(req.params.workspaceId, req.params.briefId);
  res.json({ ok: true });
});

// --- Monthly Reports ---
// Manual trigger: generate + optionally email a monthly report
app.post('/api/monthly-report/:workspaceId', async (req, res) => {
  try {
    const result = await triggerMonthlyReport(req.params.workspaceId);
    res.json({ sent: result.sent, html: result.html });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to generate report' });
  }
});

// --- Serve frontend in production (MUST be after all API routes) ---
if (IS_PROD) {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Start audit scheduler
startScheduler();
// Start approval reminders
startApprovalReminders();
// Start monthly reports
startMonthlyReports();

// Start
const PORT = parseInt(process.env.PORT || '3001', 10);
startWatcher(broadcast);
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
