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
import { discoverCmsUrls, buildStaticPathSet } from '../webflow.js';
import { getWorkspacePages } from '../workspace-data.js';
import { isContentPage, isExcludedPage } from '../audit-page.js';
import { addActivity } from '../activity-log.js';
import { resolvePagePath } from '../helpers.js';
import type { SeoIssue } from '../seo-audit.js';
import { createLogger } from '../logger.js';

const log = createLogger('aeo-review');

import { requireWorkspaceAccess } from '../auth.js';
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

router.get('/api/aeo-review/:workspaceId', requireWorkspaceAccess('workspaceId'), (_req, res) => {
  const data = loadReview(_req.params.workspaceId);
  if (!data) return res.json(null);
  res.json(data);
});

// ─── Batch site review (runs inline — for job-based, use /api/jobs) ─

router.post('/api/aeo-review/:workspaceId/site', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const { workspaceId } = req.params;
  const ws = getWorkspace(workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (!ws.webflowSiteId) return res.status(400).json({ error: 'No Webflow site linked' });

  const maxPages = Math.min(Number(req.body.maxPages) || 10, 25);

  try {
    const baseUrl = ws.liveDomain
      ? (ws.liveDomain.startsWith('http') ? ws.liveDomain : `https://${ws.liveDomain}`)
      : '';
    if (!baseUrl) return res.status(400).json({ error: 'No live domain configured for this workspace' });

    // Build audit issue map from snapshot (if available) for enrichment
    const snapshot = getLatestSnapshot(ws.webflowSiteId);
    const issueMap = new Map<string, SeoIssue[]>();
    if (snapshot) {
      for (const p of snapshot.audit.pages) {
        issueMap.set(p.slug, p.issues);
      }
    }

    // ── Discover ALL pages: static (Webflow API) + CMS (sitemap) ──
    const allPageUrls: { url: string; slug: string; name: string }[] = [];

    // 1. Static pages from Webflow API
    try {
      const published = await getWorkspacePages(workspaceId, ws.webflowSiteId);
      for (const p of published) {
        if (isExcludedPage(p.slug, p.title)) continue;
        const pagePath = resolvePagePath(p);
        const slug = pagePath.replace(/^\//, '') || p.slug || '';
        allPageUrls.push({ url: `${baseUrl}${pagePath}`, slug, name: p.title });
      }

      // 2. CMS pages from sitemap
      const staticPaths = buildStaticPathSet(published);
      const { cmsUrls } = await discoverCmsUrls(baseUrl, staticPaths, 200);
      for (const cms of cmsUrls) {
        if (isExcludedPage(cms.path, cms.pageName)) continue;
        const slug = cms.path.replace(/^\//, '');
        allPageUrls.push({ url: cms.url, slug, name: cms.pageName });
      }
    } catch (err) {
      log.warn({ err }, 'Page discovery failed, falling back to audit snapshot');
      // Fallback: use audit snapshot pages
      if (snapshot) {
        for (const p of snapshot.audit.pages) {
          allPageUrls.push({ url: p.url || `${baseUrl}/${p.slug}`, slug: p.slug, name: p.page });
        }
      }
    }

    log.info(`AEO review: discovered ${allPageUrls.length} pages (static + CMS)`);

    if (allPageUrls.length === 0) {
      return res.json({ workspaceId, generatedAt: new Date().toISOString(), pages: [], sitewideSummary: 'No pages found.', totalChanges: 0, quickWins: 0 });
    }

    // Prioritize content pages (blog, articles, guides) then pages with AEO issues
    const scored = allPageUrls.map(p => {
      const isContent = isContentPage(p.slug) ? 2 : 0;
      const aeoIssueCount = (issueMap.get(p.slug) || []).filter(i => i.check.startsWith('aeo-')).length;
      return { ...p, priority: isContent + aeoIssueCount };
    });
    scored.sort((a, b) => b.priority - a.priority);
    const selected = scored.slice(0, maxPages);

    // Fetch HTML for each page
    const pagesToReview: { url: string; title: string; html: string; issues: SeoIssue[] }[] = [];
    await Promise.all(selected.map(async (page) => {
      try {
        const htmlRes = await fetch(page.url, { redirect: 'follow', signal: AbortSignal.timeout(10_000) });
        if (htmlRes.ok) {
          const html = await htmlRes.text();
          const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || page.name;
          pagesToReview.push({ url: page.url, title, html, issues: issueMap.get(page.slug) || [] });
        }
      } catch { /* skip unreachable / timed-out pages */ }
    }));

    log.info(`AEO review: fetched ${pagesToReview.length}/${selected.length} pages, sending to AI`);

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
