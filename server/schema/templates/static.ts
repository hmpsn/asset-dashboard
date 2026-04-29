/**
 * Static page templates: AboutPage, ContactPage, CollectionPage, WebPage.
 * Each emits the typed primary node + BreadcrumbList only.
 */
import type { PageData } from '../data-sources.js';
import { dropUndefined, buildBreadcrumb, orgRef } from './helpers.js';

export interface StaticInput {
  baseUrl: string;
  pageData: PageData;
}

function withBreadcrumb(primary: Record<string, unknown>, pageData: PageData): Record<string, unknown> {
  const graph: Array<Record<string, unknown>> = [primary];
  const bc = buildBreadcrumb(pageData.breadcrumbs, pageData.canonicalUrl);
  if (bc) graph.push(bc);
  return { '@context': 'https://schema.org', '@graph': graph };
}

export function buildAboutPageSchema(input: StaticInput): Record<string, unknown> {
  const { pageData, baseUrl } = input;
  const primary = dropUndefined({
    '@type': 'AboutPage',
    '@id': `${pageData.canonicalUrl}#aboutpage`,
    'name': pageData.title,
    'description': pageData.description,
    'url': pageData.canonicalUrl,
    'mainEntity': orgRef(baseUrl),
  });
  return withBreadcrumb(primary, pageData);
}

export function buildContactPageSchema(input: StaticInput): Record<string, unknown> {
  const { pageData } = input;
  const primary = dropUndefined({
    '@type': 'ContactPage',
    '@id': `${pageData.canonicalUrl}#contactpage`,
    'name': pageData.title,
    'description': pageData.description,
    'url': pageData.canonicalUrl,
  });
  return withBreadcrumb(primary, pageData);
}

export function buildCollectionPageSchema(input: StaticInput): Record<string, unknown> {
  const { pageData } = input;
  const primary = dropUndefined({
    '@type': 'CollectionPage',
    '@id': `${pageData.canonicalUrl}#collection`,
    'name': pageData.title,
    'description': pageData.description,
    'url': pageData.canonicalUrl,
  });
  return withBreadcrumb(primary, pageData);
}

export function buildWebPageSchema(input: StaticInput): Record<string, unknown> {
  const { pageData } = input;
  const primary = dropUndefined({
    '@type': 'WebPage',
    '@id': `${pageData.canonicalUrl}#webpage`,
    'name': pageData.title,
    'description': pageData.description,
    'url': pageData.canonicalUrl,
  });
  return withBreadcrumb(primary, pageData);
}
