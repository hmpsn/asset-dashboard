// Site-wide technical checks for SEO audit engine.
// Extracted from seo-audit.ts for modularity.

import { scanRedirects } from './redirect-scanner.js';
import { isProgrammingError } from './errors.js';
import { extractLinks } from './seo-audit-html.js';
import { isExcludedPage, CHECK_CATEGORY } from './audit-page.js';
import { runHomepageCwv } from './seo-audit-cwv.js';
import { createLogger } from './logger.js';
import type { SeoIssue, PageSeoResult } from './audit-page.js';
import type { CwvSummary } from './seo-audit.js';

const log = createLogger('seo-audit-site-checks');

export interface SiteWideChecksOpts {
  siteId: string;
  baseUrl: string;
  siteWideUrl: string;
  pages: { title: string; slug: string }[];
  results: PageSeoResult[];
  metaCache: { title: string; desc: string; page: string }[];
  htmlCache: Map<string, string>;
  wsId?: string;
}

export interface SiteWideChecksResult {
  siteWideIssues: SeoIssue[];
  cwvSummary: CwvSummary;
}

export async function runSiteWideChecks(opts: SiteWideChecksOpts): Promise<SiteWideChecksResult> {
  const { siteId, baseUrl, siteWideUrl, pages, results, metaCache, htmlCache, wsId } = opts;

  // Site-wide issues collector
  const siteWideIssues: SeoIssue[] = [];

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
    } catch (err) { log.debug({ err }, 'seo-audit-site-checks/robots-fetch: external fetch error — degrading gracefully'); }

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
    } catch (err) { log.debug({ err }, 'seo-audit-site-checks/sitemap-fetch: external fetch error — degrading gracefully'); }

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
    } catch (err) { log.debug({ err }, 'seo-audit-site-checks/response-time: external fetch error — degrading gracefully'); }

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
    if (isProgrammingError(err)) {
      log.warn({ err }, 'seo-audit-site-checks/redirect-scan: unexpected error');
    } else {
      log.debug({ err }, 'seo-audit-site-checks/redirect-scan: external network error — degrading gracefully');
    }
  }

  // --- Homepage Core Web Vitals (mobile + desktop) ---
  // CWV field data (CrUX) → cwvSummary (dedicated card in frontend).
  // Lighthouse lab score → siteWideIssues (diagnostic info only).
  const homepageUrl = siteWideUrl || baseUrl;
  const cwvSummary = await runHomepageCwv({ homepageUrl, siteWideIssues });

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
        } catch (err) { log.debug({ err }, 'seo-audit-site-checks/url-parse: malformed URL — degrading gracefully'); }
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

  return { siteWideIssues, cwvSummary };
}
