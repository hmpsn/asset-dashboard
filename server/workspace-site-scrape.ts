import type { Workspace } from './workspaces.js';
import type { ScrapedPage } from './web-scraper.js';
import type * as WebScraper from './web-scraper.js';
import { isProgrammingError } from './errors.js';
import { resolvePagePath } from './helpers.js';
import { createLogger } from './logger.js';
import { resolveBaseUrl } from './url-helpers.js';
import { discoverSitemapUrls } from './webflow.js';
import { getWorkspacePages } from './workspace-data.js';
import { getTokenForSite } from './workspaces.js';

const log = createLogger('workspace-site-scrape');

export async function scrapeWorkspaceSite(ws: Workspace): Promise<{ scraped: ScrapedPage[]; pagesSummary: string }> {
  const { scrapeUrls }: typeof WebScraper = await import('./web-scraper.js'); // dynamic-import-ok

  const token = getTokenForSite(ws.webflowSiteId!) || undefined;
  const baseUrl = await resolveBaseUrl({ liveDomain: ws.liveDomain, webflowSiteId: ws.webflowSiteId! }, token);
  if (!baseUrl) throw new Error('Could not determine site URL');

  const published = await getWorkspacePages(ws.id, ws.webflowSiteId!);

  const priorityPatterns = [
    /^\/?$/, /about/i, /who-we-are/i, /our-story/i, /team/i,
    /service/i, /solution/i, /what-we-do/i, /offer/i,
    /work/i, /portfolio/i, /case-stud/i, /project/i, /client/i,
    /contact/i, /location/i, /blog/i, /insight/i, /resource/i,
  ];

  const prioritized: string[] = [];
  const rest: string[] = [];

  for (const p of published) {
    const pagePath = resolvePagePath(p);
    const url = baseUrl + pagePath;
    if (priorityPatterns.some(pat => pat.test(pagePath))) prioritized.push(url);
    else rest.push(url);
  }

  try {
    const sitemapUrls = await discoverSitemapUrls(baseUrl);
    for (const url of sitemapUrls) {
      try {
        const pagePath = new URL(url).pathname;
        if (!prioritized.includes(url) && !rest.includes(url)) {
          if (priorityPatterns.some(pat => pat.test(pagePath))) prioritized.push(url);
          else rest.push(url);
        }
        // url-fetch-ok: sitemap entries can contain malformed URLs; skip invalid entries.
      } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'workspace-site-scrape: programming error'); /* skip */ }
    }
    // url-fetch-ok: sitemap discovery is best-effort external IO and may fail without blocking scrape.
  } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'workspace-site-scrape: programming error'); /* sitemap unavailable */ }

  const urlsToScrape = [...prioritized.slice(0, 12), ...rest.slice(0, 3)];
  if (urlsToScrape.length === 0) throw new Error('No pages found to scrape');

  const scraped = await scrapeUrls(urlsToScrape, 3);
  if (scraped.length === 0) throw new Error('Could not scrape any pages');

  const pagesSummary = scraped.map(p => {
    const headingsStr = p.headings.slice(0, 10).map(h => `${'#'.repeat(h.level)} ${h.text}`).join('\n');
    return `--- PAGE: ${p.url} ---\nTitle: ${p.title}\nDescription: ${p.metaDescription}\nHeadings:\n${headingsStr}\nContent excerpt:\n${p.bodyText.slice(0, 1500)}`;
  }).join('\n\n');

  return { scraped, pagesSummary };
}
