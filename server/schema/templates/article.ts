/**
 * Article and BlogPosting templates.
 * Emits up to 4 nodes: primary (Article/BlogPosting) + optional HowTo +
 * optional VideoObject + BreadcrumbList.
 */
import type { PageData } from '../data-sources.js';
import { dropUndefined, withBreadcrumb, webSiteRef, breadcrumbRef, filterHttpUrls } from './helpers.js';

export interface ArticleInput {
  baseUrl: string;
  pageData: PageData;
}

export type ArticleKind = 'BlogPosting' | 'Article';

function cleanStepText(text: string): string {
  return text.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
}

function stepName(text: string): string {
  const cleaned = cleanStepText(text);
  const label = cleaned.match(/^(.{3,80}?)(?:\s+-\s+|:\s+)/)?.[1]
    || cleaned.match(/^([^.!?]{8,80})[.!?]\s/)?.[1]
    || cleaned;
  return label.length <= 80 ? label : `${label.slice(0, 77).trim()}...`;
}

function hasMeaningfulImageContext(image: { alt?: string; caption?: string }): boolean {
  const alt = image.alt?.trim() ?? '';
  const caption = image.caption?.trim() ?? '';
  // Short labels like "Logo" or "Team photo" add noise; keep gallery nodes for images
  // with enough visible context for search engines to understand why they matter.
  return alt.length >= 20 || caption.length >= 12;
}

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
    'wordCount': pageData.wordCount,
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
      'name': stepName(s.name || s.text),
      'text': cleanStepText(s.text),
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

  // Build optional ImageGallery node from informative images (PR2).
  // Pre-emission gate: name + image[] ≥1; must have ≥2 informative images
  // (single informative image stays on the primary node's `image` field).
  const informativeImages = (pageData.elements?.images ?? []).filter((i: { role: string; alt?: string; caption?: string }) =>
    i.role === 'informative' && hasMeaningfulImageContext(i));
  const galleryName = pageData.cleanTitle || pageData.title;
  // Filter to http(s) URLs only — extracted img.src may be javascript:/data:/relative.
  // Pre-emission gate widened: ≥2 SAFE informative images.
  const galleryImageUrls = filterHttpUrls(informativeImages.map((i: { src: string }) => i.src));
  const canEmitGallery = galleryImageUrls.length >= 2 && !!galleryName;
  const imageGallery = canEmitGallery ? dropUndefined({
    '@type': 'ImageGallery' as const,
    '@id': `${pageData.canonicalUrl}#gallery`,
    'name': galleryName,
    'image': galleryImageUrls,
  }) : undefined;

  const webPageNode = dropUndefined({
    '@type': 'WebPage' as const,
    '@id': `${pageData.canonicalUrl}#webpage`,
    'url': pageData.canonicalUrl,
    'name': pageData.cleanTitle,
    'description': pageData.description,
    'isPartOf': webSiteRef(input.baseUrl),
    'about': { '@id': `${pageData.canonicalUrl}#article` },
    'inLanguage': pageData.inLanguage,
    'breadcrumb': breadcrumbRef(pageData.canonicalUrl, pageData.breadcrumbs),
  });

  const nodes: Array<Record<string, unknown>> = [primary, webPageNode];
  if (howTo) nodes.push(howTo);
  if (videoObject) nodes.push(videoObject);
  if (imageGallery) nodes.push(imageGallery);

  return withBreadcrumb(nodes, pageData);
}
