/**
 * health routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

/** Set to true during graceful shutdown so /api/health returns 503. */
let shuttingDown = false;
export function setShuttingDown(): void { shuttingDown = true; }

import fs from 'fs';
import path from 'path';
import { DATA_BASE, getUploadRoot } from '../data-dir.js';
import { getQueueStats } from '../email-queue.js';
import { isEmailConfigured } from '../email.js';
import { getGoogleCredentials } from '../google-auth.js';
import { isStripeConfigured } from '../stripe.js';
import { listWorkspaces, getTokenForSite } from '../workspaces.js';
import { getStorageReport, pruneChatSessions, pruneBackups, pruneReportSnapshots, pruneActivityLogs } from '../storage-stats.js';

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

export default router;
