/**
 * reports routes — extracted from server/index.ts
 */
import { Router, type RequestHandler } from 'express';

import { requireWorkspaceAccess, requireWorkspaceSiteAccess, requireWorkspaceSiteAccessFromQuery, requestUserCanAccessWorkspace, sendWorkspaceAccessDenied } from '../auth.js';
import { validate, z } from '../middleware/validate.js';
const router = Router();

import fs from 'fs';
import path from 'path';
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import { getDataDir } from '../data-dir.js';
import { getEffectiveAudit, getEffectivePreviousScore, getLatestEffectiveSnapshot, listEffectiveSnapshotSummaries, toEffectiveAuditSnapshot } from '../audit-snapshot-views.js';
import { triggerMonthlyReport } from '../monthly-report.js';
import {
  saveSnapshot,
  getSnapshot,
  getLatestSnapshot,
  renderReportHTML,
  addActionItem,
  updateActionItem,
  deleteActionItem,
  getActionItems,
  extractSiteLogo,
  type ActionPriority,
  type ActionStatus,
  type AuditSnapshot,
} from '../reports.js';
import { getMonthlyReportHTML, listMonthlyReports } from '../monthly-report.js';
import { runSalesAudit } from '../sales-audit.js';
import { renderSalesReportHTML } from '../sales-report-html.js';
import { runSeoAudit } from '../seo-audit.js';
import { handleOnDemandSeoAuditResult } from '../webflow-seo-audit-bridges.js';
import { listWorkspaces, getTokenForSite } from '../workspaces.js';
import { createLogger } from '../logger.js';
import { isProgrammingError } from '../errors.js';

const log = createLogger('reports');

function getWorkspaceForSite(siteId: string) {
  return listWorkspaces().find(w => w.webflowSiteId === siteId);
}

function getEffectiveSnapshotForRead(snapshot: AuditSnapshot): AuditSnapshot {
  const workspace = getWorkspaceForSite(snapshot.siteId);
  return workspace ? toEffectiveAuditSnapshot(snapshot, workspace.auditSuppressions || []) : snapshot;
}

const actionPrioritySchema = z.enum(['high', 'medium', 'low']);
const actionStatusSchema = z.enum(['planned', 'in-progress', 'completed']);

const createActionItemSchema = z.object({
  title: z.string({ required_error: 'Title is required' }).trim().min(1, 'Title is required').max(500),
  description: z.string().trim().max(5000).optional().default(''),
  priority: actionPrioritySchema.optional().default('medium'),
  category: z.string().trim().max(100).optional(),
});

const updateActionItemSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(500).optional(),
  description: z.string().trim().max(5000).optional(),
  status: actionStatusSchema.optional(),
  priority: actionPrioritySchema.optional(),
  category: z.string().trim().max(100).optional(),
}).refine(
  (body) => Object.values(body).some((value) => value !== undefined),
  { message: 'At least one field required' },
);

const requireSnapshotWorkspaceAccess: RequestHandler = (req, res, next) => {
  const snapshot = getSnapshot(req.params.id);
  if (!snapshot) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }

  const workspace = listWorkspaces().find(w => w.webflowSiteId === snapshot.siteId);
  if (!workspace) {
    if (!req.user) {
      next();
      return;
    }
    sendWorkspaceAccessDenied(res);
    return;
  }

  if (!requestUserCanAccessWorkspace(req, workspace.id)) {
    sendWorkspaceAccessDenied(res);
    return;
  }

  next();
};

// --- Sales Report (URL-based, no Webflow API needed) ---
router.post('/api/sales-report', async (req, res) => {
  try {
    const { url, maxPages } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    const requestedMaxPages = maxPages == null ? 25 : Number(maxPages);
    if (!Number.isInteger(requestedMaxPages) || requestedMaxPages < 1) {
      return res.status(400).json({ error: 'maxPages must be a positive integer' });
    }
    if (requestedMaxPages > 100) {
      return res.status(400).json({ error: 'maxPages must be between 1 and 100' });
    }
    const boundedMaxPages = Math.min(requestedMaxPages, 100);
    log.info(`Starting audit for ${url}`);
    const result = await runSalesAudit(url, boundedMaxPages);

    // Save to disk
    const reportsDir = getDataDir('sales-reports');
    const id = `sr_${Date.now()}`;
    const report = { id, ...result };
    fs.writeFileSync(path.join(reportsDir, `${id}.json`), JSON.stringify(report, null, 2));

    res.json(report);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ detail: msg }, 'Sales report error');
    res.status(500).json({ error: `Sales report failed: ${msg}` });
  }
});

router.get('/api/sales-reports', (_req, res) => {
  try {
    const reportsDir = getDataDir('sales-reports');
    if (!fs.existsSync(reportsDir)) return res.json([]);
    const files = fs.readdirSync(reportsDir).filter(f => f.endsWith('.json')).sort().reverse();
    const summaries = files.map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(reportsDir, f), 'utf-8'));
        return { id: data.id, url: data.url, siteName: data.siteName, siteScore: data.siteScore, totalPages: data.totalPages, errors: data.errors, warnings: data.warnings, generatedAt: data.generatedAt };
      } catch (err) { return null; }
    }).filter(Boolean);
    res.json(summaries);
  } catch (err) { res.json([]); }
});

router.get('/api/sales-report/:id', (req, res) => {
  try {
    const reportsDir = getDataDir('sales-reports');
    const filePath = path.join(reportsDir, `${req.params.id}.json`);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Report not found' });
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    res.json(data);
  } catch (err) { res.status(500).json({ error: 'Failed to load report' }); }
});

router.get('/api/sales-report/:id/html', (req, res) => {
  try {
    const reportsDir = getDataDir('sales-reports');
    const filePath = path.join(reportsDir, `${req.params.id}.json`);
    if (!fs.existsSync(filePath)) return res.status(404).send('Report not found');
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const html = renderSalesReportHTML(data);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) { res.status(500).send('Failed to render report'); }
});

// --- Reports & Snapshots ---
// Save audit as snapshot (run audit + save + extract logo)
router.post('/api/reports/:siteId/save', requireWorkspaceSiteAccess({
  workspace: { source: 'body', name: 'workspaceId' },
  site: { source: 'params', name: 'siteId' },
}), async (req, res) => {
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
      } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'reports: POST /api/reports/:siteId/save: programming error'); /* logo extraction is best-effort */ } // url-fetch-ok
    }

    const snapshot = saveSnapshot(siteId, siteName || siteId, audit, logoUrl);
    // Log activity — use suppression-adjusted score so it matches client dashboard stat card
    const auditWs = getWorkspaceForSite(siteId);
    let responseScore = audit.siteScore;
    let responsePreviousScore = snapshot.previousScore;
    if (auditWs) {
      const effectiveAudit = getEffectiveAudit(audit, auditWs.auditSuppressions || []);
      const effectivePreviousScore = getEffectivePreviousScore(snapshot, auditWs.auditSuppressions || []);
      responseScore = effectiveAudit.siteScore;
      responsePreviousScore = effectivePreviousScore;
      addActivity(auditWs.id, 'audit_completed', `Site audit completed — score ${effectiveAudit.siteScore}`,
        `${effectiveAudit.totalPages} pages scanned, ${effectiveAudit.errors} errors, ${effectiveAudit.warnings} warnings`,
        { score: effectiveAudit.siteScore, previousScore: effectivePreviousScore });
      broadcastToWorkspace(auditWs.id, WS_EVENTS.AUDIT_COMPLETE, { score: effectiveAudit.siteScore, previousScore: effectivePreviousScore });
    }
    res.json({ id: snapshot.id, createdAt: snapshot.createdAt, siteScore: responseScore, previousScore: responsePreviousScore });
  } catch (err) {
    log.error({ err: err }, 'Report save error');
    res.status(500).json({ error: 'Failed to save report' });
  }
});

// Save existing audit data as snapshot (no re-run)
router.post('/api/reports/:siteId/snapshot', requireWorkspaceSiteAccess({
  workspace: { source: 'body', name: 'workspaceId' },
  site: { source: 'params', name: 'siteId' },
}), (req, res) => {
  try {
    const { siteId } = req.params;
    const { siteName, audit } = req.body;
    if (!audit) return res.status(400).json({ error: 'Missing audit data' });
    const snapshot = saveSnapshot(siteId, siteName || siteId, audit);
    const auditWs = getWorkspaceForSite(siteId);
    const effectiveSnapshot = auditWs
      ? toEffectiveAuditSnapshot(snapshot, auditWs.auditSuppressions || [])
      : snapshot;
    if (auditWs) {
      addActivity(auditWs.id, 'audit_completed', `Site audit snapshot saved — score ${effectiveSnapshot.audit.siteScore}`,
        `${effectiveSnapshot.audit.totalPages} pages scanned, ${effectiveSnapshot.audit.errors} errors, ${effectiveSnapshot.audit.warnings} warnings`,
        { score: effectiveSnapshot.audit.siteScore, previousScore: effectiveSnapshot.previousScore, snapshotOnly: true });
      handleOnDemandSeoAuditResult(auditWs, effectiveSnapshot.audit);
      broadcastToWorkspace(auditWs.id, WS_EVENTS.AUDIT_COMPLETE, { score: effectiveSnapshot.audit.siteScore, previousScore: effectiveSnapshot.previousScore, snapshotOnly: true });
    }
    res.json({ id: snapshot.id, createdAt: snapshot.createdAt, siteScore: effectiveSnapshot.audit.siteScore, previousScore: effectiveSnapshot.previousScore });
  } catch (err) {
    log.error({ err: err }, 'Snapshot save error');
    res.status(500).json({ error: 'Failed to save snapshot' });
  }
});

// Get latest full snapshot for a site (used by admin SeoAudit to restore after deploy)
router.get('/api/reports/:siteId/latest', requireWorkspaceSiteAccessFromQuery(), (req, res) => {
  const latest = getLatestSnapshot(req.params.siteId);
  if (!latest) return res.json(null);
  // Apply suppressions so admin sees filtered scores matching client view
  const ws = getWorkspaceForSite(req.params.siteId);
  if (ws && ws.auditSuppressions && ws.auditSuppressions.length > 0) {
    return res.json(toEffectiveAuditSnapshot(latest, ws.auditSuppressions));
  }
  res.json(latest);
});

// List snapshots for a site
router.get('/api/reports/:siteId/history', requireWorkspaceSiteAccessFromQuery(), (req, res) => {
  const ws = getWorkspaceForSite(req.params.siteId);
  const history = listEffectiveSnapshotSummaries(req.params.siteId, ws?.auditSuppressions || []);
  res.json(history);
});

// Get a specific snapshot
router.get('/api/reports/snapshot/:id', requireSnapshotWorkspaceAccess, (req, res) => {
  const snapshot = getSnapshot(req.params.id);
  if (!snapshot) return res.status(404).json({ error: 'Report not found' });
  res.json(getEffectiveSnapshotForRead(snapshot));
});

// --- Action Items ---
router.get('/api/reports/snapshot/:id/actions', requireSnapshotWorkspaceAccess, (req, res) => {
  res.json(getActionItems(req.params.id));
});

router.post('/api/reports/snapshot/:id/actions', requireSnapshotWorkspaceAccess, validate(createActionItemSchema), (req, res) => {
  const { title, description, priority, category } = req.body;
  const item = addActionItem(req.params.id, {
    title,
    description,
    priority: priority as ActionPriority,
    category,
  });
  if (!item) return res.status(404).json({ error: 'Snapshot not found' });
  res.json(item);
});

router.patch('/api/reports/snapshot/:id/actions/:actionId', requireSnapshotWorkspaceAccess, validate(updateActionItemSchema), (req, res) => {
  const item = updateActionItem(req.params.id, req.params.actionId, req.body as {
    title?: string;
    description?: string;
    status?: ActionStatus;
    priority?: ActionPriority;
    category?: string;
  });
  if (!item) return res.status(404).json({ error: 'Action item not found' });
  res.json(item);
});

router.delete('/api/reports/snapshot/:id/actions/:actionId', requireSnapshotWorkspaceAccess, (req, res) => {
  const ok = deleteActionItem(req.params.id, req.params.actionId);
  if (!ok) return res.status(404).json({ error: 'Action item not found' });
  res.json({ success: true });
});

// Public: HTML report page (no auth required)
router.get('/report/:id', (req, res) => {
  const snapshot = getSnapshot(req.params.id);
  if (!snapshot) return res.status(404).send('<h1>Report not found</h1>');
  res.type('html').send(renderReportHTML(getEffectiveSnapshotForRead(snapshot)));
});

// Public: JSON report data (no auth required)
router.get('/api/public/report/:id', (req, res) => {
  const snapshot = getSnapshot(req.params.id);
  if (!snapshot) return res.status(404).json({ error: 'Report not found' });
  res.json(getEffectiveSnapshotForRead(snapshot));
});

// Public: Latest audit for a site (client dashboard)
router.get('/api/public/client/:siteId', (req, res) => {
  const ws = getWorkspaceForSite(req.params.siteId);
  const latest = getLatestEffectiveSnapshot(req.params.siteId, ws?.auditSuppressions || []);
  if (!latest) return res.status(404).json({ error: 'No audits found for this site' });
  const history = listEffectiveSnapshotSummaries(req.params.siteId, ws?.auditSuppressions || []);
  res.json({ latest: latest.audit, siteName: latest.siteName, history });
});

// Audit report HTML page (renamed from /client/ to avoid conflict with SPA client dashboard)
router.get('/report/audit/:siteId', (req, res) => {
  const ws = getWorkspaceForSite(req.params.siteId);
  const latest = getLatestEffectiveSnapshot(req.params.siteId, ws?.auditSuppressions || []);
  if (!latest) return res.status(404).send('<h1>No audits found</h1>');
  res.type('html').send(renderReportHTML(latest));
});

// --- Monthly Reports ---
// Manual trigger: generate + optionally email a monthly report
router.post('/api/monthly-report/:workspaceId', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  try {
    const result = await triggerMonthlyReport(req.params.workspaceId);
    res.json({ sent: result.sent, html: result.html, reportId: result.reportId });
  } catch (err) {
    if (err instanceof Error && err.message === 'Workspace not found') {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to generate report' });
  }
});

// Public: Monthly report HTML permalink (no auth)
router.get('/report/monthly/:id', (req, res) => {
  const html = getMonthlyReportHTML(req.params.id);
  if (!html) return res.status(404).send('<h1>Report not found</h1>');
  res.type('html').send(html);
});

// Public: Unified list of all shareable reports for a workspace (audit snapshots + monthly reports)
router.get('/api/public/reports/:workspaceId', (req, res) => {
  const ws = listWorkspaces().find(w => w.id === req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const reports: Array<{
    id: string;
    type: 'audit' | 'monthly';
    title: string;
    createdAt: string;
    score?: number;
    previousScore?: number;
    permalink: string;
  }> = [];

  // Audit snapshots
  if (ws.webflowSiteId) {
    const snapshots = listEffectiveSnapshotSummaries(ws.webflowSiteId, ws.auditSuppressions || []);
    for (const s of snapshots) {
      reports.push({
        id: s.id,
        type: 'audit',
        title: `SEO Audit — Score ${s.siteScore}`,
        createdAt: s.createdAt,
        score: s.siteScore,
        previousScore: s.previousScore,
        permalink: `/report/${s.id}`,
      });
    }
  }

  // Monthly reports
  const monthly = listMonthlyReports(req.params.workspaceId);
  for (const m of monthly) {
    reports.push({
      id: m.id,
      type: 'monthly',
      title: `${m.period} Report`,
      createdAt: m.createdAt,
      score: m.siteScore,
      previousScore: m.previousScore,
      permalink: `/report/monthly/${m.id}`,
    });
  }

  // Sort all by date descending
  reports.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json(reports);
});

export default router;
