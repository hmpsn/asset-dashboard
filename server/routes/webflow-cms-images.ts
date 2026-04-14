/**
 * CMS image scan route — discovers image fields across CMS collections
 * and builds a per-asset usage map for CMS-aware compression and alt text.
 */
import { Router } from 'express';
import { listCollections, getCollectionSchema, listCollectionItems } from '../webflow-cms.js';
import { getTokenForSite } from '../workspaces.js';
import { createLogger } from '../logger.js';
import type { CmsImageScanResult, CmsImageAsset, CmsCollectionImageInfo } from '../../shared/types/cms-images.ts';
import type * as WebflowClient from '../webflow-client.js';
import { isProgrammingError } from '../errors.js';

const router = Router();
const log = createLogger('webflow-cms-images');

function displayNameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    return pathname.split('/').pop()?.split('?')[0] || url;
  } catch (err) {
    return url.split('/').pop()?.split('?')[0] || url;
  }
}

const OVERSIZED_THRESHOLD = 500 * 1024; // 500 KB

// Fetch Webflow asset metadata (alt text, size, content type, hosted URL) using the site token
async function fetchAssetMap(
  siteId: string,
  token?: string,
): Promise<{
  byId: Map<string, { altText?: string; size?: number; contentType?: string; hostedUrl?: string }>;
  byUrl: Map<string, string>; // hostedUrl → assetId
}> {
  try {
    const { webflowFetch }: typeof WebflowClient = await import('../webflow-client.js'); // dynamic-import-ok
    const byId = new Map<string, { altText?: string; size?: number; contentType?: string; hostedUrl?: string }>();
    const byUrl = new Map<string, string>();
    let offset = 0;
    const limit = 100;
    while (true) {
      const res = await webflowFetch(`/sites/${siteId}/assets?limit=${limit}&offset=${offset}`, {}, token);
      if (!res.ok) break;
      const data = await res.json() as {
        assets?: Array<{ id: string; altText?: string; size?: number; contentType?: string; hostedUrl?: string; url?: string }>;
      };
      const batch = data.assets || [];
      for (const a of batch) {
        const hostedUrl = a.hostedUrl || a.url;
        byId.set(a.id, { altText: a.altText, size: a.size, contentType: a.contentType, hostedUrl });
        if (hostedUrl) byUrl.set(hostedUrl, a.id);
      }
      if (batch.length < limit) break;
      offset += limit;
    }
    return { byId, byUrl };
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err }, 'webflow-cms-images/fetchAssetMap: programming error');
    return { byId: new Map(), byUrl: new Map() };
  }
}

/**
 * GET /api/webflow/cms-images/:siteId
 *
 * Scans all CMS collections for Image/MultiImage/RichText fields and returns:
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
    const { byId: assetMetaMap, byUrl: assetUrlMap } = await fetchAssetMap(siteId, token);

    // Step 3: scan each collection for image fields
    const collectionInfos: CmsCollectionImageInfo[] = [];
    const assetUsageMap = new Map<string, CmsImageAsset>();

    for (const coll of collections) {
      const schema = await getCollectionSchema(coll.id, token);
      const imageFields = schema.fields.filter(
        f => f.type === 'Image' || f.type === 'MultiImage' || f.type === 'RichText',
      );
      if (imageFields.length === 0) continue;

      collectionInfos.push({
        collectionId: coll.id,
        collectionName: coll.displayName,
        imageFields: imageFields.map(f => ({
          slug: f.slug,
          displayName: f.displayName,
          type: f.type as 'Image' | 'MultiImage' | 'RichText',
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

          type AssetMeta = { hostedUrl: string; altText: string; size: number; contentType: string; displayName: string; isRichTextOnly?: boolean };

          const addUsage = (assetId: string, meta: AssetMeta) => {
            if (!assetUsageMap.has(assetId)) {
              assetUsageMap.set(assetId, { assetId, ...meta, usages: [] });
            }
            assetUsageMap.get(assetId)!.usages.push({
              collectionId: coll.id,
              collectionName: coll.displayName,
              itemId,
              itemName,
              fieldSlug: field.slug,
              fieldDisplayName: field.displayName,
              fieldType: field.type as 'Image' | 'MultiImage' | 'RichText',
            });
          };

          if (field.type === 'Image') {
            // Image field: { fileId, url } or string URL
            let assetId: string | undefined;
            if (typeof val === 'object' && val !== null) {
              const obj = val as Record<string, unknown>;
              if (typeof obj.fileId === 'string') assetId = obj.fileId;
            } else if (typeof val === 'string' && val.includes('/')) {
              const match = val.match(/\/([a-f0-9]{24})\//i);
              if (match) assetId = match[1];
            }
            if (assetId) {
              const m = assetMetaMap.get(assetId);
              addUsage(assetId, {
                hostedUrl: m?.hostedUrl ?? '',
                altText: m?.altText ?? '',
                size: m?.size ?? 0,
                contentType: m?.contentType ?? 'image/unknown',
                displayName: displayNameFromUrl(m?.hostedUrl ?? ''),
                isRichTextOnly: false,
              });
            }
          } else if (field.type === 'MultiImage') {
            // MultiImage field: array of { fileId, url }
            if (Array.isArray(val)) {
              for (const img of val) {
                const imgObj = img as Record<string, unknown>;
                if (typeof imgObj.fileId === 'string') {
                  const assetId = imgObj.fileId;
                  const m = assetMetaMap.get(assetId);
                  addUsage(assetId, {
                    hostedUrl: m?.hostedUrl ?? '',
                    altText: m?.altText ?? '',
                    size: m?.size ?? 0,
                    contentType: m?.contentType ?? 'image/unknown',
                    displayName: displayNameFromUrl(m?.hostedUrl ?? ''),
                    isRichTextOnly: false,
                  });
                }
              }
            }
          } else if (field.type === 'RichText') {
            // RichText field: HTML string — extract all <img src="..."> URLs
            // Deduplicate: same asset may appear multiple times in one field
            if (typeof val === 'string') {
              const imgTagRegex = /<img([^>]+)>/gi;
              const seenAssetIds = new Set<string>();
              let tagMatch: RegExpExecArray | null;
              while ((tagMatch = imgTagRegex.exec(val)) !== null) {
                const attrs = tagMatch[1];
                const srcMatch = /src=["']([^"']+)["']/i.exec(attrs);
                const altMatch = /alt=["']([^"']*)["']/i.exec(attrs);
                if (!srcMatch) continue;
                const src = srcMatch[1];
                const imgAlt = altMatch ? altMatch[1] : '';
                // Look up by exact URL first, then try extracting ID from CDN path
                let resolvedId = assetUrlMap.get(src);
                if (!resolvedId) {
                  const idMatch = src.match(/\/([a-f0-9]{24})\//i);
                  if (idMatch) resolvedId = idMatch[1];
                }
                if (!resolvedId || seenAssetIds.has(resolvedId)) continue;
                seenAssetIds.add(resolvedId);
                const m = assetMetaMap.get(resolvedId);
                const isRichTextOnly = !m;
                addUsage(resolvedId, {
                  hostedUrl: m?.hostedUrl ?? src,
                  altText: m?.altText ?? imgAlt,
                  size: m?.size ?? 0,
                  contentType: m?.contentType ?? 'image/unknown',
                  displayName: displayNameFromUrl(src),
                  isRichTextOnly,
                });
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
      if (!asset.altText || asset.altText.trim() === '') missingAlt++;
      if (asset.size > OVERSIZED_THRESHOLD) oversized++;
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
