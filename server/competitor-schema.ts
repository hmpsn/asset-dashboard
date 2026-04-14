/**
 * Competitor Schema Intelligence (D4)
 *
 * Crawl competitor websites, extract JSON-LD schemas, and compare coverage
 * against our site's schema types to surface competitive intelligence.
 */
import fs from 'fs';
import path from 'path';
import { getDataDir } from './data-dir.js';
import { createLogger } from './logger.js';

const log = createLogger('competitor-schema');

// ── Types ──

export interface CompetitorSchemaResult {
  domain: string;
  crawledAt: string;
  pages: {
    url: string;
    schemaTypes: string[];
    schemaCount: number;
  }[];
  allTypes: string[];     // Deduplicated list of all schema types found
  typeFrequency: Record<string, number>;  // How many pages use each type
}

export interface SchemaComparison {
  competitorDomain: string;
  typesTheyHaveWeNot: string[];    // Types competitor uses that we don't
  typesWeHaveTheyNot: string[];    // Types we use that competitor doesn't
  sharedTypes: string[];
  ourCoverage: number;             // % of our pages with schema
  theirCoverage: number;           // % of their crawled pages with schema
}

// ── Constants ──

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CONCURRENT = 2;
const DELAY_MS = 500;
const FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_PAGES = 10;

// ── JSON-LD extraction (same regex pattern as schema-suggester.ts extractExistingSchemas) ──

function extractJsonLdFromHtml(html: string): { types: string[]; count: number } {
  const types: string[] = [];
  let count = 0;
  const regex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1].trim());
      count++;
      if (data['@type']) types.push(data['@type']);
      if (Array.isArray(data['@graph'])) {
        for (const item of data['@graph']) {
          if (item['@type']) types.push(String(item['@type']));
        }
      }
    } catch (err) { /* malformed JSON-LD — skip */ }
  }
  return { types, count };
}

// ── Sitemap URL extraction ──

function extractUrlsFromSitemap(xml: string, domain: string, maxUrls: number): string[] {
  const urls: string[] = [];
  const locRegex = /<loc>\s*(.*?)\s*<\/loc>/gi;
  let match;
  while ((match = locRegex.exec(xml)) !== null && urls.length < maxUrls) {
    const url = match[1].trim();
    // Only include URLs from the same domain
    try {
      const parsed = new URL(url);
      if (parsed.hostname === domain || parsed.hostname === `www.${domain}` || `www.${parsed.hostname}` === domain) {
        urls.push(url);
      }
    } catch (err) { /* invalid URL — skip */ }
  }
  return urls;
}

// ── Rate-limited fetcher ──

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AssetDashboard-SchemaBot/1.0' },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch (err) {
    /* network failure or timeout — expected */
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Process URLs in batches with concurrency limit and inter-request delay.
 */
async function fetchPagesWithRateLimit(
  urls: string[],
  maxConcurrent: number,
  delayMs: number,
  timeoutMs: number,
): Promise<{ url: string; html: string | null }[]> {
  const results: { url: string; html: string | null }[] = [];

  for (let i = 0; i < urls.length; i += maxConcurrent) {
    const batch = urls.slice(i, i + maxConcurrent);
    const batchResults = await Promise.all(
      batch.map(async (url) => {
        const html = await fetchWithTimeout(url, timeoutMs);
        return { url, html };
      }),
    );
    results.push(...batchResults);

    // Delay between batches (skip after last batch)
    if (i + maxConcurrent < urls.length) {
      await delay(delayMs);
    }
  }

  return results;
}

// ── Cache ──

function getCacheDir(): string {
  return getDataDir('competitor-schemas');
}

function getCachePath(domain: string): string {
  const safeDomain = domain.replace(/[^a-z0-9.-]/gi, '_');
  return path.join(getCacheDir(), `${safeDomain}.json`);
}

function readCache(domain: string): CompetitorSchemaResult | null {
  const cachePath = getCachePath(domain);
  try {
    if (!fs.existsSync(cachePath)) return null;
    const raw = fs.readFileSync(cachePath, 'utf-8');
    const cached = JSON.parse(raw) as CompetitorSchemaResult;
    // Check TTL
    const age = Date.now() - new Date(cached.crawledAt).getTime();
    if (age > CACHE_TTL_MS) return null;
    return cached;
  } catch (err) {
    log.debug({ err }, 'competitor-schema/readCache: expected error — degrading gracefully');
    return null;
  }
}

function writeCache(domain: string, result: CompetitorSchemaResult): void {
  const cachePath = getCachePath(domain);
  try {
    fs.writeFileSync(cachePath, JSON.stringify(result, null, 2), 'utf-8');
  } catch (err) {
    log.warn({ err, domain }, 'Failed to write competitor schema cache');
  }
}

// ── Public API ──

/**
 * Crawl a competitor domain's pages and extract JSON-LD schema data.
 * Results are cached for 24 hours.
 */
export async function crawlCompetitorSchemas(
  domain: string,
  maxPages: number = DEFAULT_MAX_PAGES,
): Promise<CompetitorSchemaResult> {
  // Check cache first
  const cached = readCache(domain);
  if (cached) {
    log.info({ domain }, 'Using cached competitor schema data (24h TTL)');
    return cached;
  }

  log.info({ domain, maxPages }, 'Crawling competitor schemas');

  // Normalize domain
  const cleanDomain = domain.replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/+$/, '');
  const baseUrl = `https://${cleanDomain}`;

  // Collect page URLs: start with homepage, then try sitemap
  const pageUrls = new Set<string>([baseUrl, `${baseUrl}/`]);

  // Try fetching sitemap.xml
  const sitemapHtml = await fetchWithTimeout(`${baseUrl}/sitemap.xml`, FETCH_TIMEOUT_MS);
  if (sitemapHtml) {
    const sitemapUrls = extractUrlsFromSitemap(sitemapHtml, cleanDomain, maxPages);
    for (const u of sitemapUrls) pageUrls.add(u);
  }

  // Deduplicate and limit to maxPages
  const urlList = [...pageUrls].slice(0, maxPages);

  // Fetch all pages with rate limiting
  const fetchResults = await fetchPagesWithRateLimit(urlList, MAX_CONCURRENT, DELAY_MS, FETCH_TIMEOUT_MS);

  // Extract schema data from each page
  const pages: CompetitorSchemaResult['pages'] = [];
  const typeFrequency: Record<string, number> = {};
  const allTypesSet = new Set<string>();

  for (const { url, html } of fetchResults) {
    if (!html) {
      pages.push({ url, schemaTypes: [], schemaCount: 0 });
      continue;
    }

    const { types, count } = extractJsonLdFromHtml(html);
    pages.push({ url, schemaTypes: types, schemaCount: count });

    for (const t of types) {
      allTypesSet.add(t);
      typeFrequency[t] = (typeFrequency[t] || 0) + 1;
    }
  }

  const result: CompetitorSchemaResult = {
    domain: cleanDomain,
    crawledAt: new Date().toISOString(),
    pages,
    allTypes: [...allTypesSet].sort(),
    typeFrequency,
  };

  // Cache result
  writeCache(cleanDomain, result);
  log.info({ domain: cleanDomain, pagesCrawled: pages.length, typesFound: allTypesSet.size }, 'Competitor schema crawl complete');

  return result;
}

/**
 * Compare our site's schema types against a competitor's crawl result.
 */
export function compareSchemas(ours: string[], theirs: CompetitorSchemaResult): SchemaComparison {
  const ourSet = new Set(ours);
  const theirSet = new Set(theirs.allTypes);

  const typesTheyHaveWeNot = [...theirSet].filter(t => !ourSet.has(t)).sort();
  const typesWeHaveTheyNot = [...ourSet].filter(t => !theirSet.has(t)).sort();
  const sharedTypes = [...ourSet].filter(t => theirSet.has(t)).sort();

  const theirPagesWithSchema = theirs.pages.filter(p => p.schemaCount > 0).length;
  const theirCoverage = theirs.pages.length > 0 ? Math.round((theirPagesWithSchema / theirs.pages.length) * 100) : 0;

  // ourCoverage is calculated externally and passed as 0 here — the route handler fills it in
  return {
    competitorDomain: theirs.domain,
    typesTheyHaveWeNot,
    typesWeHaveTheyNot,
    sharedTypes,
    ourCoverage: 0,
    theirCoverage,
  };
}
