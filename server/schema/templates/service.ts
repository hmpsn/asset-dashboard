/**
 * Service and Product templates.
 * Service uses provider @id reference (no duplicated Organization).
 * Product never emits zero-price offers.
 */
import type { PageData } from '../data-sources.js';
import { dropUndefined, buildBreadcrumb, orgRef } from './helpers.js';

export interface ServiceInput {
  baseUrl: string;
  pageData: PageData;
}

export function buildServiceSchema(input: ServiceInput): Record<string, unknown> {
  const { pageData, baseUrl } = input;

  const primary = dropUndefined({
    '@type': 'Service',
    '@id': `${pageData.canonicalUrl}#service`,
    'name': pageData.title,
    'description': pageData.description,
    'image': pageData.image,
    'url': pageData.canonicalUrl,
    'provider': dropUndefined({
      '@type': 'Organization',
      ...orgRef(baseUrl),
      'name': pageData.publisher.name,
    }),
  });

  const graph: Array<Record<string, unknown>> = [primary];
  const bc = buildBreadcrumb(pageData.breadcrumbs, pageData.canonicalUrl);
  if (bc) graph.push(bc);

  return { '@context': 'https://schema.org', '@graph': graph };
}

export function buildProductSchema(input: ServiceInput): Record<string, unknown> {
  const { pageData } = input;

  const primary = dropUndefined({
    '@type': 'Product',
    '@id': `${pageData.canonicalUrl}#product`,
    'name': pageData.title,
    'description': pageData.description,
    'image': pageData.image ? [pageData.image] : undefined,
    'url': pageData.canonicalUrl,
    'brand': { '@type': 'Brand', 'name': pageData.publisher.name },
    // Intentionally NO offers — emitting offers without a verified price is spammy
    // and Google penalises it. Add via intelligence layer when business profile has price.
  });

  const graph: Array<Record<string, unknown>> = [primary];
  const bc = buildBreadcrumb(pageData.breadcrumbs, pageData.canonicalUrl);
  if (bc) graph.push(bc);

  return { '@context': 'https://schema.org', '@graph': graph };
}
