/**
 * Core webflow routes — asset browser, pages, SEO editing, publish, metadata
 * Domain-specific routes extracted to: webflow-audit, webflow-keywords, webflow-alt-text, webflow-organize, webflow-cms
 */
import { Router } from 'express';
import { addActivity } from '../activity-log.js';
import { recordSeoChange } from '../seo-change-tracker.js';
import { getQueue, getMetadata } from '../processor.js';
import {
  listSites,
  listAssets,
  updateAsset,
  deleteAsset,
  updatePageSeo,
  publishSite,
  getSiteSubdomain,
  discoverCmsUrls,
  buildStaticPathSet,
} from '../webflow.js';
import {
  listWorkspaces,
  getTokenForSite,
  updatePageState,
} from '../workspaces.js';
import { getWorkspacePages } from '../workspace-data.js';
import { createLogger } from '../logger.js';

const log = createLogger('webflow');

import { requireWorkspaceAccessFromQuery } from '../auth.js';
const router = Router();

// Processing queue
router.get('/api/queue', (_req, res) => {
  res.json(getQueue());
});

// Webflow sites
router.get('/api/webflow/sites', async (req, res) => {
  try {
    const tokenParam = req.query.token as string | undefined;
    const sites = await listSites(tokenParam || undefined);
    res.json(sites);
  } catch {
    res.json([]);
  }
});

// --- Asset Browser ---
router.get('/api/webflow/assets/:siteId', requireWorkspaceAccessFromQuery(), async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId);
    const assets = await listAssets(req.params.siteId, token || undefined);
    res.json(assets);
  } catch {
    res.status(500).json({ error: 'Failed to list assets' });
  }
});

router.patch('/api/webflow/assets/:assetId', async (req, res) => {
  const { altText, displayName, siteId } = req.body;
  const token = siteId ? getTokenForSite(siteId) : null;
  const result = await updateAsset(req.params.assetId, { altText, displayName }, token || undefined);
  res.json(result);
});

router.delete('/api/webflow/assets/:assetId', async (req, res) => {
  const siteId = req.query.siteId as string;
  const token = siteId ? getTokenForSite(siteId) : null;
  const result = await deleteAsset(req.params.assetId, token || undefined);
  res.json(result);
});

/** Run `fn` over `items` with at most `limit` in-flight at once. */
async function runConcurrent<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const settled = await Promise.allSettled(items.slice(i, i + limit).map(fn));
    results.push(...settled);
  }
  return results;
}

// Bulk update alt text
router.post('/api/webflow/assets/bulk-alt', async (req, res) => {
  const { updates, siteId } = req.body as { updates: Array<{ assetId: string; altText: string }>; siteId?: string };
  const token = siteId ? getTokenForSite(siteId) : null;
  const settled = await runConcurrent(updates, 5, u => updateAsset(u.assetId, { altText: u.altText }, token || undefined));
  res.json(settled.map((r, i) => ({
    assetId: updates[i].assetId,
    ...(r.status === 'fulfilled' ? r.value : { error: String(r.reason) }),
  })));
});

// Bulk delete assets
router.post('/api/webflow/assets/bulk-delete', async (req, res) => {
  const { assetIds, siteId } = req.body as { assetIds: string[]; siteId?: string };
  const token = siteId ? getTokenForSite(siteId) : null;
  const settled = await runConcurrent(assetIds, 5, id => deleteAsset(id, token || undefined));
  res.json(settled.map((r, i) => ({
    assetId: assetIds[i],
    ...(r.status === 'fulfilled' ? r.value : { error: String(r.reason) }),
  })));
});

// --- Page SEO Editing ---
router.get('/api/webflow/pages/:siteId', requireWorkspaceAccessFromQuery(), async (req, res) => {
  try {
    const { siteId } = req.params;
    const ws = listWorkspaces().find(w => w.webflowSiteId === siteId);
    const published = ws ? await getWorkspacePages(ws.id, siteId) : [];
    log.info(`Pages: ${published.length} published`);
    res.json(published);
  } catch (err) {
    log.error({ err: err }, 'Pages list error');
    res.status(500).json({ error: 'Failed to list pages' });
  }
});

// All pages (static + CMS) — for Page Analysis and bulk analysis features
router.get('/api/webflow/all-pages/:siteId', requireWorkspaceAccessFromQuery(), async (req, res) => {
  try {
    const { siteId } = req.params;
    const token = getTokenForSite(siteId) || undefined;
    const ws = listWorkspaces().find(w => w.webflowSiteId === siteId);
    const published = ws ? await getWorkspacePages(ws.id, siteId) : [];

    // Build result from static pages
    const result: Array<{ id: string; title: string; slug: string; publishedPath?: string | null; seo?: { title?: string; description?: string }; source: 'static' | 'cms'; collectionId?: string }> = published.map(p => ({
      id: p.id,
      title: p.title,
      slug: p.slug || '',
      publishedPath: p.publishedPath,
      seo: p.seo ? { title: p.seo.title || undefined, description: p.seo.description || undefined } : undefined,
      source: 'static' as const,
      collectionId: p.collectionId ?? undefined,
    }));

    // Discover CMS pages from sitemap
    try {
      const ws = listWorkspaces().find(w => w.webflowSiteId === siteId);
      let baseUrl = '';
      if (ws?.liveDomain) {
        baseUrl = ws.liveDomain.startsWith('http') ? ws.liveDomain : `https://${ws.liveDomain}`;
      } else {
        const sub = await getSiteSubdomain(siteId, token);
        if (sub) baseUrl = `https://${sub}.webflow.io`;
      }

      if (baseUrl) {
        const staticPaths = buildStaticPathSet(published);
        const { cmsUrls } = await discoverCmsUrls(baseUrl, staticPaths, 500);
        for (const cms of cmsUrls) {
          result.push({
            id: `cms-${cms.path.replace(/\//g, '-')}`,
            title: cms.pageName,
            slug: cms.path.replace(/^\//, ''),
            publishedPath: cms.path,
            source: 'cms',
          });
        }
        log.info(`All pages: ${published.length} static + ${cmsUrls.length} CMS = ${result.length} total`);
      }
    } catch (err) {
      log.warn({ err }, 'CMS page discovery failed — returning static pages only');
    }

    res.json(result);
  } catch (err) {
    log.error({ err }, 'All-pages list error');
    res.status(500).json({ error: 'Failed to list pages' });
  }
});

router.put('/api/webflow/pages/:pageId/seo', async (req, res) => {
  // Reject synthetic CMS IDs at the API boundary — these are not real Webflow page IDs
  // and the Webflow API returns 404 for them. Guard here so no frontend call site can
  // inadvertently send them through regardless of whether it remembered to filter.
  if (req.params.pageId.startsWith('cms-')) {
    return res.status(400).json({ error: 'Cannot update SEO for CMS pages via this endpoint — update directly in Webflow' });
  }
  try {
    const { siteId, seo, openGraph, title } = req.body;
    const token = siteId ? (getTokenForSite(siteId) || undefined) : undefined;
    const result = await updatePageSeo(req.params.pageId, { seo, openGraph, title }, token);
    if (siteId) {
      const seoWs = listWorkspaces().find(w => w.webflowSiteId === siteId);
      if (seoWs) {
        const changedFields = [seo?.title && 'title', seo?.description && 'description', openGraph && 'OG'].filter(Boolean) as string[];
        addActivity(seoWs.id, 'seo_updated', `Updated SEO ${changedFields.join(', ')} for a page`, undefined, { pageId: req.params.pageId });
        updatePageState(seoWs.id, req.params.pageId, { status: 'live', source: 'editor', fields: changedFields, updatedBy: 'admin' });
        recordSeoChange(seoWs.id, req.params.pageId, req.body.slug || '', req.body.pageTitle || title || '', changedFields, 'editor');
      }
    }
    res.json(result);
  } catch (err) {
    log.error({ err: err }, 'Page SEO update error');
    res.status(500).json({ error: 'Failed to update page SEO' });
  }
});

router.post('/api/webflow/publish/:siteId', requireWorkspaceAccessFromQuery(), async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const result = await publishSite(req.params.siteId, token);
    res.json(result);
  } catch (err) {
    log.error({ err: err }, 'Publish error');
    res.status(500).json({ error: 'Failed to publish site' });
  }
});

// Persistent metadata (alt text, upload history)
router.get('/api/metadata', (_req, res) => {
  res.json(getMetadata());
});

export default router;
