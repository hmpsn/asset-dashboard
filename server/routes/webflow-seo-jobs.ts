/**
 * Webflow SEO background job start routes.
 *
 * @reads workspaces, jobs, webflow_api
 * @writes jobs
 */
import { Router } from 'express';

import { requireWorkspaceAccess } from '../auth.js';
import { createJob, hasActiveJob, registerAbort } from '../jobs.js';
import { validate, z } from '../middleware/validate.js';
import { seoBulkAcceptFixSchema, seoBulkAnalyzePageSchema, seoBulkRewritePageSchema } from '../schemas/seo-bulk-jobs.js';
import { runSeoBulkAcceptFixesJob } from '../webflow-seo-bulk-accept-fixes-job.js';
import { runSeoBulkAnalyzeJob } from '../webflow-seo-bulk-analyze-job.js';
import { runSeoBulkRewriteJob } from '../webflow-seo-bulk-rewrite-job.js';
import {
  getTokenForSite,
  getWorkspace,
} from '../workspaces.js';

const router = Router();

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
