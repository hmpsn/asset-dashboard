// server/workspace-data.ts
// Shared data accessors — cached, workspace-scoped access to frequently-fetched data.
// Spec: docs/superpowers/specs/unified-workspace-intelligence.md §5

import { listPages, filterPublishedPages } from './webflow-pages.js';
import { getWorkspace } from './workspaces.js';
import { createLogger } from './logger.js';

const log = createLogger('workspace-data');

// ── Types ───────────────────────────────────────────────────────────────

type WebflowPageArray = Awaited<ReturnType<typeof listPages>>;

interface PageCacheEntry {
  /**
   * All live pages — includes CMS template pages (collectionId set) but
   * excludes drafts and archived pages.  Data-only CMS collections whose
   * template pages are in draft/archived state are naturally excluded.
   */
  allPages: WebflowPageArray;
  /** Published-only subset — excludes CMS templates, drafts, archived */
  publishedPages: WebflowPageArray;
  fetchedAt: number;
}

// ── Page cache ──────────────────────────────────────────────────────────

const PAGE_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const pageCache = new Map<string, PageCacheEntry>();
const pageInflight = new Map<string, Promise<PageCacheEntry>>();

/**
 * Internal: fetch and cache ALL pages for a workspace+site.
 * Both getWorkspacePages() and getWorkspaceAllPages() share this cache.
 */
async function fetchAndCachePages(
  workspaceId: string,
  siteId: string,
): Promise<PageCacheEntry> {
  const key = `${workspaceId}:${siteId}`;

  // Check cache
  const cached = pageCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < PAGE_CACHE_TTL) {
    log.debug({ workspaceId, siteId, cache_hit: true }, 'Page cache hit');
    return cached;
  }
  log.debug({ workspaceId, siteId, cache_hit: false }, 'Page cache miss');

  // Single-flight: if another call is already fetching, wait for it
  const existing = pageInflight.get(key);
  if (existing) return existing;

  // Resolve workspace token
  const token = getWorkspace(workspaceId)?.webflowToken;
  if (!token) {
    const empty: PageCacheEntry = { allPages: [], publishedPages: [], fetchedAt: Date.now() };
    return empty;
  }

  const promise = listPages(siteId, token)
    .then(raw => {
      // "All pages" = live pages (not draft, not archived) — includes CMS templates
      const allPages = raw.filter(p => p.draft !== true && !p.archived);
      const publishedPages = filterPublishedPages(raw);
      const entry: PageCacheEntry = { allPages, publishedPages, fetchedAt: Date.now() };
      pageCache.set(key, entry);
      log.info({ workspaceId, siteId, rawPages: raw.length, livePages: allPages.length, publishedPages: publishedPages.length }, 'Page cache refreshed');
      return entry;
    })
    .catch(err => {
      log.warn({ workspaceId, siteId, err }, 'Failed to fetch Webflow pages');
      // Return stale cache if available
      const stale = pageCache.get(key);
      if (stale) return stale;
      return { allPages: [], publishedPages: [], fetchedAt: 0 } as PageCacheEntry;
    })
    .finally(() => {
      pageInflight.delete(key);
    });

  pageInflight.set(key, promise);
  return promise;
}

/**
 * Get published Webflow pages for a workspace, with 10-minute caching.
 * Filters out drafts, archived, and CMS template pages.
 *
 * @param workspaceId - Workspace ID (for cache key and token lookup)
 * @param siteId - Webflow site ID
 */
export async function getWorkspacePages(
  workspaceId: string,
  siteId: string,
): Promise<WebflowPageArray> {
  const entry = await fetchAndCachePages(workspaceId, siteId);
  return entry.publishedPages;
}

/**
 * Get all LIVE Webflow pages for a workspace, with 10-minute caching.
 * Includes CMS template pages (pages with collectionId) but excludes
 * drafts and archived pages. Use this when you need CMS template pages
 * to enumerate collection item URLs.
 *
 * Data-only CMS collections whose template pages are draft/archived
 * are naturally excluded — only live, published CMS template pages appear.
 *
 * Shares the same cache as getWorkspacePages() — no extra API call.
 *
 * @param workspaceId - Workspace ID (for cache key and token lookup)
 * @param siteId - Webflow site ID
 */
export async function getWorkspaceAllPages(
  workspaceId: string,
  siteId: string,
): Promise<WebflowPageArray> {
  const entry = await fetchAndCachePages(workspaceId, siteId);
  return entry.allPages;
}

/**
 * Invalidate page cache for a workspace. Called on workspace settings save.
 */
export function invalidatePageCache(workspaceId: string): void {
  for (const key of pageCache.keys()) {
    if (key.startsWith(`${workspaceId}:`)) {
      pageCache.delete(key);
    }
  }
  log.debug({ workspaceId }, 'Page cache invalidated');
}

/**
 * Cache stats for health endpoint (§18).
 */
export function getPageCacheStats(): { entries: number; maxEntries: number } {
  return { entries: pageCache.size, maxEntries: 100 };
}
