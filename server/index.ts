import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  listWorkspaces,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  getUploadRoot,
  getOptRoot,
  getTokenForSite,
} from './workspaces.js';
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
  listPages,
  filterPublishedPages,
  getPageDom,
  updatePageSeo,
  publishSite,
  uploadAsset,
  listAssetFolders,
  createAssetFolder,
  moveAssetToFolder,
  getSiteSubdomain,
} from './webflow.js';
import { generateAltText } from './alttext.js';
import { runSeoAudit } from './seo-audit.js';
import { checkSiteLinks } from './link-checker.js';
import {
  saveSnapshot, getSnapshot, listSnapshots, getLatestSnapshot, renderReportHTML,
  addActionItem, updateActionItem, deleteActionItem, getActionItems, extractSiteLogo,
} from './reports.js';
import { runSiteSpeed, runSinglePageSpeed } from './pagespeed.js';
import { generateSchemaSuggestions, generateSchemaForPage } from './schema-suggester.js';
import { runSalesAudit } from './sales-audit.js';
import { renderSalesReportHTML } from './sales-report-html.js';
import { getAuthUrl, exchangeCode, isConnected, disconnect, getGoogleCredentials } from './google-auth.js';
import { listGscSites, getSearchOverview, getPerformanceTrend } from './search-console.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const IS_PROD = process.env.NODE_ENV === 'production';

// Ensure data directories exist
for (const dir of [getUploadRoot(), getOptRoot()]) {
  fs.mkdirSync(dir, { recursive: true });
}

// --- Auth middleware (password gate) ---
const APP_PASSWORD = process.env.APP_PASSWORD;
if (APP_PASSWORD) {
  app.use((req, res, next) => {
    // Allow health check without auth
    if (req.path === '/api/health' || req.path === '/api/health/diag') return next();
    // Check cookie or header
    const token = req.headers['x-auth-token'];
    if (token === APP_PASSWORD) return next();
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

app.use(cors());
app.use(express.json());

// Auth login endpoint
app.post('/api/auth/login', express.json(), (req, res) => {
  const { password } = req.body;
  if (!APP_PASSWORD) return res.json({ ok: true });
  if (password === APP_PASSWORD) {
    res.json({ ok: true, token: APP_PASSWORD });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

app.get('/api/auth/check', (req, res) => {
  if (!APP_PASSWORD) return res.json({ required: false });
  const token = req.headers['x-auth-token'];
  res.json({ required: true, authenticated: token === APP_PASSWORD });
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
    envTokenPrefix: envToken ? envToken.slice(0, 8) + '...' : null,
    workspaceCount: workspaces.length,
    workspaces: workspaces.map(ws => ({
      id: ws.id,
      name: ws.name,
      siteId: ws.webflowSiteId || null,
      hasToken: !!ws.webflowToken,
      tokenPrefix: ws.webflowToken ? ws.webflowToken.slice(0, 8) + '...' : null,
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
        resolvedTokenPrefix: resolved ? resolved.slice(0, 8) + '...' : null,
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

// --- API Routes ---

// Workspaces
app.get('/api/workspaces', (_req, res) => {
  const workspaces = listWorkspaces().map(ws => ({ ...ws, webflowToken: undefined }));
  res.json(workspaces);
});

app.post('/api/workspaces', (req, res) => {
  const { name, webflowSiteId, webflowSiteName } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const ws = createWorkspace(name, webflowSiteId, webflowSiteName);
  broadcast('workspace:created', ws);
  res.json(ws);
});

app.patch('/api/workspaces/:id', (req, res) => {
  const updates = { ...req.body };
  // When unlinking, clear the token too
  if (updates.webflowSiteId === null || updates.webflowSiteId === '') {
    updates.webflowToken = '';
  }
  const ws = updateWorkspace(req.params.id, updates);
  if (!ws) return res.status(404).json({ error: 'Not found' });
  // Strip token from response to avoid leaking to frontend
  const safe = { ...ws, webflowToken: undefined };
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
    const reportsDir = path.join(
      process.env.DATA_DIR || (IS_PROD ? '/tmp/asset-dashboard' : path.join(process.env.HOME || '', '.asset-dashboard')),
      'sales-reports'
    );
    fs.mkdirSync(reportsDir, { recursive: true });
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
    const reportsDir = path.join(
      process.env.DATA_DIR || (IS_PROD ? '/tmp/asset-dashboard' : path.join(process.env.HOME || '', '.asset-dashboard')),
      'sales-reports'
    );
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
    const reportsDir = path.join(
      process.env.DATA_DIR || (IS_PROD ? '/tmp/asset-dashboard' : path.join(process.env.HOME || '', '.asset-dashboard')),
      'sales-reports'
    );
    const filePath = path.join(reportsDir, `${req.params.id}.json`);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Report not found' });
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    res.json(data);
  } catch { res.status(500).json({ error: 'Failed to load report' }); }
});

app.get('/api/sales-report/:id/html', (req, res) => {
  try {
    const reportsDir = path.join(
      process.env.DATA_DIR || (IS_PROD ? '/tmp/asset-dashboard' : path.join(process.env.HOME || '', '.asset-dashboard')),
      'sales-reports'
    );
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
app.get('/api/webflow/schema-suggestions/:siteId', async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const useAI = req.query.ai === 'true';
    const result = await generateSchemaSuggestions(req.params.siteId, token, useAI);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Schema suggester error:', msg, err);
    res.status(500).json({ error: `Schema suggestion failed: ${msg}` });
  }
});

app.post('/api/webflow/schema-suggestions/:siteId/page', async (req, res) => {
  const { pageId } = req.body;
  if (!pageId) return res.status(400).json({ error: 'pageId required' });
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const result = await generateSchemaForPage(req.params.siteId, pageId, token);
    if (!result) return res.status(404).json({ error: 'Page not found' });
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Single-page schema error:', msg, err);
    res.status(500).json({ error: `Schema generation failed: ${msg}` });
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

// Client dashboard HTML page (no auth required)
app.get('/client/:siteId', (req, res) => {
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

// --- AI SEO Rewrite ---
app.post('/api/webflow/seo-rewrite', async (req, res) => {
  const { pageTitle, currentSeoTitle, currentDescription, pageContent, siteContext, field } = req.body;
  if (!pageTitle) return res.status(400).json({ error: 'pageTitle required' });

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  try {
    let prompt: string;
    if (field === 'description') {
      prompt = `You are an expert SEO copywriter. Write a compelling meta description for this web page.

Page title: ${pageTitle}
Current meta description: ${currentDescription || '(none)'}
Site context: ${siteContext || 'N/A'}
Page content excerpt: ${pageContent ? pageContent.slice(0, 1500) : 'N/A'}

Requirements:
- Between 150-160 characters (hard limit: 160)
- Include a clear call to action or value proposition
- Natural, not keyword-stuffed
- Compelling enough to increase click-through rate from search results

Return ONLY the meta description text, nothing else.`;
    } else {
      prompt = `You are an expert SEO copywriter. Write an optimized SEO title tag for this web page.

Page title: ${pageTitle}
Current SEO title: ${currentSeoTitle || '(none)'}
Current meta description: ${currentDescription || '(none)'}
Site context: ${siteContext || 'N/A'}
Page content excerpt: ${pageContent ? pageContent.slice(0, 1500) : 'N/A'}

Requirements:
- Between 50-60 characters (hard limit: 60)
- Front-load the most important keywords
- Include brand name at end if appropriate (use pipe separator: |)
- Compelling and descriptive

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
    const text = aiData.choices?.[0]?.message?.content?.trim() || '';
    res.json({ text, field });
  } catch (err) {
    console.error('SEO rewrite error:', err);
    res.status(500).json({ error: 'AI rewrite failed' });
  }
});

// --- Bulk AI SEO Fix ---
app.post('/api/webflow/seo-bulk-fix/:siteId', async (req, res) => {
  const { pages, field } = req.body as { pages: Array<{ pageId: string; title: string; currentSeoTitle?: string; currentDescription?: string }>; field: 'title' | 'description' };
  if (!pages?.length) return res.status(400).json({ error: 'pages required' });

  const openaiKey = process.env.OPENAI_API_KEY;
  const siteId = req.params.siteId;
  const token = getTokenForSite(siteId) || undefined;

  if (!openaiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  const results = [];
  for (const page of pages) {
    try {
      const prompt = field === 'description'
        ? `Write a compelling meta description (150-160 chars max) for a page titled "${page.title}". Current description: "${page.currentDescription || 'none'}". Return ONLY the text.`
        : `Write an SEO title tag (50-60 chars max) for a page titled "${page.title}". Current SEO title: "${page.currentSeoTitle || 'none'}". Return ONLY the text.`;

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
      const text = aiData.choices?.[0]?.message?.content?.trim() || '';

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

// --- AI Keyword Analysis ---
app.post('/api/webflow/keyword-analysis', async (req, res) => {
  const { pageTitle, seoTitle, metaDescription, pageContent, slug, siteContext } = req.body;
  if (!pageTitle) return res.status(400).json({ error: 'pageTitle required' });

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  try {
    const prompt = `You are an expert SEO strategist and keyword researcher. Analyze this web page and provide a comprehensive keyword analysis.

Page title: ${pageTitle}
SEO title: ${seoTitle || '(same as page title)'}
Meta description: ${metaDescription || '(none)'}
URL slug: /${slug || ''}
Site context: ${siteContext || 'N/A'}
Page content excerpt: ${pageContent ? pageContent.slice(0, 3000) : 'N/A'}

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
      // Use SVGO to optimize SVG
      const { execFileSync } = await import('child_process');
      const tmpIn = `/tmp/svgo_in_${Date.now()}.svg`;
      const tmpOut = `/tmp/svgo_out_${Date.now()}.svg`;
      fs.writeFileSync(tmpIn, originalBuffer);
      try {
        execFileSync('svgo', ['-i', tmpIn, '-o', tmpOut, '--quiet'], { stdio: 'pipe' });
      } catch {
        fs.unlinkSync(tmpIn);
        return res.json({ skipped: true, reason: 'SVGO optimization failed' });
      }
      const compressedSvg = fs.readFileSync(tmpOut);
      fs.unlinkSync(tmpIn);
      fs.unlinkSync(tmpOut);

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

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    hasWebflowToken: !!process.env.WEBFLOW_API_TOKEN,
    hasGoogleAuth: !!getGoogleCredentials(),
  });
});

// --- Serve frontend in production ---
if (IS_PROD) {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Start
const PORT = parseInt(process.env.PORT || '3001', 10);
startWatcher(broadcast);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Asset Dashboard running on http://localhost:${PORT} [${IS_PROD ? 'production' : 'development'}]`);
  // Startup diagnostics
  const workspaces = listWorkspaces();
  const hasEnvToken = !!process.env.WEBFLOW_API_TOKEN;
  const dataDir = process.env.DATA_DIR || (IS_PROD ? '/tmp/asset-dashboard' : 'local');
  console.log(`[startup] DATA_DIR=${dataDir}`);
  console.log(`[startup] WEBFLOW_API_TOKEN env: ${hasEnvToken ? 'SET' : 'NOT SET'}`);
  console.log(`[startup] OPENAI_API_KEY env: ${process.env.OPENAI_API_KEY ? 'SET' : 'NOT SET'}`);
  console.log(`[startup] GOOGLE_PSI_KEY env: ${process.env.GOOGLE_PSI_KEY ? 'SET' : 'NOT SET'}`);
  console.log(`[startup] Workspaces loaded: ${workspaces.length}`);
  for (const ws of workspaces) {
    console.log(`[startup]   - ${ws.name}: siteId=${ws.webflowSiteId || 'none'}, hasToken=${!!ws.webflowToken}`);
  }
});
