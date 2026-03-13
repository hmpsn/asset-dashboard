/**
 * reports routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

import fs from 'fs';
import path from 'path';
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { getDataDir } from '../data-dir.js';
import { applySuppressionsToAudit } from '../helpers.js';
import { triggerMonthlyReport } from '../monthly-report.js';
import {
  saveSnapshot,
  getSnapshot,
  listSnapshots,
  getLatestSnapshot,
  renderReportHTML,
  addActionItem,
  updateActionItem,
  deleteActionItem,
  getActionItems,
  extractSiteLogo,
} from '../reports.js';
import { getMonthlyReportHTML, listMonthlyReports } from '../monthly-report.js';
import { runSalesAudit } from '../sales-audit.js';
import { renderSalesReportHTML } from '../sales-report-html.js';
import { runSeoAudit } from '../seo-audit.js';
import { listWorkspaces, getTokenForSite } from '../workspaces.js';

// --- Sales Report (URL-based, no Webflow API needed) ---
router.post('/api/sales-report', async (req, res) => {
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

router.get('/api/sales-reports', (_req, res) => {
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

router.get('/api/sales-report/:id', (req, res) => {
  try {
    const reportsDir = getDataDir('sales-reports');
    const filePath = path.join(reportsDir, `${req.params.id}.json`);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Report not found' });
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    res.json(data);
  } catch { res.status(500).json({ error: 'Failed to load report' }); }
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
  } catch { res.status(500).send('Failed to render report'); }
});

// --- Reports & Snapshots ---
// Save audit as snapshot (run audit + save + extract logo)
router.post('/api/reports/:siteId/save', async (req, res) => {
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
    // Log activity — use suppression-adjusted score so it matches client dashboard stat card
    const auditWs = listWorkspaces().find(w => w.webflowSiteId === siteId);
    if (auditWs) {
      const effectiveAudit = auditWs.auditSuppressions?.length ? applySuppressionsToAudit(audit, auditWs.auditSuppressions) : audit;
      addActivity(auditWs.id, 'audit_completed', `Site audit completed — score ${effectiveAudit.siteScore}`,
        `${effectiveAudit.totalPages} pages scanned, ${effectiveAudit.errors} errors, ${effectiveAudit.warnings} warnings`,
        { score: effectiveAudit.siteScore, previousScore: snapshot.previousScore });
      broadcastToWorkspace(auditWs.id, 'audit:complete', { score: effectiveAudit.siteScore, previousScore: snapshot.previousScore });
    }
    res.json({ id: snapshot.id, createdAt: snapshot.createdAt, siteScore: audit.siteScore, previousScore: snapshot.previousScore });
  } catch (err) {
    console.error('Report save error:', err);
    res.status(500).json({ error: 'Failed to save report' });
  }
});

// Save existing audit data as snapshot (no re-run)
router.post('/api/reports/:siteId/snapshot', (req, res) => {
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
router.get('/api/reports/:siteId/latest', (req, res) => {
  const latest = getLatestSnapshot(req.params.siteId);
  if (!latest) return res.json(null);
  // Apply suppressions so admin sees filtered scores matching client view
  const ws = listWorkspaces().find(w => w.webflowSiteId === req.params.siteId);
  if (ws && ws.auditSuppressions && ws.auditSuppressions.length > 0) {
    const filtered = applySuppressionsToAudit(latest.audit, ws.auditSuppressions);
    return res.json({ ...latest, audit: filtered });
  }
  res.json(latest);
});

// List snapshots for a site
router.get('/api/reports/:siteId/history', (req, res) => {
  const history = listSnapshots(req.params.siteId);
  res.json(history);
});

// Get a specific snapshot
router.get('/api/reports/snapshot/:id', (req, res) => {
  const snapshot = getSnapshot(req.params.id);
  if (!snapshot) return res.status(404).json({ error: 'Report not found' });
  res.json(snapshot);
});

// --- Action Items ---
router.get('/api/reports/snapshot/:id/actions', (req, res) => {
  res.json(getActionItems(req.params.id));
});

router.post('/api/reports/snapshot/:id/actions', (req, res) => {
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

router.patch('/api/reports/snapshot/:id/actions/:actionId', (req, res) => {
  const item = updateActionItem(req.params.id, req.params.actionId, req.body);
  if (!item) return res.status(404).json({ error: 'Action item not found' });
  res.json(item);
});

router.delete('/api/reports/snapshot/:id/actions/:actionId', (req, res) => {
  const ok = deleteActionItem(req.params.id, req.params.actionId);
  if (!ok) return res.status(404).json({ error: 'Action item not found' });
  res.json({ success: true });
});

// Public: HTML report page (no auth required)
router.get('/report/:id', (req, res) => {
  const snapshot = getSnapshot(req.params.id);
  if (!snapshot) return res.status(404).send('<h1>Report not found</h1>');
  res.type('html').send(renderReportHTML(snapshot));
});

// Public: JSON report data (no auth required)
router.get('/api/public/report/:id', (req, res) => {
  const snapshot = getSnapshot(req.params.id);
  if (!snapshot) return res.status(404).json({ error: 'Report not found' });
  res.json(snapshot);
});

// Public: Latest audit for a site (client dashboard)
router.get('/api/public/client/:siteId', (req, res) => {
  const latest = getLatestSnapshot(req.params.siteId);
  if (!latest) return res.status(404).json({ error: 'No audits found for this site' });
  const history = listSnapshots(req.params.siteId);
  res.json({ latest: latest.audit, siteName: latest.siteName, history });
});

// Audit report HTML page (renamed from /client/ to avoid conflict with SPA client dashboard)
router.get('/report/audit/:siteId', (req, res) => {
  const latest = getLatestSnapshot(req.params.siteId);
  if (!latest) return res.status(404).send('<h1>No audits found</h1>');
  res.type('html').send(renderReportHTML(latest));
});

// --- Monthly Reports ---
// Manual trigger: generate + optionally email a monthly report
router.post('/api/monthly-report/:workspaceId', async (req, res) => {
  try {
    const result = await triggerMonthlyReport(req.params.workspaceId);
    res.json({ sent: result.sent, html: result.html, reportId: result.reportId });
  } catch (err) {
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
    const snapshots = listSnapshots(ws.webflowSiteId);
    for (const s of snapshots) {
      reports.push({
        id: s.id,
        type: 'audit',
        title: `SEO Audit — Score ${s.siteScore}`,
        createdAt: s.createdAt,
        score: s.siteScore,
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
