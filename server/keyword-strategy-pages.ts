import { resolvePagePath, stripHtmlToText, decodeEntities } from './helpers.js';
import { resolveBaseUrl } from './url-helpers.js';
import { discoverSitemapUrls } from './webflow.js';
import { getWorkspacePages } from './workspace-data.js';
import { updateWorkspace } from './workspaces.js';
import { listPageKeywords } from './page-keywords.js';
import { createLogger } from './logger.js';
import { isProgrammingError } from './errors.js';
import { INCREMENTAL_THRESHOLD_DAYS } from './keyword-strategy-helpers.js';
import type { Workspace } from '../shared/types/workspace.js';

const log = createLogger('keyword-strategy');

export interface KeywordStrategyPageInfo {
  path: string;
  title: string;
  seoTitle: string;
  seoDesc: string;
  contentSnippet: string;
}

type WebflowPageMeta = { title: string; seoTitle: string; seoDesc: string };

interface DiscoverKeywordStrategyPagesOptions {
  ws: Workspace & { webflowSiteId: string };
  token?: string;
  strategyMode: 'full' | 'incremental';
  maxPagesParam: number;
  sendProgress: (step: string, detail: string, progress: number) => void;
}

export interface DiscoverKeywordStrategyPagesResult {
  baseUrl: string;
  pageInfo: KeywordStrategyPageInfo[];
  preloadedPageKeywords: ReturnType<typeof listPageKeywords> | null;
}

const SKIP_PATHS = new Set([
  '/404', '/search', '/password', '/offline', '/thank-you', '/thanks', '/confirmation',
  // Legal pages — no SEO value to optimize
  '/privacy', '/privacy-policy', '/terms', '/terms-of-service', '/terms-and-conditions',
  '/cookie-policy', '/cookies', '/disclaimer', '/legal', '/gdpr', '/ccpa',
  '/acceptable-use', '/acceptable-use-policy', '/dmca', '/refund-policy', '/returns-policy',
  // Utility pages
  '/login', '/signup', '/register', '/reset-password', '/forgot-password',
  '/unsubscribe', '/opt-out', '/maintenance', '/coming-soon', '/under-construction',
]);

const SKIP_PREFIXES = ['/tag/', '/category/', '/author/', '/page/', '/legal/', '/policies/'];
const SKIP_SUFFIXES = ['/rss', '/feed', '/rss.xml', '/feed.xml'];
const SKIP_PATTERNS = [/\/404$/i, /\/search$/i, /\/password$/i, /\/privacy[-_]?policy/i, /\/terms[-_]?(of[-_]?service|and[-_]?conditions)?$/i, /\/cookie[-_]?policy/i, /\/legal$/i];

async function resolveLiveBaseUrl(
  ws: Workspace & { webflowSiteId: string },
  token: string | undefined,
): Promise<string> {
  let liveDomain = ws.liveDomain || '';
  if (!liveDomain && token) {
    try {
      const domRes = await fetch(`https://api.webflow.com/v2/sites/${ws.webflowSiteId}/custom_domains`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (domRes.ok) {
        const domData = await domRes.json() as { customDomains?: { url?: string }[] };
        const domains = domData.customDomains || [];
        if (domains.length > 0 && domains[0].url) {
          const d = domains[0].url;
          liveDomain = d.startsWith('http') ? d : `https://${d}`;
          // Persist so we don't re-resolve every time.
          updateWorkspace(ws.id, { liveDomain });
          log.info(`Auto-resolved liveDomain: ${liveDomain}`);
        }
      }
    } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'keyword-strategy: programming error'); /* best-effort */ } // url-fetch-ok
  }
  const baseUrl = await resolveBaseUrl({ liveDomain, webflowSiteId: ws.webflowSiteId }, token);
  log.info(`Using baseUrl: ${baseUrl}`);
  return baseUrl;
}

async function buildWebflowMetadataLookup(ws: Workspace & { webflowSiteId: string }): Promise<Map<string, WebflowPageMeta>> {
  const wfMetaByPath = new Map<string, WebflowPageMeta>();
  try {
    const published = await getWorkspacePages(ws.id, ws.webflowSiteId);
    for (const p of published) {
      const pagePath = resolvePagePath(p);
      wfMetaByPath.set(pagePath, {
        title: p.title || p.slug || '',
        seoTitle: p.seo?.title || '',
        seoDesc: p.seo?.description || '',
      });
    }
    log.info(`Webflow API: ${wfMetaByPath.size} pages with metadata`);
  } catch (err) {
    log.info({ err }, 'Webflow API metadata fetch failed, continuing without it');
  }
  return wfMetaByPath;
}

async function discoverLivePaths(baseUrl: string, wfMetaByPath: Map<string, WebflowPageMeta>): Promise<Set<string>> {
  const allPaths = new Set<string>();
  if (baseUrl) {
    try {
      const sitemapUrls = await discoverSitemapUrls(baseUrl);
      log.info(`Sitemap discovered ${sitemapUrls.length} URLs from ${baseUrl}`);
      let skippedUtility = 0;
      for (const url of sitemapUrls) {
        try {
          const rawPath = new URL(url).pathname || '/';
          const path = rawPath === '/' ? '/' : rawPath.replace(/\/$/, '');
          const lowerPath = path.toLowerCase();

          if (SKIP_PATHS.has(lowerPath)) { skippedUtility++; continue; }
          if (SKIP_PREFIXES.some(p => lowerPath.startsWith(p))) { skippedUtility++; continue; }
          if (SKIP_SUFFIXES.some(s => lowerPath.endsWith(s))) { skippedUtility++; continue; }
          if (SKIP_PATTERNS.some(r => r.test(path))) { skippedUtility++; continue; }

          allPaths.add(path);
        } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'keyword-strategy: programming error'); /* skip invalid URLs */ } // url-fetch-ok
      }
      if (skippedUtility > 0) log.info(`Skipped ${skippedUtility} utility/index pages`);
    } catch (err) {
      log.info({ err }, 'Sitemap discovery failed');
    }
  }

  if (allPaths.size === 0 && wfMetaByPath.size > 0) {
    log.info('Sitemap empty — falling back to Webflow API pages');
    for (const path of wfMetaByPath.keys()) allPaths.add(path);
  }
  return allPaths;
}

function capPaths(
  allPaths: Set<string>,
  wfMetaByPath: Map<string, WebflowPageMeta>,
  maxPagesParam: number,
  sendProgress: (step: string, detail: string, progress: number) => void,
): { pathArray: string[]; cappedFromTotal: number } {
  let pathArray = Array.from(allPaths);
  let cappedFromTotal = 0;
  if (maxPagesParam > 0 && pathArray.length > maxPagesParam) {
    cappedFromTotal = pathArray.length;
    const scorePath = (p: string): number => {
      if (p === '/') return 0;
      const depth = p.split('/').filter(Boolean).length;
      const hasWfMeta = wfMetaByPath.has(p) ? 0 : 100;
      return depth * 10 + hasWfMeta;
    };
    pathArray.sort((a, b) => scorePath(a) - scorePath(b));
    pathArray = pathArray.slice(0, maxPagesParam);
    log.info(`Capped from ${cappedFromTotal} → ${maxPagesParam} pages (prioritized by depth + metadata)`);
    sendProgress('discovery', `Large site — prioritized top ${maxPagesParam} of ${cappedFromTotal} pages`, 0.13);
  }
  return { pathArray, cappedFromTotal };
}

function preloadFreshIncrementalPaths(
  workspaceId: string,
  pathArray: string[],
  strategyMode: 'full' | 'incremental',
  sendProgress: (step: string, detail: string, progress: number) => void,
): { freshPathSet: Set<string>; preloadedPageKeywords: ReturnType<typeof listPageKeywords> | null } {
  const freshPathSet = new Set<string>();
  let preloadedPageKeywords: ReturnType<typeof listPageKeywords> | null = null;
  if (strategyMode === 'incremental') {
    preloadedPageKeywords = listPageKeywords(workspaceId);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - INCREMENTAL_THRESHOLD_DAYS);
    const cutoffIso = cutoff.toISOString();
    for (const pk of preloadedPageKeywords) {
      if (pk.analysisGeneratedAt && pk.analysisGeneratedAt >= cutoffIso) {
        freshPathSet.add(pk.pagePath);
      }
    }
    if (freshPathSet.size > 0) {
      log.info(`Incremental pre-check: ${freshPathSet.size} fresh pages skip content fetch`);
      sendProgress('discovery', `Incremental: fetching ${pathArray.length - freshPathSet.size} pages (${freshPathSet.size} already fresh)`, 0.135);
    }
  }
  return { freshPathSet, preloadedPageKeywords };
}

async function fetchPageContent(
  baseUrl: string,
  pathsToFetch: string[],
  wfMetaByPath: Map<string, WebflowPageMeta>,
  snippetLimit: number,
  sendProgress: (step: string, detail: string, progress: number) => void,
): Promise<KeywordStrategyPageInfo[]> {
  const pageInfo: KeywordStrategyPageInfo[] = [];
  const contentBatch = 6;
  const HTML_READ_LIMIT = 100_000; // 100KB max per page — enough for snippet extraction
  for (let i = 0; i < pathsToFetch.length; i += contentBatch) {
    const chunk = pathsToFetch.slice(i, i + contentBatch);
    const fetched = Math.min(i + contentBatch, pathsToFetch.length);
    sendProgress('content', `Fetching page content... ${fetched}/${pathsToFetch.length}`, 0.15 + (fetched / pathsToFetch.length) * 0.30);
    const contents = await Promise.all(chunk.map(async (pagePath): Promise<KeywordStrategyPageInfo | null> => {
      const wfMeta = wfMetaByPath.get(pagePath);
      let contentSnippet = '';
      let htmlTitle = '';
      let htmlMetaDesc = '';
      const url = baseUrl ? `${baseUrl}${pagePath === '/' ? '' : pagePath}` : '';
      if (url) {
        try {
          const htmlRes = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
          if (!htmlRes.ok) {
            if (!wfMeta) return null;
          } else {
            let html = '';
            if (htmlRes.body) {
              const reader = htmlRes.body.getReader();
              const decoder = new TextDecoder();
              let bytesRead = 0;
              while (bytesRead < HTML_READ_LIMIT) {
                const { done, value } = await reader.read();
                if (done) break;
                html += decoder.decode(value, { stream: true });
                bytesRead += value.byteLength;
              }
              reader.cancel().catch(() => {});
            } else {
              html = (await htmlRes.text()).slice(0, HTML_READ_LIMIT);
            }
            if (!wfMeta) {
              const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
              if (titleMatch) htmlTitle = decodeEntities(titleMatch[1].trim());
              const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)
                || html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i);
              if (descMatch) htmlMetaDesc = descMatch[1].trim();
            }
            contentSnippet = stripHtmlToText(html, { stripHeader: true, maxLength: snippetLimit });
          }
        } catch (err) { // url-fetch-ok
          if (isProgrammingError(err)) log.warn({ err }, 'keyword-strategy: programming error');
          if (!wfMeta) return null;
        }
      }
      const pathName = pagePath.replace(/^\//, '').replace(/\/$/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Home';
      return {
        path: pagePath,
        title: wfMeta?.title || htmlTitle || pathName,
        seoTitle: wfMeta?.seoTitle || htmlTitle || '',
        seoDesc: wfMeta?.seoDesc || htmlMetaDesc || '',
        contentSnippet,
      };
    }));
    pageInfo.push(...contents.filter((c): c is KeywordStrategyPageInfo => c !== null));
  }
  return pageInfo;
}

function removeThinPages(pageInfo: KeywordStrategyPageInfo[]): number {
  const thinPages = pageInfo.filter(p => p.contentSnippet.length < 50 && p.path !== '/');
  if (thinPages.length > 0) {
    log.info(`Thin content pages (< 50 chars): ${thinPages.map(p => p.path).join(', ')}`);
    for (const thin of thinPages) {
      const idx = pageInfo.indexOf(thin);
      if (idx >= 0) pageInfo.splice(idx, 1);
    }
    log.info(`Removed ${thinPages.length} thin content pages`);
  }
  return thinPages.length;
}

function addFreshPageSkeletons(
  pageInfo: KeywordStrategyPageInfo[],
  preloadedPageKeywords: ReturnType<typeof listPageKeywords> | null,
  freshPathSet: Set<string>,
): void {
  if (!preloadedPageKeywords || freshPathSet.size === 0) return;
  const fetchedPaths = new Set(pageInfo.map(p => p.path));
  let added = 0;
  for (const pk of preloadedPageKeywords) {
    if (freshPathSet.has(pk.pagePath) && !fetchedPaths.has(pk.pagePath)) {
      pageInfo.push({
        path: pk.pagePath,
        title: pk.pageTitle || '',
        seoTitle: '',
        seoDesc: '',
        contentSnippet: '',
      });
      added++;
    }
  }
  log.info(`Incremental: re-added ${added} fresh page skeletons for synthesis context`);
}

/**
 * Discover live pages and fetch bounded content snippets for keyword strategy generation.
 *
 * Side effects:
 * - May persist an auto-resolved workspace liveDomain when Webflow custom-domain lookup succeeds.
 * - Reads existing page keyword rows in incremental mode to skip fresh HTML fetches.
 */
export async function discoverKeywordStrategyPages({
  ws,
  token,
  strategyMode,
  maxPagesParam,
  sendProgress,
}: DiscoverKeywordStrategyPagesOptions): Promise<DiscoverKeywordStrategyPagesResult> {
  sendProgress('discovery', 'Resolving site URL...', 0.02);
  const baseUrl = await resolveLiveBaseUrl(ws, token);

  sendProgress('discovery', 'Crawling sitemap for live pages...', 0.05);
  const wfMetaByPath = await buildWebflowMetadataLookup(ws);
  const allPaths = await discoverLivePaths(baseUrl, wfMetaByPath);
  sendProgress('discovery', `Found ${allPaths.size} live pages`, 0.12);
  log.info(`Total live pages: ${allPaths.size}`);

  const { pathArray, cappedFromTotal } = capPaths(allPaths, wfMetaByPath, maxPagesParam, sendProgress);
  const snippetLimit = cappedFromTotal > 0 ? 800 : 1200;
  const { freshPathSet, preloadedPageKeywords } = preloadFreshIncrementalPaths(ws.id, pathArray, strategyMode, sendProgress);

  const pathsToFetch = strategyMode === 'incremental' && freshPathSet.size > 0
    ? pathArray.filter(p => !freshPathSet.has(p))
    : pathArray;
  sendProgress('content', `Fetching content from ${pathsToFetch.length} pages...`, 0.15);
  const pageInfo = await fetchPageContent(baseUrl, pathsToFetch, wfMetaByPath, snippetLimit, sendProgress);
  const skipped = pathsToFetch.length - pageInfo.length;
  if (skipped > 0) log.info(`Filtered out ${skipped} non-live pages (404/unreachable)`);

  const beforeThinFilter = pageInfo.length;
  removeThinPages(pageInfo);
  const capNote = cappedFromTotal > 0 ? ` of ${cappedFromTotal} total` : '';
  sendProgress('content', `Fetched ${pageInfo.length} live pages${capNote} (${skipped} non-live, ${beforeThinFilter - pageInfo.length} thin filtered)`, 0.46);

  if (strategyMode === 'incremental') {
    addFreshPageSkeletons(pageInfo, preloadedPageKeywords, freshPathSet);
  }

  return { baseUrl, pageInfo, preloadedPageKeywords };
}
