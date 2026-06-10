/**
 * Brief scrape enrichment — shared helper for collecting live web-scrape evidence
 * for content brief generation.
 *
 * Consumed by:
 *   - generateStandaloneBrief (server/content-brief-generation-job.ts)
 *   - generateBriefForRequest (server/content-brief-generation-job.ts)
 *   - C4 (#16) will persist the output shape; do NOT change the exported interface
 *     without updating C4's stored blob schema.
 *
 * Design contract:
 *   - Never throws — degrades gracefully on scraper failure (FM-2 pattern).
 *   - All errors are caught; programming errors are logged at warn level
 *     (operational scrape failures are expected and stay silent per
 *     server/errors.ts conventions).
 *   - On failure: scrapedRefs/stylePages are empty arrays, serpData is null.
 */

import { isProgrammingError } from './errors.js';
import { createLogger } from './logger.js';
import type { ScrapedPage, SerpData } from './web-scraper.js';

const log = createLogger('content-brief-scrape-enrichment');

// ── C4 contract (pre-committed by C1 — do not rename or reorder fields) ──────

export interface BriefScrapeEnrichmentInput {
  /** Target keyword used for SERP scraping */
  targetKeyword: string;
  /** HTTP-prefixed reference URLs to scrape (already validated); max 5 consumed */
  referenceUrls?: string[];
  /** Public GA4-derived top-page URLs to use as style examples; max 2 consumed */
  stylePageUrls?: string[];
}

export interface BriefScrapeEnrichment {
  /** Scraped content from reference URLs (empty if none provided or all fail) */
  scrapedRefs: ScrapedPage[];
  /** Live SERP data for the keyword (null on failure — FM-2 degradation) */
  serpData: SerpData | null;
  /** Scraped top-performing pages from GA4 for style examples (empty if none) */
  stylePages: ScrapedPage[];
}

/**
 * Derive the top style-example page URLs from GA4 landing-page performance.
 * Shared by both brief paths so the selection heuristic cannot drift.
 *
 * `liveDomain` may be stored with or without a protocol (the auto-resolution
 * path in routes/workspaces.ts stores it WITH one) — it is stripped before
 * re-prefixing, otherwise the URL becomes `https://https://…` and the scrape
 * silently fails the helper's startsWith('http') filter downstream.
 */
export function deriveStylePageUrls(
  pages: Array<{ landingPage: string; sessions: number; avgEngagementTime: number }>,
  liveDomain: string | null | undefined,
): string[] {
  if (!liveDomain) return [];
  const domain = liveDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!domain) return [];
  return [...pages]
    .filter(p => p.sessions > 10 && p.avgEngagementTime > 30)
    .sort((a, b) => (b.avgEngagementTime * b.sessions) - (a.avgEngagementTime * a.sessions))
    .slice(0, 2)
    .map(p => `https://${domain}${p.landingPage}`);
}

/**
 * Collect live web-scrape enrichment for a brief.
 *
 * Uses dynamic import for web-scraper.js (lazy-loaded per job — same as before extraction).
 * Never throws — all failures degrade to empty/null fields with a warn log.
 */
export async function collectBriefEnrichment(
  input: BriefScrapeEnrichmentInput,
): Promise<BriefScrapeEnrichment> {
  const { targetKeyword, referenceUrls = [], stylePageUrls = [] } = input;

  try {
    const { scrapeUrls, scrapeSerpData } = await import('./web-scraper.js'); // dynamic-import-ok — lazy-loaded per job

    const refUrlList = referenceUrls
      .filter((u): u is string => typeof u === 'string' && u.startsWith('http'))
      .slice(0, 5);

    const styleUrlList = stylePageUrls
      .filter((u): u is string => typeof u === 'string' && u.startsWith('http'))
      .slice(0, 2);

    const [scrapedRefs, serpData, stylePages] = await Promise.all([
      refUrlList.length > 0
        ? scrapeUrls(refUrlList, 3).catch((err: unknown) => {
            if (isProgrammingError(err)) log.warn({ err, keyword: targetKeyword }, 'Brief enrichment: reference URL scraping failed');
            return [] as ScrapedPage[];
          })
        : Promise.resolve([] as ScrapedPage[]),
      scrapeSerpData(targetKeyword).catch((err: unknown) => {
        if (isProgrammingError(err)) log.warn({ err, keyword: targetKeyword }, 'Brief enrichment: SERP scraping failed');
        return null;
      }),
      styleUrlList.length > 0
        ? scrapeUrls(styleUrlList, 2).catch((err: unknown) => {
            if (isProgrammingError(err)) log.warn({ err, keyword: targetKeyword }, 'Brief enrichment: style page scraping failed');
            return [] as ScrapedPage[];
          })
        : Promise.resolve([] as ScrapedPage[]),
    ]);

    return { scrapedRefs, serpData, stylePages };
  } catch (err) {
    // Outer catch guards against import failure or unexpected errors
    log.warn({ err, keyword: targetKeyword }, 'Brief enrichment: unexpected failure — returning empty enrichment');
    return { scrapedRefs: [], serpData: null, stylePages: [] };
  }
}
