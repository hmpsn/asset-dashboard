import { listPages, filterPublishedPages, discoverCmsUrls, buildStaticPathSet } from './webflow.js';

const WEBFLOW_API = 'https://api.webflow.com/v2';

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
}

async function getSiteSubdomain(siteId: string, token: string): Promise<string | null> {
  const res = await fetch(`${WEBFLOW_API}/sites/${siteId}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) return null;
  const data = await res.json() as { shortName?: string };
  return data.shortName || null;
}

async function fetchPublishedHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}

function extractLinks(html: string): Array<{ href: string; text: string }> {
  const regex = /<a\s[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const links: Array<{ href: string; text: string }> = [];
  let match;
  while ((match = regex.exec(html)) !== null) {
    const href = match[1].trim();
    const text = match[2].replace(/<[^>]*>/g, '').trim().slice(0, 100);
    if (href && !href.startsWith('mailto:') && !href.startsWith('tel:') && !href.startsWith('javascript:')) {
      links.push({ href, text });
    }
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

export async function checkSiteLinks(siteId: string, tokenOverride?: string): Promise<LinkCheckResult> {
  const token = tokenOverride || process.env.WEBFLOW_API_TOKEN || '';
  const subdomain = await getSiteSubdomain(siteId, token);
  const baseUrl = subdomain ? `https://${subdomain}.webflow.io` : '';
  if (!baseUrl) {
    return { totalLinks: 0, deadLinks: [], redirects: [], healthy: 0, checkedAt: new Date().toISOString() };
  }

  const allPages = await listPages(siteId, tokenOverride);
  const pages = filterPublishedPages(allPages);
  console.log(`Link checker: scanning ${pages.length} published pages on ${baseUrl} (filtered out ${allPages.length - pages.length})`);

  // Collect all links from all pages
  const allLinks: Array<{ href: string; text: string; page: string; pageSlug: string }> = [];
  const batch = 5;
  for (let i = 0; i < pages.length; i += batch) {
    const chunk = pages.slice(i, i + batch);
    const htmls = await Promise.all(
      chunk.map(p => {
        const url = p.slug ? `${baseUrl}/${p.slug}` : baseUrl;
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
    console.log(`Link checker: also scanning ${cmsUrls.length} CMS pages for links`);
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

  console.log(`Link checker: found ${urlMap.size} unique URLs from ${allLinks.length} total links`);

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

  console.log(`Link checker: ${healthy} healthy, ${deadLinks.length} dead, ${redirects.length} redirects`);

  return {
    totalLinks: allLinks.length,
    deadLinks,
    redirects,
    healthy,
    checkedAt: new Date().toISOString(),
  };
}
