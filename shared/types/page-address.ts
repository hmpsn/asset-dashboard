export const PAGE_ADDRESS_SOURCES = {
  publishedPath: 'publishedPath',
  path: 'path',
  url: 'url',
  slug: 'slug',
  fallback: 'fallback',
} as const;

export type PageAddressSource = typeof PAGE_ADDRESS_SOURCES[keyof typeof PAGE_ADDRESS_SOURCES];

export interface PageAddressInput {
  publishedPath?: string | null;
  path?: string | null;
  url?: string | null;
  slug?: string | null;
}

export interface PageAddress {
  /** Canonical site-relative path, normalized with a leading slash and no trailing slash except '/'. */
  canonicalPath: string;
  /** Canonical absolute URL when a base URL is available. */
  canonicalUrl?: string;
  /** Raw Webflow leaf slug, retained for legacy matching and display only. */
  rawSlug?: string | null;
  /** Field that supplied the canonical path. */
  source: PageAddressSource;
  /** Legacy pre-hardening path, usually '/{slug}', when it differs from canonicalPath. */
  legacyFallbackPath?: string;
}

export interface ResolvePageAddressOptions {
  baseUrl?: string | null;
  includeLegacyFallback?: boolean;
}
