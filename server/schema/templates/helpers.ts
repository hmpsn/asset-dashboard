/**
 * Shared utilities for schema template builders.
 * Pure functions only.
 */

import type { BreadcrumbItem, PageData } from '../data-sources.js';

/**
 * Removes keys whose value is undefined. Schema.org templates only emit fields
 * with verified data, so undefined fields must be stripped before serialisation.
 */
export function dropUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

/**
 * Builds a BreadcrumbList @graph node from breadcrumb items. Always emits
 * itemListElement as a positional array. Returns undefined if items.length < 2
 * (a single-item breadcrumb is just the homepage and adds no information).
 */
export function buildBreadcrumb(items: BreadcrumbItem[], canonicalUrl: string): Record<string, unknown> | undefined {
  if (items.length < 2) return undefined;
  return {
    '@type': 'BreadcrumbList',
    '@id': `${canonicalUrl}#breadcrumb`,
    'itemListElement': items.map((it, i) => ({
      '@type': 'ListItem',
      'position': i + 1,
      'name': it.name,
      'item': it.url,
    })),
  };
}

/**
 * Returns an @id reference to the homepage Organization node.
 * All non-homepage pages reference the Organization via @id rather than
 * duplicating the full node.
 */
export function orgRef(baseUrl: string): { '@id': string } {
  return { '@id': `${baseUrl}/#organization` };
}

/**
 * Wraps a single image URL in the schema.org ImageObject shape.
 * Returns undefined if no URL provided so dropUndefined will strip the field.
 */
export function imageNode(url: string | undefined): { '@type': 'ImageObject'; url: string } | undefined {
  if (!url) return undefined;
  return { '@type': 'ImageObject', url };
}

/**
 * Wraps one or more primary nodes into a complete schema document, appending a
 * BreadcrumbList when there are 2+ breadcrumb items. Used by all non-homepage templates.
 */
export function withBreadcrumb(
  primary: Record<string, unknown> | Array<Record<string, unknown>>,
  pageData: PageData,
): Record<string, unknown> {
  const graph: Array<Record<string, unknown>> = Array.isArray(primary) ? [...primary] : [primary];
  const bc = buildBreadcrumb(pageData.breadcrumbs, pageData.canonicalUrl);
  if (bc) graph.push(bc);
  return { '@context': 'https://schema.org', '@graph': graph };
}

/**
 * Returns an @id reference to the homepage WebSite node.
 * Every non-homepage primary node uses this for `isPartOf`.
 */
export function webSiteRef(baseUrl: string): { '@id': string } {
  return { '@id': `${baseUrl}/#website` };
}

/**
 * Returns an @id reference to a page's BreadcrumbList node, or undefined when no
 * BreadcrumbList will be emitted (single-item paths — root or one-segment URLs).
 * Mirrors the buildBreadcrumb gating so a primary node never points at a
 * BreadcrumbList @id that doesn't exist in the @graph.
 */
export function breadcrumbRef(
  canonicalUrl: string,
  breadcrumbs: BreadcrumbItem[],
): { '@id': string } | undefined {
  if (breadcrumbs.length < 2) return undefined;
  return { '@id': `${canonicalUrl}#breadcrumb` };
}

/**
 * Removes a trailing " | Brand", " - Brand", " — Brand", or " · Brand" suffix from a title.
 * Schema.org `name` and breadcrumb labels should not duplicate the site name —
 * Yoast/RankMath strip this; we match the brand against workspace.name (case-insensitive)
 * to avoid stripping legitimate trailing words that look like brand pipes.
 *
 * Examples:
 *   scrubBrandSuffix("Privacy Policy | Acme Studio", "Acme Studio") → "Privacy Policy"
 *   scrubBrandSuffix("Privacy Policy", "Acme Studio") → "Privacy Policy"
 *   scrubBrandSuffix("Acme | Other Co", "Acme Studio") → "Acme | Other Co" (suffix doesn't match brand)
 */
export function scrubBrandSuffix(name: string, brand: string): string {
  if (!brand) return name;
  // Match " | Brand", " - Brand", " — Brand", " · Brand" at the end, case-insensitive on the brand.
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\s+[|\\-—·]\\s+${escaped}\\s*$`, 'i');
  return name.replace(re, '').trim() || name;
}
