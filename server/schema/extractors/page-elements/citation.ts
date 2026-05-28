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
const COMMERCIAL_HOST_RE = /(?:^|\.)((calendly|typeform|elfsight)\.com|grsm\.io)$/i;
const AUTHORITY_ANCHOR_RE = /\b(?:docs?|documentation|guidelines?|research|stud(?:y|ies)|reports?|white\s*papers?|papers?|journals?|standards?|spec(?:ification)?|articles?|guides?|data|statistics|benchmarks?|surveys?)\b/i;
const AUTHORITY_PATH_RE = /(?:^|[/_-])(?:docs?|documentation|guidelines?|research|stud(?:y|ies)|reports?|whitepapers?|papers?|journals?|articles?|guides?|data|statistics|benchmarks?|surveys?|api)(?:$|[/._-])/i;
const AUTHORITY_HOST_RE = /(?:^|\.)((?:gov)|(?:edu)|developers\.google\.com|web\.dev|developer\.mozilla\.org|schema\.org)$/i;
const BRANDED_FALLBACK_BLOCKED_HOST_RE = /(?:^|\.)((?:linkedin|facebook|instagram|x|twitter|youtube|tiktok|pinterest)\.com)$/i;
const GENERIC_CITATION_LABEL_RE = /^(?:research|source|documentation|docs?|article|guide|study|report|paper|reference|website|link|read more|learn more|more)$/i;
const GENERIC_PATH_SEGMENT = new Set([
  'blog',
  'blogs',
  'article',
  'articles',
  'news',
  'resources',
  'docs',
  'doc',
  'documentation',
  'guide',
  'guides',
  'research',
  'study',
  'studies',
  'report',
  'reports',
  'paper',
  'papers',
  'post',
  'posts',
]);

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

function titleizeWords(value: string): string {
  return value
    .split(/\s+/g)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function safeDecodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch { // catch-ok: malformed percent-encoded segment; fall back to raw segment
    return segment;
  }
}

function deriveTitleFromUrl(url: string): string | null {
  const parsed = parseUrlOrNull(url);
  if (!parsed) return null;
  const segments = parsed.pathname
    .split('/')
    .map(segment => safeDecodeSegment(segment).trim().toLowerCase())
    .filter(Boolean);

  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i]
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!segment) continue;
    if (GENERIC_PATH_SEGMENT.has(segment)) continue;
    if (segment.length < 4) continue;
    return titleizeWords(segment);
  }

  const host = comparableHost(parsed.hostname);
  const primaryLabel = host.split('.').filter(Boolean).slice(-2)[0] || host;
  const cleanedHost = primaryLabel.replace(/[-_]+/g, ' ').trim();
  return cleanedHost ? titleizeWords(cleanedHost) : null;
}

export function citationDisplayName(citation: Pick<Citation, 'text' | 'url'>): string {
  const raw = citation.text.replace(/\s+/g, ' ').trim();
  if (raw && !GENERIC_CITATION_LABEL_RE.test(raw) && raw.length >= 4) return raw;
  return deriveTitleFromUrl(citation.url) ?? citation.url;
}

function brandAlignedWithHost(anchorText: string, host: string): boolean {
  const anchor = anchorText.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!anchor) return false;
  const labels = host.split('.').filter(Boolean);
  if (labels.length === 0) return false;
  const primaryLabel = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
  const hostTokens = primaryLabel
    .split(/[^a-z0-9]+/g)
    .map(token => token.trim())
    .filter(token => token.length >= 3);
  if (hostTokens.length === 0) return false;
  return hostTokens.some(token => anchor.includes(token));
}

function isAuthorityCitation(linkUrl: URL, anchorText: string): boolean {
  const text = anchorText.replace(/\s+/g, ' ').trim();
  const host = comparableHost(linkUrl.hostname);
  if (COMMERCIAL_HOST_RE.test(host)) return false;
  if (BRANDED_FALLBACK_BLOCKED_HOST_RE.test(host)) return false;
  const hasPathBeyondRoot = Boolean(linkUrl.pathname && linkUrl.pathname !== '/');
  if (!text) return false;
  if (text.length < 4 || WEAK_ANCHOR_RE.test(text)) return false;
  const anchorIntent = text.replace(/[-_]+/g, ' ');
  if (CTA_ANCHOR_RE.test(anchorIntent) || COMMERCIAL_PATH_RE.test(linkUrl.pathname)) return false;
  const isStrictAuthority = AUTHORITY_HOST_RE.test(host)
    || AUTHORITY_ANCHOR_RE.test(text)
    || AUTHORITY_PATH_RE.test(linkUrl.pathname);
  // Cross-industry branded reference fallback:
  // allow non-CTA branded links that point to an actual resource path and
  // whose anchor text aligns with the linked domain brand (e.g. "Invisalign" -> invisalign.com).
  const isBrandedReference = hasPathBeyondRoot && brandAlignedWithHost(text, host);
  return isStrictAuthority || isBrandedReference;
}

export function filterAuthorityCitations(citations: Citation[], pageBaseUrl?: string): Citation[] {
  const ownUrl = pageBaseUrl ? parseUrlOrNull(pageBaseUrl) : null;
  const ownHost = ownUrl ? comparableHost(ownUrl.hostname) : null;
  const seen = new Set<string>();
  const out: Citation[] = [];

  for (const citation of citations) {
    const linkUrl = parseUrlOrNull(citation.url);
    if (!linkUrl) continue;
    if (!ALLOWED_SCHEMES.has(linkUrl.protocol)) continue;
    if (ownHost && comparableHost(linkUrl.hostname) === ownHost) continue;
    if (!isAuthorityCitation(linkUrl, citation.text)) continue;

    const normalizedUrl = normalizeCitationUrl(linkUrl);
    if (seen.has(normalizedUrl)) continue;
    seen.add(normalizedUrl);
    out.push({
      url: normalizedUrl,
      text: citation.text.replace(/\s+/g, ' ').trim(),
      isExternal: true,
    });
    if (out.length >= MAX_CITATIONS) break;
  }

  return out;
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

    citations.push({
      url: linkUrl.toString(),
      text,
      isExternal: true,
    });
  });

  return filterAuthorityCitations(citations, pageBaseUrl);
}
