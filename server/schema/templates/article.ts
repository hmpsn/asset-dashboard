/**
 * Article and BlogPosting templates.
 * Emits ONE primary node + optional BreadcrumbList. No multi-type @graph.
 */
import type { PageData } from '../data-sources.js';
import { dropUndefined, withBreadcrumb } from './helpers.js';

export interface ArticleInput {
  baseUrl: string;
  pageData: PageData;
}

export type ArticleKind = 'BlogPosting' | 'Article';

export function buildArticleSchema(input: ArticleInput, kind: ArticleKind): Record<string, unknown> {
  const { pageData } = input;

  const primary = dropUndefined({
    '@type': kind,
    '@id': `${pageData.canonicalUrl}#article`,
    'headline': pageData.title,
    'description': pageData.description,
    'image': pageData.image ? [pageData.image] : undefined,
    'url': pageData.canonicalUrl,
    'datePublished': pageData.datePublished,
    'dateModified': pageData.dateModified || pageData.datePublished,
    'mainEntityOfPage': { '@type': 'WebPage', '@id': pageData.canonicalUrl },
    'author': { '@type': 'Organization', 'name': pageData.publisher.name },
    'publisher': dropUndefined({
      '@type': 'Organization',
      'name': pageData.publisher.name,
      'logo': pageData.publisher.logoUrl
        ? { '@type': 'ImageObject', 'url': pageData.publisher.logoUrl }
        : undefined,
    }),
    'about': kind === 'Article' ? 'Case study' : undefined,
  });

  return withBreadcrumb(primary, pageData);
}
