/**
 * Shared page path utilities — mirrors server/helpers.ts path functions.
 * Used by frontend components that match or display page paths.
 */

/** Normalize a page path: ensure leading slash, strip trailing slash (keep '/' as-is) */
export function normalizePath(p: string): string {
  const s = p.startsWith('/') ? p : `/${p}`;
  return s.length > 1 && s.endsWith('/') ? s.slice(0, -1) : s;
}

/** Exact path match with trailing-slash normalization (case-insensitive) */
export function matchPagePath(a: string, b: string): boolean {
  return normalizePath(a).toLowerCase() === normalizePath(b).toLowerCase();
}

/** Find a pageMap entry by path (exact match with normalization, case-insensitive) */
export function findPageMapEntry<T extends { pagePath: string }>(pageMap: T[], path: string): T | undefined {
  const norm = normalizePath(path).toLowerCase();
  return pageMap.find(p => normalizePath(p.pagePath).toLowerCase() === norm);
}

/** Resolve a Webflow page's canonical path from publishedPath or slug */
export function resolvePagePath(page: { publishedPath?: string | null; slug?: string }): string {
  return page.publishedPath || (page.slug ? `/${page.slug}` : '/');
}

/**
 * Find a pageMap entry for a given Webflow page, with backward-compat fallback.
 * Mirrors `server/helpers.ts:findPageMapEntryForPage`.
 *
 * Tries the resolved path first (`publishedPath` or `/${slug}`). If no match AND
 * the page has both a slug and a publishedPath, falls back to `/${slug}` to catch
 * legacy pageMap entries stored before the slug-path hardening migration.
 */
export function findPageMapEntryForPage<T extends { pagePath: string }>(
  pageMap: T[],
  page: { publishedPath?: string | null; slug?: string },
): T | undefined {
  const primary = findPageMapEntry(pageMap, resolvePagePath(page));
  if (primary) return primary;
  if (page.slug && page.publishedPath && page.publishedPath !== `/${page.slug}`) {
    return findPageMapEntry(pageMap, `/${page.slug}`);
  }
  return undefined;
}

/**
 * Find a pageMap entry by bare Webflow slug (e.g. 'seo' → '/services/seo').
 *
 * Approval items only store the bare slug, not the full published path. For top-level pages
 * the exact match `/${slug}` works fine. For nested pages (slug 'seo', path '/services/seo')
 * the suffix fallback is required. Exact match is tried first for performance.
 */
export function findPageMapEntryBySlug<T extends { pagePath: string }>(pageMap: T[], slug: string): T | undefined {
  const exact = findPageMapEntry(pageMap, `/${slug}`);
  if (exact) return exact;
  const lowerSlug = slug.toLowerCase();
  return pageMap.find(p => normalizePath(p.pagePath).toLowerCase().endsWith(`/${lowerSlug}`));
}

/**
 * Returns the resolved page path, or `undefined` when the page has no slug/publishedPath info at all.
 * Use this anywhere "no meaningful path info" must be distinguishable from a real path (including the homepage).
 * See server/helpers.ts:tryResolvePagePath for the authoritative doc.
 *
 * Webflow homepages are marked with `slug: ''` (empty string), NOT undefined. The guard below checks
 * `=== undefined` / `=== null` rather than falsy, so `slug: ''` correctly resolves to `/`.
 */
export function tryResolvePagePath(page: { publishedPath?: string | null; slug?: string }): string | undefined {
  const hasSlug = page.slug !== undefined && page.slug !== null;
  const hasPublishedPath = page.publishedPath !== undefined && page.publishedPath !== null;
  if (!hasSlug && !hasPublishedPath) return undefined;
  return resolvePagePath(page);
}
