/**
 * health routes — extracted from server/index.ts
 */
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { DATA_BASE, getUploadRoot } from '../data-dir.js';
import { getQueueStats } from '../email-queue.js';
import { isEmailConfigured } from '../email.js';
import { getGoogleCredentials, getTokenStatus, GLOBAL_KEY } from '../google-auth.js';
import { isStripeConfigured } from '../stripe.js';
import { getStripeConfigSafe } from '../stripe-config.js';
import { listWorkspaces, getTokenForSite, getWorkspace } from '../workspaces.js';
import { getStorageReport, pruneChatSessions, pruneBackups, pruneReportSnapshots, pruneActivityLogs } from '../storage-stats.js';
import { getSemrushUsage } from '../semrush.js';
import { getDataForSeoUsage } from '../providers/dataforseo-provider.js';
import { listProviders } from '../seo-data-provider.js';
import { getTokenUsage } from '../openai-helpers.js';
import { requireWorkspaceAccess } from '../auth.js';
import db from '../db/index.js';
import { isProgrammingError } from '../errors.js';
import { createLogger } from '../logger.js';
import type { IntegrationHealthItem, IntegrationHealthState, WorkspaceIntegrationHealth } from '../../shared/types/integration-health.js';
import { buildWorkspaceObservabilityReport } from '../platform-observability-report.js';


const log = createLogger('health');
const router = Router();
const DEFAULT_OBSERVABILITY_DAYS = 14;
const MAX_OBSERVABILITY_DAYS = 90;
const MIN_OBSERVABILITY_DAYS = 1;

/** Set to true during graceful shutdown so /api/health returns 503. */
let shuttingDown = false;
export function setShuttingDown(): void { shuttingDown = true; }

const DATA_ROOT = DATA_BASE || path.join(process.env.HOME || '', '.asset-dashboard');

function latestTimestamp(entries: Array<{ timestamp?: string }>): string | null {
  if (entries.length === 0) return null;
  return entries
    .map(entry => entry.timestamp ?? null)
    .filter((value): value is string => !!value)
    .sort()
    .at(-1) ?? null;
}

function summaryFromIntegrations(integrations: IntegrationHealthItem[]) {
  const configured = integrations.filter(item => item.state !== 'missing').length;
  const missing = integrations.filter(item => item.state === 'missing').length;
  const degraded = integrations.filter(item => item.state === 'degraded').length;
  const healthy = integrations.filter(item => item.state === 'configured').length;
  return { configured, missing, degraded, healthy };
}

function createIntegration(item: Omit<IntegrationHealthItem, 'state'> & { state?: IntegrationHealthState }): IntegrationHealthItem {
  return {
    ...item,
    state: item.state ?? (item.configured ? 'configured' : 'missing'),
  };
}

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

router.get('/api/integrations/health/:workspaceId', requireWorkspaceAccess('workspaceId'), (_req, res) => {
  const { workspaceId } = _req.params;
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return res.status(404).json({ error: 'Workspace not found' });

  const googleConfigured = !!getGoogleCredentials();
  const googleToken = getTokenStatus(GLOBAL_KEY);
  const googleOperational = googleToken.connected && googleToken.usable;
  const hasGscProperty = !!workspace.gscPropertyUrl;
  const hasGa4Property = !!workspace.ga4PropertyId;
  const hasWebflowSite = !!workspace.webflowSiteId;
  const hasWebflowToken = hasWebflowSite ? !!getTokenForSite(workspace.webflowSiteId!) : false;

  const providerStatus = listProviders();
  const semrushProvider = providerStatus.find(provider => provider.name === 'semrush');
  const dataforseoProvider = providerStatus.find(provider => provider.name === 'dataforseo');

  const semrushUsage = getSemrushUsage(workspaceId);
  const dataforseoUsage = getDataForSeoUsage(workspaceId);
  const aiUsage = getTokenUsage(workspaceId);
  const openAiUsageEntries = aiUsage.entries.filter(entry => !entry.model.includes('claude'));
  const anthropicUsageEntries = aiUsage.entries.filter(entry => entry.model.includes('claude'));
  const stripeConfig = getStripeConfigSafe();

  const integrations: IntegrationHealthItem[] = [
    createIntegration({
      key: 'webflow',
      label: 'Webflow',
      configured: hasWebflowSite && hasWebflowToken,
      connected: hasWebflowSite,
      state: hasWebflowSite && !hasWebflowToken ? 'degraded' : undefined,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: hasWebflowSite && !hasWebflowToken ? 'Site linked but API token is missing' : (hasWebflowSite ? null : 'No Webflow site linked'),
      quotaStatus: 'unknown',
      quotaDetail: 'Webflow API quota status is not currently exposed.',
      tokenExpiresAt: null,
      affectedFeatures: ['SEO Editor', 'Schema Generator', 'CMS Editor', 'Asset Manager'],
      notes: hasWebflowSite ? null : 'Link a Webflow site in workspace settings.',
    }),
    createIntegration({
      key: 'google',
      label: 'Google Auth',
      configured: googleConfigured,
      connected: googleOperational,
      state: googleConfigured && !googleOperational ? 'degraded' : undefined,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: !googleConfigured
        ? 'Google OAuth credentials are not configured'
        : (!googleToken.connected ? 'Google account not connected' : (googleToken.usable ? null : 'Google token expired and cannot be refreshed')),
      quotaStatus: 'unknown',
      quotaDetail: 'Google API quota status is not currently exposed.',
      tokenExpiresAt: googleToken.expiresAt,
      affectedFeatures: ['Search Console analytics', 'GA4 analytics', 'Rank tracking'],
      notes: !googleToken.connected
        ? 'Connect Google from the Connections tab.'
        : (googleToken.usable ? 'Successful-call telemetry is not yet tracked for this integration.' : 'Reconnect Google to refresh credentials.'),
    }),
    createIntegration({
      key: 'gsc',
      label: 'Google Search Console Property',
      configured: googleOperational && hasGscProperty,
      connected: googleOperational && hasGscProperty,
      state: googleOperational && !hasGscProperty ? 'degraded' : undefined,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: googleOperational
        ? (hasGscProperty ? null : 'Connected Google account but no GSC property selected')
        : (!googleToken.connected ? 'Google account not connected' : 'Google token is not currently usable'),
      quotaStatus: 'unknown',
      quotaDetail: 'GSC query quota is not currently exposed.',
      tokenExpiresAt: googleToken.expiresAt,
      affectedFeatures: ['Search overview', 'Keyword rankings', 'Traffic insights'],
      notes: hasGscProperty
        ? 'Successful-call telemetry is not yet tracked for this integration.'
        : 'Select a Search Console property in the Connections tab.',
    }),
    createIntegration({
      key: 'ga4',
      label: 'GA4 Property',
      configured: googleOperational && hasGa4Property,
      connected: googleOperational && hasGa4Property,
      state: googleOperational && !hasGa4Property ? 'degraded' : undefined,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: googleOperational
        ? (hasGa4Property ? null : 'Connected Google account but no GA4 property selected')
        : (!googleToken.connected ? 'Google account not connected' : 'Google token is not currently usable'),
      quotaStatus: 'unknown',
      quotaDetail: 'GA4 quota status is not currently exposed.',
      tokenExpiresAt: googleToken.expiresAt,
      affectedFeatures: ['Traffic analytics', 'Engagement metrics', 'Monthly reporting'],
      notes: hasGa4Property
        ? 'Successful-call telemetry is not yet tracked for this integration.'
        : 'Select a GA4 property in the Connections tab.',
    }),
    createIntegration({
      key: 'semrush',
      label: 'SEMRush',
      configured: !!semrushProvider?.configured,
      connected: !!semrushProvider?.configured,
      lastSuccessAt: latestTimestamp(semrushUsage.entries),
      lastErrorAt: null,
      lastError: semrushProvider?.configured ? null : 'SEMRush API key is not configured',
      quotaStatus: semrushProvider?.configured ? 'unknown' : 'unknown',
      quotaDetail: semrushProvider?.configured
        ? `Credits used: ${semrushUsage.totalCredits} across ${semrushUsage.totalCalls} calls.`
        : 'SEMRush usage unavailable until configured.',
      tokenExpiresAt: null,
      affectedFeatures: ['Competitor intelligence', 'Keyword opportunities', 'Content strategy'],
      notes: semrushProvider?.configured ? null : 'Configure SEMRush credentials to enable direct provider fallback.',
    }),
    createIntegration({
      key: 'dataforseo',
      label: 'DataForSEO',
      configured: !!dataforseoProvider?.configured,
      connected: !!dataforseoProvider?.configured,
      lastSuccessAt: latestTimestamp(dataforseoUsage.entries),
      lastErrorAt: null,
      lastError: dataforseoProvider?.configured ? null : 'DataForSEO credentials are not configured',
      quotaStatus: 'unknown',
      quotaDetail: dataforseoProvider?.configured
        ? `Credits used: ${dataforseoUsage.totalCredits} across ${dataforseoUsage.totalCalls} calls.`
        : 'DataForSEO usage unavailable until configured.',
      tokenExpiresAt: null,
      affectedFeatures: ['Keyword strategy', 'SERP research', 'Backlink and domain analysis'],
      notes: dataforseoProvider?.configured ? null : 'Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD.',
    }),
    createIntegration({
      key: 'stripe',
      label: 'Stripe',
      configured: stripeConfig.configured,
      connected: stripeConfig.configured,
      lastSuccessAt: stripeConfig.updatedAt,
      lastErrorAt: null,
      lastError: stripeConfig.configured ? null : 'Stripe secret key is not configured',
      quotaStatus: 'unknown',
      quotaDetail: 'Stripe request quota status is not currently exposed.',
      tokenExpiresAt: null,
      affectedFeatures: ['Checkout', 'Plan upgrades', 'Billing portal'],
      notes: stripeConfig.configured ? null : 'Configure Stripe keys in admin settings.',
    }),
    createIntegration({
      key: 'openai',
      label: 'OpenAI',
      configured: !!process.env.OPENAI_API_KEY,
      connected: !!process.env.OPENAI_API_KEY,
      lastSuccessAt: latestTimestamp(openAiUsageEntries),
      lastErrorAt: null,
      lastError: process.env.OPENAI_API_KEY ? null : 'OPENAI_API_KEY is not configured',
      quotaStatus: 'unknown',
      quotaDetail: process.env.OPENAI_API_KEY
        ? `${openAiUsageEntries.length} calls logged for this workspace.`
        : 'Usage unavailable until configured.',
      tokenExpiresAt: null,
      affectedFeatures: ['SEO rewrites', 'Schema generation', 'AI recommendations'],
      notes: null,
    }),
    createIntegration({
      key: 'anthropic',
      label: 'Anthropic (Claude)',
      configured: !!process.env.ANTHROPIC_API_KEY,
      connected: !!process.env.ANTHROPIC_API_KEY,
      lastSuccessAt: latestTimestamp(anthropicUsageEntries),
      lastErrorAt: null,
      lastError: process.env.ANTHROPIC_API_KEY ? null : 'ANTHROPIC_API_KEY is not configured',
      quotaStatus: 'unknown',
      quotaDetail: process.env.ANTHROPIC_API_KEY
        ? `${anthropicUsageEntries.length} calls logged for this workspace.`
        : 'Usage unavailable until configured.',
      tokenExpiresAt: null,
      affectedFeatures: ['Creative writing', 'Brand voice generation', 'Content drafting'],
      notes: null,
    }),
    createIntegration({
      key: 'email',
      label: 'Email (SMTP)',
      configured: isEmailConfigured(),
      connected: isEmailConfigured(),
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: isEmailConfigured() ? null : 'SMTP credentials are not configured',
      quotaStatus: 'unknown',
      quotaDetail: 'SMTP provider quota status is not currently exposed.',
      tokenExpiresAt: null,
      affectedFeatures: ['Client notifications', 'Approval reminders', 'Scheduled reports'],
      notes: isEmailConfigured() ? null : 'Set SMTP_HOST/SMTP_USER/SMTP_PASS and notification email.',
    }),
  ];

  const payload: WorkspaceIntegrationHealth = {
    workspaceId,
    generatedAt: new Date().toISOString(),
    summary: summaryFromIntegrations(integrations),
    integrations,
  };

  res.json(payload);
});

router.get('/api/observability/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { workspaceId } = req.params;
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return res.status(404).json({ error: 'Workspace not found' });

  const hasDaysParam = typeof req.query.days === 'string';
  const daysRaw = hasDaysParam ? Number(req.query.days) : DEFAULT_OBSERVABILITY_DAYS;
  if (!Number.isFinite(daysRaw)) {
    return res.status(400).json({
      error: `days must be a number between ${MIN_OBSERVABILITY_DAYS} and ${MAX_OBSERVABILITY_DAYS}`,
    });
  }
  const days = Math.floor(daysRaw);
  if (days < MIN_OBSERVABILITY_DAYS || days > MAX_OBSERVABILITY_DAYS) {
    return res.status(400).json({
      error: `days must be between ${MIN_OBSERVABILITY_DAYS} and ${MAX_OBSERVABILITY_DAYS}`,
    });
  }
  const report = buildWorkspaceObservabilityReport(workspaceId, { days });
  res.json(report);
});

// ── Storage monitoring & pruning ──

router.get('/api/admin/storage-stats', async (_req, res) => {
  try {
    const report = await getStorageReport();
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
