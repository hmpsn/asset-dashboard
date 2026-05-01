/**
 * Static page templates: AboutPage, ContactPage, CollectionPage, WebPage.
 * Each emits the typed primary node + BreadcrumbList only.
 */
import type { PageData, BusinessProfile } from '../data-sources.js';
import { dropUndefined, orgRef, localBusinessRef, withBreadcrumb, webSiteRef, breadcrumbRef } from './helpers.js';

export interface StaticInput {
  baseUrl: string;
  pageData: PageData;
  businessProfile?: BusinessProfile | null;
}

export function buildAboutPageSchema(input: StaticInput): Record<string, unknown> {
  const { pageData, baseUrl } = input;
  const primary = dropUndefined({
    '@type': 'AboutPage',
    '@id': `${pageData.canonicalUrl}#aboutpage`,
    'name': pageData.cleanTitle,
    'description': pageData.description,
    'url': pageData.canonicalUrl,
    'mainEntity': (input.businessProfile?.address?.street || input.businessProfile?.address?.city)
      ? localBusinessRef(baseUrl)
      : orgRef(baseUrl),
    'isPartOf': webSiteRef(baseUrl),
    'breadcrumb': breadcrumbRef(pageData.canonicalUrl, pageData.breadcrumbs),
    'inLanguage': pageData.inLanguage,
  });
  return withBreadcrumb(primary, pageData);
}

export function buildContactPageSchema(input: StaticInput): Record<string, unknown> {
  const { pageData, baseUrl } = input;
  const primary = dropUndefined({
    '@type': 'ContactPage',
    '@id': `${pageData.canonicalUrl}#contactpage`,
    'name': pageData.cleanTitle,
    'description': pageData.description,
    'url': pageData.canonicalUrl,
    // ContactPage: only link to LocalBusiness when address has at least one locating field.
    // Falls back to undefined (not orgRef) — a ContactPage without a LocalBusiness has no meaningful mainEntity.
    'mainEntity': (input.businessProfile?.address?.street || input.businessProfile?.address?.city)
      ? localBusinessRef(baseUrl)
      : undefined,
    'isPartOf': webSiteRef(baseUrl),
    'breadcrumb': breadcrumbRef(pageData.canonicalUrl, pageData.breadcrumbs),
    'inLanguage': pageData.inLanguage,
  });
  return withBreadcrumb(primary, pageData);
}

export function buildCollectionPageSchema(input: StaticInput & {
  /** When provided, emits mainEntity: ItemList with positional ListItem entries. */
  children?: Array<{ id: string }>;
}): Record<string, unknown> {
  const { pageData, baseUrl } = input;
  const mainEntity = input.children && input.children.length > 0
    ? {
        '@type': 'ItemList',
        'numberOfItems': input.children.length,
        'itemListElement': input.children.map((c, i) => ({
          '@type': 'ListItem',
          'position': i + 1,
          'item': { '@id': c.id },
        })),
      }
    : undefined;
  const primary = dropUndefined({
    '@type': 'CollectionPage',
    '@id': `${pageData.canonicalUrl}#collection`,
    'name': pageData.cleanTitle,
    'description': pageData.description,
    'url': pageData.canonicalUrl,
    'mainEntity': mainEntity,
    'isPartOf': webSiteRef(baseUrl),
    'breadcrumb': breadcrumbRef(pageData.canonicalUrl, pageData.breadcrumbs),
    'inLanguage': pageData.inLanguage,
  });
  return withBreadcrumb(primary, pageData);
}

export function buildWebPageSchema(input: StaticInput): Record<string, unknown> {
  const { pageData, baseUrl } = input;
  const primary = dropUndefined({
    '@type': 'WebPage',
    '@id': `${pageData.canonicalUrl}#webpage`,
    'name': pageData.cleanTitle,
    'description': pageData.description,
    'url': pageData.canonicalUrl,
    'isPartOf': webSiteRef(baseUrl),
    'breadcrumb': breadcrumbRef(pageData.canonicalUrl, pageData.breadcrumbs),
    'inLanguage': pageData.inLanguage,
  });
  return withBreadcrumb(primary, pageData);
}

/**
 * Blog index page — emits Blog with blogPost[] cross-references.
 * Falls back to buildCollectionPageSchema in the generator when no siteContext.
 *
 * @param children - Pre-sorted SiteContextPage child refs (sorted by date desc, null last).
 *   blogPost is capped at 10; numberOfItems reflects the true total.
 */
export function buildBlogIndexSchema(input: {
  baseUrl: string;
  pageData: PageData;
  children: Array<{ id: string }>;
}): Record<string, unknown> {
  const { pageData, baseUrl } = input;
  const cappedBlogPost = input.children.slice(0, 10);
  const primary = dropUndefined({
    '@type': 'Blog',
    '@id': `${pageData.canonicalUrl}#blog`,
    'name': pageData.cleanTitle,
    'description': pageData.description,
    'url': pageData.canonicalUrl,
    'publisher': orgRef(baseUrl),
    'inLanguage': pageData.inLanguage,
    'numberOfItems': input.children.length,
    'blogPost': cappedBlogPost.length > 0
      ? cappedBlogPost.map(c => ({ '@id': c.id }))
      : undefined,
    'breadcrumb': breadcrumbRef(pageData.canonicalUrl, pageData.breadcrumbs),
  });
  return withBreadcrumb(primary, pageData);
}

/**
 * Service index page — emits Service + OfferCatalog with child @id refs.
 * Falls back to buildCollectionPageSchema in the generator when no siteContext.
 */
export function buildServiceHubSchema(input: {
  baseUrl: string;
  pageData: PageData;
  children: Array<{ id: string }>;
}): Record<string, unknown> {
  const { pageData, baseUrl } = input;
  const primary = dropUndefined({
    '@type': 'Service',
    '@id': `${pageData.canonicalUrl}#service`,
    'name': pageData.cleanTitle,
    'description': pageData.description,
    'url': pageData.canonicalUrl,
    'provider': orgRef(baseUrl),
    'hasOfferCatalog': input.children.length > 0
      ? {
          '@type': 'OfferCatalog',
          'name': pageData.cleanTitle || 'Services',
          'hasPart': input.children.map(c => ({ '@id': c.id })),
        }
      : undefined,
    'isPartOf': webSiteRef(baseUrl),
    'breadcrumb': breadcrumbRef(pageData.canonicalUrl, pageData.breadcrumbs),
    'inLanguage': pageData.inLanguage,
  });
  return withBreadcrumb(primary, pageData);
}
