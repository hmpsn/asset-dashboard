/**
 * AEO Page Review routes — admin-only AI-powered content change recommendations
 */
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { getDataDir } from '../data-dir.js';
import { reviewPage, reviewSitePages } from '../aeo-page-review.js';
import { getWorkspace } from '../workspaces.js';
import { getLatestSnapshot } from '../reports.js';
import { addActivity } from '../activity-log.js';
import type { SeoIssue } from '../seo-audit.js';
import { createLogger } from '../logger.js';

const log = createLogger('aeo-review');

const router = Router();
const REVIEW_DIR = getDataDir('aeo-reviews');

// ─── Storage helpers ──────────────────────────────────────────────

function reviewFile(workspaceId: string): string {
  return path.join(REVIEW_DIR, `${workspaceId}.json`);
}

function saveReview(workspaceId: string, data: unknown): void {
  fs.writeFileSync(reviewFile(workspaceId), JSON.stringify(data, null, 2));
}

function loadReview(workspaceId: string): unknown | null {
  const file = reviewFile(workspaceId);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }
}

// ─── Single page review ──────────────────────────────────────────

router.post('/api/aeo-review/:workspaceId/page', async (req, res) => {
  const { workspaceId } = req.params;
  const { pageUrl, pageSlug } = req.body;

  if (!pageUrl && !pageSlug) {
    return res.status(400).json({ error: 'pageUrl or pageSlug required' });
  }

  const ws = getWorkspace(workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  try {
    // Fetch page HTML
    const targetUrl = pageUrl || (ws.liveDomain ? `https://${ws.liveDomain}/${pageSlug || ''}` : '');
    if (!targetUrl) return res.status(400).json({ error: 'No pageUrl provided and workspace has no liveDomain configured' });
    const htmlRes = await fetch(targetUrl, { redirect: 'follow', signal: AbortSignal.timeout(10_000) });
    if (!htmlRes.ok) return res.status(400).json({ error: `Failed to fetch page: ${htmlRes.status}` });
    const html = await htmlRes.text();

    // Get audit issues for this page (from latest snapshot)
    let pageIssues: SeoIssue[] = [];
    if (ws.webflowSiteId) {
      const snapshot = getLatestSnapshot(ws.webflowSiteId);
      if (snapshot) {
        const slug = pageSlug || new URL(targetUrl).pathname.replace(/^\//, '');
        const pageData = snapshot.audit.pages.find(
          (p: { slug: string }) => p.slug === slug || p.slug === `/${slug}`
        );
        if (pageData) pageIssues = pageData.issues;
      }
    }

    const pageTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || targetUrl;
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

router.get('/api/aeo-review/:workspaceId', (_req, res) => {
  const data = loadReview(_req.params.workspaceId);
  if (!data) return res.json(null);
  res.json(data);
});

// ─── Batch site review (runs inline — for job-based, use /api/jobs) ─

router.post('/api/aeo-review/:workspaceId/site', async (req, res) => {
  const { workspaceId } = req.params;
  const ws = getWorkspace(workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (!ws.webflowSiteId) return res.status(400).json({ error: 'No Webflow site linked' });

  const maxPages = Math.min(Number(req.body.maxPages) || 10, 25);

  try {
    // Get latest audit snapshot for issues
    const snapshot = getLatestSnapshot(ws.webflowSiteId);
    if (!snapshot) return res.status(400).json({ error: 'No audit snapshot found — run an SEO audit first' });

    const baseUrl = ws.liveDomain
      ? (ws.liveDomain.startsWith('http') ? ws.liveDomain : `https://${ws.liveDomain}`)
      : '';
    if (!baseUrl) return res.status(400).json({ error: 'No live domain configured for this workspace' });

    // Get pages with AEO issues (prioritize those with most issues)
    const pagesWithAeo = snapshot.audit.pages
      .filter((p: { issues: SeoIssue[] }) => p.issues.some((i: SeoIssue) => i.check.startsWith('aeo-')))
      .sort((a: { issues: SeoIssue[] }, b: { issues: SeoIssue[] }) =>
        b.issues.filter((i: SeoIssue) => i.check.startsWith('aeo-')).length -
        a.issues.filter((i: SeoIssue) => i.check.startsWith('aeo-')).length
      )
      .slice(0, maxPages);

    if (pagesWithAeo.length === 0) {
      return res.json({ workspaceId, generatedAt: new Date().toISOString(), pages: [], sitewideSummary: 'No pages with AEO issues found.', totalChanges: 0, quickWins: 0 });
    }

    // Fetch HTML for each page
    const pagesToReview: { url: string; title: string; html: string; issues: SeoIssue[] }[] = [];
    await Promise.all(pagesWithAeo.map(async (page) => {
      const pageUrl = page.slug ? `${baseUrl}/${page.slug}` : baseUrl;
      try {
        const htmlRes = await fetch(pageUrl, { redirect: 'follow', signal: AbortSignal.timeout(10_000) });
        if (htmlRes.ok) {
          const html = await htmlRes.text();
          const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || page.slug;
          pagesToReview.push({ url: pageUrl, title, html, issues: page.issues });
        }
      } catch { /* skip unreachable / timed-out pages */ }
    }));

    const result = await reviewSitePages(workspaceId, pagesToReview);

    // Save to disk
    saveReview(workspaceId, result);

    // Activity log
    addActivity(workspaceId, 'aeo_review', `AEO site review: ${result.pages.length} pages`, result.sitewideSummary);

    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ detail: msg }, 'Site review error');
    res.status(500).json({ error: msg });
  }
});

export default router;
