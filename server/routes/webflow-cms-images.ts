/**
 * CMS image scan route — discovers image fields across CMS collections
 * and builds a per-asset usage map for CMS-aware compression and alt text.
 */
import { Router } from 'express';
import { listCollections, getCollectionSchema, listCollectionItems } from '../webflow-cms.js';
import { getTokenForSite } from '../workspaces.js';
import { createLogger } from '../logger.js';
import type { CmsImageScanResult, CmsImageAsset, CmsCollectionImageInfo } from '../../shared/types/cms-images.ts';

const router = Router();
const log = createLogger('webflow-cms-images');

const OVERSIZED_THRESHOLD = 500 * 1024; // 500 KB

// Fetch Webflow asset metadata (alt text, size, content type) using the site token
async function fetchAssetMap(siteId: string, token?: string): Promise<Map<string, { altText?: string; size?: number; contentType?: string }>> {
  try {
    const { webflowFetch } = await import('../webflow-client.js');
    const map = new Map<string, { altText?: string; size?: number; contentType?: string }>();
    let offset = 0;
    const limit = 100;
    while (true) {
      const res = await webflowFetch(`/sites/${siteId}/assets?limit=${limit}&offset=${offset}`, {}, token);
      if (!res.ok) break;
      const data = await res.json() as { assets?: Array<{ id: string; altText?: string; size?: number; contentType?: string }> };
      const batch = data.assets || [];
      for (const a of batch) map.set(a.id, { altText: a.altText, size: a.size, contentType: a.contentType });
      if (batch.length < limit) break;
      offset += limit;
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * GET /api/webflow/cms-images/:siteId
 *
 * Scans all CMS collections for Image/MultiImage fields and returns:
 * - collections: list of collections with their image fields (for the field selector UI)
 * - assets: per-asset CMS usage locations
 * - stats: totals for CMS images, missing alt text, and oversized images
 */
router.get('/api/webflow/cms-images/:siteId', async (req, res) => {
  try {
    const { siteId } = req.params;
    const token = getTokenForSite(siteId) || undefined;

    // Step 1: list all collections
    const collections = await listCollections(siteId, token);

    // Step 2: build asset metadata map for enrichment
    const assetMetaMap = await fetchAssetMap(siteId, token);

    // Step 3: scan each collection for image fields
    const collectionInfos: CmsCollectionImageInfo[] = [];
    const assetUsageMap = new Map<string, CmsImageAsset>();

    for (const coll of collections) {
      const schema = await getCollectionSchema(coll.id, token);
      const imageFields = schema.fields.filter(f => f.type === 'Image' || f.type === 'MultiImage');
      if (imageFields.length === 0) continue;

      collectionInfos.push({
        collectionId: coll.id,
        collectionName: coll.displayName,
        imageFields: imageFields.map(f => ({
          slug: f.slug,
          displayName: f.displayName,
          type: f.type as 'Image' | 'MultiImage',
        })),
      });

      // Step 4: paginate through all items
      const PAGE_SIZE = 100;
      let allItems: Array<Record<string, unknown>> = [];
      let fetchOffset = 0;
      let totalItems = 0;
      do {
        const { items: batch, total } = await listCollectionItems(coll.id, PAGE_SIZE, fetchOffset, token);
        totalItems = total;
        allItems = allItems.concat(batch);
        fetchOffset += PAGE_SIZE;
      } while (fetchOffset < totalItems);

      if (allItems.length === 0) continue;

      // Step 5: extract image references from each item
      for (const item of allItems) {
        const itemId = (item.id || (item as Record<string, unknown>)._id) as string;
        const fd = (item.fieldData || item) as Record<string, unknown>;
        const itemName = String(fd['name'] || fd['slug'] || itemId);

        for (const field of imageFields) {
          const val = fd[field.slug];
          if (!val) continue;

          const addUsage = (assetId: string) => {
            if (!assetUsageMap.has(assetId)) {
              assetUsageMap.set(assetId, { assetId, usages: [] });
            }
            assetUsageMap.get(assetId)!.usages.push({
              collectionId: coll.id,
              collectionName: coll.displayName,
              itemId,
              itemName,
              fieldSlug: field.slug,
              fieldDisplayName: field.displayName,
              fieldType: field.type as 'Image' | 'MultiImage',
            });
          };

          if (field.type === 'Image') {
            // Image field: { fileId, url } or string URL
            if (typeof val === 'object' && val !== null) {
              const obj = val as Record<string, unknown>;
              if (typeof obj.fileId === 'string') addUsage(obj.fileId);
            } else if (typeof val === 'string' && val.includes('/')) {
              // Bare URL — extract asset ID from Webflow CDN path if possible
              const match = val.match(/\/([a-f0-9]{24})\//i);
              if (match) addUsage(match[1]);
            }
          } else if (field.type === 'MultiImage') {
            // MultiImage field: array of { fileId, url }
            if (Array.isArray(val)) {
              for (const img of val) {
                const imgObj = img as Record<string, unknown>;
                if (typeof imgObj.fileId === 'string') addUsage(imgObj.fileId);
              }
            }
          }
        }
      }
    }

    // Step 6: build stats
    const assets = [...assetUsageMap.values()];
    let missingAlt = 0;
    let oversized = 0;
    for (const asset of assets) {
      const meta = assetMetaMap.get(asset.assetId);
      if (meta) {
        if (!meta.altText || meta.altText.trim() === '') missingAlt++;
        if ((meta.size ?? 0) > OVERSIZED_THRESHOLD) oversized++;
      }
    }

    const result: CmsImageScanResult = {
      collections: collectionInfos,
      assets,
      stats: {
        totalCmsImages: assets.length,
        missingAlt,
        oversized,
      },
    };

    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ detail: msg }, 'CMS images scan error');
    res.status(500).json({ error: msg });
  }
});

export default router;
