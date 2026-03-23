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
  updatePageState,
} from '../workspaces.js';
import { createLogger } from '../logger.js';

const log = createLogger('webflow-cms');

import { requireWorkspaceAccessFromQuery } from '../auth.js';
const router = Router();

// --- CMS Collections ---
router.get('/api/webflow/collections/:siteId', requireWorkspaceAccessFromQuery(), async (req, res) => {
  try {
    const collections = await listCollections(req.params.siteId);
    res.json(collections);
  } catch {
    res.json([]);
  }
});

router.get('/api/webflow/collections/:collectionId/schema', async (req, res) => {
  try {
    const schema = await getCollectionSchema(req.params.collectionId);
    res.json(schema);
  } catch {
    res.json({ fields: [] });
  }
});

router.get('/api/webflow/collections/:collectionId/items', async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const offset = parseInt(req.query.offset as string) || 0;
  try {
    const result = await listCollectionItems(req.params.collectionId, limit, offset);
    res.json(result);
  } catch {
    res.json({ items: [], total: 0 });
  }
});

router.patch('/api/webflow/collections/:collectionId/items/:itemId', async (req, res) => {
  const result = await updateCollectionItem(req.params.collectionId, req.params.itemId, req.body.fieldData);
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
      const subdomain = await getSiteSubdomain(req.params.siteId, token);
      if (subdomain) {
        const baseUrl = `https://${subdomain}.webflow.io`;
        const sitemapUrls = await discoverSitemapUrls(baseUrl);
        if (sitemapUrls.length > 0) {
          sitemapPaths = new Set(sitemapUrls.map(u => {
            try { return new URL(u).pathname.replace(/\/$/, '').toLowerCase(); } catch { return ''; }
          }).filter(Boolean));
        }
      }
    } catch { /* sitemap fetch is best-effort */ }

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

      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;
      const { items, total } = await listCollectionItems(coll.id, limit, offset, token);
      if (total === 0) continue;

      const liveItems = items.filter(item => {
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
    const { itemIds } = req.body;
    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({ error: 'itemIds array required' });
    }
    const result = await publishCollectionItems(req.params.collectionId, itemIds);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;
