/**
 * Redirect Scanner — detects redirect chains, 404s needing redirects,
 * and provides a comprehensive redirect audit for a Webflow site.
 */

import { discoverCmsUrls, buildStaticPathSet } from './webflow.js';
import { resolvePagePath } from './helpers.js';
import { createLogger } from './logger.js';
import { getWorkspacePages } from './workspace-data.js';
import { listWorkspaces, getWorkspace } from './workspaces.js';
import { isProgrammingError } from './errors.js';
import { resolveBaseUrl } from './url-helpers.js';

const log = createLogger('redirect-scanner');

export interface RedirectHop {
  url: string;
  status: number;
}

export interface RedirectChain {
  originalUrl: string;
  hops: RedirectHop[];
  finalUrl: string;
  totalHops: number;
  isLoop: boolean;
  foundOn: string[];         // pages linking to this URL
  type: 'internal' | 'external';
}

export interface OrphanRedirect {
  fromUrl: string;
  toUrl: string;
  status: number;
  issue: string;             // e.g. "destination 404", "chain", "self-redirect"
}

export interface PageStatus {
  url: string;
  path: string;
  title: string;
  status: number | 'error';
  statusText: string;
  redirectsTo?: string;
  recommendedTarget?: string;
  recommendedReason?: string;
  source: 'static' | 'cms' | 'gsc';
}

export interface RedirectScanResult {
  chains: RedirectChain[];
  pageStatuses: PageStatus[];
  summary: {
    totalPages: number;
    healthy: number;
    redirecting: number;
    notFound: number;
    errors: number;
    chainsDetected: number;
    longestChain: number;
  };
  scannedAt: string;
}

async function traceRedirects(url: string, maxHops = 10): Promise<{ hops: RedirectHop[]; finalUrl: string; finalStatus: number; isLoop: boolean }> {
  const hops: RedirectHop[] = [];
  const visited = new Set<string>();
  let currentUrl = url;
  let isLoop = false;

  for (let i = 0; i < maxHops; i++) {
    if (visited.has(currentUrl)) {
      isLoop = true;
      break;
    }
    visited.add(currentUrl);

    try {
      const res = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': 'AssetDashboard-RedirectScanner/1.0' },
        signal: AbortSignal.timeout(10000),
      });

      const status = res.status;
      hops.push({ url: currentUrl, status });

      if (status >= 300 && status < 400) {
        const location = res.headers.get('location');
        if (!location) break;
        // Resolve relative redirects
        try {
          currentUrl = new URL(location, currentUrl).toString();
        } catch { // catch-ok — malformed redirect URL from external server is expected degradation
          break;
        }
      } else {
        // Not a redirect — we've reached the final destination
        break;
      }
    } catch (err) {
      log.debug({ err }, 'redirect-scanner/traceRedirects: network error following redirect chain');
      hops.push({ url: currentUrl, status: 0 });
      break;
    }
  }

  const finalHop = hops[hops.length - 1];
  return {
    hops,
    finalUrl: finalHop?.url || url,
    finalStatus: finalHop?.status || 0,
    isLoop,
  };
}

async function checkPageStatus(url: string): Promise<{ status: number | 'error'; statusText: string; redirectsTo?: string }> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': 'AssetDashboard-RedirectScanner/1.0' },
      signal: AbortSignal.timeout(10000),
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      let resolvedLocation = location || undefined;
      if (location) {
        try { resolvedLocation = new URL(location, url).toString(); } catch { /* keep as-is */ }
      }
      return { status: res.status, statusText: res.statusText, redirectsTo: resolvedLocation };
    }

    return { status: res.status, statusText: res.statusText };
  } catch (err) {
    return { status: 'error', statusText: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Match a broken/redirecting path against healthy pages by slug keyword overlap.
 * Returns the best-matching healthy page, or null if no reasonable match.
 */
function findBestMatch(brokenPath: string, healthyPages: PageStatus[]): PageStatus | null {
  if (healthyPages.length === 0) return null;

  // Tokenize path into meaningful words (strip leading slash, split on / and -)
  const tokenize = (p: string) =>
    p.replace(/^\//, '').toLowerCase().split(/[-_/]+/).filter(t => t.length > 1);

  const brokenTokens = tokenize(brokenPath);
  if (brokenTokens.length === 0) return null;

  let bestScore = 0;
  let bestPage: PageStatus | null = null;

  for (const page of healthyPages) {
    if (page.path === '/' && brokenPath !== '/') continue; // don't recommend homepage for everything

    const pageTokens = tokenize(page.path);
    const titleTokens = page.title.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    const allPageTokens = [...new Set([...pageTokens, ...titleTokens])];

    // Score: count overlapping tokens
    let score = 0;
    for (const bt of brokenTokens) {
      for (const pt of allPageTokens) {
        if (bt === pt) { score += 3; break; }
        if (pt.includes(bt) || bt.includes(pt)) { score += 1.5; break; }
      }
    }

    // Bonus for matching path depth
    const brokenDepth = brokenPath.split('/').filter(Boolean).length;
    const pageDepth = page.path.split('/').filter(Boolean).length;
    if (brokenDepth === pageDepth) score += 0.5;

    // Bonus for shared path prefix
    if (brokenPath.length > 1 && page.path.startsWith(brokenPath.split('/').slice(0, 2).join('/'))) {
      score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestPage = page;
    }
  }

  // Only return if there's a meaningful match (at least one full token match)
  return bestScore >= 3 ? bestPage : null;
}

export interface GscGhostUrl {
  url: string;
  path: string;
  clicks: number;
  impressions: number;
}

export async function scanRedirects(siteId: string, workspaceId?: string, liveDomain?: string, gscGhostUrls?: GscGhostUrl[]): Promise<RedirectScanResult> {
  const wsId = workspaceId || listWorkspaces().find(w => w.webflowSiteId === siteId)?.id;
  const ws = wsId ? getWorkspace(wsId) : undefined;
  const token = ws?.webflowToken || process.env.WEBFLOW_API_TOKEN || '';
  const baseUrl = await resolveBaseUrl({ liveDomain, webflowSiteId: siteId }, token || undefined);
  log.info(`Using baseUrl: ${baseUrl} (liveDomain=${liveDomain || '(none)'})`);
  if (!baseUrl) {
    return {
      chains: [],
      pageStatuses: [],
      summary: { totalPages: 0, healthy: 0, redirecting: 0, notFound: 0, errors: 0, chainsDetected: 0, longestChain: 0 },
      scannedAt: new Date().toISOString(),
    };
  }

  // 1. Gather all known pages
  const published = wsId ? await getWorkspacePages(wsId, siteId) : [];
  log.info(`Redirect scanner: checking ${published.length} static pages on ${baseUrl}`);

  const pageUrls: Array<{ url: string; path: string; title: string; source: 'static' | 'cms' | 'gsc' }> = published.map(p => {
    // Use publishedPath for full URL (handles nested pages like /about/team)
    const pagePath = resolvePagePath(p);
    return {
      url: pagePath ? `${baseUrl}${pagePath}` : baseUrl,
      path: pagePath || '/',
      title: p.title || p.slug || 'Home',
      source: 'static' as const,
    };
  });

  // Also discover CMS pages
  const staticPaths = buildStaticPathSet(published);
  try {
    const { cmsUrls } = await discoverCmsUrls(baseUrl, staticPaths, 50);
    for (const cms of cmsUrls) {
      pageUrls.push({
        url: cms.url,
        path: cms.path,
        title: cms.pageName,
        source: 'cms',
      });
    }
    if (cmsUrls.length > 0) {
      log.info(`Redirect scanner: also checking ${cmsUrls.length} CMS pages`);
    }
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err }, 'redirect-scanner: programming error');
    log.info('Redirect scanner: CMS discovery skipped');
  }

  // Also add GSC ghost URLs — pages Google knows about that aren't in our page list
  if (gscGhostUrls && gscGhostUrls.length > 0) {
    const knownPaths = new Set(pageUrls.map(p => p.path.toLowerCase()));
    let added = 0;
    for (const ghost of gscGhostUrls) {
      if (!knownPaths.has(ghost.path.toLowerCase())) {
        const lastSegment = ghost.path.replace(/^\//, '').split('/').pop() || '';
        const pageName = lastSegment.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || ghost.path;
        pageUrls.push({
          url: ghost.url,
          path: ghost.path,
          title: `[GSC] ${pageName}`,
          source: 'gsc' as const,
        });
        knownPaths.add(ghost.path.toLowerCase());
        added++;
      }
    }
    if (added > 0) {
      log.info(`Redirect scanner: added ${added} GSC ghost URLs (pages Google indexes that aren't on the site)`);
    }
  }

  // 2. Check each page's status
  const pageStatuses: PageStatus[] = [];
  const redirectingUrls: string[] = [];
  const batchSize = 8;

  for (let i = 0; i < pageUrls.length; i += batchSize) {
    const chunk = pageUrls.slice(i, i + batchSize);
    const results = await Promise.all(chunk.map(p => checkPageStatus(p.url)));
    for (let j = 0; j < chunk.length; j++) {
      const r = results[j];
      pageStatuses.push({
        url: chunk[j].url,
        path: chunk[j].path,
        title: chunk[j].title,
        status: r.status,
        statusText: r.statusText,
        redirectsTo: r.redirectsTo,
        source: chunk[j].source,
      });
      if (typeof r.status === 'number' && r.status >= 300 && r.status < 400) {
        redirectingUrls.push(chunk[j].url);
      }
    }
  }

  // 3. Trace redirect chains for any redirecting pages
  const chains: RedirectChain[] = [];

  for (let i = 0; i < redirectingUrls.length; i += batchSize) {
    const chunk = redirectingUrls.slice(i, i + batchSize);
    const traces = await Promise.all(chunk.map(url => traceRedirects(url)));
    for (let j = 0; j < chunk.length; j++) {
      const trace = traces[j];
      if (trace.hops.length > 1) {
        const isInternal = chunk[j].startsWith(baseUrl);
        chains.push({
          originalUrl: chunk[j],
          hops: trace.hops,
          finalUrl: trace.finalUrl,
          totalHops: trace.hops.length - 1,  // don't count the final destination as a hop
          isLoop: trace.isLoop,
          foundOn: [pageStatuses.find(p => p.url === chunk[j])?.title || ''],
          type: isInternal ? 'internal' : 'external',
        });
      }
    }
  }

  // 4. Also scan common paths that might 404 and need redirects
  const commonPaths = ['/blog', '/about', '/contact', '/services', '/portfolio', '/work', '/team', '/faq', '/pricing'];
  const extraChecks = commonPaths
    .filter(p => !pageUrls.some(pu => pu.path === p))
    .map(p => ({ url: `${baseUrl}${p}`, path: p }));

  for (const extra of extraChecks) {
    const r = await checkPageStatus(extra.url);
    // Only include if it's a redirect (suggesting it once existed) or soft 404
    if (typeof r.status === 'number' && (r.status >= 300 && r.status < 400)) {
      pageStatuses.push({
        url: extra.url,
        path: extra.path,
        title: `(unlinked) ${extra.path}`,
        status: r.status,
        statusText: r.statusText,
        redirectsTo: r.redirectsTo,
        source: 'static',
      });
    }
  }

  // 5. Compute summary
  let healthy = 0, redirecting = 0, notFound = 0, errors = 0;
  for (const ps of pageStatuses) {
    if (ps.status === 'error') errors++;
    else if (ps.status >= 400 && ps.status < 500) notFound++;
    else if (ps.status >= 300 && ps.status < 400) redirecting++;
    else if (ps.status >= 200 && ps.status < 300) healthy++;
    else errors++;
  }

  const longestChain = chains.reduce((max, c) => Math.max(max, c.totalHops), 0);

  // 6. Generate redirect target recommendations for redirecting and 404 pages
  const healthyPages = pageStatuses.filter(p => typeof p.status === 'number' && p.status >= 200 && p.status < 300);
  for (const ps of pageStatuses) {
    if (typeof ps.status !== 'number') continue;
    if (ps.status >= 300 && ps.status < 400 && ps.redirectsTo) {
      // Already redirecting — check if destination is healthy
      const destPath = (() => { try { return new URL(ps.redirectsTo).pathname; } catch (err) { return null; } })();
      if (destPath) {
        const destPage = pageStatuses.find(p => p.path === destPath);
        if (destPage && (destPage.status === 'error' || (typeof destPage.status === 'number' && destPage.status >= 400))) {
          // Destination is broken — recommend a better target
          const match = findBestMatch(ps.path, healthyPages);
          if (match) {
            ps.recommendedTarget = match.path;
            ps.recommendedReason = `Current destination ${destPath} returns ${destPage.status}. Suggested: ${match.path} (${match.title})`;
          }
        }
      }
    } else if (ps.status >= 400 && ps.status < 500) {
      // 404 — recommend a redirect target
      const match = findBestMatch(ps.path, healthyPages);
      if (match) {
        ps.recommendedTarget = match.path;
        ps.recommendedReason = `Page not found. Best match: ${match.title}`;
      }
    }
  }

  log.info(`Redirect scanner: ${healthy} healthy, ${redirecting} redirecting, ${notFound} not found, ${chains.length} chains`);

  return {
    chains,
    pageStatuses,
    summary: {
      totalPages: pageStatuses.length,
      healthy,
      redirecting,
      notFound,
      errors,
      chainsDetected: chains.length,
      longestChain,
    },
    scannedAt: new Date().toISOString(),
  };
}
