/**
 * Web Scraper Utility — extracts structured content from URLs.
 * Used by content briefs (reference URLs), SERP scraping, and style examples.
 */

import { STUDIO_BOT_UA } from './constants.js';
import { isProgrammingError } from './errors.js';
import { createLogger } from './logger.js';


const log = createLogger('web-scraper');
export interface ScrapedPage {
  url: string;
  title: string;
  metaDescription: string;
  headings: { level: number; text: string }[];
  bodyText: string;        // plain text, truncated
  wordCount: number;
  fetchedAt: string;
}

export interface SerpResult {
  position: number;
  title: string;
  url: string;
  snippet: string;
}

export interface SerpData {
  query: string;
  peopleAlsoAsk: string[];
  organicResults: SerpResult[];
  fetchedAt: string;
}

const SCRAPE_TIMEOUT = 8000;

/**
 * Scrape a single URL and extract structured content.
 * Returns null on failure (timeout, blocked, etc.).
 */
export async function scrapeUrl(url: string): Promise<ScrapedPage | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT);

    const res = await fetch(url, {
      headers: {
        'User-Agent': STUDIO_BOT_UA,
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const html = await res.text();
    return parseHtml(url, html);
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err }, 'web-scraper/scrapeUrl: programming error');
    return null;
  }
}

/**
 * Scrape multiple URLs in parallel with concurrency limit.
 */
export async function scrapeUrls(urls: string[], concurrency = 3): Promise<ScrapedPage[]> {
  const results: ScrapedPage[] = [];
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const scraped = await Promise.all(batch.map(u => scrapeUrl(u)));
    for (const s of scraped) {
      if (s) results.push(s);
    }
  }
  return results;
}

/**
 * Parse raw HTML into structured ScrapedPage.
 */
function parseHtml(url: string, html: string): ScrapedPage {
  // Extract <title>
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : '';

  // Extract meta description
  const metaMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["'][^>]*>/i)
    || html.match(/<meta[^>]*content=["']([\s\S]*?)["'][^>]*name=["']description["'][^>]*>/i);
  const metaDescription = metaMatch ? decodeEntities(metaMatch[1].trim()) : '';

  // Extract headings (h1-h6)
  const headings: { level: number; text: string }[] = [];
  const headingRegex = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let hMatch;
  while ((hMatch = headingRegex.exec(html)) !== null) {
    const text = stripTags(hMatch[2]).trim();
    if (text) headings.push({ level: parseInt(hMatch[1]), text });
  }

  // Extract body text
  let body = html;
  // Remove script, style, nav, header, footer
  body = body.replace(/<(script|style|nav|header|footer|noscript|svg|iframe)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  // Remove all tags
  body = stripTags(body);
  // Normalize whitespace
  body = body.replace(/\s+/g, ' ').trim();

  const wordCount = body.split(/\s+/).filter(w => w.length > 0).length;

  return {
    url,
    title,
    metaDescription,
    headings: headings.slice(0, 30),
    bodyText: body.slice(0, 3000),
    wordCount,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Attempt to scrape Google SERP for a query.
 * Returns null if blocked or fails — this is best-effort.
 */
export async function scrapeSerpData(query: string): Promise<SerpData | null> {
  try {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://www.google.com/search?q=${encodedQuery}&hl=en&gl=us&num=10`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT);

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const html = await res.text();

    // Check if we got a CAPTCHA/block
    if (html.includes('unusual traffic') || html.includes('CAPTCHA') || html.length < 5000) {
      return null;
    }

    return parseSerpHtml(query, html);
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err }, 'web-scraper/scrapeSerpData: programming error');
    return null;
  }
}

/**
 * Parse Google SERP HTML to extract PAA and organic results.
 */
function parseSerpHtml(query: string, html: string): SerpData {
  const peopleAlsoAsk: string[] = [];
  const organicResults: SerpResult[] = [];

  // Extract People Also Ask questions
  // PAA questions are in data-q attributes or specific div structures
  const paaRegex = /data-q="([^"]+)"/g;
  let paaMatch;
  while ((paaMatch = paaRegex.exec(html)) !== null) {
    const q = decodeEntities(paaMatch[1]).trim();
    if (q && q.length > 10 && q.length < 200 && !peopleAlsoAsk.includes(q)) {
      peopleAlsoAsk.push(q);
    }
  }

  // Fallback: extract from aria-label patterns common in PAA
  if (peopleAlsoAsk.length === 0) {
    const ariaRegex = /aria-label="([^"]*\?[^"]*)"/g;
    let ariaMatch;
    while ((ariaMatch = ariaRegex.exec(html)) !== null) {
      const q = decodeEntities(ariaMatch[1]).trim();
      if (q && q.length > 15 && q.length < 200 && q.includes('?') && !peopleAlsoAsk.includes(q)) {
        peopleAlsoAsk.push(q);
      }
    }
  }

  // Extract organic results (simplified — look for <h3> tags within result blocks)
  const resultBlockRegex = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/gi;
  let resultMatch;
  let pos = 0;
  while ((resultMatch = resultBlockRegex.exec(html)) !== null && pos < 10) {
    const resultUrl = resultMatch[1];
    const resultTitle = stripTags(resultMatch[2]).trim();
    // Skip Google's own URLs
    if (resultUrl.includes('google.com') || resultUrl.includes('youtube.com') || !resultTitle) continue;
    pos++;
    organicResults.push({
      position: pos,
      title: resultTitle,
      url: resultUrl,
      snippet: '',
    });
  }

  return {
    query,
    peopleAlsoAsk: peopleAlsoAsk.slice(0, 8),
    organicResults: organicResults.slice(0, 5),
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Build a condensed summary of scraped reference pages for AI prompts.
 */
export function buildReferenceContext(pages: ScrapedPage[]): string {
  if (pages.length === 0) return '';

  const blocks = pages.map((p, i) => {
    const headingStr = p.headings.slice(0, 10)
      .map(h => `${'  '.repeat(h.level - 1)}${h.text}`)
      .join('\n');
    return `--- Reference ${i + 1}: ${p.title} (${p.url}) ---
Word count: ~${p.wordCount}
Content structure:
${headingStr}
Content excerpt: ${p.bodyText.slice(0, 800)}`;
  });

  return `\n\nREFERENCE CONTENT (analyze these for structure, tone, and topics — then differentiate and improve):\n${blocks.join('\n\n')}`;
}

/**
 * Build a style example block from top-performing site pages.
 */
export function buildStyleExampleContext(pages: ScrapedPage[]): string {
  if (pages.length === 0) return '';

  const blocks = pages.map(p => {
    return `--- "${p.title}" (${p.url}, ~${p.wordCount} words) ---
${p.bodyText.slice(0, 600)}`;
  });

  return `\n\nTOP-PERFORMING CONTENT FROM THIS SITE (match this writing style, tone, and quality level):\n${blocks.join('\n\n')}`;
}

/**
 * Build a SERP intelligence block for content briefs.
 */
export function buildSerpContext(serp: SerpData): string {
  const parts: string[] = [];

  if (serp.peopleAlsoAsk.length > 0) {
    parts.push(`REAL "People Also Ask" questions from Google (use these EXACTLY — do NOT hallucinate different questions):\n${serp.peopleAlsoAsk.map((q, i) => `${i + 1}. ${q}`).join('\n')}`);
  }

  if (serp.organicResults.length > 0) {
    parts.push(`TOP RANKING PAGES for "${serp.query}":\n${serp.organicResults.map(r => `#${r.position}: "${r.title}" — ${r.url}`).join('\n')}`);
  }

  return parts.length > 0 ? `\n\n${parts.join('\n\n')}` : '';
}

// --- Helpers ---

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ');
}
