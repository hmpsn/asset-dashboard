// server/workspace-data.ts
// Shared data accessors — cached, workspace-scoped access to frequently-fetched data.
// Spec: docs/superpowers/specs/unified-workspace-intelligence.md §5

import { listPages, filterPublishedPages } from './webflow-pages.js';
import { getWorkspace } from './workspaces.js';
import { createLogger } from './logger.js';

const log = createLogger('workspace-data');

// ── Types ───────────────────────────────────────────────────────────────

interface PageCacheEntry {
  pages: Awaited<ReturnType<typeof listPages>>;
  fetchedAt: number;
}

// ── Page cache ──────────────────────────────────────────────────────────

const PAGE_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const pageCache = new Map<string, PageCacheEntry>();
const pageInflight = new Map<string, Promise<Awaited<ReturnType<typeof listPages>>>>();

/**
 * Get published Webflow pages for a workspace, with 10-minute caching.
 * Replaces 20 independent listPages() + filterPublishedPages() calls.
 *
 * @param workspaceId - Workspace ID (for cache key and token lookup)
 * @param siteId - Webflow site ID
 */
export async function getWorkspacePages(
  workspaceId: string,
  siteId: string,
): Promise<Awaited<ReturnType<typeof listPages>>> {
  const key = `${workspaceId}:${siteId}`;

  // Check cache
  const cached = pageCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < PAGE_CACHE_TTL) {
    return cached.pages;
  }

  // Single-flight: if another call is already fetching, wait for it
  const existing = pageInflight.get(key);
  if (existing) return existing;

  // Resolve workspace token
  const token = getWorkspace(workspaceId)?.webflowToken;
  if (!token) return [];

  const promise = listPages(siteId, token)
    .then(raw => {
      const pages = filterPublishedPages(raw);
      pageCache.set(key, { pages, fetchedAt: Date.now() });
      log.info({ workspaceId, siteId, pageCount: pages.length }, 'Page cache refreshed');
      return pages;
    })
    .catch(err => {
      log.warn({ workspaceId, siteId, err }, 'Failed to fetch Webflow pages');
      // Return stale cache if available
      const stale = pageCache.get(key);
      if (stale) return stale.pages;
      return [];
    })
    .finally(() => {
      pageInflight.delete(key);
    });

  pageInflight.set(key, promise);
  return promise;
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
