/**
 * Public entry-point for page-element extraction.
 *
 * Composes the per-element extractors. Pure function of HTML — caller
 * decides where the HTML comes from (fetchPublishedHtml(url) for static
 * pages and CMS items per audit §2.4).
 *
 * Returns a typed PageElementCatalog. Always returns; never throws.
 */
import * as cheerio from 'cheerio';
import type { PageElementCatalog } from '../../../shared/types/page-elements.js';
import { extractVideos } from './page-elements/video.js';
import { extractLists } from './page-elements/howto.js';
import { extractCitations } from './page-elements/citation.js';
import type { AiBudget } from './page-elements/ai-budget.js';

export interface ExtractPageElementsOpts {
  /** Page's canonical URL — used by citation extractor to identify external links. */
  pageBaseUrl: string;
  /** Webflow lastPublished at fetch time (drives stale detection). Null for static pages. */
  sourcePublishedAt: string | null;
  /** Per-regenerate AI budget. Used by AI-assisted extractors in PR2; ignored in PR1. */
  aiBudget: AiBudget;
}

export async function extractPageElements(
  html: string,
  opts: ExtractPageElementsOpts,
): Promise<PageElementCatalog> {
  const $ = cheerio.load(html ?? '');

  // PR1 elements
  const videos = extractVideos($);
  const lists = extractLists($);
  const citations = extractCitations($, opts.pageBaseUrl);

  // PR2/PR3 elements — empty arrays in PR1
  const headings: PageElementCatalog['headings'] = [];
  const tables: PageElementCatalog['tables'] = [];
  const images: PageElementCatalog['images'] = [];
  const testimonials: PageElementCatalog['testimonials'] = [];
  const codeBlocks: PageElementCatalog['codeBlocks'] = [];

  return {
    extractedAt: new Date().toISOString(),
    sourcePublishedAt: opts.sourcePublishedAt,
    headings,
    tables,
    images,
    videos,
    lists,
    testimonials,
    codeBlocks,
    citations,
    diagnostics: {
      aiClassificationCalls: opts.aiBudget.used,
      hitAiBudgetCap: opts.aiBudget.exhausted,
      rawCounts: {
        headings: headings.length,
        tables: tables.length,
        images: images.length,
        videos: videos.length,
        lists: lists.length,
        testimonials: testimonials.length,
        codeBlocks: codeBlocks.length,
        citations: citations.length,
      },
    },
  };
}
