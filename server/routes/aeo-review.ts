/**
 * AEO Page Review routes — admin-only AI-powered content change recommendations
 */
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { getDataDir } from '../data-dir.js';
import { reviewPage } from '../aeo-page-review.js';
import { getWorkspace } from '../workspaces.js';
import { getLatestSnapshot } from '../reports.js';
import { addActivity } from '../activity-log.js';
import { matchPageIdentity, normalizePageUrl, decodeEntities } from '../helpers.js';
import type { SeoIssue } from '../seo-audit.js';
import { createLogger } from '../logger.js';
import { requireWorkspaceAccess } from '../auth.js';
import { createJob } from '../jobs.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import { runAeoSiteReviewJob } from '../aeo-site-review-job.js';

const log = createLogger('aeo-review');

const router = Router();
const REVIEW_DIR = getDataDir('aeo-reviews');

// ─── Storage helpers ──────────────────────────────────────────────

function reviewFile(workspaceId: string): string {
  return path.join(REVIEW_DIR, `${workspaceId}.json`);
}

function loadReview(workspaceId: string): unknown | null {
  const file = reviewFile(workspaceId);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch (err) { return null; }
}

// ─── Single page review ──────────────────────────────────────────

router.post('/api/aeo-review/:workspaceId/page', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const { workspaceId } = req.params;
  const { pageUrl, pageSlug } = req.body;

  if (!pageUrl && !pageSlug) {
    return res.status(400).json({ error: 'pageUrl or pageSlug required' });
  }

  const ws = getWorkspace(workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  try {
    // Fetch page HTML
    const requestedPath = typeof pageUrl === 'string' && pageUrl
      ? normalizePageUrl(pageUrl)
      : (typeof pageSlug === 'string' && pageSlug ? normalizePageUrl(pageSlug) : '');
    const baseDomain = ws.liveDomain
      ? (ws.liveDomain.startsWith('http') ? ws.liveDomain : `https://${ws.liveDomain}`)
      : '';
    const targetUrl = pageUrl?.startsWith?.('http')
      ? pageUrl
      : (baseDomain && requestedPath ? `${baseDomain.replace(/\/+$/, '')}${requestedPath === '/' ? '' : requestedPath}` : '');
    if (!targetUrl) return res.status(400).json({ error: 'No pageUrl provided and workspace has no liveDomain configured' });
    const htmlRes = await fetch(targetUrl, { redirect: 'follow', signal: AbortSignal.timeout(10_000) });
    if (!htmlRes.ok) return res.status(400).json({ error: `Failed to fetch page: ${htmlRes.status}` });
    const html = await htmlRes.text();

    // Get audit issues for this page (from latest snapshot)
    let pageIssues: SeoIssue[] = [];
    if (ws.webflowSiteId) {
      const snapshot = getLatestSnapshot(ws.webflowSiteId);
      if (snapshot) {
        const targetPath = normalizePageUrl(targetUrl);
        const pageData = snapshot.audit.pages.find(
          (p: { slug: string; url?: string }) => matchPageIdentity(p.url || p.slug, targetPath)
        );
        if (pageData) pageIssues = pageData.issues;
      }
    }

    const pageTitle = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || targetUrl);
    const review = await reviewPage(targetUrl, pageTitle, html, pageIssues, workspaceId);

    // Activity log
    addActivity(workspaceId, 'aeo_review', `AEO review: ${pageTitle}`, `${review.changes.length} changes, score ${review.overallScore}/100`);

    res.json(review);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ detail: msg }, 'Single page error');
    res.status(500).json({ error: msg });
  }
});

// ─── Load saved review ───────────────────────────────────────────

router.get('/api/aeo-review/:workspaceId', requireWorkspaceAccess('workspaceId'), (_req, res) => {
  const data = loadReview(_req.params.workspaceId);
  if (!data) return res.json(null);
  res.json(data);
});

// ─── Batch site review (async — returns { jobId }) ───────────────────────────

router.post('/api/aeo-review/:workspaceId/site', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { workspaceId } = req.params;
  const ws = getWorkspace(workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (!ws.webflowSiteId) return res.status(400).json({ error: 'No Webflow site linked' });
  if (!ws.liveDomain) return res.status(400).json({ error: 'No live domain configured for this workspace' });

  const rawMaxPages = req.body?.maxPages;
  const requestedMaxPages = rawMaxPages == null ? 10 : Number(rawMaxPages);
  if (!Number.isInteger(requestedMaxPages) || requestedMaxPages < 1) {
    return res.status(400).json({ error: 'maxPages must be a positive integer' });
  }
  if (requestedMaxPages > 25) {
    return res.status(400).json({ error: 'maxPages must be between 1 and 25' });
  }
  const maxPages = Math.min(requestedMaxPages, 25);

  const job = createJob(BACKGROUND_JOB_TYPES.AEO_SITE_REVIEW, { workspaceId });
  setImmediate(() => {
    void runAeoSiteReviewJob({ jobId: job.id, workspaceId, maxPages });
  });
  return res.json({ jobId: job.id });
});

export default router;
