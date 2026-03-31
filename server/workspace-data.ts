// server/workspace-data.ts
// Shared data accessors — cached, workspace-scoped access to frequently-fetched data.
// Spec: docs/superpowers/specs/unified-workspace-intelligence.md §5

import { listPages, filterPublishedPages } from './webflow-pages.js';
import { getWorkspace } from './workspaces.js';
import { createLogger } from './logger.js';
import { LRUCache, singleFlight } from './intelligence-cache.js';

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
const pageCache = new LRUCache<PageCacheEntry>(100);

/**
 * Generation counter per cache key. Incremented on invalidation.
 * In-flight fetches check this before writing to cache — if the generation
 * changed while the fetch was running, the result is stale and discarded.
 */
const cacheGeneration = new Map<string, number>();

function getGeneration(key: string): number {
  return cacheGeneration.get(key) ?? 0;
}

/**
 * Internal: fetch and cache ALL pages for a workspace+site.
 * Both getWorkspacePages() and getWorkspaceAllPages() share this cache.
 */
async function fetchAndCachePages(
  workspaceId: string,
  siteId: string,
): Promise<PageCacheEntry> {
  const key = `${workspaceId}:${siteId}`;

  // Check cache (LRU handles TTL expiry)
  const cached = pageCache.get(key);
  if (cached && !cached.stale) {
    log.debug({ workspaceId, siteId, cache_hit: true }, 'Page cache hit');
    return cached.data;
  }
  log.debug({ workspaceId, siteId, cache_hit: false, stale: cached?.stale }, 'Page cache miss');

  // Single-flight dedup via shared utility
  return singleFlight(`page:${key}`, async () => {
    const token = getWorkspace(workspaceId)?.webflowToken;
    const gen = getGeneration(key);

    try {
      const raw = await listPages(siteId, token || undefined);
      // "All pages" = live pages (not draft, not archived) — includes CMS templates
      const allPages = raw.filter(p => p.draft !== true && !p.archived);
      const publishedPages = filterPublishedPages(raw);
      const entry: PageCacheEntry = { allPages, publishedPages, fetchedAt: Date.now() };

      // Only cache if generation hasn't changed (no invalidation during fetch)
      if (getGeneration(key) === gen) {
        pageCache.set(key, entry, PAGE_CACHE_TTL);
        log.info({ workspaceId, siteId, rawPages: raw.length, livePages: allPages.length, publishedPages: publishedPages.length }, 'Page cache refreshed');
      } else {
        log.info({ workspaceId, siteId }, 'Page cache invalidated during fetch — discarding stale result');
      }
      return entry;
    } catch (err) {
      log.warn({ workspaceId, siteId, err }, 'Failed to fetch Webflow pages');
      // Return stale cache if available — preserve fallback-on-error behavior
      const stale = pageCache.get(key);
      if (stale) return stale.data;
      return { allPages: [], publishedPages: [], fetchedAt: 0 } as PageCacheEntry;
    }
  });
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
 * Uses a generation counter to prevent in-flight fetches from re-populating
 * the cache with stale data after invalidation.
 */
export function invalidatePageCache(workspaceId: string): void {
  const prefix = `${workspaceId}:`;
  const deleted = pageCache.deleteByPrefix(prefix);
  // Bump generation for race-safe invalidation
  for (const key of cacheGeneration.keys()) {
    if (key.startsWith(prefix)) {
      cacheGeneration.set(key, getGeneration(key) + 1);
    }
  }
  log.info({ workspaceId, entriesDeleted: deleted }, 'Page cache invalidated');
}

/**
 * Cache stats for health endpoint (§18).
 */
export function getPageCacheStats(): { entries: number; maxEntries: number } {
  return pageCache.stats();
}

/**
 * Stub: content pipeline summary for workspace. Full implementation in Phase 2.
 */
export function getContentPipelineSummary(_workspaceId: string): null {
  return null;
}
