/**
 * Public entry-point for page-element extraction.
 *
 * Composes the per-element extractors. Pure function of HTML — caller
 * decides where the HTML comes from (fetchPublishedHtml(url) for static
 * pages and CMS items per audit §2.4).
 *
 * Returns a typed PageElementCatalog. Always returns; never throws — any
 * cheerio.load or sub-extractor failure degrades to an empty catalog with
 * the failure reason captured in diagnostics.rawCounts.error.
 */
import * as cheerio from 'cheerio';
import type { PageElementCatalog } from '../../../shared/types/page-elements.js';
import { extractVideos } from './page-elements/video.js';
import { extractLists } from './page-elements/howto.js';
import { extractCitations } from './page-elements/citation.js';
import { extractImages } from './page-elements/images.js';
import { extractTables } from './page-elements/tables.js';
import { extractTestimonials } from './page-elements/testimonials.js';
import { aiClassifyImages } from './page-elements/image-ai-classifier.js';
import { aiDisambiguateHowTo } from './page-elements/howto-ai-fallback.js';
import type { AiBudget } from './page-elements/ai-budget.js';
import { createLogger } from '../../logger.js';

const log = createLogger('schema/extractors/page-elements');

export interface ExtractPageElementsOpts {
  /** Page's canonical URL — used by citation extractor to identify external links. */
  pageBaseUrl: string;
  /** Webflow lastPublished at fetch time (drives stale detection). Null for static pages. */
  sourcePublishedAt: string | null;
  /** Per-regenerate AI budget. Used by AI-assisted extractors in PR2; ignored in PR1. */
  aiBudget: AiBudget;
  /** Workspace ID for AI token-logging attribution. Undefined when called outside a workspace context. */
  workspaceId?: string | undefined;
}

function emptyCatalog(opts: ExtractPageElementsOpts, errorMarker: 1 | 0 = 0): PageElementCatalog {
  return {
    extractedAt: new Date().toISOString(),
    sourcePublishedAt: opts.sourcePublishedAt,
    headings: [],
    tables: [],
    images: [],
    videos: [],
    lists: [],
    testimonials: [],
    codeBlocks: [],
    citations: [],
    diagnostics: {
      aiClassificationCalls: opts.aiBudget.used,
      hitAiBudgetCap: opts.aiBudget.exhausted,
      // The `error` count is non-zero only when the catch path fires. Operators
      // can grep diagnostics for `error: 1` to find pages whose extractors threw.
      rawCounts: {
        headings: 0,
        tables: 0,
        images: 0,
        videos: 0,
        lists: 0,
        testimonials: 0,
        codeBlocks: 0,
        citations: 0,
        error: errorMarker,
      },
    },
  };
}

export async function extractPageElements(
  html: string,
  opts: ExtractPageElementsOpts,
): Promise<PageElementCatalog> {
  // The function documents a "never throws" contract — wrap the entire body
  // so any future sub-extractor that calls into less-defensive code (regex,
  // URL parsing) cannot break that guarantee. Callers (generator.ts) rely on
  // it to keep schema generation flowing when extraction degrades.
  try {
    const $ = cheerio.load(html ?? '');

    // PR1 elements
    const videos = extractVideos($);
    let lists = extractLists($);
    // Capture parallel raw item text for AI disambiguation (PR2).
    // Scope must match extractLists EXACTLY (article ol+ul, with whole-document
    // fallback) so the resulting itemsByList[i] is aligned with lists[i] by
    // DOM order. The disambiguator slices itemsByList[i] per list — a flat
    // concat would silently send list-0's items as the prompt for every
    // subsequent list (review-caught data corruption bug).
    const $listScope = $('article').length > 0 ? $('article ol, article ul') : $('ol, ul');
    const itemsByList: string[][] = [];
    $listScope.each((_, el) => {
      const items = $(el).children('li').toArray().map(li => $(li).text().trim());
      itemsByList.push(items);
    });
    lists = await aiDisambiguateHowTo(lists, itemsByList, {
      budget: opts.aiBudget,
      workspaceId: opts.workspaceId,
    });
    const citations = extractCitations($, opts.pageBaseUrl);

    // PR2 elements (images / tables / testimonials)
    let images = extractImages($);
    images = await aiClassifyImages(images, {
      budget: opts.aiBudget,
      workspaceId: opts.workspaceId,
    });
    const tables = extractTables($);
    const testimonials = extractTestimonials($);

    // PR3 elements — empty arrays until PR3
    const headings: PageElementCatalog['headings'] = [];
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
  } catch (err) { // catch-ok: the public contract guarantees no throw — degrade to empty catalog
    log.warn({ err, pageBaseUrl: opts.pageBaseUrl }, 'extractPageElements failed; returning empty catalog');
    return emptyCatalog(opts, 1);
  }
}
