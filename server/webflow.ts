import fs from 'fs';
import path from 'path';

const WEBFLOW_API = 'https://api.webflow.com/v2';

function getToken(): string | null {
  return process.env.WEBFLOW_API_TOKEN || null;
}

async function webflowFetch(endpoint: string, options: RequestInit = {}, tokenOverride?: string): Promise<Response> {
  const token = tokenOverride || getToken();
  if (!token) throw new Error('WEBFLOW_API_TOKEN not configured');

  return fetch(`${WEBFLOW_API}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

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
  } catch {
    return null;
  }
}

// --- Update asset (alt text, displayName) ---
// Webflow v2 PATCH /assets/{id} requires displayName. This function
// fetches the current asset first to merge fields so partial updates work.
export async function updateAsset(
  assetId: string,
  updates: { altText?: string; displayName?: string },
  tokenOverride?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Fetch current asset to get existing displayName/altText so we can merge
    const current = await getAsset(assetId, tokenOverride);
    const body: Record<string, string> = {};
    // Always include displayName (required by Webflow API)
    body.displayName = updates.displayName ?? current?.displayName ?? `asset-${assetId}`;
    // Always include altText to avoid wiping it
    if (updates.altText !== undefined) {
      body.altText = updates.altText;
    } else if (current?.altText) {
      body.altText = current.altText;
    }

    console.log(`PATCH /assets/${assetId}:`, JSON.stringify(body));
    const res = await webflowFetch(`/assets/${assetId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }, tokenOverride);
    if (!res.ok) {
      const err = await res.text();
      console.error(`Asset PATCH failed (${res.status}):`, err);
      return { success: false, error: `${res.status}: ${err}` };
    }
    const result = await res.json();
    console.log(`Asset PATCH success:`, JSON.stringify(result));
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Asset update error:', msg);
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
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function moveAssetToFolder(
  assetId: string,
  parentFolderId: string,
  tokenOverride?: string,
): Promise<{ success: boolean; error?: string }> {
  // The PATCH /assets/{id} endpoint accepts parentFolder to move an asset
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
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// --- List pages ---
export interface WebflowPage {
  id: string;
  title: string;
  slug: string;
  draft?: boolean;
  archived?: boolean;
  collectionId?: string | null;
  publishedPath?: string | null;
  seo?: { title?: string | null; description?: string | null };
  openGraph?: { title?: string | null; description?: string | null; titleCopied?: boolean; descriptionCopied?: boolean };
  [key: string]: unknown;
}

export async function listPages(siteId: string, tokenOverride?: string): Promise<WebflowPage[]> {
  const res = await webflowFetch(`/sites/${siteId}/pages?limit=100`, {}, tokenOverride);
  if (!res.ok) return [];
  const data = await res.json() as { pages?: WebflowPage[] };
  return data.pages || [];
}

// Filter to only published, non-collection, non-draft pages
export function filterPublishedPages(pages: WebflowPage[]): WebflowPage[] {
  return pages.filter(p =>
    p.draft !== true &&
    !p.collectionId &&
    !p.archived &&
    p.publishedPath
  );
}

// --- Get page DOM nodes (paginated) ---
interface DomNode {
  id: string;
  type: string;
  image?: { assetId?: string; alt?: string };
  attributes?: Record<string, unknown>;
  componentId?: string;
  propertyOverrides?: Array<{ propertyId: string; value?: unknown }>;
  [key: string]: unknown;
}

export async function getPageDomNodes(pageId: string, tokenOverride?: string): Promise<DomNode[]> {
  const allNodes: DomNode[] = [];
  let offset = 0;
  while (true) {
    const res = await webflowFetch(`/pages/${pageId}/dom?limit=100&offset=${offset}`, {}, tokenOverride);
    if (!res.ok) break;
    const data = await res.json() as { nodes?: DomNode[]; pagination?: { total?: number } };
    const nodes = data.nodes || [];
    allNodes.push(...nodes);
    const total = data.pagination?.total || 0;
    offset += nodes.length;
    if (offset >= total || nodes.length === 0) break;
  }
  return allNodes;
}

// Legacy wrapper for alt-text context (returns stringified DOM)
export async function getPageDom(pageId: string, tokenOverride?: string): Promise<string> {
  const res = await webflowFetch(`/pages/${pageId}/dom`, {}, tokenOverride);
  if (!res.ok) return '';
  return await res.text();
}

// --- List CMS collections ---
export async function listCollections(siteId: string, tokenOverride?: string): Promise<Array<{ id: string; displayName: string; slug: string }>> {
  const res = await webflowFetch(`/sites/${siteId}/collections`, {}, tokenOverride);
  if (!res.ok) return [];
  const data = await res.json() as { collections?: Array<{ id: string; displayName: string; slug: string }> };
  return data.collections || [];
}

// --- List CMS collection items ---
export async function listCollectionItems(collectionId: string, limit = 100, offset = 0, tokenOverride?: string): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
  const res = await webflowFetch(`/collections/${collectionId}/items?limit=${limit}&offset=${offset}`, {}, tokenOverride);
  if (!res.ok) return { items: [], total: 0 };
  const data = await res.json() as { items?: Array<Record<string, unknown>>; pagination?: { total?: number } };
  return { items: data.items || [], total: data.pagination?.total || 0 };
}

// --- Get collection schema ---
export async function getCollectionSchema(collectionId: string, tokenOverride?: string): Promise<{ fields: Array<{ id: string; displayName: string; type: string; slug: string }> }> {
  const res = await webflowFetch(`/collections/${collectionId}`, {}, tokenOverride);
  if (!res.ok) return { fields: [] };
  const data = await res.json() as { fields?: Array<{ id: string; displayName: string; type: string; slug: string }> };
  return { fields: data.fields || [] };
}

// --- Update CMS item ---
export async function updateCollectionItem(
  collectionId: string,
  itemId: string,
  fieldData: Record<string, unknown>,
  tokenOverride?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await webflowFetch(`/collections/${collectionId}/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ fieldData }),
    }, tokenOverride);
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `${res.status}: ${err}` };
    }
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// --- Publish CMS items (make draft changes live) ---
export async function publishCollectionItems(
  collectionId: string,
  itemIds: string[],
  tokenOverride?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await webflowFetch(`/collections/${collectionId}/items/publish`, {
      method: 'POST',
      body: JSON.stringify({ itemIds }),
    }, tokenOverride);
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `${res.status}: ${err}` };
    }
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// --- Get site subdomain for published HTML scanning ---
export async function getSiteSubdomain(siteId: string, tokenOverride?: string): Promise<string | null> {
  const res = await webflowFetch(`/sites/${siteId}`, {}, tokenOverride);
  if (!res.ok) return null;
  const data = await res.json() as { shortName?: string };
  return data.shortName || null;
}

// --- Scan site for asset usage across published HTML and CMS ---
export async function scanAssetUsage(siteId: string, tokenOverride?: string): Promise<Map<string, string[]>> {
  const usageMap = new Map<string, string[]>();

  const addUsage = (key: string, ref: string) => {
    if (!key) return;
    const refs = usageMap.get(key) || [];
    if (!refs.includes(ref)) refs.push(ref);
    usageMap.set(key, refs);
  };

  // Get all assets first so we know which IDs to look for
  const assets = await listAssets(siteId, tokenOverride);
  const assetIds = new Set(assets.map(a => a.id));

  // Strategy 1: Scan published HTML pages — catches everything including component images
  const subdomain = await getSiteSubdomain(siteId, tokenOverride);
  if (subdomain) {
    const baseUrl = `https://${subdomain}.webflow.io`;
    const allPages = await listPages(siteId, tokenOverride);
    const pages = filterPublishedPages(allPages);
    // Build page URL list: home + all published pages using publishedPath (handles nested pages)
    const pageUrls: { url: string; title: string }[] = [
      { url: baseUrl, title: 'Home' },
    ];
    for (const page of pages) {
      // Use publishedPath for full URL (handles nested pages like /about/team)
      const pagePath = page.publishedPath || (page.slug ? `/${page.slug}` : '');
      if (pagePath && pagePath !== '/' && page.slug !== 'index') {
        pageUrls.push({ url: `${baseUrl}${pagePath}`, title: page.title });
      }
    }

    // Add CMS template page instances (e.g. /blog/post-slug)
    // Use the collection slug (not the template page slug) for the URL prefix
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
      } catch { /* skip */ }
    }

    console.log(`[asset-usage] Scanning ${pageUrls.length} page URLs for asset references (${assetIds.size} assets)`);

    // Also scan the site's CSS files for background-image asset references
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
          } catch { /* skip */ }
        }
      }
    } catch { /* skip */ }

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
            // Scan for asset IDs in the HTML (they appear in CDN URLs)
            for (const id of assetIds) {
              if (html.includes(id)) {
                addUsage(id, ref);
              }
            }
          } catch { /* skip */ }
        })
      );
      void results; // suppress unused warning
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
              // Check if any asset ID appears in the string value
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
              // MultiImage: array of image objects
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
    } catch { /* skip failed collections */ }
  }

  return usageMap;
}

// --- Update page SEO fields ---
export async function updatePageSeo(
  pageId: string,
  fields: {
    title?: string;
    slug?: string;
    seo?: { title?: string; description?: string };
    openGraph?: { title?: string; description?: string; titleCopied?: boolean; descriptionCopied?: boolean };
  },
  tokenOverride?: string,
): Promise<{ success: boolean; error?: string }> {
  const body: Record<string, unknown> = {};
  if (fields.title !== undefined) body.title = fields.title;
  if (fields.slug !== undefined) body.slug = fields.slug;
  if (fields.seo) body.seo = fields.seo;
  if (fields.openGraph) body.openGraph = fields.openGraph;

  const res = await webflowFetch(`/pages/${pageId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  }, tokenOverride);
  if (!res.ok) {
    const text = await res.text();
    return { success: false, error: `${res.status}: ${text}` };
  }
  return { success: true };
}

// --- Get full page metadata ---
export async function getPageMeta(
  pageId: string,
  tokenOverride?: string,
): Promise<Record<string, unknown> | null> {
  const res = await webflowFetch(`/pages/${pageId}`, {}, tokenOverride);
  if (!res.ok) return null;
  return await res.json() as Record<string, unknown>;
}

// --- Publish site ---
export async function publishSite(
  siteId: string,
  tokenOverride?: string,
): Promise<{ success: boolean; error?: string }> {
  const res = await webflowFetch(`/sites/${siteId}/publish`, {
    method: 'POST',
    body: JSON.stringify({ publishToWebflowSubdomain: true }),
  }, tokenOverride);
  if (!res.ok) {
    const text = await res.text();
    return { success: false, error: `${res.status}: ${text}` };
  }
  return { success: true };
}

// --- Custom Code API: Register, Apply, and Manage inline scripts ---

// Identifier prefix so we can recognize our schema scripts vs. user code
const SCHEMA_SCRIPT_PREFIX = 'JSON-LD Schema';

interface RegisteredScript {
  id: string;
  displayName: string;
  version: string;
  hostedLocation?: string;
}

interface PageCustomCodeBlock {
  id: string;
  location: 'header' | 'footer';
  version: string;
}

// Register an inline script with the site
async function registerInlineScript(
  siteId: string,
  sourceCode: string,
  displayName: string,
  version: string,
  tokenOverride?: string,
): Promise<RegisteredScript | null> {
  const res = await webflowFetch(`/sites/${siteId}/registered_scripts/inline`, {
    method: 'POST',
    body: JSON.stringify({
      sourceCode,
      displayName,
      version,
      canCopy: false,
    }),
  }, tokenOverride);
  if (!res.ok) {
    const text = await res.text();
    console.error(`[schema-publish] Failed to register inline script: ${res.status} ${text}`);
    return null;
  }
  return await res.json() as RegisteredScript;
}

// List all registered scripts for a site
async function listRegisteredScripts(siteId: string, tokenOverride?: string): Promise<RegisteredScript[]> {
  const res = await webflowFetch(`/sites/${siteId}/registered_scripts`, {}, tokenOverride);
  if (!res.ok) return [];
  const data = await res.json() as { registeredScripts?: RegisteredScript[] };
  return data.registeredScripts || [];
}

// Get existing custom code blocks applied to a page
async function getPageCustomCode(pageId: string, tokenOverride?: string): Promise<PageCustomCodeBlock[]> {
  const res = await webflowFetch(`/pages/${pageId}/custom_code`, {}, tokenOverride);
  if (!res.ok) return []; // 404 means no custom code yet — that's fine
  const data = await res.json() as { scripts?: PageCustomCodeBlock[] };
  return data.scripts || [];
}

// Upsert (replace) all custom code blocks on a page
async function upsertPageCustomCode(
  pageId: string,
  scripts: PageCustomCodeBlock[],
  tokenOverride?: string,
): Promise<boolean> {
  const res = await webflowFetch(`/pages/${pageId}/custom_code`, {
    method: 'PUT',
    body: JSON.stringify({ scripts }),
  }, tokenOverride);
  if (!res.ok) {
    const text = await res.text();
    console.error(`[schema-publish] Failed to upsert page custom code: ${res.status} ${text}`);
    return false;
  }
  return true;
}

/**
 * Safely publish a JSON-LD schema to a Webflow page.
 * 
 * SAFETY: This function ONLY touches scripts whose displayName starts with
 * our SCHEMA_SCRIPT_PREFIX. All other custom code on the page is preserved.
 * 
 * Flow:
 * 1. Register the JSON-LD as a new inline script version
 * 2. GET existing custom code on the page
 * 3. Remove only our previous schema scripts, keep everything else
 * 4. Add the new schema script to the header
 * 5. PUT the merged list back
 */
export async function publishSchemaToPage(
  siteId: string,
  pageId: string,
  schemaJson: Record<string, unknown>,
  tokenOverride?: string,
): Promise<{ success: boolean; error?: string }> {
  const sourceCode = `<script type="application/ld+json">\n${JSON.stringify(schemaJson, null, 2)}\n</script>`;
  const version = `1.0.${Date.now()}`; // unique version per publish
  const displayName = `${SCHEMA_SCRIPT_PREFIX} (${pageId.slice(0, 8)})`;

  // 1. Get all registered scripts so we know which IDs are ours
  const allScripts = await listRegisteredScripts(siteId, tokenOverride);
  const ourPreviousScriptIds = new Set(
    allScripts
      .filter(s => s.displayName.startsWith(SCHEMA_SCRIPT_PREFIX))
      .map(s => s.id)
  );

  // 2. Register the new inline script
  const registered = await registerInlineScript(siteId, sourceCode, displayName, version, tokenOverride);
  if (!registered) {
    return { success: false, error: 'Failed to register schema script with Webflow' };
  }

  // 3. Get existing custom code on this page
  const existingBlocks = await getPageCustomCode(pageId, tokenOverride);

  // 4. Filter out ONLY our previous schema scripts, keep everything else untouched
  const preserved = existingBlocks.filter(block => !ourPreviousScriptIds.has(block.id));

  // 5. Add the new schema script in the header
  const updatedBlocks: PageCustomCodeBlock[] = [
    ...preserved,
    { id: registered.id, location: 'header', version },
  ];

  // 6. Upsert the merged list
  const applied = await upsertPageCustomCode(pageId, updatedBlocks, tokenOverride);
  if (!applied) {
    return { success: false, error: 'Failed to apply schema to page custom code' };
  }

  console.log(`[schema-publish] Published schema to page ${pageId}: ${preserved.length} existing scripts preserved, 1 schema added`);
  return { success: true };
}

/**
 * Publish a raw JSON-LD string (e.g. CMS template with {{wf}} tags) to a page.
 * Same safety logic as publishSchemaToPage but takes a pre-formatted string.
 */
export async function publishRawSchemaToPage(
  siteId: string,
  pageId: string,
  rawJsonLd: string,
  tokenOverride?: string,
): Promise<{ success: boolean; error?: string }> {
  const sourceCode = `<script type="application/ld+json">\n${rawJsonLd}\n</script>`;
  const version = `1.0.${Date.now()}`;
  const displayName = `${SCHEMA_SCRIPT_PREFIX} (${pageId.slice(0, 8)})`;

  const allScripts = await listRegisteredScripts(siteId, tokenOverride);
  const ourPreviousScriptIds = new Set(
    allScripts
      .filter(s => s.displayName.startsWith(SCHEMA_SCRIPT_PREFIX))
      .map(s => s.id)
  );

  const registered = await registerInlineScript(siteId, sourceCode, displayName, version, tokenOverride);
  if (!registered) {
    return { success: false, error: 'Failed to register schema script with Webflow' };
  }

  const existingBlocks = await getPageCustomCode(pageId, tokenOverride);
  const preserved = existingBlocks.filter(block => !ourPreviousScriptIds.has(block.id));
  const updatedBlocks: PageCustomCodeBlock[] = [
    ...preserved,
    { id: registered.id, location: 'header', version },
  ];

  const applied = await upsertPageCustomCode(pageId, updatedBlocks, tokenOverride);
  if (!applied) {
    return { success: false, error: 'Failed to apply CMS template schema to page custom code' };
  }

  console.log(`[schema-publish] Published CMS template schema to page ${pageId}`);
  return { success: true };
}

export async function listSites(tokenOverride?: string): Promise<Array<{ id: string; displayName: string; shortName: string }>> {
  const token = tokenOverride || getToken();
  if (!token) return [];

  const res = await webflowFetch('/sites', {}, token);
  if (!res.ok) return [];
  const data = await res.json() as { sites?: Array<{ id: string; displayName?: string; shortName: string }> };
  return (data.sites || []).map((s) => ({
    id: s.id,
    displayName: s.displayName || s.shortName,
    shortName: s.shortName,
  }));
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

  // Generate a simple hash from file content
  const { createHash } = await import('crypto');
  const fileHash = createHash('md5').update(fileBuffer).digest('hex');

  try {
    // Step 1: Create asset metadata and get presigned upload URL
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
      console.error('Webflow create response:', JSON.stringify(createData, null, 2));
      return { success: false, error: 'No uploadUrl or uploadDetails in response' };
    }

    // Step 2: Upload file via S3 presigned POST (multipart form)
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

    // Step 3: Set alt text via PATCH (not supported in initial create)
    // Must include displayName (required by Webflow v2 API)
    if (altText && assetId) {
      try {
        const patchBody: Record<string, string> = { displayName: fileName, altText };
        const patchRes = await webflowFetch(`/assets/${assetId}`, {
          method: 'PATCH',
          body: JSON.stringify(patchBody),
        }, token);
        if (patchRes.ok) {
          console.log(`Set alt text for ${fileName}: "${altText}"`);
        } else {
          const errText = await patchRes.text();
          console.error(`Failed to set alt text for ${fileName} (${patchRes.status}):`, errText);
        }
      } catch (e) {
        console.error(`Alt text PATCH error for ${fileName}:`, e);
      }
    }

    const hostedUrl = (createData as Record<string, unknown>).hostedUrl as string | undefined;
    console.log(`Uploaded ${fileName} to Webflow (asset: ${assetId})`);
    return { success: true, assetId, hostedUrl };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

// ── Shared CMS page discovery via sitemap ──

export interface CmsPageUrl {
  url: string;
  path: string;
  pageName: string;
}

/**
 * Discover CMS/collection item URLs from sitemap.xml that aren't in the static pages list.
 * @param sitemapBaseUrl - The published site URL to fetch sitemap from (e.g. https://site.webflow.io or https://custom.com)
 * @param staticPaths - Set of lowercase paths already known from the Webflow Pages API
 * @param limit - Max CMS URLs to return (default 50)
 */
export async function discoverCmsUrls(
  sitemapBaseUrl: string,
  staticPaths: Set<string>,
  limit: number = 50,
): Promise<{ cmsUrls: CmsPageUrl[]; totalFound: number }> {
  try {
    const sitemapRes = await fetch(`${sitemapBaseUrl}/sitemap.xml`, { redirect: 'follow' });
    if (!sitemapRes.ok) return { cmsUrls: [], totalFound: 0 };

    const sitemapText = await sitemapRes.text();
    const isXml = sitemapText.trimStart().startsWith('<?xml') || sitemapText.trimStart().startsWith('<urlset') || sitemapText.trimStart().startsWith('<sitemapindex');
    if (!isXml) return { cmsUrls: [], totalFound: 0 };

    // Extract all <loc> URLs
    const locRegex = /<loc>([^<]+)<\/loc>/gi;
    const allUrls: string[] = [];
    let m;
    while ((m = locRegex.exec(sitemapText)) !== null) {
      allUrls.push(m[1].trim());
    }

    // Find URLs not covered by static pages
    const cmsAll: CmsPageUrl[] = [];
    for (const sitemapUrl of allUrls) {
      try {
        const parsed = new URL(sitemapUrl);
        const path = parsed.pathname.replace(/\/$/, '').toLowerCase();
        if (!staticPaths.has(path)) {
          const slug = parsed.pathname.replace(/^\//, '');
          const lastSegment = slug.split('/').pop() || slug;
          const pageName = lastSegment.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          cmsAll.push({ url: sitemapUrl, path: parsed.pathname, pageName });
        }
      } catch { /* skip malformed URLs */ }
    }

    console.log(`[cms-discovery] sitemap: ${allUrls.length} URLs total, ${cmsAll.length} are CMS pages`);
    return { cmsUrls: cmsAll.slice(0, limit), totalFound: cmsAll.length };
  } catch (err) {
    console.error('[cms-discovery] sitemap fetch failed:', err);
    return { cmsUrls: [], totalFound: 0 };
  }
}

/**
 * Build the set of static page paths from Webflow API pages for use with discoverCmsUrls.
 */
/**
 * Discover all URLs from a site's sitemap.xml (handles sitemap index with multiple sub-sitemaps).
 * Returns full URLs. Used by keyword strategy to find CMS/blog pages not in Webflow pages API.
 */
export async function discoverSitemapUrls(baseUrl: string): Promise<string[]> {
  const urls: string[] = [];
  const extractLocs = (xml: string): string[] => {
    const locs: string[] = [];
    const re = /<loc>([^<]+)<\/loc>/gi;
    let m;
    while ((m = re.exec(xml)) !== null) locs.push(m[1].trim());
    return locs;
  };

  try {
    const res = await fetch(`${baseUrl}/sitemap.xml`, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
    if (!res.ok) return urls;
    const text = await res.text();
    if (!text.includes('<urlset') && !text.includes('<sitemapindex')) return urls;

    if (text.includes('<sitemapindex')) {
      // Sitemap index — parse ALL sub-sitemaps
      const subUrls = extractLocs(text);
      for (const subUrl of subUrls) {
        try {
          const subRes = await fetch(subUrl, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
          if (subRes.ok) {
            const subText = await subRes.text();
            urls.push(...extractLocs(subText));
          }
        } catch { /* skip failed sub-sitemap */ }
      }
    } else {
      urls.push(...extractLocs(text));
    }
  } catch { /* sitemap fetch failed */ }
  return urls;
}

export function buildStaticPathSet(pages: WebflowPage[]): Set<string> {
  const paths = new Set<string>();
  paths.add(''); // root
  for (const p of pages) {
    const path = (p.publishedPath || `/${p.slug || ''}`).replace(/\/$/, '').toLowerCase();
    paths.add(path);
  }
  return paths;
}
