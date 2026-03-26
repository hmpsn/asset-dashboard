/**
 * data-export routes — CSV/JSON export for key datasets
 */
import { Router } from 'express';
import { listBriefs } from '../content-brief.js';
import { listContentRequests } from '../content-requests.js';
import { listActivity } from '../activity-log.js';
import { listPayments } from '../payments.js';
import { getWorkspace } from '../workspaces.js';
import { listMatrices } from '../content-matrices.js';
import { listTemplates } from '../content-templates.js';
import { createLogger } from '../logger.js';
import { requireWorkspaceAccess } from '../auth.js';

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
router.get('/api/export/:workspaceId/briefs', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { format = 'json' } = req.query as { format?: string };
  const briefs = listBriefs(req.params.workspaceId);
  log.info(`EXPORT briefs ${req.params.workspaceId}: ${briefs.length} items as ${format}`);
  const headers = ['id', 'targetKeyword', 'suggestedTitle', 'wordCountTarget', 'intent', 'contentFormat', 'pageType', 'difficultyScore', 'trafficPotential', 'createdAt'];
  sendExport(res, briefs, headers, `briefs-${req.params.workspaceId}`, format);
});

// --- Content Requests Export ---
router.get('/api/export/:workspaceId/requests', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { format = 'json' } = req.query as { format?: string };
  const requests = listContentRequests(req.params.workspaceId);
  log.info(`EXPORT requests ${req.params.workspaceId}: ${requests.length} items as ${format}`);
  const headers = ['id', 'topic', 'targetKeyword', 'intent', 'priority', 'status', 'serviceType', 'source', 'requestedAt', 'updatedAt'];
  sendExport(res, requests, headers, `requests-${req.params.workspaceId}`, format);
});

// --- Activity Log Export ---
router.get('/api/export/:workspaceId/activity', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { format = 'json' } = req.query as { format?: string };
  const activity = listActivity(req.params.workspaceId, 500);
  log.info(`EXPORT activity ${req.params.workspaceId}: ${activity.length} items as ${format}`);
  const headers = ['id', 'type', 'title', 'description', 'actorName', 'createdAt'];
  sendExport(res, activity, headers, `activity-${req.params.workspaceId}`, format);
});

// --- Keyword Strategy Export ---
router.get('/api/export/:workspaceId/strategy', requireWorkspaceAccess('workspaceId'), (req, res) => {
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
router.get('/api/export/:workspaceId/payments', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { format = 'json' } = req.query as { format?: string };
  const payments = listPayments(req.params.workspaceId);
  log.info(`EXPORT payments ${req.params.workspaceId}: ${payments.length} items as ${format}`);
  const headers = ['id', 'productType', 'amount', 'currency', 'status', 'createdAt', 'paidAt'];
  sendExport(res, payments, headers, `payments-${req.params.workspaceId}`, format);
});

// --- Content Matrices Export (flattened cells) ---
router.get('/api/export/:workspaceId/matrices', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { format = 'json' } = req.query as { format?: string };
  const matrices = listMatrices(req.params.workspaceId);
  // Flatten: one row per cell across all matrices
  const rows = matrices.flatMap(m =>
    m.cells.map(c => ({
      matrixId: m.id,
      matrixName: m.name,
      templateId: m.templateId,
      cellId: c.id,
      targetKeyword: c.targetKeyword,
      plannedUrl: c.plannedUrl,
      status: c.status,
      variableValues: c.variableValues ? Object.entries(c.variableValues).map(([k, v]) => `${k}=${v}`).join('; ') : '',
      volume: c.keywordValidation?.volume ?? '',
      difficulty: c.keywordValidation?.difficulty ?? '',
      cpc: c.keywordValidation?.cpc ?? '',
      briefId: c.briefId || '',
      postId: c.postId || '',
    })),
  );
  log.info(`EXPORT matrices ${req.params.workspaceId}: ${rows.length} cells as ${format}`);
  const headers = ['matrixId', 'matrixName', 'templateId', 'cellId', 'targetKeyword', 'plannedUrl', 'status', 'variableValues', 'volume', 'difficulty', 'cpc', 'briefId', 'postId'];
  sendExport(res, rows, headers, `matrices-${req.params.workspaceId}`, format);
});

// --- Content Templates Export ---
router.get('/api/export/:workspaceId/templates', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { format = 'json' } = req.query as { format?: string };
  const templates = listTemplates(req.params.workspaceId);
  log.info(`EXPORT templates ${req.params.workspaceId}: ${templates.length} items as ${format}`);
  const rows = templates.map(t => ({
    id: t.id,
    name: t.name,
    pageType: t.pageType,
    urlPattern: t.urlPattern,
    keywordPattern: t.keywordPattern,
    sectionCount: t.sections?.length || 0,
    variableCount: t.variables?.length || 0,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }));
  const headers = ['id', 'name', 'pageType', 'urlPattern', 'keywordPattern', 'sectionCount', 'variableCount', 'createdAt', 'updatedAt'];
  sendExport(res, rows, headers, `templates-${req.params.workspaceId}`, format);
});

export default router;
