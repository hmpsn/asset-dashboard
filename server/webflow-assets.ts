/**
 * Asset-related Webflow API functions.
 * Extracted from webflow.ts — asset CRUD, folders, upload, and usage scanning.
 */
import fs from 'fs';
import path from 'path';
import { createLogger } from './logger.js';
import { resolvePagePath } from './helpers.js';
import { webflowFetch, getToken } from './webflow-client.js';
import { getWorkspacePages, getWorkspaceAllPages } from './workspace-data.js';
import { listWorkspaces } from './workspaces.js';
import type * as WebflowPages from './webflow-pages.js';
import type * as WebflowCms from './webflow-cms.js';
import type { createHash as CreateHashFn } from 'crypto';

const log = createLogger('webflow-assets');

// --- Asset types ---
export interface WebflowAsset {
  id: string;
  displayName?: string;
  originalFileName?: string;
  size: number;
  contentType: string;
  url?: string;
  hostedUrl?: string;
  altText?: string;
  parentFolder?: string | null;
  createdOn?: string;
  lastUpdated?: string;
}

// --- List all assets (paginated) ---
export async function listAssets(siteId: string, tokenOverride?: string): Promise<WebflowAsset[]> {
  const token = tokenOverride || getToken();
  if (!token) return [];

  const allAssets: WebflowAsset[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const res = await webflowFetch(`/sites/${siteId}/assets?limit=${limit}&offset=${offset}`, {}, token);
    if (!res.ok) break;
    const data = await res.json() as { assets?: WebflowAsset[] };
    const assets = data.assets || [];
    allAssets.push(...assets);
    if (assets.length < limit) break;
    offset += limit;
  }
  return allAssets;
}

// --- Get single asset ---
export async function getAsset(
  assetId: string,
  tokenOverride?: string
): Promise<WebflowAsset | null> {
  try {
    const res = await webflowFetch(`/assets/${assetId}`, {}, tokenOverride);
    if (!res.ok) return null;
    return await res.json() as WebflowAsset;
  } catch (err) {
    log.debug({ err }, 'webflow-assets/get-asset: external API error — degrading gracefully');
    return null;
  }
}

// --- Update asset (alt text, displayName) ---
export async function updateAsset(
  assetId: string,
  updates: { altText?: string; displayName?: string },
  tokenOverride?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const current = await getAsset(assetId, tokenOverride);
    const body: Record<string, string> = {};
    body.displayName = updates.displayName ?? current?.displayName ?? `asset-${assetId}`;
    if (updates.altText !== undefined) {
      body.altText = updates.altText;
    } else if (current?.altText) {
      body.altText = current.altText;
    }

    log.info({ detail: body }, `PATCH /assets/${assetId}:`);
    const res = await webflowFetch(`/assets/${assetId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }, tokenOverride);
    if (!res.ok) {
      const err = await res.text();
      log.error({ err: err }, `Asset PATCH failed (${res.status}):`);
      return { success: false, error: `${res.status}: ${err}` };
    }
    const result = await res.json();
    log.info({ detail: result }, `Asset PATCH success:`);
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.debug({ err }, 'webflow-assets/update-asset: external API error — degrading gracefully');
    return { success: false, error: msg };
  }
}

// --- Asset Folders ---
export interface AssetFolder {
  id: string;
  displayName: string;
  parentFolderId?: string | null;
  createdOn?: string;
  lastUpdated?: string;
}

export async function listAssetFolders(
  siteId: string,
  tokenOverride?: string,
): Promise<AssetFolder[]> {
  const res = await webflowFetch(`/sites/${siteId}/asset_folders`, {}, tokenOverride);
  if (!res.ok) return [];
  const data = await res.json() as { assetFolders?: AssetFolder[] };
  return data.assetFolders || [];
}

export async function createAssetFolder(
  siteId: string,
  displayName: string,
  parentFolderId?: string,
  tokenOverride?: string,
): Promise<{ success: boolean; folderId?: string; error?: string }> {
  try {
    const body: Record<string, string> = { displayName };
    if (parentFolderId) body.parentFolderId = parentFolderId;
    const res = await webflowFetch(`/sites/${siteId}/asset_folders`, {
      method: 'POST',
      body: JSON.stringify(body),
    }, tokenOverride);
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `${res.status}: ${err}` };
    }
    const data = await res.json() as { id?: string };
    return { success: true, folderId: data.id };
  } catch (err: unknown) {
    log.debug({ err }, 'webflow-assets/create-folder: external API error — degrading gracefully');
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function moveAssetToFolder(
  assetId: string,
  parentFolderId: string,
  tokenOverride?: string,
): Promise<{ success: boolean; error?: string }> {
  const current = await getAsset(assetId, tokenOverride);
  const body: Record<string, string> = {
    displayName: current?.displayName ?? `asset-${assetId}`,
    parentFolder: parentFolderId,
  };
  if (current?.altText) body.altText = current.altText;

  const res = await webflowFetch(`/assets/${assetId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }, tokenOverride);
  if (!res.ok) {
    const err = await res.text();
    return { success: false, error: `${res.status}: ${err}` };
  }
  return { success: true };
}

// --- Delete asset ---
export async function deleteAsset(assetId: string, tokenOverride?: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await webflowFetch(`/assets/${assetId}`, { method: 'DELETE' }, tokenOverride);
    if (!res.ok && res.status !== 204) {
      const err = await res.text();
      return { success: false, error: `${res.status}: ${err}` };
    }
    return { success: true };
  } catch (err: unknown) {
    log.debug({ err }, 'webflow-assets/delete-asset: external API error — degrading gracefully');
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// --- Scan site for asset usage across published HTML and CMS ---
export async function scanAssetUsage(siteId: string, tokenOverride?: string): Promise<Map<string, string[]>> {
  // Import page/CMS functions to avoid circular deps — they live in sibling modules
  const { getSiteSubdomain }: typeof WebflowPages = await import('./webflow-pages.js'); // dynamic-import-ok
  const { listCollections, listCollectionItems, getCollectionSchema }: typeof WebflowCms = await import('./webflow-cms.js'); // dynamic-import-ok

  const usageMap = new Map<string, string[]>();

  const addUsage = (key: string, ref: string) => {
    if (!key) return;
    const refs = usageMap.get(key) || [];
    if (!refs.includes(ref)) refs.push(ref);
    usageMap.set(key, refs);
  };

  const assets = await listAssets(siteId, tokenOverride);
  const assetIds = new Set(assets.map(a => a.id));

  // Strategy 1: Scan published HTML pages
  const subdomain = await getSiteSubdomain(siteId, tokenOverride);
  if (subdomain) {
    const baseUrl = `https://${subdomain}.webflow.io`;
    const wsId = listWorkspaces().find(w => w.webflowSiteId === siteId)?.id;
    // allPages includes CMS template pages (needed for the collection instance loop below)
    const allPages = wsId ? await getWorkspaceAllPages(wsId, siteId) : [];
    // Published pages for HTML scanning (excludes CMS templates — no fetchable URL)
    const pages = wsId ? await getWorkspacePages(wsId, siteId) : [];
    const pageUrls: { url: string; title: string }[] = [
      { url: baseUrl, title: 'Home' },
    ];
    for (const page of pages) {
      const pagePath = resolvePagePath(page);
      if (pagePath && pagePath !== '/' && page.slug !== 'index') {
        pageUrls.push({ url: `${baseUrl}${pagePath}`, title: page.title });
      }
    }

    // Add CMS template page instances
    const collections = await listCollections(siteId, tokenOverride);
    const collSlugMap = new Map(collections.map(c => [c.id, c.slug]));
    for (const page of allPages) {
      const collId = (page as Record<string, unknown>).collectionId as string;
      if (!collId) continue;
      const collSlug = collSlugMap.get(collId);
      if (!collSlug) continue;
      try {
        let offset = 0;
        while (true) {
          const { items, total } = await listCollectionItems(collId, 100, offset, tokenOverride);
          for (const item of items) {
            const fd = (item.fieldData || item) as Record<string, unknown>;
            const slug = fd.slug as string;
            if (slug) {
              pageUrls.push({
                url: `${baseUrl}/${collSlug}/${slug}`,
                title: `${page.title}: ${fd.name || slug}`,
              });
            }
          }
          offset += items.length;
          if (offset >= total || items.length === 0) break;
        }
      } catch (err) { log.debug({ err }, 'webflow-assets/scan-cms-instances: external API error — degrading gracefully'); }
    }

    log.info(`Scanning ${pageUrls.length} page URLs for asset references (${assetIds.size} assets)`);

    // Scan CSS files for background-image asset references
    try {
      const homeRes = await fetch(baseUrl, { redirect: 'follow' });
      if (homeRes.ok) {
        const homeHtml = await homeRes.text();
        const cssUrls = homeHtml.match(/https:\/\/cdn\.prod\.website-files\.com\/[^"]*\.css[^"]*/g) || [];
        for (const cssUrl of cssUrls) {
          try {
            const cssRes = await fetch(cssUrl);
            if (cssRes.ok) {
              const css = await cssRes.text();
              for (const id of assetIds) {
                if (css.includes(id)) {
                  addUsage(id, 'css:styles');
                }
              }
            }
          } catch (err) { log.debug({ err }, 'webflow-assets/scan-css: external fetch error — degrading gracefully'); }
        }
      }
    } catch (err) { log.debug({ err }, 'webflow-assets/scan-css-home: external fetch error — degrading gracefully'); }

    // Fetch pages in parallel batches of 10
    const batchSize = 10;
    for (let i = 0; i < pageUrls.length; i += batchSize) {
      const batch = pageUrls.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async ({ url, title }) => {
          try {
            const res = await fetch(url, { redirect: 'follow' });
            if (!res.ok) return;
            const html = await res.text();
            const ref = `page:${title}`;
            for (const id of assetIds) {
              if (html.includes(id)) {
                addUsage(id, ref);
              }
            }
          } catch (err) { log.debug({ err }, 'webflow-assets/scan-page: external fetch error — degrading gracefully'); }
        })
      );
      void results;
    }
  }

  // Strategy 2: Scan CMS collections for image/rich-text fields
  const collections2 = await listCollections(siteId, tokenOverride);
  for (const coll of collections2) {
    try {
      const schema = await getCollectionSchema(coll.id, tokenOverride);
      const imageFields = schema.fields.filter(f =>
        f.type === 'Image' || f.type === 'MultiImage' || f.type === 'RichText'
      );
      if (imageFields.length === 0) continue;

      let offset = 0;
      while (true) {
        const { items, total } = await listCollectionItems(coll.id, 100, offset, tokenOverride);
        for (const item of items) {
          const fieldData = (item.fieldData || item) as Record<string, unknown>;
          const ref = `cms:${coll.displayName}`;
          for (const field of imageFields) {
            const val = fieldData[field.slug];
            if (!val) continue;

            if (typeof val === 'string') {
              for (const id of assetIds) {
                if (val.includes(id)) addUsage(id, ref);
              }
            } else if (typeof val === 'object') {
              const obj = val as Record<string, unknown>;
              if (obj.fileId && assetIds.has(obj.fileId as string)) {
                addUsage(obj.fileId as string, ref);
              }
              if (obj.url && typeof obj.url === 'string') {
                for (const id of assetIds) {
                  if ((obj.url as string).includes(id)) addUsage(id, ref);
                }
              }
              if (Array.isArray(val)) {
                for (const img of val) {
                  if (typeof img === 'object' && img) {
                    const imgObj = img as Record<string, unknown>;
                    if (imgObj.fileId && assetIds.has(imgObj.fileId as string)) {
                      addUsage(imgObj.fileId as string, ref);
                    }
                    if (imgObj.url && typeof imgObj.url === 'string') {
                      for (const id of assetIds) {
                        if ((imgObj.url as string).includes(id)) addUsage(id, ref);
                      }
                    }
                  }
                }
              }
            }
          }
        }
        offset += items.length;
        if (offset >= total || items.length === 0) break;
      }
    } catch (err) { log.debug({ err }, 'webflow-assets/scan-cms-fields: external API error — degrading gracefully'); }
  }

  return usageMap;
}

export async function uploadAsset(
  siteId: string,
  filePath: string,
  fileName: string,
  altText?: string,
  tokenOverride?: string
): Promise<{ success: boolean; assetId?: string; hostedUrl?: string; error?: string }> {
  const token = tokenOverride || getToken();
  if (!token) return { success: false, error: 'WEBFLOW_API_TOKEN not configured' };

  const fileBuffer = fs.readFileSync(filePath);
  const fileSize = fileBuffer.length;
  const ext = path.extname(fileName).slice(1).toLowerCase();

  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
    avif: 'image/avif',
  };
  const mimeType = mimeMap[ext] || 'application/octet-stream';

  const { createHash }: { createHash: typeof CreateHashFn } = await import('crypto'); // dynamic-import-ok
  const fileHash = createHash('md5').update(fileBuffer).digest('hex');

  try {
    const createBody: Record<string, unknown> = {
      fileName,
      fileSize,
      fileHash,
      mimeType,
    };
    const createRes = await webflowFetch(`/sites/${siteId}/assets`, {
      method: 'POST',
      body: JSON.stringify(createBody),
    }, token);

    if (!createRes.ok) {
      const errText = await createRes.text();
      return { success: false, error: `Failed to create asset (${createRes.status}): ${errText}` };
    }

    const createData = await createRes.json() as {
      uploadDetails?: Record<string, string>;
      uploadUrl?: string;
      asset?: { id: string };
      id?: string;
    };
    const uploadUrl = createData.uploadUrl;
    const uploadDetails = createData.uploadDetails;
    const assetId = createData.asset?.id || createData.id;

    if (!uploadUrl || !uploadDetails) {
      log.error({ detail: JSON.stringify(createData, null, 2) }, 'Webflow create response missing uploadUrl/uploadDetails');
      return { success: false, error: 'No uploadUrl or uploadDetails in response' };
    }

    const formData = new FormData();
    for (const [key, value] of Object.entries(uploadDetails)) {
      formData.append(key, value);
    }
    formData.append('file', new Blob([fileBuffer], { type: mimeType }), fileName);

    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      body: formData,
    });

    if (!uploadRes.ok && uploadRes.status !== 201) {
      const errBody = await uploadRes.text();
      return { success: false, error: `Upload to S3 failed (${uploadRes.status}): ${errBody.slice(0, 300)}` };
    }

    if (altText && assetId) {
      try {
        const patchBody: Record<string, string> = { displayName: fileName, altText };
        const patchRes = await webflowFetch(`/assets/${assetId}`, {
          method: 'PATCH',
          body: JSON.stringify(patchBody),
        }, token);
        if (patchRes.ok) {
          log.info(`Set alt text for ${fileName}: "${altText}"`);
        } else {
          const errText = await patchRes.text();
          log.error({ detail: errText }, `Failed to set alt text for ${fileName} (${patchRes.status}):`);
        }
      } catch (e) {
        log.debug({ err: e }, `webflow-assets/upload-alt-patch: external API error — degrading gracefully`);
      }
    }

    const hostedUrl = (createData as Record<string, unknown>).hostedUrl as string | undefined;
    log.info(`Uploaded ${fileName} to Webflow (asset: ${assetId})`);
    return { success: true, assetId, hostedUrl };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.debug({ err }, 'webflow-assets/upload-asset: external API error — degrading gracefully');
    return { success: false, error: msg };
  }
}
