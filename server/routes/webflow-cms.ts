/**
 * CMS collection routes — extracted from webflow.ts
 */
import { Router } from 'express';
import {
  listCollections,
  getCollectionSchema,
  listCollectionItems,
  updateCollectionItem,
  publishCollectionItems,
  getSiteSubdomain,
  discoverSitemapUrls,
} from '../webflow.js';
import {
  getTokenForSite,
  getWorkspace,
  updatePageState,
  listWorkspaces,
} from '../workspaces.js';
import { createLogger } from '../logger.js';

const log = createLogger('webflow-cms');

import { requireWorkspaceAccessFromQuery } from '../auth.js';
import { isProgrammingError } from '../errors.js';
const router = Router();

// --- CMS Collections ---
router.get('/api/webflow/collections/:siteId', requireWorkspaceAccessFromQuery(), async (req, res) => {
  try {
    const collections = await listCollections(req.params.siteId);
    res.json(collections);
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err }, 'webflow-cms: GET /api/webflow/collections/:siteId: programming error');
    res.json([]);
  }
});

router.get('/api/webflow/collections/:collectionId/schema', async (req, res) => {
  try {
    const schema = await getCollectionSchema(req.params.collectionId);
    res.json(schema);
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err }, 'webflow-cms: GET /api/webflow/collections/:collectionId/schema: programming error');
    res.json({ fields: [] });
  }
});

router.get('/api/webflow/collections/:collectionId/items', async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const offset = parseInt(req.query.offset as string) || 0;
  try {
    const result = await listCollectionItems(req.params.collectionId, limit, offset);
    res.json(result);
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err }, 'webflow-cms: GET /api/webflow/collections/:collectionId/items: programming error');
    res.json({ items: [], total: 0 });
  }
});

router.patch('/api/webflow/collections/:collectionId/items/:itemId', async (req, res) => {
  // Resolve per-site token: workspaceId → workspace → siteId → token.
  // Without this, webflowFetch falls back to the global WEBFLOW_API_TOKEN env var,
  // which may belong to a different Webflow account → 404 on the collection/item.
  const ws = req.body.workspaceId ? getWorkspace(req.body.workspaceId) : undefined;
  const token = ws?.webflowSiteId ? getTokenForSite(ws.webflowSiteId) || undefined : undefined;
  const result = await updateCollectionItem(req.params.collectionId, req.params.itemId, req.body.fieldData, token);
  if (req.body.workspaceId) {
    updatePageState(req.body.workspaceId, req.params.itemId, { status: 'live', source: 'cms', updatedBy: 'admin' });
  }
  res.json(result);
});

// --- CMS SEO Editor: list all collections with SEO-relevant fields and items ---
router.get('/api/webflow/cms-seo/:siteId', requireWorkspaceAccessFromQuery(), async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const collections = await listCollections(req.params.siteId, token);
    const SEO_FIELD_PATTERNS = ['seo title', 'meta title', 'title tag', 'seo description', 'meta description', 'og title', 'og description', 'open graph'];

    let sitemapPaths: Set<string> | null = null;
    try {
      // Try live domain first (CMS pages often only in live sitemap), then webflow.io
      const ws = listWorkspaces().find(w => w.webflowSiteId === req.params.siteId);
      const sitemapBases: string[] = [];
      if (ws?.liveDomain) {
        const domain = ws.liveDomain.startsWith('http') ? ws.liveDomain : `https://${ws.liveDomain}`;
        sitemapBases.push(domain.replace(/\/+$/, ''));
      }
      const subdomain = await getSiteSubdomain(req.params.siteId, token);
      if (subdomain) sitemapBases.push(`https://${subdomain}.webflow.io`);

      for (const base of sitemapBases) {
        try {
          const sitemapUrls = await discoverSitemapUrls(base);
          if (sitemapUrls.length > 0) {
            sitemapPaths = new Set(sitemapUrls.map(u => {
              try { return new URL(u).pathname.replace(/\/$/, '').toLowerCase(); } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'webflow-cms: programming error'); return ''; }
            }).filter(Boolean));
            break; // use first successful sitemap
          }
        } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'webflow-cms: programming error'); /* try next base URL */ }
      }
    } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'webflow-cms: GET /api/webflow/cms-seo/:siteId: programming error'); /* sitemap fetch is best-effort */ }

    const results: Array<{
      collectionId: string;
      collectionName: string;
      collectionSlug: string;
      seoFields: Array<{ id: string; slug: string; displayName: string; type: string }>;
      items: Array<{ id: string; fieldData: Record<string, unknown> }>;
      total: number;
    }> = [];

    for (const coll of collections) {
      const schema = await getCollectionSchema(coll.id, token);
      const seoFields = schema.fields.filter(f => {
        const name = f.displayName.toLowerCase();
        const slug = f.slug.toLowerCase();
        if (f.slug === 'name' || f.slug === 'slug') return true;
        if (f.type === 'PlainText' || f.type === 'RichText') {
          return SEO_FIELD_PATTERNS.some(p => name.includes(p) || slug.includes(p.replace(/\s/g, '-')));
        }
        return false;
      });

      // Paginate through ALL items (Webflow API caps at 100 per request)
      const PAGE_SIZE = 100;
      let allItems: Array<Record<string, unknown>> = [];
      let fetchOffset = 0;
      let totalItems = 0;
      do {
        const { items: batch, total: batchTotal } = await listCollectionItems(coll.id, PAGE_SIZE, fetchOffset, token);
        totalItems = batchTotal;
        allItems = allItems.concat(batch);
        fetchOffset += PAGE_SIZE;
      } while (fetchOffset < totalItems);
      if (totalItems === 0) continue;

      const liveItems = allItems.filter(item => {
        const draft = item.isDraft as boolean | undefined;
        const archived = item.isArchived as boolean | undefined;
        return !draft && !archived;
      });
      if (liveItems.length === 0) continue;

      const collSlug = coll.slug;
      const sitemapFiltered = sitemapPaths
        ? liveItems.filter(item => {
            const fd = (item.fieldData || item) as Record<string, unknown>;
            const itemSlug = String(fd['slug'] || '').toLowerCase();
            if (!itemSlug) return false;
            const fullPath = `/${collSlug}/${itemSlug}`;
            return sitemapPaths!.has(fullPath) || sitemapPaths!.has(`/${itemSlug}`);
          })
        : liveItems;

      if (sitemapFiltered.length === 0) continue;

      const cleanItems = sitemapFiltered.map(item => {
        const fd = (item.fieldData || item) as Record<string, unknown>;
        const relevant: Record<string, unknown> = {};
        relevant['name'] = fd['name'] || '';
        relevant['slug'] = fd['slug'] || '';
        for (const sf of seoFields) {
          if (sf.slug !== 'name' && sf.slug !== 'slug') {
            relevant[sf.slug] = fd[sf.slug] || '';
          }
        }
        return { id: item.id as string || (item as Record<string, unknown>)._id as string, fieldData: relevant };
      });

      results.push({
        collectionId: coll.id,
        collectionName: coll.displayName,
        collectionSlug: coll.slug,
        seoFields,
        items: cleanItems,
        total: sitemapFiltered.length,
      });
    }

    res.json(results);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ detail: msg }, 'CMS SEO list error');
    res.status(500).json({ error: msg });
  }
});

// --- CMS SEO: Publish collection items after editing ---
router.post('/api/webflow/collections/:collectionId/publish', async (req, res) => {
  try {
    const { itemIds, workspaceId } = req.body;
    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({ error: 'itemIds array required' });
    }
    const ws = workspaceId ? getWorkspace(workspaceId) : undefined;
    const token = ws?.webflowSiteId ? getTokenForSite(ws.webflowSiteId) || undefined : undefined;
    const result = await publishCollectionItems(req.params.collectionId, itemIds, token);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;
