/**
 * data-export routes — CSV/JSON export for key datasets
 */
import { Router } from 'express';
import { listBriefs } from '../content-brief.js';
import { listContentRequests } from '../content-requests.js';
import { listActivity } from '../activity-log.js';
import { listPayments } from '../payments.js';
import { getWorkspace } from '../workspaces.js';
import { createLogger } from '../logger.js';

const log = createLogger('data-export');
const router = Router();

// --- Helpers ---

function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const escape = (v: unknown): string => {
    if (v == null) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => escape(row[h])).join(','));
  }
  return lines.join('\n');
}

function sendExport(res: import('express').Response, data: unknown[], headers: string[], filename: string, format: string) {
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    res.send(toCsv(headers, data as Record<string, unknown>[]));
  } else {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
    res.json(data);
  }
}

// --- Content Briefs Export ---
router.get('/api/export/:workspaceId/briefs', (req, res) => {
  const { format = 'json' } = req.query as { format?: string };
  const briefs = listBriefs(req.params.workspaceId);
  log.info(`EXPORT briefs ${req.params.workspaceId}: ${briefs.length} items as ${format}`);
  const headers = ['id', 'targetKeyword', 'suggestedTitle', 'wordCountTarget', 'intent', 'contentFormat', 'pageType', 'difficultyScore', 'trafficPotential', 'createdAt'];
  sendExport(res, briefs, headers, `briefs-${req.params.workspaceId}`, format);
});

// --- Content Requests Export ---
router.get('/api/export/:workspaceId/requests', (req, res) => {
  const { format = 'json' } = req.query as { format?: string };
  const requests = listContentRequests(req.params.workspaceId);
  log.info(`EXPORT requests ${req.params.workspaceId}: ${requests.length} items as ${format}`);
  const headers = ['id', 'topic', 'targetKeyword', 'intent', 'priority', 'status', 'serviceType', 'source', 'requestedAt', 'updatedAt'];
  sendExport(res, requests, headers, `requests-${req.params.workspaceId}`, format);
});

// --- Activity Log Export ---
router.get('/api/export/:workspaceId/activity', (req, res) => {
  const { format = 'json' } = req.query as { format?: string };
  const activity = listActivity(req.params.workspaceId, 500);
  log.info(`EXPORT activity ${req.params.workspaceId}: ${activity.length} items as ${format}`);
  const headers = ['id', 'type', 'title', 'description', 'actorName', 'createdAt'];
  sendExport(res, activity, headers, `activity-${req.params.workspaceId}`, format);
});

// --- Keyword Strategy Export ---
router.get('/api/export/:workspaceId/strategy', (req, res) => {
  const { format = 'json' } = req.query as { format?: string };
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const strategy = ws.keywordStrategy;
  if (!strategy?.pageMap?.length) return res.json([]);
  log.info(`EXPORT strategy ${req.params.workspaceId}: ${strategy.pageMap.length} pages as ${format}`);
  const rows = strategy.pageMap.map(p => ({
    pagePath: p.pagePath,
    pageTitle: p.pageTitle || '',
    primaryKeyword: p.primaryKeyword,
    secondaryKeywords: (p.secondaryKeywords || []).join('; '),
  }));
  const headers = ['pagePath', 'pageTitle', 'primaryKeyword', 'secondaryKeywords'];
  sendExport(res, rows, headers, `strategy-${req.params.workspaceId}`, format);
});

// --- Payments Export ---
router.get('/api/export/:workspaceId/payments', (req, res) => {
  const { format = 'json' } = req.query as { format?: string };
  const payments = listPayments(req.params.workspaceId);
  log.info(`EXPORT payments ${req.params.workspaceId}: ${payments.length} items as ${format}`);
  const headers = ['id', 'productType', 'amount', 'currency', 'status', 'createdAt', 'paidAt'];
  sendExport(res, payments, headers, `payments-${req.params.workspaceId}`, format);
});

export default router;
