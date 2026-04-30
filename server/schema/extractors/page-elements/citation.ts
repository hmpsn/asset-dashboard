/**
 * Citation extractor. Detects outbound <a href> in main content area
 * (inside <article>) pointing at external domains. Filters out internal
 * links (own domain), nav/footer links, javascript:/mailto: schemes,
 * empty hrefs, and relative paths.
 *
 * Used by Article.citation[] schema enrichment (Task 12).
 */
import type * as cheerio from 'cheerio';
import type { Citation } from '../../../../shared/types/page-elements.js';

function urlHostnameOrNull(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch { // catch-ok: malformed URL or relative path — treat as internal/skipped
    return null;
  }
}

export function extractCitations($: cheerio.CheerioAPI, pageBaseUrl: string): Citation[] {
  const ownHost = urlHostnameOrNull(pageBaseUrl);
  if (!ownHost) return []; // own URL malformed — skip rather than misclassify

  const citations: Citation[] = [];
  // Restrict to <article> scope — keeps nav/footer/sidebar out
  $('article a[href]').each((_, el) => {
    const $el = $(el);
    const href = ($el.attr('href') ?? '').trim();
    if (!href) return;
    if (href.startsWith('javascript:')) return;
    if (href.startsWith('mailto:')) return;
    if (href.startsWith('tel:')) return;

    const linkHost = urlHostnameOrNull(href);
    if (!linkHost) return; // relative path or malformed — skip
    if (linkHost === ownHost) return; // internal — skip

    citations.push({
      url: href,
      text: $el.text().trim(),
      isExternal: true,
    });
  });

  return citations;
}
