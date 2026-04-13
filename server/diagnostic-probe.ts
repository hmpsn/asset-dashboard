/**
 * Diagnostic Probe — canonical tag extraction + internal link counting.
 *
 * Redirect chain detection is handled by the existing scanRedirects() in redirect-scanner.ts.
 * This module covers the two things scanRedirects() doesn't:
 * 1. Parse <link rel="canonical"> from target page
 * 2. Crawl top pages to count <a href> references to the target URL
 */

import { createLogger } from './logger.js';
import type { InternalLinksResult } from '../shared/types/diagnostics.js';

const log = createLogger('diagnostic-probe');

const PROBE_TIMEOUT_MS = 10_000;
const MAX_PAGES_TO_CRAWL = 20;

// ── Canonical Probe ─────────────────────────────────────────────────

export interface CanonicalProbeResult {
  canonical: string | null;
  selfReferencing: boolean;
  statusCode: number;
  error: string | null;
}

/**
 * Fetch a URL and extract the <link rel="canonical"> tag from the HTML head.
 * Returns null canonical if the page can't be reached or has no canonical tag.
 */
export async function probeCanonical(url: string): Promise<CanonicalProbeResult> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { 'User-Agent': 'hmpsn-diagnostic-probe/1.0' },
    });

    const html = await res.text();
    const canonical = extractCanonical(html);
    const normalizedUrl = normalizeUrl(url);
    const normalizedCanonical = canonical ? normalizeUrl(canonical) : null;

    return {
      canonical,
      selfReferencing: normalizedCanonical === normalizedUrl,
      statusCode: res.status,
      error: null,
    };
  } catch (err) {
    log.warn({ err, url }, 'Canonical probe failed');
    return { canonical: null, selfReferencing: false, statusCode: 0, error: (err as Error).message };
  }
}

function extractCanonical(html: string): string | null {
  // Match <link rel="canonical" href="..."> in any attribute order
  const match = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i)
    || html.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["'][^>]*>/i);
  return match?.[1] ?? null;
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`.replace(/\/$/, '');
  } catch {
    return url.replace(/\/$/, '');
  }
}

// ── Internal Link Counter ───────────────────────────────────────────

/**
 * Crawl a set of pages and count how many contain <a href> links to the target URL.
 * Returns the count, the linking pages, and the deficit vs site median.
 *
 * @param targetPath - The path of the page we're investigating (e.g., "/blog/copilot-article")
 * @param pagesToCrawl - Full URLs of pages to check for links (top pages by traffic)
 * @param liveDomain - The live domain (e.g., "https://www.faros.ai")
 */
export async function countInternalLinks(
  targetPath: string,
  pagesToCrawl: string[],
  liveDomain: string,
): Promise<InternalLinksResult> {
  const pages = pagesToCrawl.slice(0, MAX_PAGES_TO_CRAWL);
  const linkingPages: string[] = [];
  const allLinkCounts: number[] = [];

  await Promise.allSettled(
    pages.map(async (pageUrl) => {
      try {
        const res = await fetch(pageUrl, {
          method: 'GET',
          redirect: 'follow',
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
          headers: { 'User-Agent': 'hmpsn-diagnostic-probe/1.0' },
        });
        const html = await res.text();
        const { linksToTarget, totalInternalLinks } = countLinksInPage(html, targetPath, liveDomain);
        allLinkCounts.push(totalInternalLinks);
        if (linksToTarget > 0) {
          linkingPages.push(pageUrl);
        }
      } catch (err) {
        log.debug({ err, pageUrl }, 'Failed to crawl page for link counting');
      }
    }),
  );

  const count = linkingPages.length;
  const siteMedian = computeMedian(allLinkCounts);
  const deficit = Math.max(0, siteMedian - count);

  log.info({ targetPath, count, siteMedian, deficit, crawled: pages.length }, 'Internal link count complete');

  return { count, siteMedian, topLinkingPages: linkingPages, deficit };
}

function countLinksInPage(
  html: string,
  targetPath: string,
  liveDomain: string,
): { linksToTarget: number; totalInternalLinks: number } {
  // Match all <a href="..."> tags
  const hrefRegex = /<a[^>]*href=["']([^"'#]+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  let linksToTarget = 0;
  let totalInternalLinks = 0;
  const normalizedTarget = targetPath.replace(/\/$/, '');

  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1];
    // Check if internal link (relative path or same domain)
    if (href.startsWith('/') || href.startsWith(liveDomain)) {
      totalInternalLinks++;
      const path = href.startsWith('/') ? href : new URL(href).pathname;
      if (path.replace(/\/$/, '') === normalizedTarget) {
        linksToTarget++;
      }
    }
  }

  return { linksToTarget, totalInternalLinks };
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}
