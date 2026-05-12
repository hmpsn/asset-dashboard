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
import { contentScope } from './content-scope.js';

/**
 * URL scheme allowlist — JSON-LD citations are public Schema.org annotations
 * consumed by search engines. Only http(s) outbound links qualify; data:,
 * file:, blob:, javascript:, vbscript:, mailto:, tel:, and anchor-only hrefs
 * are excluded.
 */
const ALLOWED_SCHEMES = new Set(['http:', 'https:']);
const MAX_CITATIONS = 5;
const WEAK_ANCHOR_RE = /^(?:click here|here|read more|learn more|more|link|this|website|source)$/i;
const CTA_ANCHOR_RE = /\b(?:schedule|appointment|book\s+(?:a|an|now|today|your|online)|demo|contact\s+(?:us|sales)|call\s+(?:us|now|today)|email\s+(?:us|sales)|quote|consultation|consult\s+(?:with|us)|buy\s+(?:now|today)|cart|checkout|pricing|price|payment|pay|affirm|membership|subscribe|signup|sign up|get started|download\s+(?:now|today|guide|ebook)|apply\s+(?:now|today)|login|log in)\b/i;
const COMMERCIAL_PATH_RE = /\/(?:schedule|appointment|book|demo|contact|pricing|checkout|cart|payment|affirm|membership|subscribe|signup|login|get-started|consultation|quote)(?:\/|$)/i;

function parseUrlOrNull(url: string): URL | null {
  try {
    return new URL(url);
  } catch { // catch-ok: malformed URL or relative path — treat as internal/skipped
    return null;
  }
}

function comparableHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

function normalizeCitationUrl(url: URL): string {
  const normalized = new URL(url.toString());
  normalized.hash = '';
  return normalized.toString();
}

function isAuthorityCitation(linkUrl: URL, anchorText: string): boolean {
  const text = anchorText.replace(/\s+/g, ' ').trim();
  if (!text) return false;
  if (text.length < 4 || WEAK_ANCHOR_RE.test(text)) return false;
  const anchorIntent = text.replace(/[-_]+/g, ' ');
  if (CTA_ANCHOR_RE.test(anchorIntent) || COMMERCIAL_PATH_RE.test(linkUrl.pathname)) return false;
  return true;
}

export function extractCitations($: cheerio.CheerioAPI, pageBaseUrl: string): Citation[] {
  const ownUrl = parseUrlOrNull(pageBaseUrl);
  const ownHost = ownUrl ? comparableHost(ownUrl.hostname) : null;
  if (!ownHost) return []; // own URL malformed — skip rather than misclassify

  const citations: Citation[] = [];
  // Restrict to content scope — keeps nav/footer/sidebar out
  contentScope($).find('a[href]').each((_, el) => {
    const $el = $(el);
    const href = ($el.attr('href') ?? '').trim();
    if (!href) return;

    const linkUrl = parseUrlOrNull(href);
    if (!linkUrl) return; // relative path or malformed — skip
    if (!ALLOWED_SCHEMES.has(linkUrl.protocol)) return; // non-http(s) — skip
    if (comparableHost(linkUrl.hostname) === ownHost) return; // internal — skip
    const text = $el.text().trim();
    if (!isAuthorityCitation(linkUrl, text)) return;

    citations.push({
      url: normalizeCitationUrl(linkUrl),
      text,
      isExternal: true,
    });
  });

  const seen = new Set<string>();
  return citations.filter(citation => {
    if (seen.has(citation.url)) return false;
    seen.add(citation.url);
    return true;
  }).slice(0, MAX_CITATIONS);
}
