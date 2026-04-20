import { discoverCmsUrls, buildStaticPathSet } from './webflow.js';
import { getWorkspacePages } from './workspace-data.js';
import { checkSiteLinks } from './link-checker.js';
import type { DeadLink } from './link-checker.js';
import { listWorkspaces } from './workspaces.js';
import { extractMetaContent } from './seo-audit-html.js';
import { auditPage, isExcludedPage } from './audit-page.js';
import { resolvePagePath, fetchPublishedHtml } from './helpers.js';
export type { Severity, CheckCategory, SeoIssue, PageSeoResult } from './audit-page.js';
import type { SeoIssue, PageSeoResult } from './audit-page.js';
import { createLogger } from './logger.js';
import { getToken, webflowFetch } from './webflow-client.js';
import { runSiteWideChecks } from './seo-audit-site-checks.js';
import { generateAiRecommendations } from './seo-audit-ai-recs.js';

const log = createLogger('seo-audit');


export interface CwvMetricSummary {
  value: number | null;
  rating: 'good' | 'needs-improvement' | 'poor' | null;
}

export interface CwvStrategyResult {
  assessment: 'good' | 'needs-improvement' | 'poor' | 'no-data';
  fieldDataAvailable: boolean;
  lighthouseScore: number;
  metrics: {
    LCP: CwvMetricSummary;
    INP: CwvMetricSummary;
    CLS: CwvMetricSummary;
  };
}

export interface CwvSummary {
  mobile?: CwvStrategyResult;
  desktop?: CwvStrategyResult;
}

export interface SeoAuditResult {
  siteScore: number;
  totalPages: number;
  errors: number;
  warnings: number;
  infos: number;
  pages: PageSeoResult[];
  siteWideIssues: SeoIssue[];
  cwvSummary?: CwvSummary;
  deadLinkSummary?: { total: number; internal: number; external: number; redirects: number };
  deadLinkDetails?: DeadLink[];
}

interface PageMeta {
  id: string;
  title: string;
  slug: string;
  seo?: { title?: string; description?: string };
  openGraph?: { title?: string; description?: string; titleCopied?: boolean; descriptionCopied?: boolean };
}

export async function fetchPageMeta(pageId: string, tokenOverride?: string): Promise<PageMeta | null> {
  if (!tokenOverride && !getToken()) return null;
  try {
    const res = await webflowFetch(`/pages/${pageId}`, {}, tokenOverride);
    if (!res.ok) return null;
    return await res.json() as PageMeta;
  } catch (err) { /* network failure — expected */ return null; }
}


interface SiteInfo {
  subdomain: string | null;
  customDomain: string | null;
}

async function getSiteInfo(siteId: string, tokenOverride?: string): Promise<SiteInfo> {
  if (!tokenOverride && !getToken()) return { subdomain: null, customDomain: null };
  try {
    // Fetch site info for subdomain
    const siteRes = await webflowFetch(`/sites/${siteId}`, { signal: AbortSignal.timeout(5000) }, tokenOverride);
    let subdomain: string | null = null;
    if (siteRes.ok) {
      const siteData = await siteRes.json() as { shortName?: string };
      subdomain = siteData.shortName || null;
    }

    // Fetch custom domains from dedicated endpoint
    let customDomain: string | null = null;
    try {
      const domainRes = await webflowFetch(`/sites/${siteId}/custom_domains`, { signal: AbortSignal.timeout(5000) }, tokenOverride);
      if (domainRes.ok) {
        const domainData = await domainRes.json() as { customDomains?: { url?: string }[] };
        const domains = domainData.customDomains || [];
        if (domains.length > 0 && domains[0].url) {
          customDomain = domains[0].url;
        }
      }
    } catch (err) { /* custom domains fetch is best-effort */ }

    return { subdomain, customDomain };
  } catch (err) { /* network failure — expected */ return { subdomain: null, customDomain: null }; }
}

export async function runSeoAudit(siteId: string, tokenOverride?: string, workspaceId?: string, skipLinkCheck = false): Promise<SeoAuditResult> {
  const siteInfo = await getSiteInfo(siteId, tokenOverride);
  const baseUrl = siteInfo.subdomain ? `https://${siteInfo.subdomain}.webflow.io` : '';
  // Use custom domain for site-wide checks (robots.txt, sitemap) since webflow.io blocks crawlers by design
  const siteWideUrl = siteInfo.customDomain
    ? (siteInfo.customDomain.startsWith('http') ? siteInfo.customDomain : `https://${siteInfo.customDomain}`)
    : baseUrl;
  log.info(`SEO audit: subdomain=${siteInfo.subdomain}, baseUrl=${baseUrl}, siteWideUrl=${siteWideUrl}`);
  const wsId = workspaceId || listWorkspaces().find(w => w.webflowSiteId === siteId)?.id;
  if (!wsId) {
    // No workspace linked to this site — page-level SEO checks will be skipped.
    // All route callers pass a workspaceId or are covered by the listWorkspaces() fallback.
    // If this fires, the site has no linked workspace (e.g. a prospect/unlinked audit).
    log.warn({ siteId }, 'SEO audit: no workspace found for site — page-level checks skipped');
  }
  const allPublished = wsId ? await getWorkspacePages(wsId, siteId) : [];
  // Filter published pages and exclude utility / legal / error pages
  const pages = allPublished.filter(
    (p: { title: string; slug: string }) => !isExcludedPage(p.slug, p.title)
  );
  log.info(`SEO audit: ${allPublished.length} total published pages, ${pages.length} published (excluded utility/legal/password/draft pages)`);

  // Fetch metadata and HTML in parallel (batch of 5), cache meta for site-wide checks
  const results: PageSeoResult[] = [];
  const metaCache: { title: string; desc: string; page: string }[] = [];
  const htmlCache = new Map<string, string>();
  const batch = 5;

  for (let i = 0; i < pages.length; i += batch) {
    const chunk = pages.slice(i, i + batch);
    const chunkResults = await Promise.all(
      chunk.map(async (page) => {
        // Use publishedPath for full URL (handles nested pages like /services/veneers)
        const pagePath = resolvePagePath(page);
        const url = pagePath ? `${baseUrl}${pagePath}` : baseUrl;
        const displaySlug = pagePath ? pagePath.replace(/^\//, '') : (page.slug || '');
        const [meta, html] = await Promise.all([
          fetchPageMeta(page.id, tokenOverride),
          baseUrl ? fetchPublishedHtml(url) : Promise.resolve(null),
        ]);
        // Cache for site-wide duplicate checking
        if (meta) {
          metaCache.push({
            title: (meta.seo?.title || meta.title || '').toLowerCase().trim(),
            desc: (meta.seo?.description || '').toLowerCase().trim(),
            page: page.title,
          });
        }
        // Store HTML for AI recommendations later
        if (html) htmlCache.set(page.id, html);
        return auditPage(page.id, page.title, displaySlug, url, meta, html);
      })
    );
    results.push(...chunkResults);
  }

  // Site-wide issues collector (populated by runSiteWideChecks; declared early for CMS discovery)
  let siteWideIssues: SeoIssue[] = [];

  // ── Discover & audit CMS collection pages via sitemap ──
  const CMS_PAGE_LIMIT = 9999; // No practical limit — audit all CMS pages
  const scanUrl = siteWideUrl || baseUrl;
  if (scanUrl) {
    const staticPaths = buildStaticPathSet(pages);
    const { cmsUrls, totalFound } = await discoverCmsUrls(scanUrl, staticPaths, CMS_PAGE_LIMIT);

    // Filter out utility/legal CMS pages the same way we filter static pages
    const filteredCmsUrls = cmsUrls.filter(item => !isExcludedPage(item.path, item.pageName));
    if (filteredCmsUrls.length > 0) {
      log.info(`SEO audit: auditing ${filteredCmsUrls.length} CMS pages (${totalFound} total in sitemap, ${cmsUrls.length - filteredCmsUrls.length} excluded)`);
      for (let i = 0; i < filteredCmsUrls.length; i += batch) {
        const chunk = filteredCmsUrls.slice(i, i + batch);
        const chunkResults = await Promise.all(
          chunk.map(async (item) => {
            const html = await fetchPublishedHtml(item.url);
            const slug = item.path.replace(/^\//, '');
            const htmlTitle = html ? (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || '') : '';
            const htmlMetaDesc = html ? (extractMetaContent(html, 'description') || '') : '';
            metaCache.push({
              title: htmlTitle.toLowerCase().trim(),
              desc: htmlMetaDesc.toLowerCase().trim(),
              page: item.pageName,
            });
            if (html) htmlCache.set(`cms-${slug}`, html);
            return auditPage(`cms-${slug}`, item.pageName, slug, item.url, null, html);
          })
        );
        results.push(...chunkResults);
      }

      if (totalFound > CMS_PAGE_LIMIT) {
        siteWideIssues.push({
          check: 'sitemap', severity: 'info', category: 'technical',
          message: `${totalFound} CMS pages found, ${CMS_PAGE_LIMIT} sampled for audit`,
          recommendation: `Your site has ${totalFound} collection pages. We audited a sample of ${CMS_PAGE_LIMIT}. Issues found likely apply across similar CMS pages.`,
        });
      }
    }
  }

  // Capture any pre-existing siteWideIssues (from CMS discovery above) before running checks
  const preSiteWideIssues = [...siteWideIssues];

  // --- Site-wide technical checks (robots.txt, sitemap, SSL, redirects, CWV, AEO, duplicates, orphans, indexability) ---
  const { siteWideIssues: checkedIssues, cwvSummary } = await runSiteWideChecks({ siteId, baseUrl, siteWideUrl, pages, results, metaCache, htmlCache, wsId });
  siteWideIssues = [...preSiteWideIssues, ...checkedIssues];

  // --- AI-Powered Recommendations (mutates results[].issues[].suggestedFix in-place) ---
  await generateAiRecommendations({ results, htmlCache, workspaceId, siteId });

  // Free HTML cache
  htmlCache.clear();

  // Sort pages best-to-worst (highest score first) for client presentation
  results.sort((a, b) => b.score - a.score);

  let totalErrors = 0, totalWarnings = 0, totalInfos = 0;
  for (const r of results) {
    for (const i of r.issues) {
      if (i.severity === 'error') totalErrors++;
      else if (i.severity === 'warning') totalWarnings++;
      else totalInfos++;
    }
  }
  for (const i of siteWideIssues) {
    if (i.severity === 'error') totalErrors++;
    else if (i.severity === 'warning') totalWarnings++;
    else totalInfos++;
  }

  // Exclude noindex pages from site score — they're intentionally hidden from search
  const indexedResults = results.filter(r => !r.noindex);
  const siteScore = indexedResults.length > 0
    ? Math.round(indexedResults.reduce((s, r) => s + r.score, 0) / indexedResults.length)
    : 100;

  // --- Dead link scan (opt-out via skipLinkCheck) ---
  let deadLinkSummary: SeoAuditResult['deadLinkSummary'] | undefined;
  let deadLinkDetails: DeadLink[] | undefined;
  if (!skipLinkCheck) {
    try {
      log.info('Running dead link scan...');
      const linkResult = await checkSiteLinks(siteId, wsId);
      const internalDead = linkResult.deadLinks.filter(l => l.type === 'internal').length;
      const externalDead = linkResult.deadLinks.filter(l => l.type === 'external').length;
      deadLinkSummary = {
        total: linkResult.deadLinks.length,
        internal: internalDead,
        external: externalDead,
        redirects: linkResult.redirects.length,
      };
      deadLinkDetails = linkResult.deadLinks;
      if (linkResult.deadLinks.length > 0) {
        siteWideIssues.push({
          check: 'dead-links',
          severity: internalDead > 0 ? 'error' : 'warning',
          message: `${linkResult.deadLinks.length} broken link${linkResult.deadLinks.length > 1 ? 's' : ''} found${internalDead > 0 ? ` (${internalDead} internal)` : ''}`,
          recommendation: 'Broken links harm user experience and crawlability. Fix or redirect internal broken links immediately; update or remove broken external links.',
          value: `${linkResult.deadLinks.length} broken`,
        });
        // Update counters — dead link scan runs after initial tally
        if (internalDead > 0) totalErrors++;
        else totalWarnings++;
      }
    } catch (err) {
      log.error({ err }, 'Dead link scan failed (non-fatal)');
    }
  }

  return {
    siteScore,
    totalPages: results.length,
    errors: totalErrors,
    warnings: totalWarnings,
    infos: totalInfos,
    pages: results,
    siteWideIssues,
    cwvSummary: (cwvSummary.mobile || cwvSummary.desktop) ? cwvSummary : undefined,
    deadLinkSummary,
    deadLinkDetails,
  };
}
