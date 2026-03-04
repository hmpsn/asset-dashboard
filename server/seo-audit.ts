import { listPages, filterPublishedPages } from './webflow.js';

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
}

const CHECK_CATEGORY: Record<string, CheckCategory> = {
  // Content
  'title': 'content', 'meta-description': 'content', 'h1': 'content', 'heading-hierarchy': 'content',
  'content-length': 'content', 'internal-links': 'content', 'link-text': 'content',
  'meta-keywords': 'content', 'h1-title-match': 'content', 'url': 'content',
  'duplicate-title': 'content', 'duplicate-description': 'content',
  // Technical
  'canonical': 'technical', 'viewport': 'technical', 'robots': 'technical', 'lang': 'technical',
  'favicon': 'technical', 'mixed-content': 'technical', 'ssl': 'technical',
  'robots-txt': 'technical', 'sitemap': 'technical', 'response-time': 'technical',
  'structured-data': 'technical',
  // Social
  'og-tags': 'social', 'og-image': 'social', 'twitter-card': 'social',
  // Performance
  'lazy-loading': 'performance', 'img-dimensions': 'performance',
  'inline-css': 'performance', 'inline-js': 'performance', 'render-blocking': 'performance',
  // Accessibility
  'img-alt': 'accessibility',
};

export interface PageSeoResult {
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

function extractImgTags(html: string): { src: string; alt: string; loading?: string; hasWidth: boolean; hasHeight: boolean }[] {
  const imgs: { src: string; alt: string; loading?: string; hasWidth: boolean; hasHeight: boolean }[] = [];
  const regex = /<img\s+([^>]*)>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const attrs = m[1];
    const src = attrs.match(/src=["']([^"']*)["']/)?.[1] || '';
    const alt = attrs.match(/alt=["']([^"']*)["']/)?.[1] || '';
    const loading = attrs.match(/loading=["']([^"']*)["']/)?.[1];
    const hasWidth = /width\s*=/.test(attrs);
    const hasHeight = /height\s*=/.test(attrs);
    imgs.push({ src, alt, loading, hasWidth, hasHeight });
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

    // Images without alt text
    const imgs = extractImgTags(html);
    const noAlt = imgs.filter(i => !i.alt || i.alt.trim() === '');
    if (noAlt.length > 0) {
      issues.push({ check: 'img-alt', severity: 'warning', message: `${noAlt.length} image${noAlt.length > 1 ? 's' : ''} missing alt text`, recommendation: 'Add descriptive alt text to all meaningful images for accessibility and SEO.' });
    }

    // Canonical tag
    const canonical = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i);
    if (!canonical) {
      issues.push({ check: 'canonical', severity: 'warning', message: 'Missing canonical tag', recommendation: 'Add a canonical tag to prevent duplicate content issues.' });
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

    // 2. Twitter Card tags
    const twitterCard = extractMetaContent(html, 'twitter:card');
    if (!twitterCard) {
      issues.push({ check: 'twitter-card', severity: 'info', message: 'Missing Twitter Card tags', recommendation: 'Add twitter:card, twitter:title, and twitter:description meta tags for better Twitter/X sharing previews.' });
    }

    // 3. Language attribute
    const htmlLang = html.match(/<html[^>]*\blang=["']([^"']*)["']/i);
    if (!htmlLang) {
      issues.push({ check: 'lang', severity: 'warning', message: 'Missing lang attribute on <html>', recommendation: 'Add a lang attribute (e.g., lang="en") to help search engines and assistive technology understand the page language.' });
    }

    // 4. Favicon
    const favicon = html.match(/<link[^>]*rel=["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*>/i);
    if (!favicon) {
      issues.push({ check: 'favicon', severity: 'info', message: 'No favicon detected', recommendation: 'Add a favicon for better brand recognition in browser tabs and bookmarks.' });
    }

    // 5. Image lazy loading (account for Webflow's JS-based lazy loading via data-src)
    const hasWebflowLazy = /data-src=/i.test(html) || /class="[^"]*w-lazy/i.test(html) || /Webflow/i.test(html.slice(0, 2000));
    if (!hasWebflowLazy) {
      const imgsWithoutLazy = imgs.filter(i => !i.loading || i.loading !== 'lazy');
      // Only flag if there are several images — first 1-2 might be above the fold
      if (imgs.length > 3 && imgsWithoutLazy.length > 2) {
        issues.push({ check: 'lazy-loading', severity: 'info', message: `${imgsWithoutLazy.length} of ${imgs.length} images without native lazy loading`, recommendation: 'Consider adding loading="lazy" to below-the-fold images to improve initial page load performance.' });
      }
    }

    // 6. Image dimensions (CLS prevention)
    // Only flag when a significant portion lack dimensions; Webflow often handles sizing via CSS
    const noDimensions = imgs.filter(i => !i.hasWidth || !i.hasHeight);
    if (noDimensions.length > 3 && noDimensions.length > imgs.length * 0.5) {
      issues.push({ check: 'img-dimensions', severity: 'info', message: `${noDimensions.length} of ${imgs.length} images missing width/height attributes`, recommendation: 'Consider adding explicit width and height on images to help prevent Cumulative Layout Shift (CLS). If CSS handles sizing, this may not apply.' });
    }

    // 7. Inline CSS size
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

    // 10. Meta keywords (deprecated)
    const metaKeywords = extractMetaContent(html, 'keywords');
    if (metaKeywords) {
      issues.push({ check: 'meta-keywords', severity: 'info', message: 'Using deprecated meta keywords tag', recommendation: 'The meta keywords tag is ignored by Google and most search engines. Focus on content quality instead.' });
    }

    // 11. H1 matches title exactly (missed optimization)
    if (h1s.length === 1 && seoTitle) {
      const h1Clean = h1s[0].replace(/<[^>]+>/g, '').trim().toLowerCase();
      const titleClean = seoTitle.trim().toLowerCase();
      if (h1Clean === titleClean && h1Clean.length > 0) {
        issues.push({ check: 'h1-title-match', severity: 'info', message: 'H1 and title tag are identical', recommendation: 'Differentiate your H1 from the title tag slightly. The title targets search engines while H1 targets readers on the page.' });
      }
    }
  }

  // Auto-assign categories
  for (const issue of issues) {
    issue.category = CHECK_CATEGORY[issue.check] || 'technical';
  }

  // Score: start at 100, deduct per issue
  let score = 100;
  for (const issue of issues) {
    if (issue.severity === 'error') score -= 15;
    else if (issue.severity === 'warning') score -= 7;
    else score -= 2;
  }
  score = Math.max(0, Math.min(100, score));

  return { page: pageName, slug, url, score, issues };
}

export async function runSeoAudit(siteId: string, tokenOverride?: string): Promise<SeoAuditResult> {
  const siteInfo = await getSiteInfo(siteId, tokenOverride);
  const baseUrl = siteInfo.subdomain ? `https://${siteInfo.subdomain}.webflow.io` : '';
  // Use custom domain for site-wide checks (robots.txt, sitemap) since webflow.io blocks crawlers by design
  const siteWideUrl = siteInfo.customDomain
    ? (siteInfo.customDomain.startsWith('http') ? siteInfo.customDomain : `https://${siteInfo.customDomain}`)
    : baseUrl;
  console.log(`SEO audit: subdomain=${siteInfo.subdomain}, baseUrl=${baseUrl}, siteWideUrl=${siteWideUrl}`);
  const allPages = await listPages(siteId, tokenOverride);
  // Filter published pages and exclude password-protected pages
  const pages = filterPublishedPages(allPages).filter(
    (p: { title: string; slug: string }) => !(p.title || '').toLowerCase().includes('password') && !(p.slug || '').toLowerCase().includes('password')
  );
  console.log(`SEO audit: ${allPages.length} total pages, ${pages.length} published (excluded password + draft pages)`);

  // Fetch metadata and HTML in parallel (batch of 5), cache meta for site-wide checks
  const results: PageSeoResult[] = [];
  const metaCache: { title: string; desc: string; page: string }[] = [];
  const batch = 5;

  for (let i = 0; i < pages.length; i += batch) {
    const chunk = pages.slice(i, i + batch);
    const chunkResults = await Promise.all(
      chunk.map(async (page) => {
        const url = page.slug ? `${baseUrl}/${page.slug}` : baseUrl;
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
        return auditPage(page.title, page.slug, url, meta, html);
      })
    );
    results.push(...chunkResults);
  }

  // Site-wide checks
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

  // Auto-assign categories to site-wide issues
  for (const issue of siteWideIssues) {
    issue.category = CHECK_CATEGORY[issue.check] || 'technical';
  }

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
