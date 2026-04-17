import { discoverCmsUrls, buildStaticPathSet } from './webflow.js';
import { resolvePagePath } from './helpers.js';
import { createLogger } from './logger.js';
import { getWorkspacePages } from './workspace-data.js';
import { listWorkspaces, getWorkspace } from './workspaces.js';
import { webflowFetch } from './webflow-client.js';
import { fetchPublishedHtml } from './helpers.js';

const log = createLogger('link-checker');

export interface DeadLink {
  url: string;
  status: number | 'timeout' | 'error';
  statusText: string;
  foundOn: string;       // page title
  foundOnSlug: string;
  anchorText: string;
  type: 'internal' | 'external';
}

export interface LinkCheckResult {
  totalLinks: number;
  deadLinks: DeadLink[];
  redirects: DeadLink[];
  healthy: number;
  checkedAt: string;
  crawledDomain?: string;
}

export interface SiteDomainInfo {
  staging: string;           // e.g. https://mysite.webflow.io
  customDomains: string[];   // e.g. ["https://example.com", "https://www.example.com"]
  defaultDomain: string;     // custom domain if available, otherwise staging
}

export async function getSiteDomains(siteId: string, token: string): Promise<SiteDomainInfo | null> {
  if (!token) return null;
  const res = await webflowFetch(`/sites/${siteId}`, {}, token);
  if (!res.ok) return null;
  const data = await res.json() as {
    shortName?: string;
    customDomains?: Array<{ url?: string }>;
  };
  if (!data.shortName) return null;

  const staging = `https://${data.shortName}.webflow.io`;
  const customDomains = (data.customDomains || [])
    .map(d => d.url ? (d.url.startsWith('http') ? d.url : `https://${d.url}`) : '')
    .filter(Boolean);

  return {
    staging,
    customDomains,
    defaultDomain: customDomains[0] || staging,
  };
}

export function isCheckableUrl(href: string): boolean {
  return !!href
    && !href.startsWith('mailto:')
    && !href.startsWith('tel:')
    && !href.startsWith('javascript:')
    && !href.startsWith('#')
    && !href.includes('/cdn-cgi/'); // Cloudflare email/phone protection URLs
}

function extractLinks(html: string): Array<{ href: string; text: string }> {
  const links: Array<{ href: string; text: string }> = [];
  const seen = new Set<string>();

  const addLink = (href: string, text: string) => {
    const trimmed = href.trim();
    if (isCheckableUrl(trimmed) && !seen.has(trimmed)) {
      seen.add(trimmed);
      links.push({ href: trimmed, text: text.slice(0, 100) });
    }
  };

  // 1. Standard <a href="..."> links
  const aRegex = /<a\s[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = aRegex.exec(html)) !== null) {
    addLink(match[1], match[2].replace(/<[^>]*>/g, '').trim());
  }

  // 2. onclick navigation: window.location, window.location.href, location.href, window.open
  const onclickRegex = /onclick=["'][^"']*(?:window\.(?:location(?:\.href)?|open)\s*[=(]\s*['"])([^'"]+)['"]/gi;
  while ((match = onclickRegex.exec(html)) !== null) {
    // Extract surrounding element text for context
    const pos = match.index;
    const surrounding = html.slice(Math.max(0, pos - 200), pos + match[0].length + 200);
    const textMatch = surrounding.match(/>([^<]{1,100})</);
    addLink(match[1], textMatch ? textMatch[1].trim() : '[button/onclick]');
  }

  // 3. <form action="..."> URLs
  const formRegex = /<form\s[^>]*action=["']([^"'#][^"']*)["']/gi;
  while ((match = formRegex.exec(html)) !== null) {
    addLink(match[1], '[form action]');
  }

  return links;
}

async function checkUrl(url: string, timeout = 10000): Promise<{ status: number | 'timeout' | 'error'; statusText: string; redirected: boolean; finalUrl?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'AssetDashboard-LinkChecker/1.0' },
    });
    clearTimeout(timer);
    // Some servers block HEAD, retry with GET
    if (res.status === 405 || res.status === 403) {
      const getRes = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(timeout),
        redirect: 'follow',
        headers: { 'User-Agent': 'AssetDashboard-LinkChecker/1.0' },
      });
      return {
        status: getRes.status,
        statusText: getRes.statusText,
        redirected: getRes.redirected,
        finalUrl: getRes.url !== url ? getRes.url : undefined,
      };
    }
    return {
      status: res.status,
      statusText: res.statusText,
      redirected: res.redirected,
      finalUrl: res.url !== url ? res.url : undefined,
    };
  } catch (err: unknown) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') {
      return { status: 'timeout', statusText: 'Request timed out', redirected: false };
    }
    return { status: 'error', statusText: err instanceof Error ? err.message : 'Unknown error', redirected: false };
  }
}

export async function checkSiteLinks(siteId: string, workspaceId?: string, domain?: string): Promise<LinkCheckResult> {
  const wsId = workspaceId || listWorkspaces().find(w => w.webflowSiteId === siteId)?.id;
  const ws = wsId ? getWorkspace(wsId) : undefined;
  const token = ws?.webflowToken || process.env.WEBFLOW_API_TOKEN || '';
  const domains = await getSiteDomains(siteId, token);
  if (!domains) {
    return { totalLinks: 0, deadLinks: [], redirects: [], healthy: 0, checkedAt: new Date().toISOString() };
  }
  // Use provided domain, or default (custom domain if available, otherwise staging)
  const baseUrl = (domain || domains.defaultDomain).replace(/\/$/, '');

  const pages = wsId ? await getWorkspacePages(wsId, siteId) : [];
  log.info(`Link checker: scanning ${pages.length} published pages on ${baseUrl}`);

  // Collect all links from all pages
  const allLinks: Array<{ href: string; text: string; page: string; pageSlug: string }> = [];
  const batch = 5;
  for (let i = 0; i < pages.length; i += batch) {
    const chunk = pages.slice(i, i + batch);
    const htmls = await Promise.all(
      chunk.map(p => {
        // Use publishedPath for full URL (handles nested pages like /about/team)
        const pagePath = resolvePagePath(p);
        const url = pagePath ? `${baseUrl}${pagePath}` : baseUrl;
        return fetchPublishedHtml(url);
      })
    );
    for (let j = 0; j < chunk.length; j++) {
      if (!htmls[j]) continue;
      const links = extractLinks(htmls[j]!);
      for (const link of links) {
        allLinks.push({ href: link.href, text: link.text, page: chunk[j].title, pageSlug: chunk[j].slug });
      }
    }
  }

  // Deduplicate by URL — keep track of which pages reference each URL
  const urlMap = new Map<string, Array<{ page: string; pageSlug: string; text: string }>>();
  for (const link of allLinks) {
    // Resolve relative URLs
    let absoluteUrl = link.href;
    if (absoluteUrl.startsWith('/')) {
      absoluteUrl = `${baseUrl}${absoluteUrl}`;
    } else if (!absoluteUrl.startsWith('http')) {
      absoluteUrl = `${baseUrl}/${absoluteUrl}`;
    }
    const existing = urlMap.get(absoluteUrl) || [];
    existing.push({ page: link.page, pageSlug: link.pageSlug, text: link.text });
    urlMap.set(absoluteUrl, existing);
  }

  // ── Also scan CMS/collection pages discovered via sitemap ──
  const staticPaths = buildStaticPathSet(pages);
  const { cmsUrls } = await discoverCmsUrls(baseUrl, staticPaths, 30);
  if (cmsUrls.length > 0) {
    log.info(`Link checker: also scanning ${cmsUrls.length} CMS pages for links`);
    for (let i = 0; i < cmsUrls.length; i += batch) {
      const chunk = cmsUrls.slice(i, i + batch);
      const htmls = await Promise.all(chunk.map(item => fetchPublishedHtml(item.url)));
      for (let j = 0; j < chunk.length; j++) {
        if (!htmls[j]) continue;
        const links = extractLinks(htmls[j]!);
        for (const link of links) {
          const cmsPageSlug = chunk[j].path.replace(/^\//, '');
          allLinks.push({ href: link.href, text: link.text, page: chunk[j].pageName, pageSlug: cmsPageSlug });
          // Add to urlMap for deduplication
          let absoluteUrl = link.href;
          if (absoluteUrl.startsWith('/')) absoluteUrl = `${baseUrl}${absoluteUrl}`;
          else if (!absoluteUrl.startsWith('http')) absoluteUrl = `${baseUrl}/${absoluteUrl}`;
          const existing = urlMap.get(absoluteUrl) || [];
          existing.push({ page: chunk[j].pageName, pageSlug: cmsPageSlug, text: link.text });
          urlMap.set(absoluteUrl, existing);
        }
      }
    }
  }

  log.info(`Link checker: found ${urlMap.size} unique URLs from ${allLinks.length} total links`);

  // Check all unique URLs in parallel batches
  const deadLinks: DeadLink[] = [];
  const redirects: DeadLink[] = [];
  let healthy = 0;
  const urls = Array.from(urlMap.entries());
  const checkBatch = 10;

  for (let i = 0; i < urls.length; i += checkBatch) {
    const chunk = urls.slice(i, i + checkBatch);
    const results = await Promise.all(
      chunk.map(([url]) => checkUrl(url))
    );

    for (let j = 0; j < chunk.length; j++) {
      const [url, refs] = chunk[j];
      const result = results[j];
      const isInternal = url.startsWith(baseUrl) || url.startsWith('/');
      const type = isInternal ? 'internal' : 'external';

      if (result.redirected) {
        for (const ref of refs) {
          redirects.push({
            url,
            status: typeof result.status === 'number' ? result.status : 301,
            statusText: `Redirects to ${result.finalUrl || 'unknown'}`,
            foundOn: ref.page,
            foundOnSlug: ref.pageSlug,
            anchorText: ref.text,
            type,
          });
        }
      } else if (
        result.status === 'timeout' ||
        result.status === 'error' ||
        (typeof result.status === 'number' && result.status >= 400)
      ) {
        for (const ref of refs) {
          deadLinks.push({
            url,
            status: result.status,
            statusText: result.statusText,
            foundOn: ref.page,
            foundOnSlug: ref.pageSlug,
            anchorText: ref.text,
            type,
          });
        }
      } else {
        healthy++;
      }
    }
  }

  log.info(`Link checker: ${healthy} healthy, ${deadLinks.length} dead, ${redirects.length} redirects`);

  return {
    totalLinks: allLinks.length,
    deadLinks,
    redirects,
    healthy,
    checkedAt: new Date().toISOString(),
    crawledDomain: baseUrl,
  };
}
