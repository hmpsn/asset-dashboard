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
    'mainEntity': input.businessProfile?.address
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
    'mainEntity': input.businessProfile?.address
      ? localBusinessRef(baseUrl)
      : undefined,
    'isPartOf': webSiteRef(baseUrl),
    'breadcrumb': breadcrumbRef(pageData.canonicalUrl, pageData.breadcrumbs),
    'inLanguage': pageData.inLanguage,
  });
  return withBreadcrumb(primary, pageData);
}

export function buildCollectionPageSchema(input: StaticInput): Record<string, unknown> {
  const { pageData, baseUrl } = input;
  const primary = dropUndefined({
    '@type': 'CollectionPage',
    '@id': `${pageData.canonicalUrl}#collection`,
    'name': pageData.cleanTitle,
    'description': pageData.description,
    'url': pageData.canonicalUrl,
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
