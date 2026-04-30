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

/**
 * URL scheme allowlist — JSON-LD citations are public Schema.org annotations
 * consumed by search engines. Only http(s) outbound links qualify; data:,
 * file:, blob:, javascript:, vbscript:, mailto:, tel:, and anchor-only hrefs
 * are excluded.
 */
const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

function parseUrlOrNull(url: string): URL | null {
  try {
    return new URL(url);
  } catch { // catch-ok: malformed URL or relative path — treat as internal/skipped
    return null;
  }
}

export function extractCitations($: cheerio.CheerioAPI, pageBaseUrl: string): Citation[] {
  const ownUrl = parseUrlOrNull(pageBaseUrl);
  const ownHost = ownUrl?.hostname.toLowerCase() ?? null;
  if (!ownHost) return []; // own URL malformed — skip rather than misclassify

  const citations: Citation[] = [];
  // Restrict to <article> scope — keeps nav/footer/sidebar out
  $('article a[href]').each((_, el) => {
    const $el = $(el);
    const href = ($el.attr('href') ?? '').trim();
    if (!href) return;

    const linkUrl = parseUrlOrNull(href);
    if (!linkUrl) return; // relative path or malformed — skip
    if (!ALLOWED_SCHEMES.has(linkUrl.protocol)) return; // non-http(s) — skip
    if (linkUrl.hostname.toLowerCase() === ownHost) return; // internal — skip

    citations.push({
      url: href,
      text: $el.text().trim(),
      isExternal: true,
    });
  });

  return citations;
}
