/**
 * Shared page path utilities — mirrors server/helpers.ts path functions.
 * Used by frontend components that match or display page paths.
 */
import { PAGE_ADDRESS_SOURCES } from '../../shared/types/page-address';
import type { PageAddress, PageAddressInput, ResolvePageAddressOptions } from '../../shared/types/page-address';

/** Normalize a page path: ensure leading slash, strip trailing slash (keep '/' as-is) */
export function normalizePath(p: string): string {
  const s = p.startsWith('/') ? p : `/${p}`;
  return s.length > 1 && s.endsWith('/') ? s.slice(0, -1) : s;
}

function normalizePageAddressPath(value: string): string {
  try {
    if (value.startsWith('http')) {
      return normalizePath(new URL(value).pathname);
    }
  } catch {
    // Malformed URL string — fall through to path-only normalization.
  }
  return normalizePath(value);
}

function buildCanonicalUrl(baseUrl: string | null | undefined, canonicalPath: string): string | undefined {
  if (!baseUrl) return undefined;
  const normalizedBase = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`;
  const trimmedBase = normalizedBase.replace(/\/+$/, '');
  return `${trimmedBase}${canonicalPath === '/' ? '' : canonicalPath}`;
}

/** Exact path match with trailing-slash normalization (case-insensitive) */
export function matchPagePath(a: string, b: string): boolean {
  return normalizePath(a).toLowerCase() === normalizePath(b).toLowerCase();
}

/**
 * Normalize a page identity that may arrive as a full URL, path, or bare slug.
 * Strips origin/query/hash for full URLs, then delegates to normalizePath().
 */
export function normalizePageUrl(url: string): string {
  return normalizePageAddressPath(url);
}

/** Exact match for page identity values that may be full URLs, paths, or bare slugs. */
export function matchPageIdentity(a: string, b: string): boolean {
  return normalizePageUrl(a).toLowerCase() === normalizePageUrl(b).toLowerCase();
}

/** Find a pageMap entry by path (exact match with normalization, case-insensitive) */
export function findPageMapEntry<T extends { pagePath: string }>(pageMap: T[], path: string): T | undefined {
  const norm = normalizePath(path).toLowerCase();
  return pageMap.find(p => normalizePath(p.pagePath).toLowerCase() === norm);
}

/** Find a pageMap entry from a full URL/path/bare slug using exact normalized page identity. */
export function findPageMapEntryByIdentity<T extends { pagePath: string }>(
  pageMap: T[],
  pageIdentity: string,
): T | undefined {
  return findPageMapEntry(pageMap, normalizePageUrl(pageIdentity));
}

/** Resolve a Webflow page's canonical path from publishedPath or slug */
export function resolvePageAddress(
  page: PageAddressInput,
  options: ResolvePageAddressOptions = {},
): PageAddress {
  const includeLegacyFallback = options.includeLegacyFallback !== false;
  let canonicalPath = '/';
  let source: PageAddress['source'] = PAGE_ADDRESS_SOURCES.fallback;

  if (page.publishedPath !== undefined && page.publishedPath !== null) {
    canonicalPath = normalizePageAddressPath(page.publishedPath);
    source = PAGE_ADDRESS_SOURCES.publishedPath;
  } else if (page.path !== undefined && page.path !== null) {
    canonicalPath = normalizePageAddressPath(page.path);
    source = PAGE_ADDRESS_SOURCES.path;
  } else if (page.url !== undefined && page.url !== null) {
    canonicalPath = normalizePageAddressPath(page.url);
    source = PAGE_ADDRESS_SOURCES.url;
  } else if (page.slug !== undefined && page.slug !== null) {
    canonicalPath = normalizePageAddressPath(page.slug);
    source = PAGE_ADDRESS_SOURCES.slug;
  }

  const address: PageAddress = {
    canonicalPath,
    canonicalUrl: buildCanonicalUrl(options.baseUrl, canonicalPath),
    rawSlug: page.slug ?? null,
    source,
  };

  if (includeLegacyFallback && page.slug !== undefined && page.slug !== null) {
    const legacyFallbackPath = normalizePageAddressPath(page.slug);
    if (legacyFallbackPath.toLowerCase() !== canonicalPath.toLowerCase()) {
      address.legacyFallbackPath = legacyFallbackPath;
    }
  }

  return address;
}

export function resolvePagePath(page: PageAddressInput): string {
  return resolvePageAddress(page).canonicalPath;
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
  const address = resolvePageAddress(page);
  const primary = findPageMapEntry(pageMap, address.canonicalPath);
  if (primary) return primary;
  if (address.legacyFallbackPath) {
    return findPageMapEntry(pageMap, address.legacyFallbackPath);
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
export function tryResolvePagePath(page: PageAddressInput): string | undefined {
  const hasSlug = page.slug !== undefined && page.slug !== null;
  const hasPublishedPath = page.publishedPath !== undefined && page.publishedPath !== null;
  const hasPath = page.path !== undefined && page.path !== null;
  const hasUrl = page.url !== undefined && page.url !== null;
  if (!hasSlug && !hasPublishedPath && !hasPath && !hasUrl) return undefined;
  return resolvePagePath(page);
}
