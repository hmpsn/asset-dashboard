/**
 * Page-related Webflow API functions.
 * Extracted from webflow.ts — pages, SEO, publishing, schema, sitemap discovery.
 */
import { createLogger } from './logger.js';
import { resolvePagePath } from './helpers.js';
import { webflowFetch, getToken } from './webflow-client.js';
import { parseJsonFallback } from './db/json-validation.js';
import { fetchPublicWebText } from './external-fetch.js';
import type { SchemaDeliveryDecision, SchemaPublishResponse } from '../shared/types/schema-generation.js';

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
// Homepage may have publishedPath: "" or null — allow it via slug fallback
export function filterPublishedPages(pages: WebflowPage[]): WebflowPage[] {
  return pages.filter(p =>
    p.draft !== true &&
    !p.collectionId &&
    !p.archived &&
    (p.publishedPath || p.slug === '' || p.slug === 'index' || p.slug === 'home')
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
  // Guard: no token available — callers treat null as "no subdomain found"
  if (!tokenOverride && !process.env.WEBFLOW_API_TOKEN) return null;
  try {
    const res = await webflowFetch(`/sites/${siteId}`, {}, tokenOverride);
    if (!res.ok) return null;
    const data = await res.json() as { shortName?: string };
    return data.shortName || null;
  } catch { // catch-ok: network failure or missing token → callers treat null as "no subdomain"
    return null;
  }
}

// --- Custom Code API: Register, Apply, and Manage inline scripts ---

const SCHEMA_SCRIPT_PREFIX = 'JSONLDSchema';
const LEGACY_SCHEMA_SCRIPT_PREFIXES = ['JSON-LD Schema', 'JSONLD Schema', SCHEMA_SCRIPT_PREFIX];
const WEBFLOW_INLINE_SCRIPT_LIMIT = 2000;

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

interface WebflowCustomCodeWriteResult<T = undefined> {
  data?: T;
  error?: string;
  customCodeApiUnavailable?: boolean;
}

function isWebflowCustomCodeApiUnavailable(status: number, body: string): boolean {
  if (status !== 403) return false;
  const parsed = parseJsonFallback<{ code?: unknown; message?: unknown } | null>(body, null);
  if (parsed?.code === 'invalid_auth_version') return true;
  if (typeof parsed?.message === 'string' && /not authorized to access this version/i.test(parsed.message)) {
    return true;
  }
  return /invalid_auth_version|not authorized to access this version/i.test(body);
}

async function registerInlineScript(
  siteId: string,
  sourceCode: string,
  displayName: string,
  version: string,
  tokenOverride?: string,
): Promise<WebflowCustomCodeWriteResult<RegisteredScript>> {
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
    return {
      customCodeApiUnavailable: isWebflowCustomCodeApiUnavailable(res.status, text),
      error: `Failed to register schema script with Webflow (${res.status}: ${text})`,
    };
  }
  return { data: await res.json() as RegisteredScript };
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
): Promise<WebflowCustomCodeWriteResult> {
  const res = await webflowFetch(`/pages/${pageId}/custom_code`, {
    method: 'PUT',
    body: JSON.stringify({ scripts }),
  }, tokenOverride);
  if (!res.ok) {
    const text = await res.text();
    log.error(`Failed to upsert page custom code: ${res.status} ${text}`);
    return {
      customCodeApiUnavailable: isWebflowCustomCodeApiUnavailable(res.status, text),
      error: `Failed to apply schema to page custom code (${res.status}: ${text})`,
    };
  }
  return {};
}

function schemaScriptDisplayName(pageId: string): string {
  const safePageId = pageId.slice(0, 12).replace(/[^a-z0-9]/gi, '') || 'Page';
  return `${SCHEMA_SCRIPT_PREFIX}${safePageId}`.slice(0, 50);
}

function buildJsonLdInjectionScript(jsonLd: string): string {
  const safeJson = jsonLd.replace(/<\/script/gi, '<\\/script');
  return `(()=>{const s=document.createElement("script");s.type="application/ld+json";s.textContent=${JSON.stringify(safeJson)};document.head.appendChild(s);})();`;
}

function webflowInlineLimitError(length: number): string {
  return `Schema script is ${length} characters after compaction, exceeding Webflow's 2000 character registered inline script limit. Use CMS schema field delivery or a manual page embed for this rich schema.`;
}

function jsonLdOnly(schemaJson: Record<string, unknown>): string {
  return JSON.stringify(schemaJson, null, 2);
}

function publishedDelivery(jsonLd: string): SchemaDeliveryDecision {
  return {
    method: 'webflow-api',
    status: 'published',
    message: 'Schema published to Webflow through the Custom Code API.',
    jsonLd,
  };
}

function failedDelivery(
  jsonLd: string,
  reason: 'webflow-register-failed' | 'webflow-apply-failed' | 'webflow-inline-script-limit',
  message: string,
): SchemaDeliveryDecision {
  return {
    method: 'webflow-api',
    status: 'failed',
    reason,
    message,
    jsonLd,
  };
}

function manualNativeSchemaDelivery(jsonLd: string, characterCount: number): SchemaDeliveryDecision {
  return {
    method: 'manual-native-schema-field',
    status: 'manual-required',
    reason: 'webflow-inline-script-limit',
    message: 'This schema is too large for Webflow’s registered inline script API. Copy the JSON-LD into Webflow Page Settings -> Schema markup. Webflow’s native Schema markup field is not currently writable through the Data API or MCP.',
    jsonLd,
    characterCount,
    apiLimit: WEBFLOW_INLINE_SCRIPT_LIMIT,
  };
}

function manualNativeSchemaDeliveryForCustomCodeApi(jsonLd: string, message: string): SchemaDeliveryDecision {
  return {
    method: 'manual-native-schema-field',
    status: 'manual-required',
    reason: 'webflow-custom-code-api-unavailable',
    message,
    jsonLd,
  };
}

function webflowCustomCodeApiUnavailableMessage(): string {
  return 'Webflow rejected the Custom Code API request for this token/API version. Copy the JSON-LD into Webflow Page Settings -> Schema markup. Webflow’s native Schema markup field is not currently writable through the Data API or MCP.';
}

export async function publishSchemaToPage(
  siteId: string,
  pageId: string,
  schemaJson: Record<string, unknown>,
  tokenOverride?: string,
): Promise<SchemaPublishResponse> {
  const jsonLd = jsonLdOnly(schemaJson);
  const sourceCode = buildJsonLdInjectionScript(JSON.stringify(schemaJson));
  if (sourceCode.length > WEBFLOW_INLINE_SCRIPT_LIMIT) {
    return {
      success: false,
      delivery: manualNativeSchemaDelivery(jsonLd, sourceCode.length),
      error: webflowInlineLimitError(sourceCode.length),
    };
  }
  const version = `1.0.${Date.now()}`;
  const displayName = schemaScriptDisplayName(pageId);

  const allScripts = await listRegisteredScripts(siteId, tokenOverride);
  const ourPreviousScriptIds = new Set(
    allScripts
      .filter(s => LEGACY_SCHEMA_SCRIPT_PREFIXES.some(prefix => s.displayName.startsWith(prefix)))
      .map(s => s.id)
  );

  const registered = await registerInlineScript(siteId, sourceCode, displayName, version, tokenOverride);
  if (!registered.data) {
    const error = registered.error || 'Failed to register schema script with Webflow';
    if (registered.customCodeApiUnavailable) {
      return {
        success: false,
        delivery: manualNativeSchemaDeliveryForCustomCodeApi(jsonLd, webflowCustomCodeApiUnavailableMessage()),
        error,
      };
    }
    return {
      success: false,
      delivery: failedDelivery(jsonLd, 'webflow-register-failed', error),
      error,
    };
  }

  const existingBlocks = await getPageCustomCode(pageId, tokenOverride);
  const preserved = existingBlocks.filter(block => !ourPreviousScriptIds.has(block.id));
  const updatedBlocks: PageCustomCodeBlock[] = [
    ...preserved,
    { id: registered.data.id, location: 'header', version },
  ];

  const applied = await upsertPageCustomCode(pageId, updatedBlocks, tokenOverride);
  if (applied.error) {
    const error = applied.error || 'Failed to apply schema to page custom code';
    if (applied.customCodeApiUnavailable) {
      return {
        success: false,
        delivery: manualNativeSchemaDeliveryForCustomCodeApi(jsonLd, webflowCustomCodeApiUnavailableMessage()),
        error,
      };
    }
    return {
      success: false,
      delivery: failedDelivery(jsonLd, 'webflow-apply-failed', error),
      error,
    };
  }

  log.info(`Published schema to page ${pageId}: ${preserved.length} existing scripts preserved, 1 schema added`);
  return { success: true, published: true, delivery: publishedDelivery(jsonLd) };
}

export async function publishRawSchemaToPage(
  siteId: string,
  pageId: string,
  rawJsonLd: string,
  tokenOverride?: string,
): Promise<SchemaPublishResponse> {
  const sourceCode = buildJsonLdInjectionScript(rawJsonLd);
  if (sourceCode.length > WEBFLOW_INLINE_SCRIPT_LIMIT) {
    const error = webflowInlineLimitError(sourceCode.length);
    return {
      success: false,
      delivery: failedDelivery(rawJsonLd, 'webflow-inline-script-limit', error),
      error,
    };
  }
  const version = `1.0.${Date.now()}`;
  const displayName = schemaScriptDisplayName(pageId);

  const allScripts = await listRegisteredScripts(siteId, tokenOverride);
  const ourPreviousScriptIds = new Set(
    allScripts
      .filter(s => LEGACY_SCHEMA_SCRIPT_PREFIXES.some(prefix => s.displayName.startsWith(prefix)))
      .map(s => s.id)
  );

  const registered = await registerInlineScript(siteId, sourceCode, displayName, version, tokenOverride);
  if (!registered.data) {
    const error = registered.error || 'Failed to register schema script with Webflow';
    if (registered.customCodeApiUnavailable) {
      return {
        success: false,
        delivery: manualNativeSchemaDeliveryForCustomCodeApi(rawJsonLd, webflowCustomCodeApiUnavailableMessage()),
        error,
      };
    }
    return {
      success: false,
      delivery: failedDelivery(rawJsonLd, 'webflow-register-failed', error),
      error,
    };
  }

  const existingBlocks = await getPageCustomCode(pageId, tokenOverride);
  const preserved = existingBlocks.filter(block => !ourPreviousScriptIds.has(block.id));
  const updatedBlocks: PageCustomCodeBlock[] = [
    ...preserved,
    { id: registered.data.id, location: 'header', version },
  ];

  const applied = await upsertPageCustomCode(pageId, updatedBlocks, tokenOverride);
  if (applied.error) {
    const error = applied.error || 'Failed to apply CMS template schema to page custom code';
    if (applied.customCodeApiUnavailable) {
      return {
        success: false,
        delivery: manualNativeSchemaDeliveryForCustomCodeApi(rawJsonLd, webflowCustomCodeApiUnavailableMessage()),
        error,
      };
    }
    return {
      success: false,
      delivery: failedDelivery(rawJsonLd, 'webflow-apply-failed', error),
      error,
    };
  }

  log.info(`Published CMS template schema to page ${pageId}`);
  return { success: true, published: true, delivery: publishedDelivery(rawJsonLd) };
}

/**
 * Retract (remove) all JSON-LD schema scripts from a page's custom code.
 */
export async function retractSchemaFromPage(
  siteId: string,
  pageId: string,
  tokenOverride?: string,
): Promise<{ success: boolean; removed: number; error?: string }> {
  const allScripts = await listRegisteredScripts(siteId, tokenOverride);
  const schemaScriptIds = new Set(
    allScripts
      .filter(s => LEGACY_SCHEMA_SCRIPT_PREFIXES.some(prefix => s.displayName.startsWith(prefix)))
      .map(s => s.id),
  );

  if (schemaScriptIds.size === 0) {
    return { success: true, removed: 0 };
  }

  const existingBlocks = await getPageCustomCode(pageId, tokenOverride);
  const toKeep = existingBlocks.filter(block => !schemaScriptIds.has(block.id));
  const removedCount = existingBlocks.length - toKeep.length;

  if (removedCount === 0) {
    return { success: true, removed: 0 };
  }

  const applied = await upsertPageCustomCode(pageId, toKeep, tokenOverride);
  if (applied.error) {
    return { success: false, removed: 0, error: applied.error || 'Failed to update page custom code' };
  }

  log.info(`Retracted ${removedCount} schema script(s) from page ${pageId}`);
  return { success: true, removed: removedCount };
}

export async function listSites(
  tokenOverride?: string,
): Promise<Array<{ id: string; displayName: string; shortName: string; defaultLocale: string }>> {
  const token = tokenOverride || getToken();
  if (!token) return [];

  const res = await webflowFetch('/sites', {}, token);
  if (!res.ok) return [];
  const data = await res.json() as {
    sites?: Array<{
      id: string;
      displayName?: string;
      shortName: string;
      locales?: { primary?: { tag?: string } };
    }>;
  };
  return (data.sites || []).map((s) => ({
    id: s.id,
    displayName: s.displayName || s.shortName,
    shortName: s.shortName,
    defaultLocale: s.locales?.primary?.tag || 'en',
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
    const sitemapText = await fetchPublicWebText({
      url: `${sitemapBaseUrl}/sitemap.xml`,
      redirect: 'follow',
      timeoutMs: 8_000,
      defaultHeaders: { Accept: 'application/xml,text/xml,text/plain;q=0.8,*/*;q=0.5' },
      logContext: { module: 'webflow-pages', fetchPath: 'discover-cms-sitemap' },
    });
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
      } catch { /* skip malformed URLs */ } // catch-ok
    }

    log.info(`sitemap: ${allUrls.length} URLs total, ${cmsAll.length} are CMS pages`);
    return { cmsUrls: cmsAll.slice(0, limit), totalFound: cmsAll.length };
  } catch (err) { log.debug({ err }, 'webflow-pages: sitemap fetch failed'); return { cmsUrls: [], totalFound: 0 }; } // catch-ok: network failure — expected
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
    const text = await fetchPublicWebText({
      url: `${baseUrl}/sitemap.xml`,
      redirect: 'follow',
      timeoutMs: 8_000,
      defaultHeaders: { Accept: 'application/xml,text/xml,text/plain;q=0.8,*/*;q=0.5' },
      logContext: { module: 'webflow-pages', fetchPath: 'discover-sitemap-root' },
    });
    if (!text.includes('<urlset') && !text.includes('<sitemapindex')) return urls;

    if (text.includes('<sitemapindex')) {
      const subUrls = extractLocs(text);
      for (const subUrl of subUrls) {
        try {
          const subText = await fetchPublicWebText({
            url: subUrl,
            redirect: 'follow',
            timeoutMs: 8_000,
            defaultHeaders: { Accept: 'application/xml,text/xml,text/plain;q=0.8,*/*;q=0.5' },
            logContext: { module: 'webflow-pages', fetchPath: 'discover-sitemap-child' },
          });
          urls.push(...extractLocs(subText));
        } catch { /* skip failed sub-sitemap */ } // catch-ok
      }
    } else {
      urls.push(...extractLocs(text));
    }
  } catch { /* sitemap fetch failed */ } // catch-ok
  return urls;
}

export function buildStaticPathSet(pages: WebflowPage[]): Set<string> {
  const paths = new Set<string>();
  paths.add(''); // root
  for (const p of pages) {
    const path = resolvePagePath(p).replace(/\/$/, '').toLowerCase();
    paths.add(path);
  }
  return paths;
}

interface StaticSitemapPathIndex {
  pathSet: Set<string>;
  uniqueLeafPaths: Map<string, string | null>;
}

function normalizeSitemapPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed === '/') return '/';
  const prefixed = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return prefixed.replace(/\/+$/, '') || '/';
}

function sitemapPathLeaf(path: string): string {
  const normalized = normalizeSitemapPath(path);
  if (normalized === '/') return '';
  const parts = normalized.split('/').filter(Boolean);
  return (parts.at(-1) ?? '').toLowerCase();
}

function normalizeSitemapPathKey(path: string): string {
  return normalizeSitemapPath(path).toLowerCase();
}

function canonicalSitemapHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

export function buildStaticSitemapPathIndex(sitemapUrls: string[], baseUrl: string): StaticSitemapPathIndex {
  const pathSet = new Set<string>();
  const uniqueLeafPaths = new Map<string, string | null>();
  let baseHost: string | undefined;
  try {
    baseHost = canonicalSitemapHost(new URL(baseUrl).hostname);
  } catch { baseHost = undefined; } // catch-ok: invalid configured base URL means host filtering is unavailable

  for (const sitemapUrl of sitemapUrls) {
    try {
      const parsed = new URL(sitemapUrl, baseUrl);
      if (baseHost && canonicalSitemapHost(parsed.hostname) !== baseHost) continue;
      const path = normalizeSitemapPath(parsed.pathname);
      const pathKey = normalizeSitemapPathKey(path);
      pathSet.add(pathKey);
      const leaf = sitemapPathLeaf(path);
      if (!leaf) continue;
      const previous = uniqueLeafPaths.get(leaf);
      if (previous === undefined) {
        uniqueLeafPaths.set(leaf, pathKey);
      } else if (previous !== pathKey) {
        uniqueLeafPaths.set(leaf, null);
      }
    } catch { /* malformed sitemap URL — ignore */ } // catch-ok
  }

  return { pathSet, uniqueLeafPaths };
}

export function resolveStaticPagePathFromSitemap(
  page: { slug?: string; publishedPath?: string | null },
  sitemapIndex: StaticSitemapPathIndex,
): string {
  const slug = (page.slug ?? '').trim();
  const current = normalizeSitemapPath(resolvePagePath(page));
  const slugLeaf = sitemapPathLeaf(slug || current);
  if (!slugLeaf || slugLeaf === 'index' || slugLeaf === 'home') return current;

  const sitemapPath = sitemapIndex.uniqueLeafPaths.get(slugLeaf);
  if (!sitemapPath) return current;

  const currentIsLeafFallback = current.toLowerCase() === `/${slugLeaf}`;
  const currentMissingFromSitemap = !sitemapIndex.pathSet.has(normalizeSitemapPathKey(current));
  if ((currentIsLeafFallback || currentMissingFromSitemap) && sitemapPath !== current) {
    return sitemapPath;
  }

  return current;
}

export function resolveStaticPagePathsFromSitemap<T extends { slug?: string; publishedPath?: string | null }>(
  pages: T[],
  sitemapUrls: string[],
  baseUrl: string,
): T[] {
  if (pages.length === 0 || sitemapUrls.length === 0) return pages;
  const sitemapIndex = buildStaticSitemapPathIndex(sitemapUrls, baseUrl);
  return pages.map(page => {
    const resolvedPath = resolveStaticPagePathFromSitemap(page, sitemapIndex);
    const currentPath = normalizeSitemapPath(resolvePagePath(page));
    if (resolvedPath === currentPath) return page;
    return { ...page, publishedPath: resolvedPath };
  });
}

/**
 * Canonical formula for synthetic CMS page IDs.
 * All code that creates or looks up a CMS page ID must use this function.
 * Format: cms-{path-with-slashes-replaced-by-dashes}
 * Example: /blog/my-post → cms-blog-my-post
 */
export function toCmsPageId(path: string): string {
  return `cms-${path.replace(/^\//, '').replace(/\//g, '-')}`;
}

export interface CmsItemFull extends CmsPageUrl {
  collectionId: string;
  itemId: string;
  /** Webflow CMS publishing timestamp (ISO 8601). */
  lastPublished: string | null;
  /** Webflow CMS creation timestamp (ISO 8601). */
  createdOn: string | null;
  /** Raw fieldData blob from /collections/:id/items/:itemId — passed to extractPageData via pageMeta.cmsFieldData. */
  fieldData: Record<string, unknown> | null;
}

/**
 * Like discoverCmsUrls but joins the sitemap-discovered URLs against Webflow's
 * collection items API to populate collectionId, itemId, timestamps, and fieldData.
 * Cost: 1 listCollections + 1 listCollectionItems per collection — cached per call.
 */
export async function discoverCmsItemsBySlug(
  siteId: string,
  sitemapBaseUrl: string,
  staticPaths: Set<string>,
  limit: number,
  tokenOverride?: string,
): Promise<{ items: CmsItemFull[]; totalFound: number }> {
  const { cmsUrls, totalFound } = await discoverCmsUrls(sitemapBaseUrl, staticPaths, limit);
  if (cmsUrls.length === 0) return { items: [], totalFound };

  // Lazy-import to avoid a circular module load at startup.
  const { listCollections, listCollectionItems } = await import('./webflow-cms.js'); // dynamic-import-ok
  const collections = await listCollections(siteId, tokenOverride);

  // Key by `${collectionSlug}/${itemSlug}` to disambiguate items that share an item-slug
  // across collections (e.g. /blog/expero AND /our-work/expero — same item-slug, different
  // collection). A flat slug map would silently last-writer-wins. We also keep a fallback
  // index by item-slug alone so URLs whose collection-prefix doesn't match the collection's
  // listed slug (Webflow allows custom URL paths per collection) still resolve when the
  // item-slug is globally unique — but never when ambiguous.
  type CmsItemMeta = Omit<CmsItemFull, 'url' | 'path' | 'pageName'>;
  const compoundMap = new Map<string, CmsItemMeta>();
  const itemSlugIndex = new Map<string, CmsItemMeta[]>();
  for (const coll of collections) {
    const collSlug = (coll.slug || '').toLowerCase();
    let offset = 0;
    const pageSize = 100;
    while (offset < limit) {
      const { items: batch, total } = await listCollectionItems(coll.id, pageSize, offset, tokenOverride);
      if (batch.length === 0) break;
      for (const it of batch) {
        const fieldData = (it.fieldData as Record<string, unknown> | undefined) ?? null;
        const slug = (fieldData?.slug as string | undefined) ?? undefined;
        if (!slug) continue;
        const itemSlug = slug.toLowerCase();
        const meta: CmsItemMeta = {
          collectionId: coll.id,
          itemId: (it.id as string) ?? '',
          lastPublished: (it.lastPublished as string | null | undefined) ?? null,
          createdOn: (it.createdOn as string | null | undefined) ?? null,
          fieldData,
        };
        if (collSlug) compoundMap.set(`${collSlug}/${itemSlug}`, meta);
        const bucket = itemSlugIndex.get(itemSlug) ?? [];
        bucket.push(meta);
        itemSlugIndex.set(itemSlug, bucket);
      }
      offset += batch.length;
      if (offset >= total) break;
    }
  }

  const items: CmsItemFull[] = [];
  for (const u of cmsUrls) {
    const segs = u.path.replace(/^\/|\/$/g, '').toLowerCase().split('/').filter(Boolean);
    const itemSlug = segs[segs.length - 1] ?? '';
    const collSeg = segs.length >= 2 ? segs[segs.length - 2] : '';
    let meta: CmsItemMeta | undefined;
    if (collSeg && compoundMap.has(`${collSeg}/${itemSlug}`)) {
      meta = compoundMap.get(`${collSeg}/${itemSlug}`);
    } else {
      const candidates = itemSlugIndex.get(itemSlug) ?? [];
      // Fallback only when the item-slug is globally unique — never when ambiguous.
      if (candidates.length === 1) meta = candidates[0];
    }
    if (!meta) {
      items.push({ ...u, collectionId: '', itemId: '', lastPublished: null, createdOn: null, fieldData: null });
    } else {
      items.push({ ...u, ...meta });
    }
  }
  return { items, totalFound };
}
