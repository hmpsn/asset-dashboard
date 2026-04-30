import type * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';

/**
 * Returns the best available content container in priority order:
 *   1. <article>       — semantic HTML content container
 *   2. .w-richtext     — Webflow rich-text div (most Webflow templates)
 *   3. <main>          — broad fallback for custom / non-Webflow templates
 *
 * Uses first-match-wins so containers don't nest and double-count.
 * All seven PR1+PR2 extractors and $listScope in page-elements.ts import
 * this helper to keep scope behaviour consistent across the pipeline.
 */
export function contentScope($: cheerio.CheerioAPI): cheerio.Cheerio<AnyNode> {
  if ($('article').length > 0) return $('article');
  if ($('.w-richtext').length > 0) return $('.w-richtext');
  return $('main');
}
