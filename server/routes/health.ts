/**
 * health routes — extracted from server/index.ts
 */
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { DATA_BASE, getUploadRoot } from '../data-dir.js';
import { getQueueStats } from '../email-queue.js';
import { isEmailConfigured } from '../email.js';
import { getGoogleCredentials } from '../google-auth.js';
import { isStripeConfigured } from '../stripe.js';
import { listWorkspaces, getTokenForSite } from '../workspaces.js';
import { getStorageReport, pruneChatSessions, pruneBackups, pruneReportSnapshots, pruneActivityLogs } from '../storage-stats.js';
import db from '../db/index.js';
import { isProgrammingError } from '../errors.js';
import { createLogger } from '../logger.js';


const log = createLogger('health');
const router = Router();

/** Set to true during graceful shutdown so /api/health returns 503. */
let shuttingDown = false;
export function setShuttingDown(): void { shuttingDown = true; }

const DATA_ROOT = DATA_BASE || path.join(process.env.HOME || '', '.asset-dashboard');

// Diagnostic endpoint - test Webflow API connection
router.get('/api/health/diag', async (_req, res) => {
  const envToken = process.env.WEBFLOW_API_TOKEN;
  const workspaces = listWorkspaces();
  const diag: Record<string, unknown> = {
    dataDir: DATA_ROOT,
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

// NOTE: /api/presence route stays in index.ts (depends on WebSocket state)

router.get('/api/health', (_req, res) => {
  if (shuttingDown) {
    return res.status(503).json({ status: 'shutting_down' });
  }
  res.json({
    ok: true,
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    hasWebflowToken: !!process.env.WEBFLOW_API_TOKEN,
    hasGoogleAuth: !!getGoogleCredentials(),
    hasEmailConfig: isEmailConfigured(),
    hasStripe: isStripeConfigured(),
    notificationEmail: process.env.NOTIFICATION_EMAIL || null,
    emailQueue: getQueueStats(),
  });
});

// ── Storage monitoring & pruning ──

router.get('/api/admin/storage-stats', (_req, res) => {
  try {
    const report = getStorageReport();
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to get storage stats' });
  }
});

router.post('/api/admin/storage/prune-chat', (req, res) => {
  const maxAgeDays = typeof req.body?.maxAgeDays === 'number' ? req.body.maxAgeDays : 90;
  try {
    const result = pruneChatSessions(maxAgeDays);
    res.json({ ...result, maxAgeDays });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Chat prune failed' });
  }
});

router.post('/api/admin/storage/prune-backups', (req, res) => {
  const retainDays = typeof req.body?.retainDays === 'number' ? req.body.retainDays : 3;
  try {
    const result = pruneBackups(retainDays);
    res.json({ ...result, retainDays });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Backup prune failed' });
  }
});

router.post('/api/admin/storage/prune-reports', (req, res) => {
  const keepPerSite = typeof req.body?.keepPerSite === 'number' ? req.body.keepPerSite : 20;
  try {
    const result = pruneReportSnapshots(keepPerSite);
    res.json({ ...result, keepPerSite });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Report prune failed' });
  }
});

router.post('/api/admin/storage/prune-activity', (req, res) => {
  const maxAgeDays = typeof req.body?.maxAgeDays === 'number' ? req.body.maxAgeDays : 180;
  try {
    const result = pruneActivityLogs(maxAgeDays);
    res.json({ ...result, maxAgeDays });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Activity prune failed' });
  }
});

// ── DB sync (staging only) ────────────────────────────────────────────────────

/**
 * Export the SQLite database as a binary download.
 * Checkpoints the WAL first so the exported file is fully consistent.
 * Protected by the global APP_PASSWORD middleware.
 */
router.get('/api/admin/db-export', (_req, res) => {
  const dbPath = path.join(DATA_ROOT, 'dashboard.db');
  if (!fs.existsSync(dbPath)) {
    return res.status(404).json({ error: 'Database file not found' });
  }
  try {
    db.pragma('wal_checkpoint(FULL)');
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err }, 'health: GET /api/admin/db-export: programming error');
    // Non-fatal — export proceeds with whatever is in the main file
  }
  const stat = fs.statSync(dbPath);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', 'attachment; filename="dashboard.db"');
  res.setHeader('Content-Length', stat.size);
  fs.createReadStream(dbPath).pipe(res);
});

/**
 * Replace the SQLite database with an uploaded binary.
 * Only available when ALLOW_DB_IMPORT=true (set on staging, never on production).
 * Writes to a .incoming file, renames atomically, then exits so Render restarts.
 */
router.post('/api/admin/db-import', (req, res) => {
  if (process.env.ALLOW_DB_IMPORT !== 'true') {
    return res.status(403).json({ error: 'DB import is not enabled on this environment' });
  }
  const dbPath = path.join(DATA_ROOT, 'dashboard.db');
  const incomingPath = `${dbPath}.incoming`;

  // Collect binary body (express.raw() must be applied at call site)
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    if (body.length < 100) {
      return res.status(400).json({ error: 'Uploaded file appears empty or invalid' });
    }
    try {
      fs.writeFileSync(incomingPath, body);
      fs.renameSync(incomingPath, dbPath);
      res.json({ ok: true, bytes: body.length, message: 'Database replaced. Restarting...' });
      // Give the response time to flush, then restart so the new DB is opened fresh
      setTimeout(() => process.exit(0), 500);
    } catch (err) {
      try { fs.unlinkSync(incomingPath); } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'health: programming error'); /* ignore */ }
      res.status(500).json({ error: err instanceof Error ? err.message : 'Import failed' });
    }
  });
  req.on('error', (err) => {
    res.status(500).json({ error: err.message });
  });
});

export default router;
