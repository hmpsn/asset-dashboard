import type { PageAddress, PageAddressInput, ResolvePageAddressOptions } from '../../shared/types/page-address.js';
import {
  findPageMapEntry as findPageMapEntryShared,
  findPageMapEntryByIdentity as findPageMapEntryByIdentityShared,
  findPageMapEntryForPage as findPageMapEntryForPageShared,
  matchPageIdentity as matchPageIdentityShared,
  matchPagePath as matchPagePathShared,
  normalizePageUrl as normalizePageUrlShared,
  resolvePageAddress as resolvePageAddressShared,
  resolvePagePath as resolvePagePathShared,
  tryResolvePagePath as tryResolvePagePathShared,
} from '../../shared/page-address-utils.js';

/** Exact path match with trailing-slash normalization (case-insensitive) */
export const matchPagePath = matchPagePathShared;

/** Find a pageMap entry by path (exact match with normalization, case-insensitive) */
export function findPageMapEntry<T extends { pagePath: string }>(pageMap: T[], path: string): T | undefined {
  return findPageMapEntryShared(pageMap, path);
}

/**
 * Find a pageMap entry for a given Webflow page, with backward-compat fallback.
 *
 * Tries the resolved path first (`publishedPath` or `/${slug}`). If no match AND
 * the page has both a slug and a publishedPath, falls back to `/${slug}` to catch
 * legacy pageMap entries stored before the slug-path hardening migration.
 */
export function findPageMapEntryForPage<T extends { pagePath: string }>(
  pageMap: T[],
  page: { publishedPath?: string | null; slug?: string },
): T | undefined {
  return findPageMapEntryForPageShared(pageMap, page);
}

/** Resolve the full canonical page-address contract for Webflow/site page records. */
export function resolvePageAddress(
  page: PageAddressInput,
  options: ResolvePageAddressOptions = {},
): PageAddress {
  return resolvePageAddressShared(page, options);
}

/** Resolve a Webflow page's canonical path from publishedPath or slug. */
export function resolvePagePath(page: PageAddressInput): string {
  return resolvePagePathShared(page);
}

/**
 * Returns the resolved page path, or `undefined` when the page has no slug/publishedPath/path/url info.
 * Use when the caller must distinguish "no meaningful path info" from the homepage.
 */
export function tryResolvePagePath(page: PageAddressInput): string | undefined {
  return tryResolvePagePathShared(page);
}

/**
 * Match a GSC-reported URL (full URL or path) against a resolved page path.
 * Extracts pathname, normalizes trailing slash, and handles homepage edge case.
 */
export function matchGscUrlToPath(gscUrl: string, resolvedPath: string): boolean {
  let rPath: string;
  try { rPath = new URL(gscUrl).pathname; } catch { rPath = gscUrl; }
  rPath = normalizePageUrlShared(rPath.startsWith('/') ? rPath : `/${rPath}`);
  return resolvedPath === '/' ? rPath === '/' || rPath === '' : rPath === resolvedPath;
}

/**
 * Normalize a URL or path for cross-referencing.
 * Accepts full URLs or bare paths. Strips origin, query, and hash.
 */
export function normalizePageUrl(url: string): string {
  return normalizePageUrlShared(url);
}

/**
 * Reduce any page address — a full site path (`/blog/post-x`) OR a bare slug (`post-x`)
 * — to its final slug segment, lowercased. Use to compare a keyword's assigned page
 * path (a full path from the strategy pageMap) against a published post's
 * `published_slug` (a bare title-slug): they live in different address spaces, so a
 * whole-path `.has()` systematically misses prefixed CMS/collection content. The slug
 * IS the Webflow item identity and is the only page reference stored on the post, so
 * the last segment is the right denominator; this trades a rare cross-prefix collision
 * (`/blog/x` vs `/services/x`) for fixing the common false-negative.
 */
export function pageAddressSlug(path: string): string {
  const segments = normalizePageUrlShared(path).toLowerCase().split('/').filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : '';
}

/** Exact match for page identity values that may be full URLs, paths, or bare slugs. */
export function matchPageIdentity(a: string, b: string): boolean {
  return matchPageIdentityShared(a, b);
}

/** Find a pageMap entry from a full URL/path/bare slug using exact normalized page identity. */
export function findPageMapEntryByIdentity<T extends { pagePath: string }>(
  pageMap: T[],
  pageIdentity: string,
): T | undefined {
  return findPageMapEntryByIdentityShared(pageMap, pageIdentity);
}

/**
 * Normalise a URL to a relative path for `analytics_insights.page_id` storage.
 * GSC/GA4 producers emit full URLs; insight `page_id` is stored as pathname.
 */
export function toInsightPageId(url: string): string {
  try { return new URL(url).pathname; } catch { return url; }
}

/**
 * Convert a Webflow audit page object to the canonical relative path used for
 * `analytics_insights.page_id`.
 */
export function toAuditFindingPageId(page: { slug: string; url: string; pageId: string }): string {
  try { if (page.url) return new URL(page.url).pathname; } catch { /* fall through */ }
  if (page.slug) return `/${page.slug.replace(/^\/+/, '')}`;
  return page.pageId;
}
