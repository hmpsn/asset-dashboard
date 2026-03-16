/**
 * Page-related Webflow API functions.
 * Extracted from webflow.ts — pages, SEO, publishing, schema, sitemap discovery.
 */
import { createLogger } from './logger.js';
import { webflowFetch, getToken } from './webflow-client.js';

const log = createLogger('webflow-pages');

// --- Page types ---
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

// --- Get site subdomain for published HTML scanning ---
export async function getSiteSubdomain(siteId: string, tokenOverride?: string): Promise<string | null> {
  const res = await webflowFetch(`/sites/${siteId}`, {}, tokenOverride);
  if (!res.ok) return null;
  const data = await res.json() as { shortName?: string };
  return data.shortName || null;
}

// --- Custom Code API: Register, Apply, and Manage inline scripts ---

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
    log.error(`Failed to register inline script: ${res.status} ${text}`);
    return null;
  }
  return await res.json() as RegisteredScript;
}

async function listRegisteredScripts(siteId: string, tokenOverride?: string): Promise<RegisteredScript[]> {
  const res = await webflowFetch(`/sites/${siteId}/registered_scripts`, {}, tokenOverride);
  if (!res.ok) return [];
  const data = await res.json() as { registeredScripts?: RegisteredScript[] };
  return data.registeredScripts || [];
}

async function getPageCustomCode(pageId: string, tokenOverride?: string): Promise<PageCustomCodeBlock[]> {
  const res = await webflowFetch(`/pages/${pageId}/custom_code`, {}, tokenOverride);
  if (!res.ok) return [];
  const data = await res.json() as { scripts?: PageCustomCodeBlock[] };
  return data.scripts || [];
}

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
    log.error(`Failed to upsert page custom code: ${res.status} ${text}`);
    return false;
  }
  return true;
}

export async function publishSchemaToPage(
  siteId: string,
  pageId: string,
  schemaJson: Record<string, unknown>,
  tokenOverride?: string,
): Promise<{ success: boolean; error?: string }> {
  const sourceCode = `<script type="application/ld+json">\n${JSON.stringify(schemaJson, null, 2)}\n</script>`;
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
    return { success: false, error: 'Failed to apply schema to page custom code' };
  }

  log.info(`Published schema to page ${pageId}: ${preserved.length} existing scripts preserved, 1 schema added`);
  return { success: true };
}

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

  log.info(`Published CMS template schema to page ${pageId}`);
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

// ── Shared CMS page discovery via sitemap ──

export interface CmsPageUrl {
  url: string;
  path: string;
  pageName: string;
}

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

    const locRegex = /<loc>([^<]+)<\/loc>/gi;
    const allUrls: string[] = [];
    let m;
    while ((m = locRegex.exec(sitemapText)) !== null) {
      allUrls.push(m[1].trim());
    }

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

    log.info(`sitemap: ${allUrls.length} URLs total, ${cmsAll.length} are CMS pages`);
    return { cmsUrls: cmsAll.slice(0, limit), totalFound: cmsAll.length };
  } catch (err) {
    log.error({ err: err }, 'sitemap fetch failed');
    return { cmsUrls: [], totalFound: 0 };
  }
}

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
