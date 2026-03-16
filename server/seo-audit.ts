import { listPages, filterPublishedPages, discoverCmsUrls, buildStaticPathSet } from './webflow.js';
import { scanRedirects } from './redirect-scanner.js';
import { runSinglePageSpeed } from './pagespeed.js';
import { buildSeoContext } from './seo-context.js';
import { listWorkspaces } from './workspaces.js';
import { callOpenAI } from './openai-helpers.js';
import { extractMetaContent, extractLinks } from './seo-audit-html.js';
import { auditPage, isExcludedPage, CHECK_CATEGORY } from './audit-page.js';
export type { Severity, CheckCategory, SeoIssue, PageSeoResult } from './audit-page.js';
import type { SeoIssue, PageSeoResult } from './audit-page.js';
import { createLogger } from './logger.js';

const log = createLogger('seo-audit');

const WEBFLOW_API = 'https://api.webflow.com/v2';

function getToken(tokenOverride?: string): string | null {
  return tokenOverride || process.env.WEBFLOW_API_TOKEN || null;
}


export interface SeoAuditResult {
  siteScore: number;
  totalPages: number;
  errors: number;
  warnings: number;
  infos: number;
  pages: PageSeoResult[];
  siteWideIssues: SeoIssue[];
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
  } catch { return null; }
}

async function fetchPublishedHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
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
      });
      if (domainRes.ok) {
        const domainData = await domainRes.json() as { customDomains?: { url?: string }[] };
        const domains = domainData.customDomains || [];
        if (domains.length > 0 && domains[0].url) {
          customDomain = domains[0].url;
        }
      }
    } catch { /* custom domains fetch is best-effort */ }

    return { subdomain, customDomain };
  } catch { return { subdomain: null, customDomain: null }; }
}

export async function runSeoAudit(siteId: string, tokenOverride?: string, workspaceId?: string): Promise<SeoAuditResult> {
  const siteInfo = await getSiteInfo(siteId, tokenOverride);
  const baseUrl = siteInfo.subdomain ? `https://${siteInfo.subdomain}.webflow.io` : '';
  // Use custom domain for site-wide checks (robots.txt, sitemap) since webflow.io blocks crawlers by design
  const siteWideUrl = siteInfo.customDomain
    ? (siteInfo.customDomain.startsWith('http') ? siteInfo.customDomain : `https://${siteInfo.customDomain}`)
    : baseUrl;
  log.info(`SEO audit: subdomain=${siteInfo.subdomain}, baseUrl=${baseUrl}, siteWideUrl=${siteWideUrl}`);
  const allPages = await listPages(siteId, tokenOverride);
  // Filter published pages and exclude utility / legal / error pages
  const pages = filterPublishedPages(allPages).filter(
    (p: { title: string; slug: string }) => !isExcludedPage(p.slug, p.title)
  );
  log.info(`SEO audit: ${allPages.length} total pages, ${pages.length} published (excluded utility/legal/password/draft pages)`);

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
        const pagePath = page.publishedPath || (page.slug ? `/${page.slug}` : '');
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
    } catch { /* skip if fetch fails */ }

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
    } catch { /* skip if fetch fails */ }

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
    } catch { /* skip */ }

    // SSL / HTTPS check
    if (!checkUrl.startsWith('https://')) {
      siteWideIssues.push({ check: 'ssl', severity: 'error', message: 'Site is not using HTTPS', recommendation: 'Enable SSL/HTTPS for your site. HTTPS is a ranking signal and required for user trust.' });
    }
  }

  // --- Redirect health check (runs inline, fast HEAD requests) ---
  try {
    log.info('Running redirect scan...');
    const redirectResult = await scanRedirects(siteId, tokenOverride);
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

  // --- Homepage Core Web Vitals (quick single-page PSI check) ---
  const homepageUrl = siteWideUrl || baseUrl;
  if (homepageUrl && process.env.GOOGLE_PSI_KEY) {
    try {
      log.info('Running homepage PageSpeed check...');
      const psi = await runSinglePageSpeed(homepageUrl, 'mobile', 'Homepage');
      if (psi) {
        const scoreLabel = psi.score >= 90 ? 'good' : psi.score >= 50 ? 'needs improvement' : 'poor';
        const severity: Severity = psi.score >= 90 ? 'info' : psi.score >= 50 ? 'warning' : 'error';
        siteWideIssues.push({
          check: 'cwv', severity,
          message: `Homepage performance score: ${psi.score}/100 (${scoreLabel})`,
          recommendation: psi.score >= 90
            ? 'Great performance! Core Web Vitals are a Google ranking signal.'
            : `Performance score of ${psi.score} may hurt rankings. Core Web Vitals are a Google ranking signal. Run the full PageSpeed tool for detailed recommendations.`,
          value: `${psi.score}/100`,
        });
        // Individual CWV metrics
        if (psi.vitals.LCP !== null) {
          const lcpSec = (psi.vitals.LCP / 1000).toFixed(1);
          if (psi.vitals.LCP > 4000) {
            siteWideIssues.push({ check: 'cwv-lcp', severity: 'error', message: `LCP is ${lcpSec}s (poor — should be under 2.5s)`, recommendation: 'Largest Contentful Paint over 4s severely impacts user experience. Optimize images, reduce server response time, and minimize render-blocking resources.', value: `${lcpSec}s` });
          } else if (psi.vitals.LCP > 2500) {
            siteWideIssues.push({ check: 'cwv-lcp', severity: 'warning', message: `LCP is ${lcpSec}s (needs improvement — target under 2.5s)`, recommendation: 'Optimize Largest Contentful Paint by compressing images, using next-gen formats, and preloading key resources.', value: `${lcpSec}s` });
          }
        }
        if (psi.vitals.CLS !== null && psi.vitals.CLS > 0.25) {
          siteWideIssues.push({ check: 'cwv-cls', severity: psi.vitals.CLS > 0.5 ? 'error' : 'warning', message: `CLS is ${psi.vitals.CLS.toFixed(3)} (should be under 0.1)`, recommendation: 'Cumulative Layout Shift is too high. Set explicit dimensions on images/videos, avoid inserting content above existing content, and use CSS containment.', value: `${psi.vitals.CLS.toFixed(3)}` });
        }
        if (psi.vitals.TBT !== null && psi.vitals.TBT > 600) {
          siteWideIssues.push({ check: 'cwv-tbt', severity: psi.vitals.TBT > 1500 ? 'error' : 'warning', message: `Total Blocking Time is ${Math.round(psi.vitals.TBT)}ms (should be under 200ms)`, recommendation: 'Reduce JavaScript execution time, break up long tasks, and defer non-critical scripts.', value: `${Math.round(psi.vitals.TBT)}ms` });
        }
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
      if (link.href.startsWith('/')) {
        internalLinkTargets.add(link.href.replace(/\/$/, '').toLowerCase());
      } else if (link.href.startsWith('http')) {
        try {
          const p = new URL(link.href).pathname.replace(/\/$/, '').toLowerCase();
          internalLinkTargets.add(p);
        } catch { /* skip */ }
      }
    }
  }
  // Check which audited pages receive zero inbound internal links
  const orphanPages: string[] = [];
  for (const r of results) {
    const pagePath = `/${r.slug}`.replace(/\/$/, '').toLowerCase();
    if (pagePath === '/' || pagePath === '') continue; // Homepage always linked
    if (!internalLinkTargets.has(pagePath)) {
      orphanPages.push(r.page || r.slug);
    }
  }
  if (orphanPages.length > 0) {
    siteWideIssues.push({
      check: 'orphan-pages', severity: orphanPages.length > 3 ? 'error' : 'warning',
      message: `${orphanPages.length} orphan page${orphanPages.length > 1 ? 's' : ''} with no internal links`,
      recommendation: `These pages have no internal links pointing to them, making them hard for search engines to discover: ${orphanPages.slice(0, 10).join(', ')}${orphanPages.length > 10 ? ` (+${orphanPages.length - 10} more)` : ''}. Add internal links from related pages.`,
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
    const auditBrandName = auditWs?.webflowSiteName || auditWs?.name || '';

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

          // Build keyword strategy + brand voice context for this page
          const pagePath = pageResult.url ? (() => { try { return new URL(pageResult.url).pathname; } catch { return undefined; } })() : undefined;
          const { keywordBlock, brandVoiceBlock } = buildSeoContext(wsId, pagePath);

          const prompt = `You are an expert SEO copywriter. Generate optimized meta tags for this webpage that match the brand voice and target the right keywords.

PAGE: ${pageResult.page}
URL: ${pageResult.url}
CURRENT TITLE: ${currentTitle || '(missing)'}
CURRENT META DESCRIPTION: ${currentDesc || '(missing)'}

${pageContent ? `PAGE CONTENT:\n${pageContent}\n` : ''}${keywordBlock}${brandVoiceBlock}
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

  return {
    siteScore,
    totalPages: results.length,
    errors: totalErrors,
    warnings: totalWarnings,
    infos: totalInfos,
    pages: results,
    siteWideIssues,
  };
}
