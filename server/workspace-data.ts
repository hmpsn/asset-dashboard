// server/workspace-data.ts
// Shared data accessors — cached, workspace-scoped access to frequently-fetched data.
// Spec: docs/superpowers/specs/unified-workspace-intelligence.md §5

import { listPages, filterPublishedPages } from './webflow-pages.js';
import { getWorkspace } from './workspaces.js';
import { createLogger } from './logger.js';
import { LRUCache, singleFlight } from './intelligence-cache.js';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonFallback } from './db/json-validation.js';
import type { ContentPipelineSummary } from '../shared/types/intelligence.js';

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
    // Register key in generation map BEFORE the async fetch, so that
    // invalidatePageCache() can find and bump it even on first-ever fetch.
    if (!cacheGeneration.has(key)) cacheGeneration.set(key, 0);
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
      // Return stale cache if available — preserve fallback-on-error behavior.
      // Use peek() instead of get() because get() hard-deletes expired entries,
      // making the fallback unreachable after TTL expiry.
      const stale = pageCache.peek(key);
      if (stale) return stale;
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
  // Bump generation for race-safe invalidation.
  // fetchAndCachePages registers its key in cacheGeneration BEFORE the async
  // fetch, so in-flight first-ever fetches are always found and bumped here.
  let bumped = 0;
  for (const key of cacheGeneration.keys()) {
    if (key.startsWith(prefix)) {
      cacheGeneration.set(key, getGeneration(key) + 1);
      bumped++;
    }
  }
  log.info({ workspaceId, entriesDeleted: deleted, generationsBumped: bumped }, 'Page cache invalidated');
}

/**
 * Cache stats for health endpoint (§18).
 */
export function getPageCacheStats(): { entries: number; maxEntries: number } {
  return pageCache.stats();
}

// ── Content pipeline summary ─────────────────────────────────────────────

const pipelineStmts = createStmtCache(() => ({
  briefsTotal: db.prepare(`SELECT COUNT(*) as cnt FROM content_briefs WHERE workspace_id = ?`),
  postsTotal: db.prepare(`SELECT COUNT(*) as cnt FROM content_posts WHERE workspace_id = ?`),
  postsByStatus: db.prepare(`SELECT status, COUNT(*) as cnt FROM content_posts WHERE workspace_id = ? GROUP BY status`),
  matricesTotal: db.prepare(`SELECT COUNT(*) as cnt FROM content_matrices WHERE workspace_id = ?`),
  matricesCells: db.prepare(`SELECT cells, stats FROM content_matrices WHERE workspace_id = ?`),
  requestsByStatus: db.prepare(`SELECT status, COUNT(*) as cnt FROM content_topic_requests WHERE workspace_id = ? GROUP BY status`),
  workOrdersActive: db.prepare(`SELECT COUNT(*) as cnt FROM work_orders WHERE workspace_id = ? AND status != 'completed'`),
  seoEditsByStatus: db.prepare(`SELECT status, COUNT(*) as cnt FROM seo_suggestions WHERE workspace_id = ? GROUP BY status`),
  getCache: db.prepare(`SELECT summary_json, cached_at, invalidated_at FROM content_pipeline_cache WHERE workspace_id = ?`),
  upsertCache: db.prepare(`INSERT INTO content_pipeline_cache (workspace_id, summary_json, cached_at, invalidated_at) VALUES (@workspace_id, @summary_json, @cached_at, @invalidated_at) ON CONFLICT(workspace_id) DO UPDATE SET summary_json = excluded.summary_json, cached_at = excluded.cached_at, invalidated_at = excluded.invalidated_at`),
  invalidateCache: db.prepare(`UPDATE content_pipeline_cache SET invalidated_at = datetime('now') WHERE workspace_id = ?`),
}));

/**
 * Get aggregated content pipeline counts for a workspace, with 5-minute persistent cache.
 */
export function getContentPipelineSummary(workspaceId: string): ContentPipelineSummary {
  // Check persistent cache first
  const cached = pipelineStmts().getCache.get(workspaceId) as { summary_json: string; cached_at: string; invalidated_at: string | null } | undefined;
  if (cached && !cached.invalidated_at) {
    // Normalize to ISO 8601 with Z — write path uses new Date().toISOString() which always
    // includes Z, but normalizing defensively in case a future path uses datetime('now').
    const cachedAtUtc = cached.cached_at.endsWith('Z') ? cached.cached_at : cached.cached_at.replace(' ', 'T') + 'Z';
    const age = Date.now() - new Date(cachedAtUtc).getTime();
    if (age < 5 * 60 * 1000) {
      const parsed = parseJsonFallback(cached.summary_json, null as unknown as ContentPipelineSummary);
      if (parsed) return parsed;
    }
  }

  const summary = computeContentPipelineSummary(workspaceId);

  pipelineStmts().upsertCache.run({
    workspace_id: workspaceId,
    summary_json: JSON.stringify(summary),
    cached_at: new Date().toISOString(),
    invalidated_at: null,
  });

  return summary;
}

/**
 * Invalidate the content pipeline cache for a workspace.
 * Call after any mutation to content_briefs, content_posts, content_matrices,
 * content_topic_requests, work_orders, or seo_suggestions.
 */
export function invalidateContentPipelineCache(workspaceId: string): void {
  pipelineStmts().invalidateCache.run(workspaceId);
}

function computeContentPipelineSummary(workspaceId: string): ContentPipelineSummary {
  const briefsRow = pipelineStmts().briefsTotal.get(workspaceId) as { cnt: number } | undefined;
  const postsRow = pipelineStmts().postsTotal.get(workspaceId) as { cnt: number } | undefined;
  const postsByStatusRows = pipelineStmts().postsByStatus.all(workspaceId) as { status: string; cnt: number }[];
  const postsByStatus: Record<string, number> = {};
  for (const r of postsByStatusRows) postsByStatus[r.status] = r.cnt;

  const matricesRow = pipelineStmts().matricesTotal.get(workspaceId) as { cnt: number } | undefined;
  const matricesCellRows = pipelineStmts().matricesCells.all(workspaceId) as { cells: string; stats: string }[];
  let cellsPlanned = 0;
  let cellsPublished = 0;
  for (const r of matricesCellRows) {
    const cells = parseJsonFallback<{ status?: string }[]>(r.cells || '[]', []);
    cellsPlanned += cells.length;
    cellsPublished += cells.filter(c => c.status === 'published').length;
  }

  const requestsByStatusRows = pipelineStmts().requestsByStatus.all(workspaceId) as { status: string; cnt: number }[];
  const requestsMap: Record<string, number> = {};
  for (const r of requestsByStatusRows) requestsMap[r.status] = r.cnt;

  const woRow = pipelineStmts().workOrdersActive.get(workspaceId) as { cnt: number } | undefined;

  const seoRows = pipelineStmts().seoEditsByStatus.all(workspaceId) as { status: string; cnt: number }[];
  const seoMap: Record<string, number> = {};
  for (const r of seoRows) seoMap[r.status] = r.cnt;

  return {
    briefs: { total: briefsRow?.cnt ?? 0, byStatus: {} },
    posts: { total: postsRow?.cnt ?? 0, byStatus: postsByStatus },
    matrices: { total: matricesRow?.cnt ?? 0, cellsPlanned, cellsPublished },
    requests: {
      pending: requestsMap['requested'] ?? 0,
      inProgress: requestsMap['in_progress'] ?? 0,
      delivered: requestsMap['delivered'] ?? 0,
    },
    workOrders: { active: woRow?.cnt ?? 0 },
    seoEdits: {
      pending: seoMap['pending'] ?? 0,
      applied: seoMap['applied'] ?? 0,
      dismissed: seoMap['dismissed'] ?? 0,
    },
  };
}
