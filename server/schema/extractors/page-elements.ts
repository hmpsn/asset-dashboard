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
import type { PageElementCatalog, SemanticPageData } from '../../../shared/types/page-elements.js';
import { extractVideos } from './page-elements/video.js';
import { extractLists } from './page-elements/howto.js';
import { extractCitations } from './page-elements/citation.js';
import { extractImages } from './page-elements/images.js';
import { extractTables } from './page-elements/tables.js';
import { extractTestimonials } from './page-elements/testimonials.js';
import { aiClassifyImages } from './page-elements/image-ai-classifier.js';
import { aiDisambiguateHowTo } from './page-elements/howto-ai-fallback.js';
import type { AiBudget } from './page-elements/ai-budget.js';
import { contentScope } from './page-elements/content-scope.js';
import { createLogger } from '../../logger.js';
import { parseJsonFallback } from '../../db/json-validation.js';

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

function cleanSemanticText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
  return cleaned || undefined;
}

function normalizePhone(value: unknown): string | undefined {
  const cleaned = cleanSemanticText(value);
  if (!cleaned) return undefined;
  const stripped = cleaned.replace(/^tel:/i, '').trim();
  const digitCount = stripped.replace(/\D/g, '').length;
  return digitCount >= 7 ? stripped : undefined;
}

function normalizeEmail(value: unknown): string | undefined {
  const cleaned = cleanSemanticText(value);
  if (!cleaned) return undefined;
  const stripped = cleaned.replace(/^mailto:/i, '').split('?')[0].trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(stripped) ? stripped : undefined;
}

function extractJsonLdObjects($: cheerio.CheerioAPI): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = parseJsonFallback<unknown>($(el).contents().text(), null);
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const obj = item as Record<string, unknown>;
        nodes.push(obj);
        const graph = obj['@graph'];
        if (Array.isArray(graph)) queue.push(...graph);
      }
    } catch { /* invalid inline JSON-LD is ignored by the semantic extractor */ } // catch-ok
  });
  return nodes;
}

function semanticAddressFromObject(value: unknown): SemanticPageData['address'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const obj = value as Record<string, unknown>;
  const street = cleanSemanticText(obj.streetAddress);
  const city = cleanSemanticText(obj.addressLocality);
  const state = cleanSemanticText(obj.addressRegion);
  const postalCode = cleanSemanticText(obj.postalCode);
  const country = cleanSemanticText(obj.addressCountry);
  if (!street || !city || !state) return undefined;
  return {
    street,
    city,
    state,
    ...(postalCode ? { postalCode } : {}),
    ...(country ? { country } : {}),
  };
}

function firstItemprop($: cheerio.CheerioAPI, prop: string): string | undefined {
  const el = $(`[itemprop="${prop}"]`).first();
  if (!el.length) return undefined;
  return cleanSemanticText(el.attr('content') || el.attr('datetime') || el.text());
}

function extractSemantics($: cheerio.CheerioAPI): SemanticPageData | undefined {
  const jsonLdNodes = extractJsonLdObjects($);
  const businessNode = jsonLdNodes.find(node => {
    const type = node['@type'];
    const types = Array.isArray(type) ? type : [type];
    return types.some(t => typeof t === 'string' && /^(LocalBusiness|Organization|MedicalOrganization|FinancialService)$/.test(t));
  });
  const phone = normalizePhone(businessNode?.telephone)
    ?? normalizePhone($('a[href^="tel:"]').first().attr('href'));
  const email = normalizeEmail(businessNode?.email)
    ?? normalizeEmail($('a[href^="mailto:"]').first().attr('href'));
  const jsonLdAddress = semanticAddressFromObject(businessNode?.address);
  const itempropAddress = semanticAddressFromObject({
    streetAddress: firstItemprop($, 'streetAddress'),
    addressLocality: firstItemprop($, 'addressLocality'),
    addressRegion: firstItemprop($, 'addressRegion'),
    postalCode: firstItemprop($, 'postalCode'),
    addressCountry: firstItemprop($, 'addressCountry'),
  });
  const sameAsRaw = businessNode?.sameAs;
  const sameAs = Array.isArray(sameAsRaw)
    ? sameAsRaw.map(v => cleanSemanticText(v)).filter((v): v is string => !!v && /^https?:\/\//.test(v))
    : undefined;

  const semantics: SemanticPageData = {
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
    ...(jsonLdAddress ?? itempropAddress ? { address: jsonLdAddress ?? itempropAddress } : {}),
    ...(sameAs && sameAs.length > 0 ? { sameAs } : {}),
  };
  return Object.keys(semantics).length > 0 ? semantics : undefined;
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
    const $listScope = contentScope($).find('ol, ul');
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
    const semantics = extractSemantics($);

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
      ...(semantics ? { semantics } : {}),
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
