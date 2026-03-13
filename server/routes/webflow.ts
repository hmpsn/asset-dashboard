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
  listPages,
  filterPublishedPages,
  updatePageSeo,
  publishSite,
} from '../webflow.js';
import {
  listWorkspaces,
  getTokenForSite,
  updatePageState,
} from '../workspaces.js';
import { createLogger } from '../logger.js';

const log = createLogger('webflow');

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
router.get('/api/webflow/assets/:siteId', async (req, res) => {
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

// Bulk update alt text
router.post('/api/webflow/assets/bulk-alt', async (req, res) => {
  const { updates, siteId } = req.body as { updates: Array<{ assetId: string; altText: string }>; siteId?: string };
  const token = siteId ? getTokenForSite(siteId) : null;
  const results = [];
  for (const u of updates) {
    const r = await updateAsset(u.assetId, { altText: u.altText }, token || undefined);
    results.push({ assetId: u.assetId, ...r });
  }
  res.json(results);
});

// Bulk delete assets
router.post('/api/webflow/assets/bulk-delete', async (req, res) => {
  const { assetIds, siteId } = req.body as { assetIds: string[]; siteId?: string };
  const token = siteId ? getTokenForSite(siteId) : null;
  const results = [];
  for (const id of assetIds) {
    const r = await deleteAsset(id, token || undefined);
    results.push({ assetId: id, ...r });
  }
  res.json(results);
});

// --- Page SEO Editing ---
router.get('/api/webflow/pages/:siteId', async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const allPages = await listPages(req.params.siteId, token);
    const published = filterPublishedPages(allPages);
    log.info(`Pages: ${allPages.length} total, ${published.length} published (filtered out ${allPages.length - published.length} drafts/collections/unpublished)`);
    res.json(published);
  } catch (err) {
    log.error({ err: err }, 'Pages list error');
    res.status(500).json({ error: 'Failed to list pages' });
  }
});

router.put('/api/webflow/pages/:pageId/seo', async (req, res) => {
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

router.post('/api/webflow/publish/:siteId', async (req, res) => {
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
