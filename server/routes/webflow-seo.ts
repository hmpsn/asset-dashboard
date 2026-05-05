/**
 * webflow-seo routes — extracted from server/index.ts
 *
 * @reads workspaces, webflow_api
 * @writes seo_suggestions, jobs
 */
import { Router } from 'express';

import { requireWorkspaceAccess, requireWorkspaceSiteAccessFromQuery } from '../auth.js';
const router = Router();

import { runSeoAudit } from '../seo-audit.js';
import {
  listWorkspaces,
  getWorkspace,
  getTokenForSite,
} from '../workspaces.js';
import { createLogger } from '../logger.js';
import { createJob, hasActiveJob, registerAbort } from '../jobs.js';
import { validate, z } from '../middleware/validate.js';
import { seoBulkAcceptFixSchema, seoBulkAnalyzePageSchema, seoBulkRewritePageSchema } from '../schemas/seo-bulk-jobs.js';
import { handleOnDemandSeoAuditResult } from '../webflow-seo-audit-bridges.js';
import { runSeoBulkAcceptFixesJob } from '../webflow-seo-bulk-accept-fixes-job.js';
import { runSeoBulkAnalyzeJob } from '../webflow-seo-bulk-analyze-job.js';
import { runSeoBulkRewriteJob } from '../webflow-seo-bulk-rewrite-job.js';

const log = createLogger('webflow-seo');

// --- SEO Audit ---
router.get('/api/webflow/seo-audit/:siteId', requireWorkspaceSiteAccessFromQuery(), async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    if (!token) {
      log.error({ detail: req.params.siteId }, 'SEO audit: No token available for site');
      return res.status(500).json({ error: 'No Webflow API token configured. Please link a workspace to this site in Settings, or set WEBFLOW_API_TOKEN environment variable.' });
    }
    const skipLinkCheck = req.query.skipLinkCheck === 'true';
    const result = await runSeoAudit(req.params.siteId, token, req.query.workspaceId as string | undefined, skipLinkCheck);
    // Auto-flag pages with issues for edit tracking
    const auditWsId = req.query.workspaceId as string | undefined;
    const auditWs = auditWsId ? getWorkspace(auditWsId) : listWorkspaces().find(w => w.webflowSiteId === req.params.siteId);
    if (auditWs) {
      handleOnDemandSeoAuditResult(auditWs, result);
    }
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ detail: msg }, 'SEO audit error');
    res.status(500).json({ error: `SEO audit failed: ${msg}` });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Bulk background job endpoints — run server-side with WS progress
// ═══════════════════════════════════════════════════════════════════

const bulkAnalyzeSchema = z.object({
  pages: z.array(seoBulkAnalyzePageSchema).min(1).max(500),
});

router.post('/api/seo/:workspaceId/bulk-analyze', requireWorkspaceAccess('workspaceId'), validate(bulkAnalyzeSchema), async (req, res) => {
  const workspaceId = req.params.workspaceId;
  const { pages } = req.body;
  const ws = getWorkspace(workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  const existing = hasActiveJob('seo-bulk-analyze', workspaceId);
  if (existing) return res.status(409).json({ error: 'A bulk analyze job is already running', jobId: existing.id });

  const job = createJob('seo-bulk-analyze', {
    message: `Analyzing ${pages.length} pages...`,
    total: pages.length,
    workspaceId,
  });
  const ac = registerAbort(job.id);
  res.json({ jobId: job.id });

  void runSeoBulkAnalyzeJob({
    jobId: job.id,
    workspaceId,
    pages,
    workspace: ws,
    signal: ac.signal,
  });
});

// ── Bulk AI Rewrite (background job) ──

const bulkRewriteSchema = z.object({
  siteId: z.string().min(1),
  pages: z.array(seoBulkRewritePageSchema).min(1).max(500),
  field: z.enum(['title', 'description', 'both']),
});

router.post('/api/seo/:workspaceId/bulk-rewrite', requireWorkspaceAccess('workspaceId'), validate(bulkRewriteSchema), async (req, res) => {
  const workspaceId = req.params.workspaceId;
  const { siteId, pages, field } = req.body;
  const ws = getWorkspace(workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (ws.webflowSiteId && siteId !== ws.webflowSiteId) return res.status(400).json({ error: 'siteId does not belong to this workspace' });

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  const existingJob = hasActiveJob('seo-bulk-rewrite', workspaceId);
  if (existingJob) return res.status(409).json({ error: 'A bulk rewrite job is already running', jobId: existingJob.id });

  const job = createJob('seo-bulk-rewrite', {
    message: `Generating ${field} variations for ${pages.length} pages...`,
    total: pages.length,
    workspaceId,
  });
  const ac = registerAbort(job.id);
  res.json({ jobId: job.id });

  void runSeoBulkRewriteJob({
    jobId: job.id,
    workspaceId,
    siteId,
    pages,
    field,
    workspace: ws,
    signal: ac.signal,
  });
});

// ── Bulk Accept Fixes (background job — SeoAudit accept-all) ──

const bulkAcceptFixesSchema = z.object({
  siteId: z.string().min(1),
  fixes: z.array(seoBulkAcceptFixSchema).min(1).max(500),
});

router.post('/api/seo/:workspaceId/bulk-accept-fixes', requireWorkspaceAccess('workspaceId'), validate(bulkAcceptFixesSchema), async (req, res) => {
  const workspaceId = req.params.workspaceId;
  const { siteId, fixes } = req.body;
  const ws = getWorkspace(workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (ws.webflowSiteId && siteId !== ws.webflowSiteId) return res.status(400).json({ error: 'siteId does not belong to this workspace' });

  const existingJob = hasActiveJob('seo-bulk-accept-fixes', workspaceId);
  if (existingJob) return res.status(409).json({ error: 'A bulk accept job is already running', jobId: existingJob.id });

  const token = getTokenForSite(siteId) || undefined;
  if (!token) return res.status(500).json({ error: 'No Webflow API token configured' });

  const job = createJob('seo-bulk-accept-fixes', {
    message: `Applying ${fixes.length} fixes...`,
    total: fixes.length,
    workspaceId,
  });
  const ac = registerAbort(job.id);
  res.json({ jobId: job.id });

  void runSeoBulkAcceptFixesJob({
    jobId: job.id,
    workspaceId,
    fixes,
    token,
    signal: ac.signal,
  });
});

export default router;
