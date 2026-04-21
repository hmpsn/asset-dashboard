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

/** Resolve a Webflow page's canonical path from publishedPath or slug */
export function resolvePagePath(page: { publishedPath?: string | null; slug?: string }): string {
  return page.publishedPath || (page.slug ? `/${page.slug}` : '/');
}

/**
 * Returns the resolved page path, or `undefined` when the page has no slug or publishedPath.
 * Use this anywhere "no meaningful path info" must be distinguishable from "homepage".
 * See server/helpers.ts:tryResolvePagePath for the authoritative doc.
 */
export function tryResolvePagePath(page: { publishedPath?: string | null; slug?: string }): string | undefined {
  if (!page.slug && !page.publishedPath) return undefined;
  return resolvePagePath(page);
}
