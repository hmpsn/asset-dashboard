/**
 * AEO Site Review Job
 *
 * Moves the full AEO site review crawl + AI generation into the background job
 * platform. Called via setImmediate from POST /api/aeo-review/:workspaceId/site.
 *
 * Logic migrated from server/routes/aeo-review.ts inline handler (lines 108–218).
 */
import fs from 'fs';
import path from 'path';
import { addActivity } from './activity-log.js';
import { isProgrammingError } from './errors.js';
import { updateJob, unregisterAbort } from './jobs.js';
import { createLogger } from './logger.js';
import { getWorkspace } from './workspaces.js';
import { getLatestSnapshot } from './reports.js';
import { discoverCmsUrls, buildStaticPathSet } from './webflow.js';
import { getWorkspacePages } from './workspace-data.js';
import { isContentPage, isExcludedPage } from './audit-page.js';
import { normalizePageUrl, resolvePagePath, decodeEntities } from './helpers.js';
import { reviewSitePages } from './aeo-page-review.js';
import { getDataDir } from './data-dir.js';
import type { SeoIssue } from './seo-audit.js';

const log = createLogger('aeo-site-review-job');

const REVIEW_DIR = getDataDir('aeo-reviews');

function reviewFile(workspaceId: string): string {
  return path.join(REVIEW_DIR, `${workspaceId}.json`);
}

function saveReview(workspaceId: string, data: unknown): void {
  fs.writeFileSync(reviewFile(workspaceId), JSON.stringify(data, null, 2));
}

export interface RunAeoSiteReviewJobOptions {
  jobId: string;
  workspaceId: string;
  maxPages: number;
}

export async function runAeoSiteReviewJob({
  jobId,
  workspaceId,
  maxPages,
}: RunAeoSiteReviewJobOptions): Promise<void> {
  try {
    updateJob(jobId, {
      status: 'running',
      message: 'Discovering pages...',
    });

    const ws = getWorkspace(workspaceId);
    if (!ws) throw new Error('Workspace not found');
    if (!ws.webflowSiteId) throw new Error('No Webflow site linked');

    const baseUrl = ws.liveDomain
      ? (ws.liveDomain.startsWith('http') ? ws.liveDomain : `https://${ws.liveDomain}`)
      : '';
    if (!baseUrl) throw new Error('No live domain configured for this workspace');

    // Build audit issue map from snapshot (if available) for enrichment
    const snapshot = getLatestSnapshot(ws.webflowSiteId);
    const issueMap = new Map<string, SeoIssue[]>();
    if (snapshot) {
      for (const p of snapshot.audit.pages) {
        const slugKey = normalizePageUrl(p.url || p.slug);
        issueMap.set(slugKey, p.issues);
      }
    }

    // ── Discover ALL pages: static (Webflow API) + CMS (sitemap) ──
    const allPageUrls: { url: string; path: string; name: string }[] = [];

    try {
      const published = await getWorkspacePages(workspaceId, ws.webflowSiteId);
      for (const p of published) {
        if (isExcludedPage(p.slug, p.title)) continue;
        const pagePath = resolvePagePath(p);
        allPageUrls.push({
          url: `${baseUrl.replace(/\/+$/, '')}${pagePath === '/' ? '' : pagePath}`,
          path: pagePath,
          name: p.title,
        });
      }

      const staticPaths = buildStaticPathSet(published);
      const { cmsUrls } = await discoverCmsUrls(baseUrl, staticPaths, 200);
      for (const cms of cmsUrls) {
        if (isExcludedPage(cms.path, cms.pageName)) continue;
        const pagePath = normalizePageUrl(cms.path);
        allPageUrls.push({ url: cms.url, path: pagePath, name: cms.pageName });
      }
    } catch (err) {
      log.warn({ err }, 'Page discovery failed, falling back to audit snapshot');
      if (snapshot) {
        for (const p of snapshot.audit.pages) {
          const pagePath = resolvePagePath(p);
          allPageUrls.push({
            url: p.url || `${baseUrl.replace(/\/+$/, '')}${pagePath === '/' ? '' : pagePath}`,
            path: pagePath,
            name: p.page,
          });
        }
      }
    }

    log.info(`AEO review: discovered ${allPageUrls.length} pages (static + CMS)`);

    if (allPageUrls.length === 0) {
      const emptyResult = {
        workspaceId,
        generatedAt: new Date().toISOString(),
        pages: [],
        sitewideSummary: 'No pages found.',
        totalChanges: 0,
        quickWins: 0,
      };
      saveReview(workspaceId, emptyResult);
      updateJob(jobId, {
        status: 'done',
        result: emptyResult,
        message: 'AEO review complete — no pages found',
      });
      return;
    }

    // Prioritize content pages (blog, articles, guides) then pages with AEO issues
    const scored = allPageUrls.map(p => {
      const isContent = isContentPage(p.path) ? 2 : 0;
      const lookupKey = normalizePageUrl(p.path);
      const aeoIssueCount = (issueMap.get(lookupKey) || []).filter(
        (i: SeoIssue) => i.check.startsWith('aeo-'),
      ).length;
      return { ...p, priority: isContent + aeoIssueCount };
    });
    scored.sort((a, b) => b.priority - a.priority);
    const selected = scored.slice(0, maxPages);

    updateJob(jobId, {
      status: 'running',
      message: `Fetching ${selected.length} pages...`,
      progress: 0,
      total: selected.length,
    });

    // Fetch HTML for each page
    const pagesToReview: { url: string; title: string; html: string; issues: SeoIssue[] }[] = [];
    await Promise.all(selected.map(async (page) => {
      try {
        const htmlRes = await fetch(page.url, { redirect: 'follow', signal: AbortSignal.timeout(10_000) });
        if (htmlRes.ok) {
          const html = await htmlRes.text();
          const title = decodeEntities(
            html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || page.name,
          );
          const pageKey = normalizePageUrl(page.path);
          pagesToReview.push({ url: page.url, title, html, issues: issueMap.get(pageKey) || [] });
        }
        // url-fetch-ok: per-page fetch may timeout or fail; skipping unreachable pages is intentional.
      } catch (err) {
        if (isProgrammingError(err)) { // url-fetch-ok: per-page fetch timeouts/unreachable pages are expected degradation
          log.warn({ err }, 'aeo-site-review-job: programming error fetching page');
        }
        // skip unreachable / timed-out pages
      }
    }));

    log.info(`AEO review: fetched ${pagesToReview.length}/${selected.length} pages, sending to AI`);

    updateJob(jobId, {
      status: 'running',
      message: `Reviewing ${pagesToReview.length} pages with AI...`,
      progress: pagesToReview.length,
      total: selected.length,
    });

    const result = await reviewSitePages(workspaceId, pagesToReview);

    // Save to disk (same location as the existing GET /api/aeo-review/:workspaceId reader)
    saveReview(workspaceId, result);

    // I-2: AeoReview component loads the stored result from disk on mount and passes
    // queryKeys: [] to useJobProgress. No WS broadcast is needed for UI refresh.

    updateJob(jobId, {
      status: 'done',
      result,
      message: `AEO review complete — ${result.pages.length} pages, ${result.quickWins} quick wins`,
    });

    addActivity(
      workspaceId,
      'aeo_review',
      `AEO site review: ${result.pages.length} pages`,
      result.sitewideSummary,
    );
  } catch (err) {
    if (isProgrammingError(err)) { // url-fetch-ok: job-level catch wraps page fetches; network failures are expected degradation
      log.warn({ err, workspaceId }, 'aeo-site-review-job: programming error');
    } else {
      log.debug({ err, workspaceId }, 'aeo-site-review-job: review failed');
    }
    updateJob(jobId, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      message: 'AEO site review failed',
    });
  } finally {
    unregisterAbort(jobId);
  }
}
