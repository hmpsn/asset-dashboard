/**
 * Article and BlogPosting templates.
 * Emits ONE primary node + optional BreadcrumbList. No multi-type @graph.
 */
import type { PageData } from '../data-sources.js';
import { dropUndefined, withBreadcrumb, webSiteRef, breadcrumbRef } from './helpers.js';

export interface ArticleInput {
  baseUrl: string;
  pageData: PageData;
}

export type ArticleKind = 'BlogPosting' | 'Article';

export function buildArticleSchema(input: ArticleInput, kind: ArticleKind): Record<string, unknown> {
  const { pageData } = input;

  const author = pageData.author
    ? { '@type': 'Person', 'name': pageData.author }
    : { '@type': 'Organization', 'name': pageData.publisher.name };

  const primary = dropUndefined({
    '@type': kind,
    '@id': `${pageData.canonicalUrl}#article`,
    'headline': pageData.cleanTitle,
    'description': pageData.description,
    'image': pageData.image ? [pageData.image] : undefined,
    'url': pageData.canonicalUrl,
    'datePublished': pageData.datePublished,
    'dateModified': pageData.dateModified || pageData.datePublished,
    'mainEntityOfPage': { '@type': 'WebPage', '@id': pageData.canonicalUrl },
    'author': author,
    'publisher': dropUndefined({
      '@type': 'Organization',
      'name': pageData.publisher.name,
      'logo': pageData.publisher.logoUrl
        ? { '@type': 'ImageObject', 'url': pageData.publisher.logoUrl }
        : undefined,
    }),
    'isPartOf': webSiteRef(input.baseUrl),
    'breadcrumb': breadcrumbRef(pageData.canonicalUrl, pageData.breadcrumbs),
    'inLanguage': pageData.inLanguage,
    'articleSection': pageData.articleSection,
    'keywords': pageData.keywords,
    'about': kind === 'Article' ? 'Case study' : undefined,
    'citation': pageData.elements?.citations && pageData.elements.citations.length > 0
      ? pageData.elements.citations.map(c => ({
          '@type': 'WebPage' as const,
          'url': c.url,
          'name': c.text || c.url,
        }))
      : undefined,
  });

  // Build optional HowTo node from pageData.elements.lists (isHowToLike + steps).
  const howToList = pageData.elements?.lists?.find(l => l.isHowToLike && l.steps && l.steps.length > 0);
  const howTo = howToList ? dropUndefined({
    '@type': 'HowTo' as const,
    '@id': `${pageData.canonicalUrl}#howto`,
    'name': pageData.cleanTitle ?? pageData.title,
    'step': howToList.steps!.map((s) => ({
      '@type': 'HowToStep' as const,
      'position': s.position,
      'name': s.name,
      'text': s.text,
    })),
  }) : undefined;

  // Build optional VideoObject node from pageData.elements.videos[0].
  // Multi-node @graph append per audit §2.6 (withBreadcrumb accepts arrays).
  const video = pageData.elements?.videos?.[0];
  const videoObject = video ? dropUndefined({
    '@type': 'VideoObject' as const,
    '@id': `${pageData.canonicalUrl}#video-0`,
    'name': video.title ?? pageData.cleanTitle ?? pageData.title,
    'description': pageData.description ?? `Video embedded in ${pageData.title}.`,
    'thumbnailUrl': video.thumbnailUrl,
    'uploadDate': pageData.datePublished,
    'embedUrl': video.embedUrl,
    'duration': video.durationSec ? `PT${video.durationSec}S` : undefined,
  }) : undefined;

  const nodes: Array<Record<string, unknown>> = [primary];
  if (howTo) nodes.push(howTo);
  if (videoObject) nodes.push(videoObject);

  return withBreadcrumb(nodes, pageData);
}
