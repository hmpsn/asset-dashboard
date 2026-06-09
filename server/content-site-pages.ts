import { isProgrammingError } from './errors.js';
import { normalizePageUrl, resolvePagePath } from './helpers.js';
import { createLogger } from './logger.js';
import { listPageKeywords } from './page-keywords.js';
import { discoverSitemapUrls, getSiteSubdomain } from './webflow.js';
import { getWorkspacePages } from './workspace-data.js';
import { getTokenForSite } from './workspaces.js';

const log = createLogger('content-site-pages');

export async function getAllSitePages(ws: { id: string; webflowSiteId?: string; liveDomain?: string }): Promise<string[]> {
  const pageMap = new Map<string, string>();

  const kwPages = listPageKeywords(ws.id);
  for (const p of kwPages) {
    const path = normalizePageUrl(p.pagePath);
    const label = p.primaryKeyword ? `${path} — targets: "${p.primaryKeyword}"` : path;
    pageMap.set(path.toLowerCase(), label);
  }

  if (ws.webflowSiteId) {
    try {
      const published = await getWorkspacePages(ws.id, ws.webflowSiteId);
      for (const p of published) {
        const pagePath = resolvePagePath(p);
        const key = pagePath.toLowerCase();
        if (!pageMap.has(key)) {
          const title = p.title || p.slug || 'Home';
          pageMap.set(key, `${pagePath} — "${title}"`);
        }
      }
    } catch (err) {
      if (isProgrammingError(err)) log.warn({ err }, 'content-site-pages: Webflow API unavailable');
    }
  }

  if (ws.webflowSiteId) {
    try {
      const token = getTokenForSite(ws.webflowSiteId) || undefined;
      const subdomain = await getSiteSubdomain(ws.webflowSiteId, token);
      const baseUrl = ws.liveDomain
        ? `https://${ws.liveDomain}`
        : subdomain ? `https://${subdomain}.webflow.io` : '';
      if (baseUrl) {
        const sitemapUrls = await discoverSitemapUrls(baseUrl);
        for (const url of sitemapUrls) {
          try {
            const parsed = new URL(url);
            const pagePath = parsed.pathname === '/' ? '/' : parsed.pathname.replace(/\/$/, '');
            const key = pagePath.toLowerCase();
            if (!pageMap.has(key)) {
              const slug = pagePath.split('/').pop() || '';
              const title = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
              pageMap.set(key, `${pagePath} — "${title}"`);
            }
          } catch (err) {
            log.debug({ err, url }, 'Skipping malformed sitemap URL');
          }
        }
      }
    } catch (err) {
      log.debug({ err }, 'content-site-pages: sitemap unavailable');
    } // url-fetch-ok
  }

  return Array.from(pageMap.values());
}
