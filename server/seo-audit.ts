import { listPages, filterPublishedPages, discoverCmsUrls, buildStaticPathSet } from './webflow.js';
import { scanRedirects } from './redirect-scanner.js';
import { runSinglePageSpeed } from './pagespeed.js';
import { buildSeoContext } from './seo-context.js';
import { listWorkspaces } from './workspaces.js';
import { callOpenAI } from './openai-helpers.js';

const WEBFLOW_API = 'https://api.webflow.com/v2';

function getToken(tokenOverride?: string): string | null {
  return tokenOverride || process.env.WEBFLOW_API_TOKEN || null;
}

export type Severity = 'error' | 'warning' | 'info';

export type CheckCategory = 'content' | 'technical' | 'social' | 'performance' | 'accessibility';

export interface SeoIssue {
  check: string;
  severity: Severity;
  category?: CheckCategory;
  message: string;
  recommendation: string;
  value?: string;
  suggestedFix?: string;
}

const CHECK_CATEGORY: Record<string, CheckCategory> = {
  // Content
  'title': 'content', 'meta-description': 'content', 'h1': 'content', 'heading-hierarchy': 'content',
  'content-length': 'content', 'internal-links': 'content', 'link-text': 'content',
  'url': 'content',
  'duplicate-title': 'content', 'duplicate-description': 'content',
  // Technical
  'canonical': 'technical', 'viewport': 'technical', 'robots': 'technical', 'lang': 'technical',
  'mixed-content': 'technical', 'ssl': 'technical',
  'robots-txt': 'technical', 'sitemap': 'technical', 'response-time': 'technical',
  'structured-data': 'technical', 'html-size': 'technical',
  'orphan-pages': 'technical', 'indexability': 'technical',
  'redirects': 'technical', 'redirect-chains': 'technical',
  // Social
  'og-tags': 'social', 'og-image': 'social',
  // Performance
  'lazy-loading': 'performance', 'img-dimensions': 'performance',
  'inline-css': 'performance', 'inline-js': 'performance', 'render-blocking': 'performance',
  'img-filesize': 'performance',
  'cwv': 'performance', 'cwv-lcp': 'performance', 'cwv-cls': 'performance', 'cwv-tbt': 'performance',
  // Accessibility
  'img-alt': 'accessibility',
};

// Scoring weights: higher-impact SEO checks get steeper deductions.
// 'critical' errors (missing title, canonical, noindex) cost more than cosmetic issues.
const CRITICAL_CHECKS = new Set([
  'title', 'meta-description', 'canonical', 'h1', 'robots',
  'duplicate-title', 'mixed-content', 'ssl', 'robots-txt',
]);
const MODERATE_CHECKS = new Set([
  'content-length', 'heading-hierarchy', 'internal-links', 'img-alt',
  'og-tags', 'og-image', 'link-text', 'url', 'lang', 'viewport',
  'duplicate-description', 'img-filesize', 'html-size',
]);

export interface PageSeoResult {
  pageId: string;
  page: string;
  slug: string;
  url: string;
  score: number;
  issues: SeoIssue[];
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

function extractTag(html: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  const matches: string[] = [];
  let m;
  while ((m = regex.exec(html)) !== null) matches.push(m[1].trim());
  return matches;
}

function extractMetaContent(html: string, nameOrProp: string): string | null {
  // Match name= or property=
  const r1 = new RegExp(`<meta[^>]*(?:name|property)=["']${nameOrProp}["'][^>]*content=["']([^"']*)["']`, 'i');
  const r2 = new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*(?:name|property)=["']${nameOrProp}["']`, 'i');
  const m = html.match(r1) || html.match(r2);
  return m ? m[1] : null;
}

function countWords(html: string): number {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

function extractLinks(html: string): { href: string; text: string; rel?: string }[] {
  const links: { href: string; text: string; rel?: string }[] = [];
  const regex = /<a\s+([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const attrs = m[1];
    const text = m[2].replace(/<[^>]+>/g, '').trim();
    const hrefMatch = attrs.match(/href=["']([^"']*)["']/);
    const relMatch = attrs.match(/rel=["']([^"']*)["']/);
    if (hrefMatch) {
      links.push({ href: hrefMatch[1], text, rel: relMatch?.[1] });
    }
  }
  return links;
}

function extractImgTags(html: string): { src: string; alt: string; hasAlt: boolean; loading?: string; hasWidth: boolean; hasHeight: boolean }[] {
  const imgs: { src: string; alt: string; hasAlt: boolean; loading?: string; hasWidth: boolean; hasHeight: boolean }[] = [];
  const regex = /<img\s+([^>]*)>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const attrs = m[1];
    const src = attrs.match(/src=["']([^"']*)["']/)?.[1] || '';
    const altMatch = attrs.match(/alt=["']([^"']*)["']/);
    const hasAlt = altMatch !== null;
    const alt = altMatch?.[1] || '';
    const loading = attrs.match(/loading=["']([^"']*)["']/)?.[1];
    const hasWidth = /width\s*=/.test(attrs);
    const hasHeight = /height\s*=/.test(attrs);
    imgs.push({ src, alt, hasAlt, loading, hasWidth, hasHeight });
  }
  return imgs;
}

function extractStyleBlocks(html: string): number {
  const regex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let total = 0;
  let m;
  while ((m = regex.exec(html)) !== null) total += m[1].length;
  return total;
}

function extractInlineScripts(html: string): number {
  // Count inline scripts (not external src ones)
  const regex = /<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi;
  let total = 0;
  let m;
  while ((m = regex.exec(html)) !== null) {
    // Exclude JSON-LD structured data
    if (m[0].includes('application/ld+json')) continue;
    total += m[1].length;
  }
  return total;
}

function countExternalResources(html: string): { stylesheets: number; scripts: number } {
  const cssRegex = /<link[^>]*rel=["']stylesheet["'][^>]*>/gi;
  const jsRegex = /<script[^>]*src=["'][^"']+["'][^>]*>/gi;
  let stylesheets = 0, scripts = 0;
  while (cssRegex.exec(html)) stylesheets++;
  while (jsRegex.exec(html)) scripts++;
  return { stylesheets, scripts };
}

function auditPage(
  pageId: string,
  pageName: string,
  slug: string,
  url: string,
  meta: PageMeta | null,
  html: string | null,
): PageSeoResult {
  const issues: SeoIssue[] = [];

  // --- Extract HTML-based values as fallback (Webflow API often returns empty OG/SEO data) ---
  const htmlTitle = html ? (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || '') : '';
  const htmlMetaDesc = html ? (extractMetaContent(html, 'description') || '') : '';
  const htmlOgTitle = html ? (extractMetaContent(html, 'og:title') || '') : '';
  const htmlOgDesc = html ? (extractMetaContent(html, 'og:description') || '') : '';
  const htmlOgImage = html ? (extractMetaContent(html, 'og:image') || '') : '';

  // --- Title tag (API → HTML fallback) ---
  const seoTitle = meta?.seo?.title || meta?.title || htmlTitle;
  if (!seoTitle) {
    issues.push({ check: 'title', severity: 'error', message: 'Missing page title', recommendation: 'Add a unique, descriptive title tag between 30-60 characters.' });
  } else if (seoTitle.length < 30) {
    issues.push({ check: 'title', severity: 'warning', message: `Title too short (${seoTitle.length} chars)`, recommendation: 'Expand the title to at least 30 characters for better SEO.', value: seoTitle });
  } else if (seoTitle.length > 60) {
    issues.push({ check: 'title', severity: 'warning', message: `Title too long (${seoTitle.length} chars)`, recommendation: 'Shorten the title to under 60 characters to prevent truncation in search results.', value: seoTitle });
  }

  // --- Meta description (API → HTML fallback) ---
  const metaDesc = meta?.seo?.description || htmlMetaDesc;
  if (!metaDesc) {
    issues.push({ check: 'meta-description', severity: 'error', message: 'Missing meta description', recommendation: 'Add a compelling meta description between 50-160 characters that summarizes the page content.' });
  } else if (metaDesc.length < 50) {
    issues.push({ check: 'meta-description', severity: 'warning', message: `Meta description too short (${metaDesc.length} chars)`, recommendation: 'Expand the meta description to at least 50 characters.', value: metaDesc });
  } else if (metaDesc.length > 160) {
    issues.push({ check: 'meta-description', severity: 'warning', message: `Meta description too long (${metaDesc.length} chars)`, recommendation: 'Shorten to under 160 characters to avoid truncation in search results.', value: metaDesc });
  }

  // --- Open Graph (API → HTML fallback; HTML is the source of truth) ---
  const ogTitle = meta?.openGraph?.title || htmlOgTitle;
  const ogDesc = meta?.openGraph?.description || htmlOgDesc;
  const ogImage = htmlOgImage;
  if (!ogTitle && !meta?.openGraph?.titleCopied) {
    issues.push({ check: 'og-tags', severity: 'warning', message: 'Missing Open Graph title', recommendation: 'Add an og:title for better social media sharing previews.' });
  }
  if (!ogDesc && !meta?.openGraph?.descriptionCopied) {
    issues.push({ check: 'og-tags', severity: 'warning', message: 'Missing Open Graph description', recommendation: 'Add an og:description for better social media sharing previews.' });
  }
  if (!ogImage) {
    issues.push({ check: 'og-image', severity: 'warning', message: 'Missing Open Graph image', recommendation: 'Add an og:image for social media sharing previews. Recommended size: 1200x630px.' });
  }

  // --- URL structure ---
  if (slug && slug.length > 75) {
    issues.push({ check: 'url', severity: 'warning', message: `URL slug too long (${slug.length} chars)`, recommendation: 'Shorten the URL slug to under 75 characters.', value: slug });
  }
  if (slug && /[A-Z]/.test(slug)) {
    issues.push({ check: 'url', severity: 'info', message: 'URL contains uppercase characters', recommendation: 'Use lowercase URLs for consistency and to avoid duplicate content issues.', value: slug });
  }

  // --- HTML-based checks ---
  if (html) {
    // H1 tags
    const h1s = extractTag(html, 'h1');
    if (h1s.length === 0) {
      issues.push({ check: 'h1', severity: 'error', message: 'Missing H1 tag', recommendation: 'Add exactly one H1 tag per page that describes the main content.' });
    } else if (h1s.length > 1) {
      issues.push({ check: 'h1', severity: 'warning', message: `Multiple H1 tags (${h1s.length})`, recommendation: 'Use only one H1 per page. Convert extra H1s to H2 or lower.' });
    }
    if (h1s.length === 1 && h1s[0].length > 70) {
      issues.push({ check: 'h1', severity: 'info', message: `H1 is long (${h1s[0].length} chars)`, recommendation: 'Keep H1 under 70 characters for optimal display.', value: h1s[0] });
    }

    // Heading hierarchy
    const headingRegex = /<h([1-6])[^>]*>/gi;
    const levels: number[] = [];
    let hm;
    while ((hm = headingRegex.exec(html)) !== null) levels.push(parseInt(hm[1]));
    for (let i = 1; i < levels.length; i++) {
      if (levels[i] - levels[i - 1] > 1) {
        issues.push({ check: 'heading-hierarchy', severity: 'warning', message: `Heading hierarchy skips from H${levels[i - 1]} to H${levels[i]}`, recommendation: `Don't skip heading levels. Use H${levels[i - 1] + 1} before H${levels[i]}.` });
        break;
      }
    }

    // Images without alt text (only flag images truly missing the alt attribute, not decorative alt="")
    const imgs = extractImgTags(html);
    const noAlt = imgs.filter(i => !i.hasAlt);
    if (noAlt.length > 0) {
      issues.push({ check: 'img-alt', severity: 'warning', message: `${noAlt.length} image${noAlt.length > 1 ? 's' : ''} missing alt text`, recommendation: 'Add descriptive alt text to all meaningful images for accessibility and SEO.' });
    }

    // Viewport meta
    const viewport = html.match(/<meta[^>]*name=["']viewport["']/i);
    if (!viewport) {
      issues.push({ check: 'viewport', severity: 'error', message: 'Missing viewport meta tag', recommendation: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> for mobile responsiveness.' });
    }

    // Structured data (JSON-LD)
    const jsonLd = html.match(/<script[^>]*type=["']application\/ld\+json["']/i);
    if (!jsonLd) {
      issues.push({ check: 'structured-data', severity: 'info', message: 'No structured data (JSON-LD) found', recommendation: 'Add JSON-LD structured data to help search engines understand your content and enable rich snippets.' });
    }

    // Robots meta
    const robotsMeta = extractMetaContent(html, 'robots');
    if (robotsMeta && robotsMeta.includes('noindex')) {
      issues.push({ check: 'robots', severity: 'warning', message: 'Page is set to noindex', recommendation: 'This page will not appear in search results. Remove noindex if this page should be indexed.', value: robotsMeta });
    }

    // Content length
    const wordCount = countWords(html);
    if (wordCount < 300) {
      issues.push({ check: 'content-length', severity: 'warning', message: `Thin content (${wordCount} words)`, recommendation: 'Pages with fewer than 300 words may rank poorly. Add more valuable content.' });
    }

    // Internal links
    const links = extractLinks(html);
    const internalLinks = links.filter(l => l.href.startsWith('/') || l.href.includes('webflow.io'));
    if (internalLinks.length === 0) {
      issues.push({ check: 'internal-links', severity: 'info', message: 'No internal links found', recommendation: 'Add internal links to help search engines discover other pages and distribute page authority.' });
    }

    // Check for empty link text (exclude links containing images, icons, SVGs, or aria-labels)
    const linkRegex2 = /<a\s+([^>]*)>([\s\S]*?)<\/a>/gi;
    let emptyLinkCount = 0;
    let lm2;
    while ((lm2 = linkRegex2.exec(html)) !== null) {
      const innerContent = lm2[2];
      const linkAttrs = lm2[1];
      const hrefAttr = linkAttrs.match(/href=["']([^"']*)['"]/);
      if (!hrefAttr || hrefAttr[1].startsWith('#')) continue;
      const textOnly = innerContent.replace(/<[^>]+>/g, '').trim();
      const hasImage = /<img\b/i.test(innerContent);
      const hasSvg = /<svg\b/i.test(innerContent);
      const hasAriaLabel = /aria-label/i.test(linkAttrs);
      if (!textOnly && !hasImage && !hasSvg && !hasAriaLabel) {
        emptyLinkCount++;
      }
    }
    if (emptyLinkCount > 0) {
      issues.push({ check: 'link-text', severity: 'warning', message: `${emptyLinkCount} link${emptyLinkCount > 1 ? 's' : ''} with empty anchor text`, recommendation: 'Add descriptive anchor text to all links for better accessibility and SEO.' });
    }

    // --- NEW TIER 1 CHECKS ---

    // 1. Mixed content (HTTP resources on HTTPS page)
    // Only flag actual resource loads, NOT regular <a> links
    if (url.startsWith('https://')) {
      const resourcePatterns = [
        /<(?:img|script|iframe|source|embed|video|audio)[^>]*src=["']http:\/\/[^"']+["']/gi,
        /<link[^>]*href=["']http:\/\/[^"']+["'][^>]*rel=["']stylesheet["']/gi,
        /<link[^>]*rel=["']stylesheet["'][^>]*href=["']http:\/\/[^"']+["']/gi,
      ];
      let mixedCount = 0;
      for (const pattern of resourcePatterns) {
        const matches = html.match(pattern) || [];
        mixedCount += matches.filter(r => !r.includes('http://schemas') && !r.includes('http://www.w3.org') && !r.includes('http://xmlns')).length;
      }
      if (mixedCount > 0) {
        issues.push({ check: 'mixed-content', severity: 'error', message: `${mixedCount} mixed content resource${mixedCount > 1 ? 's' : ''} (HTTP on HTTPS)`, recommendation: 'Update all resource URLs to use HTTPS. Mixed content can trigger browser security warnings and hurt trust.' });
      }
    }

    // 2. Canonical tag
    const canonical = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i)
      || html.match(/<link[^>]*href=["']([^"']*)["'][^>]*rel=["']canonical["']/i);
    if (!canonical) {
      issues.push({ check: 'canonical', severity: 'error', message: 'Missing canonical tag', recommendation: 'Add a <link rel="canonical"> tag to prevent duplicate content issues. This tells search engines the preferred URL for this page.' });
    } else {
      const canonicalUrl = canonical[1];
      // Check for obviously wrong canonicals (pointing to a different domain, or empty)
      if (!canonicalUrl || canonicalUrl.trim() === '') {
        issues.push({ check: 'canonical', severity: 'error', message: 'Empty canonical tag', recommendation: 'The canonical tag exists but has no URL. Set it to the full URL of this page.', value: '(empty)' });
      } else if (canonicalUrl.startsWith('http') && url.startsWith('http')) {
        try {
          const canonicalHost = new URL(canonicalUrl).hostname;
          const pageHost = new URL(url).hostname;
          // Only flag cross-domain canonicals if domains don't share a root (e.g. webflow.io → custom domain is fine)
          const canonRoot = canonicalHost.split('.').slice(-2).join('.');
          const pageRoot = pageHost.split('.').slice(-2).join('.');
          if (canonRoot !== pageRoot && !canonicalHost.includes('webflow.io') && !pageHost.includes('webflow.io')) {
            issues.push({ check: 'canonical', severity: 'warning', message: 'Canonical points to different domain', recommendation: `The canonical URL (${canonicalHost}) differs from the page domain (${pageHost}). Verify this is intentional.`, value: canonicalUrl });
          }
        } catch { /* skip malformed URLs */ }
      }
    }

    // 3. HTML document size
    const htmlSizeKB = Math.round(html.length / 1024);
    if (htmlSizeKB > 300) {
      issues.push({ check: 'html-size', severity: 'error', message: `Very large HTML document (${htmlSizeKB}KB)`, recommendation: 'HTML over 300KB significantly impacts page load. Audit for bloated inline styles, unused scripts, or excessive DOM elements.' });
    } else if (htmlSizeKB > 150) {
      issues.push({ check: 'html-size', severity: 'warning', message: `Large HTML document (${htmlSizeKB}KB)`, recommendation: 'HTML over 150KB can slow initial rendering. Remove unused code, inline styles, or move content to external files.' });
    }

    // 4. Images missing width/height dimensions (causes CLS — layout shift)
    let missingDimensionCount = 0;
    for (const img of imgs) {
      if (!img.src || img.src.startsWith('data:') || img.src.includes('.svg')) continue;
      if (!img.hasWidth && !img.hasHeight) {
        missingDimensionCount++;
      }
    }
    if (missingDimensionCount > 2) {
      issues.push({ check: 'img-filesize', severity: 'warning', message: `${missingDimensionCount} images missing width/height dimensions`, recommendation: 'Add explicit width and height attributes to images to prevent layout shift (CLS) and help browsers allocate space before loading.' });
    }

    // 5. Language attribute
    const htmlLang = html.match(/<html[^>]*\blang=["']([^"']*)["']/i);
    if (!htmlLang) {
      issues.push({ check: 'lang', severity: 'warning', message: 'Missing lang attribute on <html>', recommendation: 'Add a lang attribute (e.g., lang="en") to help search engines and assistive technology understand the page language.' });
    }

    // 6. Image lazy loading (account for Webflow's JS-based lazy loading via data-src)
    const hasWebflowLazy = /data-src=/i.test(html) || /class="[^"]*w-lazy/i.test(html) || /Webflow/i.test(html.slice(0, 2000));
    if (!hasWebflowLazy) {
      const imgsWithoutLazy = imgs.filter(i => !i.loading || i.loading !== 'lazy');
      // Only flag if there are several images — first 1-2 might be above the fold
      if (imgs.length > 3 && imgsWithoutLazy.length > 2) {
        issues.push({ check: 'lazy-loading', severity: 'info', message: `${imgsWithoutLazy.length} of ${imgs.length} images without native lazy loading`, recommendation: 'Consider adding loading="lazy" to below-the-fold images to improve initial page load performance.' });
      }
    }

    // 6. Inline CSS size
    const inlineCSSSize = extractStyleBlocks(html);
    if (inlineCSSSize > 15000) {
      issues.push({ check: 'inline-css', severity: 'warning', message: `Large inline CSS (${Math.round(inlineCSSSize / 1024)}KB)`, recommendation: 'Move large CSS blocks to external stylesheets for better caching and reduced HTML size.' });
    }

    // 8. Inline JS size
    const inlineJSSize = extractInlineScripts(html);
    if (inlineJSSize > 10000) {
      issues.push({ check: 'inline-js', severity: 'warning', message: `Large inline JavaScript (${Math.round(inlineJSSize / 1024)}KB)`, recommendation: 'Move large script blocks to external files for better caching and performance.' });
    }

    // 9. Render-blocking resources
    const resources = countExternalResources(html);
    if (resources.stylesheets + resources.scripts > 15) {
      issues.push({ check: 'render-blocking', severity: 'warning', message: `${resources.stylesheets} CSS + ${resources.scripts} JS files (${resources.stylesheets + resources.scripts} total)`, recommendation: 'Too many external resources can slow page rendering. Combine files, defer non-critical scripts, and lazy-load CSS where possible.' });
    }

  }

  // Auto-assign categories
  for (const issue of issues) {
    issue.category = CHECK_CATEGORY[issue.check] || 'technical';
  }

  // Score: start at 100, deduct per issue with weighted severity
  // Critical SEO checks get heavier deductions than cosmetic ones
  let score = 100;
  for (const issue of issues) {
    const isCritical = CRITICAL_CHECKS.has(issue.check);
    const isModerate = MODERATE_CHECKS.has(issue.check);
    if (issue.severity === 'error') {
      score -= isCritical ? 20 : 12;
    } else if (issue.severity === 'warning') {
      score -= isCritical ? 10 : isModerate ? 6 : 4;
    } else {
      score -= 1;
    }
  }
  score = Math.max(0, Math.min(100, score));

  return { pageId, page: pageName, slug, url, score, issues };
}

// Slugs / title keywords for pages that should be excluded from SEO audits.
// These are utility, legal, or error pages that inflate page counts and dilute the health score.
const EXCLUDED_SLUGS = new Set([
  '404', 'page-not-found', 'not-found',
  'search', 'search-results',
  'thank-you', 'thanks', 'thankyou',
  'confirmation', 'success',
  'unsubscribe', 'opt-out',
]);
const EXCLUDED_SLUG_KEYWORDS = [
  'password', 'protected', 'login', 'signin', 'sign-in',
  'privacy-policy', 'privacy', 'cookie-policy', 'cookie',
  'terms-of-service', 'terms-and-conditions', 'terms-of-use', 'terms',
  'legal', 'disclaimer', 'gdpr', 'ccpa',
  'style-guide', 'styleguide',
];

/** Returns true if a page should be excluded from SEO audit based on slug/title. */
function isExcludedPage(slug: string, title?: string): boolean {
  const s = (slug || '').toLowerCase().replace(/^\//, '');
  const t = (title || '').toLowerCase();
  if (EXCLUDED_SLUGS.has(s)) return true;
  for (const kw of EXCLUDED_SLUG_KEYWORDS) {
    if (s.includes(kw) || t.includes(kw)) return true;
  }
  return false;
}

export async function runSeoAudit(siteId: string, tokenOverride?: string, workspaceId?: string): Promise<SeoAuditResult> {
  const siteInfo = await getSiteInfo(siteId, tokenOverride);
  const baseUrl = siteInfo.subdomain ? `https://${siteInfo.subdomain}.webflow.io` : '';
  // Use custom domain for site-wide checks (robots.txt, sitemap) since webflow.io blocks crawlers by design
  const siteWideUrl = siteInfo.customDomain
    ? (siteInfo.customDomain.startsWith('http') ? siteInfo.customDomain : `https://${siteInfo.customDomain}`)
    : baseUrl;
  console.log(`SEO audit: subdomain=${siteInfo.subdomain}, baseUrl=${baseUrl}, siteWideUrl=${siteWideUrl}`);
  const allPages = await listPages(siteId, tokenOverride);
  // Filter published pages and exclude utility / legal / error pages
  const pages = filterPublishedPages(allPages).filter(
    (p: { title: string; slug: string }) => !isExcludedPage(p.slug, p.title)
  );
  console.log(`SEO audit: ${allPages.length} total pages, ${pages.length} published (excluded utility/legal/password/draft pages)`);

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
      console.log(`SEO audit: auditing ${filteredCmsUrls.length} CMS pages (${totalFound} total in sitemap, ${cmsUrls.length - filteredCmsUrls.length} excluded)`);
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
    console.log('[seo-audit] Running redirect scan...');
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
    console.error('[seo-audit] Redirect scan failed (non-fatal):', err);
  }

  // --- Homepage Core Web Vitals (quick single-page PSI check) ---
  const homepageUrl = siteWideUrl || baseUrl;
  if (homepageUrl && process.env.GOOGLE_PSI_KEY) {
    try {
      console.log('[seo-audit] Running homepage PageSpeed check...');
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
      console.error('[seo-audit] PageSpeed check failed (non-fatal):', err);
    }
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
    console.log(`[seo-audit] Generating AI recommendations for ${pagesNeedingFixes.length} pages (workspace: ${wsId || 'unknown'})...`);

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

    const aiBatch = 5;
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

Respond in this exact JSON format (only include fields that need fixing):
{"title":"...","metaDescription":"...","ogTitle":"..."}`;

          const aiResult = await callOpenAI({
            model: 'gpt-4o-mini',
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
          console.error(`[seo-audit] AI recommendation failed for ${pageResult.page}:`, err);
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

  const siteScore = results.length > 0
    ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length)
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
