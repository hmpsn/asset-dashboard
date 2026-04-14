import { discoverCmsUrls, buildStaticPathSet } from './webflow.js';
import { getWorkspacePages } from './workspace-data.js';
import { scanRedirects } from './redirect-scanner.js';
import { checkSiteLinks } from './link-checker.js';
import type { DeadLink } from './link-checker.js';
import { runSinglePageSpeed } from './pagespeed.js';
import { buildWorkspaceIntelligence, formatForPrompt } from './workspace-intelligence.js';
import { listWorkspaces, getBrandName } from './workspaces.js';
import { callOpenAI } from './openai-helpers.js';
import { extractMetaContent, extractLinks } from './seo-audit-html.js';
import { auditPage, isExcludedPage, CHECK_CATEGORY } from './audit-page.js';
import { resolvePagePath } from './helpers.js';
export type { Severity, CheckCategory, SeoIssue, PageSeoResult } from './audit-page.js';
import type { SeoIssue, PageSeoResult } from './audit-page.js';
import { createLogger } from './logger.js';
import { isProgrammingError } from './errors.js';

const log = createLogger('seo-audit');

const WEBFLOW_API = 'https://api.webflow.com/v2';

function getToken(tokenOverride?: string): string | null {
  return tokenOverride || process.env.WEBFLOW_API_TOKEN || null;
}


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

async function fetchPageMeta(pageId: string, tokenOverride?: string): Promise<PageMeta | null> {
  const token = getToken(tokenOverride);
  if (!token) return null;
  try {
    const res = await fetch(`${WEBFLOW_API}/pages/${pageId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json() as PageMeta;
  } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'seo-audit/fetchPageMeta: programming error'); return null; }
}

async function fetchPublishedHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return null;
    return await res.text();
  } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'seo-audit/fetchPublishedHtml: programming error'); return null; }
}

interface SiteInfo {
  subdomain: string | null;
  customDomain: string | null;
}

async function getSiteInfo(siteId: string, tokenOverride?: string): Promise<SiteInfo> {
  const token = getToken(tokenOverride);
  if (!token) return { subdomain: null, customDomain: null };
  try {
    // Fetch site info for subdomain
    const siteRes = await fetch(`${WEBFLOW_API}/sites/${siteId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    let subdomain: string | null = null;
    if (siteRes.ok) {
      const siteData = await siteRes.json() as { shortName?: string };
      subdomain = siteData.shortName || null;
    }

    // Fetch custom domains from dedicated endpoint
    let customDomain: string | null = null;
    try {
      const domainRes = await fetch(`${WEBFLOW_API}/sites/${siteId}/custom_domains`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (domainRes.ok) {
        const domainData = await domainRes.json() as { customDomains?: { url?: string }[] };
        const domains = domainData.customDomains || [];
        if (domains.length > 0 && domains[0].url) {
          customDomain = domains[0].url;
        }
      }
    } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'seo-audit: programming error'); /* custom domains fetch is best-effort */ }

    return { subdomain, customDomain };
  } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'seo-audit/getSiteInfo: programming error'); return { subdomain: null, customDomain: null }; }
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

  // Site-wide issues collector (declared early so CMS discovery can append to it)
  const siteWideIssues: SeoIssue[] = [];

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

  // --- TIER 2: Site-wide technical checks ---
  // Use siteWideUrl (custom domain) for robots.txt/sitemap since webflow.io blocks crawlers by design
  const checkUrl = siteWideUrl || baseUrl;
  if (checkUrl) {
    // Robots.txt
    try {
      const robotsRes = await fetch(`${checkUrl}/robots.txt`, { redirect: 'follow' });
      if (!robotsRes.ok) {
        siteWideIssues.push({ check: 'robots-txt', severity: 'warning', message: 'Missing robots.txt file', recommendation: 'Create a robots.txt file to guide search engine crawlers on which pages to index.' });
      } else {
        const robotsTxt = await robotsRes.text();
        // Verify it's actually robots.txt, not a custom 404 HTML page
        const looksLikeHtml = robotsTxt.trimStart().startsWith('<!') || robotsTxt.trimStart().startsWith('<html');
        if (looksLikeHtml) {
          siteWideIssues.push({ check: 'robots-txt', severity: 'warning', message: 'Missing robots.txt file', recommendation: 'Create a robots.txt file to guide search engine crawlers on which pages to index.' });
        } else {
          // Parse robots.txt into user-agent blocks
          const lines = robotsTxt.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
          let currentUA = '';
          const blocks: { ua: string; disallow: string[]; allow: string[] }[] = [];
          for (const line of lines) {
            if (line.toLowerCase().startsWith('user-agent:')) {
              currentUA = line.split(':')[1]?.trim() || '';
              blocks.push({ ua: currentUA, disallow: [], allow: [] });
            } else if (line.toLowerCase().startsWith('disallow:') && blocks.length > 0) {
              blocks[blocks.length - 1].disallow.push(line.split(':').slice(1).join(':').trim());
            } else if (line.toLowerCase().startsWith('allow:') && blocks.length > 0) {
              blocks[blocks.length - 1].allow.push(line.split(':').slice(1).join(':').trim());
            }
          }
          // Only flag if the wildcard (*) block disallows / without a corresponding Allow: /
          const wildcardBlock = blocks.find(b => b.ua === '*');
          if (wildcardBlock) {
            const disallowsAll = wildcardBlock.disallow.includes('/');
            const allowsRoot = wildcardBlock.allow.some(a => a === '/' || a === '/*');
            if (disallowsAll && !allowsRoot) {
              siteWideIssues.push({ check: 'robots-txt', severity: 'error', message: 'robots.txt blocks all crawlers', recommendation: 'Your robots.txt has "Disallow: /" for all user-agents without an Allow override. This prevents search engines from indexing your site.', value: 'User-agent: * / Disallow: /' });
            }
          }
          if (!robotsTxt.toLowerCase().includes('sitemap:')) {
            siteWideIssues.push({ check: 'robots-txt', severity: 'info', message: 'robots.txt does not reference a sitemap', recommendation: 'Add a Sitemap: directive to your robots.txt to help search engines discover your XML sitemap.' });
          }
        }
      }
    } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'seo-audit: programming error'); /* skip if fetch fails */ }

    // XML Sitemap
    try {
      const sitemapRes = await fetch(`${checkUrl}/sitemap.xml`, { redirect: 'follow' });
      if (!sitemapRes.ok) {
        siteWideIssues.push({ check: 'sitemap', severity: 'warning', message: 'Missing XML sitemap', recommendation: 'Create a sitemap.xml to help search engines discover and index all your pages efficiently.' });
      } else {
        const sitemapText = await sitemapRes.text();
        // Verify it's actually XML, not a custom 404 HTML page served as 200
        const isXml = sitemapText.trimStart().startsWith('<?xml') || sitemapText.trimStart().startsWith('<urlset') || sitemapText.trimStart().startsWith('<sitemapindex');
        if (!isXml) {
          siteWideIssues.push({ check: 'sitemap', severity: 'warning', message: 'Missing XML sitemap', recommendation: 'Create a sitemap.xml to help search engines discover and index all your pages efficiently.' });
        } else {
          const sitemapUrls = (sitemapText.match(/<loc>([^<]+)<\/loc>/gi) || []).length;
          if (sitemapUrls === 0) {
            siteWideIssues.push({ check: 'sitemap', severity: 'warning', message: 'XML sitemap is empty', recommendation: 'Your sitemap.xml exists but contains no URLs. Ensure it lists all indexable pages.' });
          } else if (sitemapUrls < pages.length * 0.5) {
            siteWideIssues.push({ check: 'sitemap', severity: 'warning', message: `Sitemap has ${sitemapUrls} URLs but site has ${pages.length} published pages`, recommendation: 'Your sitemap may be missing pages. Ensure all important pages are included.' });
          }
        }
      }
    } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'seo-audit: programming error'); /* skip if fetch fails */ }

    // Page response time (sample the homepage)
    try {
      const startTime = Date.now();
      await fetch(checkUrl, { redirect: 'follow' });
      const responseTime = Date.now() - startTime;
      if (responseTime > 3000) {
        siteWideIssues.push({ check: 'response-time', severity: 'error', message: `Slow server response (${(responseTime / 1000).toFixed(1)}s)`, recommendation: 'Server response time should be under 600ms. Slow response times hurt both user experience and SEO rankings.', value: `${responseTime}ms` });
      } else if (responseTime > 1000) {
        siteWideIssues.push({ check: 'response-time', severity: 'warning', message: `Server response time ${(responseTime / 1000).toFixed(1)}s`, recommendation: 'Aim for server response under 600ms. Consider caching, CDN, or server optimization.', value: `${responseTime}ms` });
      }
    } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'seo-audit/sitemapUrls: programming error'); /* skip */ }

    // SSL / HTTPS check
    if (!checkUrl.startsWith('https://')) {
      siteWideIssues.push({ check: 'ssl', severity: 'error', message: 'Site is not using HTTPS', recommendation: 'Enable SSL/HTTPS for your site. HTTPS is a ranking signal and required for user trust.' });
    }
  }

  // --- Redirect health check (runs inline, fast HEAD requests) ---
  try {
    log.info('Running redirect scan...');
    const redirectResult = await scanRedirects(siteId, wsId);
    const { summary, chains } = redirectResult;

    if (summary.notFound > 0) {
      siteWideIssues.push({
        check: 'redirects', severity: summary.notFound > 3 ? 'error' : 'warning',
        message: `${summary.notFound} page${summary.notFound > 1 ? 's' : ''} returning 404`,
        recommendation: `These pages return 404 errors and may be losing traffic/link equity. Set up 301 redirects to relevant pages.`,
        value: `${summary.notFound} broken`,
      });
    }
    if (summary.redirecting > 0) {
      siteWideIssues.push({
        check: 'redirects', severity: 'info',
        message: `${summary.redirecting} page${summary.redirecting > 1 ? 's' : ''} redirecting`,
        recommendation: 'Review redirecting pages to ensure internal links point directly to final destinations, avoiding unnecessary redirect hops.',
        value: `${summary.redirecting} redirecting`,
      });
    }
    if (summary.chainsDetected > 0) {
      const worstChain = chains.reduce((max, c) => c.totalHops > max.totalHops ? c : max, chains[0]);
      siteWideIssues.push({
        check: 'redirect-chains', severity: summary.longestChain > 2 ? 'error' : 'warning',
        message: `${summary.chainsDetected} redirect chain${summary.chainsDetected > 1 ? 's' : ''} detected (longest: ${summary.longestChain} hops)`,
        recommendation: `Redirect chains waste crawl budget and slow page loads. Worst chain: ${worstChain?.originalUrl || 'unknown'} → ${worstChain?.totalHops || 0} hops. Update redirects to point directly to the final destination.`,
        value: `${summary.longestChain} hops max`,
      });
    }
    if (chains.some(c => c.isLoop)) {
      siteWideIssues.push({
        check: 'redirect-chains', severity: 'error',
        message: 'Redirect loop detected',
        recommendation: 'One or more pages create an infinite redirect loop. This makes the page completely inaccessible to users and search engines. Fix immediately.',
      });
    }
  } catch (err) {
    log.error({ err: err }, 'Redirect scan failed (non-fatal)');
  }

  // --- Homepage Core Web Vitals (mobile + desktop) ---
  // CWV field data (CrUX) → cwvSummary (dedicated card in frontend).
  // Lighthouse lab score → siteWideIssues (diagnostic info only).
  const homepageUrl = siteWideUrl || baseUrl;
  const cwvSummary: CwvSummary = {};
  if (homepageUrl && process.env.GOOGLE_PSI_KEY) {
    try {
      log.info('Running homepage PageSpeed check (mobile + desktop)...');
      const [psiMobile, psiDesktop] = await Promise.all([
        runSinglePageSpeed(homepageUrl, 'mobile', 'Homepage').catch(() => null),
        runSinglePageSpeed(homepageUrl, 'desktop', 'Homepage').catch(() => null),
      ]);

      // Build CwvStrategyResult from a PSI result
      const buildStrategy = (psi: NonNullable<typeof psiMobile>): CwvStrategyResult => {
        const cwv = psi.cwvAssessment;
        return {
          assessment: cwv?.assessment ?? 'no-data',
          fieldDataAvailable: cwv?.fieldDataAvailable ?? false,
          lighthouseScore: psi.score,
          metrics: cwv?.metrics ?? {
            LCP: { value: psi.vitals.LCP, rating: null },
            INP: { value: psi.vitals.INP, rating: null },
            CLS: { value: psi.vitals.CLS, rating: null },
          },
        };
      };

      if (psiMobile) cwvSummary.mobile = buildStrategy(psiMobile);
      if (psiDesktop) cwvSummary.desktop = buildStrategy(psiDesktop);

      // Only push Lighthouse lab scores into siteWideIssues as info-level diagnostic
      for (const [label, psi] of [['Mobile', psiMobile], ['Desktop', psiDesktop]] as const) {
        if (!psi) continue;
        const scoreLabel = psi.score >= 90 ? 'good' : psi.score >= 50 ? 'needs improvement' : 'poor';
        siteWideIssues.push({
          check: 'cwv-lab', severity: 'info',
          message: `${label} Lighthouse score: ${psi.score}/100 (${scoreLabel})`,
          recommendation: `Lighthouse simulates page load on a mid-tier device. This score is a diagnostic tool — not used by Google for rankings. Use it to identify optimization opportunities.`,
          value: `${psi.score}/100`,
        });
      }
    } catch (err) {
      log.error({ err: err }, 'PageSpeed check failed (non-fatal)');
    }
  }

  // --- AEO: Site-wide trust pages check ---
  // Check if the site has essential trust-building pages (about, contact)
  const allSlugs = new Set(results.map(r => r.slug.toLowerCase().replace(/^\//, '')));
  const trustPages = [
    { slug: 'about', variants: ['about', 'about-us', 'who-we-are', 'our-story', 'our-team'], label: 'About' },
    { slug: 'contact', variants: ['contact', 'contact-us', 'get-in-touch'], label: 'Contact' },
  ];
  const missingTrustPages: string[] = [];
  for (const tp of trustPages) {
    const found = tp.variants.some(v => allSlugs.has(v) || [...allSlugs].some(s => s.includes(v)));
    if (!found) missingTrustPages.push(tp.label);
  }
  if (missingTrustPages.length > 0) {
    siteWideIssues.push({
      check: 'aeo-trust-pages', severity: 'warning',
      message: `Missing trust page${missingTrustPages.length > 1 ? 's' : ''}: ${missingTrustPages.join(', ')}`,
      recommendation: `LLMs and AI answer engines trust sites with clear ownership signals. Create these essential pages: ${missingTrustPages.map(p => `/${p.toLowerCase()}`).join(', ')}. For healthcare/medical sites, also consider /editorial-policy, /corrections, and /medical-review-board.`,
    });
  }

  const titleMap = new Map<string, string[]>();
  const descMap = new Map<string, string[]>();

  // Find duplicate titles
  for (const item of metaCache) {
    if (!item.title) continue;
    if (!titleMap.has(item.title)) titleMap.set(item.title, []);
    titleMap.get(item.title)!.push(item.page);
  }
  for (const [title, pgs] of titleMap) {
    if (pgs.length > 1) {
      siteWideIssues.push({
        check: 'duplicate-title', severity: 'error',
        message: `Duplicate title across ${pgs.length} pages`,
        recommendation: `Make each page title unique. Pages sharing this title: ${pgs.join(', ')}`,
        value: title,
        affectedPages: pgs,
      });
    }
  }

  // Find duplicate descriptions
  for (const item of metaCache) {
    if (!item.desc) continue;
    if (!descMap.has(item.desc)) descMap.set(item.desc, []);
    descMap.get(item.desc)!.push(item.page);
  }
  for (const [desc, pgs] of descMap) {
    if (pgs.length > 1) {
      siteWideIssues.push({
        check: 'duplicate-description', severity: 'warning',
        message: `Duplicate meta description across ${pgs.length} pages`,
        recommendation: `Write unique descriptions for each page. Pages sharing: ${pgs.join(', ')}`,
        value: desc.slice(0, 80) + (desc.length > 80 ? '...' : ''),
        affectedPages: pgs,
      });
    }
  }

  // --- Orphan pages: pages with no internal links pointing to them ---
  // Build a map of all internal link targets across all audited pages
  const internalLinkTargets = new Set<string>();
  for (const r of results) {
    // Find all internal links from each page's HTML (cached during audit)
    const cachedHtml = htmlCache.get(r.pageId);
    if (!cachedHtml) continue;
    const pageLinks = extractLinks(cachedHtml);
    for (const link of pageLinks) {
      if (link.href.startsWith('/') && !link.href.startsWith('/cdn-cgi/')) {
        internalLinkTargets.add(link.href.replace(/\/$/, '').toLowerCase());
      } else if (link.href.startsWith('http')) {
        try {
          const p = new URL(link.href).pathname.replace(/\/$/, '').toLowerCase();
          if (!p.startsWith('/cdn-cgi/')) internalLinkTargets.add(p);
        } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'seo-audit: programming error'); /* skip */ }
      }
    }
  }
  // Check which audited pages receive zero inbound internal links
  // Exclude utility pages that are intentionally unlinked (thank-you, confirmation, etc.)
  const ORPHAN_UTILITY_PATTERNS = /(?:^|\/)(?:thank[-_]?you|thanks|thankyou|confirmation|success|members?[-_]?only|members?[-_]?area|password[-_]?protected|unsubscribe|opt[-_]?out)(?:\/|$|-|_|$)/i;
  const orphanPages: string[] = [];
  for (const r of results) {
    const pagePath = `/${r.slug}`.replace(/\/$/, '').toLowerCase();
    if (pagePath === '/' || pagePath === '') continue; // Homepage always linked
    if (isExcludedPage(r.slug, r.page)) continue; // Skip utility pages entirely
    if (ORPHAN_UTILITY_PATTERNS.test(r.slug)) continue; // Skip intentionally unlinked utility pages
    if (!internalLinkTargets.has(pagePath)) {
      orphanPages.push(r.page || r.slug);
    }
  }
  if (orphanPages.length > 0) {
    siteWideIssues.push({
      check: 'orphan-pages', severity: orphanPages.length > 3 ? 'error' : 'warning',
      message: `${orphanPages.length} orphan page${orphanPages.length > 1 ? 's' : ''} with no internal links`,
      recommendation: `These pages have no internal links pointing to them, making them hard for search engines to discover: ${orphanPages.slice(0, 10).join(', ')}${orphanPages.length > 10 ? ` (+${orphanPages.length - 10} more)` : ''}. Add internal links from related pages.`,
      affectedPages: orphanPages,
    });
  }

  // --- Indexability summary ---
  const noindexPages = results.filter(r => r.issues.some(i => i.check === 'robots' && i.message.includes('noindex')));
  if (noindexPages.length > 0) {
    const pct = Math.round((noindexPages.length / results.length) * 100);
    siteWideIssues.push({
      check: 'indexability', severity: pct > 20 ? 'error' : 'warning',
      message: `${noindexPages.length} of ${results.length} pages (${pct}%) set to noindex`,
      recommendation: `These pages won't appear in search results: ${noindexPages.slice(0, 8).map(p => p.page || p.slug).join(', ')}${noindexPages.length > 8 ? ` (+${noindexPages.length - 8} more)` : ''}. Review and remove noindex if they should be indexed.`,
    });
  }

  // Deduplicate site-wide issues — keyed by check+message to prevent exact duplicates
  // while preserving distinct issues that share the same check name (e.g. robots-txt missing vs blocking)
  const seenIssueKeys = new Set<string>();
  const dedupedIssues: typeof siteWideIssues = [];
  for (const issue of siteWideIssues) {
    const key = `${issue.check}::${issue.message}`;
    if (!seenIssueKeys.has(key)) {
      seenIssueKeys.add(key);
      dedupedIssues.push(issue);
    }
  }
  siteWideIssues.length = 0;
  siteWideIssues.push(...dedupedIssues);

  // Auto-assign categories to site-wide issues
  for (const issue of siteWideIssues) {
    issue.category = CHECK_CATEGORY[issue.check] || 'technical';
  }

  // --- AI-Powered Recommendations ---
  // Generate keyword-optimized title/meta description suggestions using actual page content
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    // Resolve workspaceId from siteId if not provided
    const wsId = workspaceId || listWorkspaces().find(w => w.webflowSiteId === siteId)?.id;
    const pagesNeedingFixes = results.filter(r =>
      r.issues.some(i => ['title', 'meta-description', 'og-tags'].includes(i.check))
    );
    log.info(`Generating AI recommendations for ${pagesNeedingFixes.length} pages (workspace: ${wsId || 'unknown'})...`);

    // Resolve brand name so AI uses correct name in suggestions
    const auditWs = wsId ? listWorkspaces().find(w => w.id === wsId) : undefined;
    const auditBrandName = getBrandName(auditWs);

    // Helper: extract readable body text from HTML for context
    const extractBodyText = (html: string): string => {
      // Remove script/style/nav/footer/header blocks
      let text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '')
        .replace(/<header[\s\S]*?<\/header>/gi, '');
      // Extract headings separately for emphasis
      const headings: string[] = [];
      const hRegex = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
      let hm;
      while ((hm = hRegex.exec(text)) !== null) {
        headings.push(hm[1].replace(/<[^>]+>/g, '').trim());
      }
      // Strip tags and normalize whitespace
      text = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      // Return headings + body excerpt (capped at 2000 chars for token efficiency)
      const headingStr = headings.length > 0 ? `KEY HEADINGS: ${headings.slice(0, 8).join(' | ')}\n` : '';
      return headingStr + text.slice(0, 2000);
    };

    // Pre-assemble workspace-level slices once — learnings and seoContext base data are identical
    // for every page. pageKeywords (the only page-specific seoContext field) is a find() on the
    // pre-built pageMap, derived inline per page. pageProfile remains per-page (requires pagePath).
    const wsIntel = await buildWorkspaceIntelligence(wsId ?? '', { slices: ['learnings', 'seoContext'] as const });

    const aiBatch = 15;
    for (let i = 0; i < pagesNeedingFixes.length; i += aiBatch) {
      // Stagger batches to avoid hammering rate limits
      if (i > 0) await new Promise(r => setTimeout(r, 1500));
      const batch = pagesNeedingFixes.slice(i, i + aiBatch);
      await Promise.all(batch.map(async (pageResult) => {
        try {
          const titleIssue = pageResult.issues.find(i => i.check === 'title');
          const descIssue = pageResult.issues.find(i => i.check === 'meta-description');
          const ogTitleIssue = pageResult.issues.find(i => i.check === 'og-tags' && i.message.includes('title'));
          const ogDescIssue = pageResult.issues.find(i => i.check === 'og-tags' && i.message.includes('description'));

          if (!titleIssue && !descIssue && !ogTitleIssue && !ogDescIssue) return;

          const currentTitle = titleIssue?.value || pageResult.page || '';
          const currentDesc = descIssue?.value || '';

          // Get actual page content for on-brand suggestions
          const cachedHtml = htmlCache.get(pageResult.pageId);
          const pageContent = cachedHtml ? extractBodyText(cachedHtml) : '';

          // Build keyword strategy + brand voice + KB + personas context for this page
          const pagePath = pageResult.url ? (() => { try { return new URL(pageResult.url).pathname; } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'seo-audit: programming error'); return undefined; } })() : undefined;
          // Derive per-page keywords from pre-built pageMap — no extra DB call for seoContext
          const seoCtx = wsIntel.seoContext ? { ...wsIntel.seoContext } : undefined;
          if (seoCtx && pagePath && seoCtx.strategy?.pageMap?.length) {
            const kw = seoCtx.strategy.pageMap.find(p => p.pagePath.toLowerCase() === pagePath.toLowerCase());
            if (kw) seoCtx.pageKeywords = kw;
          }
          const pageProfileIntel = await buildWorkspaceIntelligence(wsId ?? '', { slices: ['pageProfile'] as const, pagePath });
          const intel = { ...wsIntel, seoContext: seoCtx, pageProfile: pageProfileIntel.pageProfile };
          const fullContext = formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext', 'learnings', 'pageProfile'] }); // bip-ok: slices is a superset

          const prompt = `You are an expert SEO copywriter. Generate optimized meta tags for this webpage that match the brand voice and target the right keywords.

PAGE: ${pageResult.page}
URL: ${pageResult.url}
CURRENT TITLE: ${currentTitle || '(missing)'}
CURRENT META DESCRIPTION: ${currentDesc || '(missing)'}

${pageContent ? `PAGE CONTENT:\n${pageContent}\n` : ''}${fullContext}
ISSUES TO FIX:
${titleIssue ? `- Title: ${titleIssue.message}` : ''}
${descIssue ? `- Meta Description: ${descIssue.message}` : ''}
${ogTitleIssue ? `- OG Title: ${ogTitleIssue.message}` : ''}

RULES:
- If keyword strategy is provided above, the title MUST include the primary keyword near the start
- If brand voice is provided above, match that exact tone and style
- Title: 30-60 chars, front-load the primary keyword, compelling for clicks
- Meta Description: 120-155 chars, include primary + secondary keywords naturally, include a call-to-action
- OG Title: Can match the SEO title or be slightly more conversational for social sharing
- Use natural language that sounds like it belongs on this specific website
- Pull specific terminology, services, or value props directly from the page content
${auditBrandName ? `- The brand name is "${auditBrandName}" — use this exact name if referencing the brand (never use a shortened/abbreviated version)` : ''}
Respond in this exact JSON format (only include fields that need fixing):
{"title":"...","metaDescription":"...","ogTitle":"..."}`;

          const aiResult = await callOpenAI({
            model: 'gpt-4.1-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.6,
            maxTokens: 400,
            feature: 'seo-audit-recs',
            workspaceId: wsId,
          });

          const content = aiResult.text;
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (!jsonMatch) return;

          const suggestions = JSON.parse(jsonMatch[0]) as { title?: string; metaDescription?: string; ogTitle?: string };

          if (suggestions.title && titleIssue) {
            titleIssue.suggestedFix = suggestions.title;
          }
          if (suggestions.metaDescription && descIssue) {
            descIssue.suggestedFix = suggestions.metaDescription;
          }
          if (suggestions.ogTitle && ogTitleIssue) {
            ogTitleIssue.suggestedFix = suggestions.ogTitle;
          }
          // If OG desc is missing but we have a meta desc suggestion, use it
          if (ogDescIssue && suggestions.metaDescription) {
            ogDescIssue.suggestedFix = suggestions.metaDescription;
          }
        } catch (err) {
          log.error({ err: err }, `AI recommendation failed for ${pageResult.page}:`);
        }
      }));
    }
  }
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
