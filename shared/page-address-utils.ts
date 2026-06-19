import { PAGE_ADDRESS_SOURCES } from './types/page-address.js';
import type { PageAddress, PageAddressInput, ResolvePageAddressOptions } from './types/page-address.js';

function normalizePathValue(value: string): string {
  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`;
  return withLeadingSlash.length > 1 && withLeadingSlash.endsWith('/')
    ? withLeadingSlash.slice(0, -1)
    : withLeadingSlash;
}

export function normalizePageUrl(value: string): string {
  try {
    if (value.startsWith('http')) {
      return normalizePathValue(new URL(value).pathname);
    }
  } catch {
    // Malformed URL string — fall through to path-only normalization.
  }
  return normalizePathValue(value);
}

/**
 * Normalise any URL or path value to a bare slug (no leading slash, no domain).
 * Canonical slug form shared by the recommendation generator (`affectedPages`) and
 * the admin Strategy cards that match a rec back to a page/keyword. Both sides MUST
 * use this so leading-slash drift can never break the match. Pure / deterministic.
 *
 * Examples: `/blog/foo` → `blog/foo`, `blog/foo` → `blog/foo`,
 * `https://x.com/blog/foo` → `blog/foo`, `/` → ``.
 */
export function toPageSlug(url: string): string {
  return normalizePageUrl(url).replace(/^\//, '');
}

function buildCanonicalUrl(baseUrl: string | null | undefined, canonicalPath: string): string | undefined {
  if (!baseUrl) return undefined;
  const normalizedBase = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`;
  const trimmedBase = normalizedBase.replace(/\/+$/, '');
  return `${trimmedBase}${canonicalPath === '/' ? '' : canonicalPath}`;
}

export function matchPagePath(a: string, b: string): boolean {
  return normalizePageUrl(a).toLowerCase() === normalizePageUrl(b).toLowerCase();
}

export function matchPageIdentity(a: string, b: string): boolean {
  return normalizePageUrl(a).toLowerCase() === normalizePageUrl(b).toLowerCase();
}

export function findPageMapEntry<T extends { pagePath: string }>(pageMap: T[], path: string): T | undefined {
  const normalized = normalizePageUrl(path).toLowerCase();
  return pageMap.find((page) => normalizePageUrl(page.pagePath).toLowerCase() === normalized);
}

export function findPageMapEntryByIdentity<T extends { pagePath: string }>(
  pageMap: T[],
  pageIdentity: string,
): T | undefined {
  return findPageMapEntry(pageMap, normalizePageUrl(pageIdentity));
}

export function resolvePageAddress(
  page: PageAddressInput,
  options: ResolvePageAddressOptions = {},
): PageAddress {
  const includeLegacyFallback = options.includeLegacyFallback !== false;
  let canonicalPath = '/';
  let source: PageAddress['source'] = PAGE_ADDRESS_SOURCES.fallback;

  if (page.publishedPath !== undefined && page.publishedPath !== null) {
    canonicalPath = normalizePageUrl(page.publishedPath);
    source = PAGE_ADDRESS_SOURCES.publishedPath;
  } else if (page.path !== undefined && page.path !== null) {
    canonicalPath = normalizePageUrl(page.path);
    source = PAGE_ADDRESS_SOURCES.path;
  } else if (page.url !== undefined && page.url !== null) {
    canonicalPath = normalizePageUrl(page.url);
    source = PAGE_ADDRESS_SOURCES.url;
  } else if (page.slug !== undefined && page.slug !== null) {
    canonicalPath = normalizePageUrl(page.slug);
    source = PAGE_ADDRESS_SOURCES.slug;
  }

  const address: PageAddress = {
    canonicalPath,
    canonicalUrl: buildCanonicalUrl(options.baseUrl, canonicalPath),
    rawSlug: page.slug ?? null,
    source,
  };

  if (includeLegacyFallback && page.slug !== undefined && page.slug !== null) {
    const legacyFallbackPath = normalizePageUrl(page.slug);
    if (legacyFallbackPath.toLowerCase() !== canonicalPath.toLowerCase()) {
      address.legacyFallbackPath = legacyFallbackPath;
    }
  }

  return address;
}

export function resolvePagePath(page: PageAddressInput): string {
  return resolvePageAddress(page).canonicalPath;
}

export function tryResolvePagePath(page: PageAddressInput): string | undefined {
  const hasSlug = page.slug !== undefined && page.slug !== null;
  const hasPublishedPath = page.publishedPath !== undefined && page.publishedPath !== null;
  const hasPath = page.path !== undefined && page.path !== null;
  const hasUrl = page.url !== undefined && page.url !== null;
  if (!hasSlug && !hasPublishedPath && !hasPath && !hasUrl) return undefined;
  return resolvePagePath(page);
}

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

export function findPageMapEntryBySlug<T extends { pagePath: string }>(
  pageMap: T[],
  slug: string,
): T | undefined {
  const exact = findPageMapEntry(pageMap, `/${slug}`);
  if (exact) return exact;
  const lowerSlug = slug.toLowerCase();
  return pageMap.find((page) => normalizePageUrl(page.pagePath).toLowerCase().endsWith(`/${lowerSlug}`));
}
