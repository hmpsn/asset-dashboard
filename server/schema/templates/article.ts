/**
 * Article and BlogPosting templates.
 * Emits up to 4 nodes: primary (Article/BlogPosting) + optional HowTo +
 * optional VideoObject + BreadcrumbList.
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
  // `||` (not `??`) on title/description fallthroughs: validators check
  // `=== undefined || === null`, so an empty string would slip past required-field
  // checks and produce a HowTo/VideoObject with a blank `name`/`description`.
  const howTo = howToList ? dropUndefined({
    '@type': 'HowTo' as const,
    '@id': `${pageData.canonicalUrl}#howto`,
    'name': pageData.cleanTitle || pageData.title,
    'step': howToList.steps!.map((s) => ({
      '@type': 'HowToStep' as const,
      'position': s.position,
      'name': s.name,
      'text': s.text,
    })),
  }) : undefined;

  // Build optional VideoObject node from pageData.elements.videos[0].
  // Multi-node @graph append per audit §2.6 (withBreadcrumb accepts arrays).
  // Multi-video iteration is deferred to PR2 (single video object today).
  //
  // Pre-emission gating: only emit when ALL Google-required fields will be
  // populated (`name`, `description`, `uploadDate`). The validator's
  // `thumbnailUrl` requirement was moved to `recommended` because Vimeo
  // and native videos cannot supply a thumbnail without an API call, but
  // `uploadDate` (= pageData.datePublished) remains required and may be
  // undefined for static pages without date metadata. Skipping the node
  // entirely is preferable to emitting invalid schema (spec §2: "never
  // produces invalid output"); FAQ uses post-validation rollback for the
  // async case, but VideoObject can decide synchronously here.
  const video = pageData.elements?.videos?.[0];
  const canEmitVideo = !!(video && pageData.datePublished);
  const videoObject = canEmitVideo ? dropUndefined({
    '@type': 'VideoObject' as const,
    '@id': `${pageData.canonicalUrl}#video-0`,
    'name': video!.title || pageData.cleanTitle || pageData.title,
    'description': pageData.description || `Video embedded in ${pageData.title}.`,
    'thumbnailUrl': video!.thumbnailUrl,
    'uploadDate': pageData.datePublished,
    'embedUrl': video!.embedUrl,
    'duration': video!.durationSec ? `PT${video!.durationSec}S` : undefined,
  }) : undefined;

  const nodes: Array<Record<string, unknown>> = [primary];
  if (howTo) nodes.push(howTo);
  if (videoObject) nodes.push(videoObject);

  return withBreadcrumb(nodes, pageData);
}
