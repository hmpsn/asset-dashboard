/**
 * Sales Audit Engine — URL-based SEO audit that works on ANY website.
 * No Webflow API needed. Discovers pages via sitemap/crawl, fetches HTML, runs checks.
 */

export type Severity = 'error' | 'warning' | 'info';
export type CheckCategory = 'content' | 'technical' | 'social' | 'performance' | 'accessibility';

export interface SalesIssue {
  check: string;
  severity: Severity;
  category?: CheckCategory;
  message: string;
  recommendation: string;
  value?: string;
  opportunityCost?: string;  // Sales framing: what they're losing
}

const CHECK_CATEGORY: Record<string, CheckCategory> = {
  'title': 'content', 'meta-description': 'content', 'h1': 'content', 'heading-hierarchy': 'content',
  'content-length': 'content', 'internal-links': 'content', 'link-text': 'content',
  'meta-keywords': 'content', 'h1-title-match': 'content', 'url': 'content',
  'duplicate-title': 'content', 'duplicate-description': 'content',
  'canonical': 'technical', 'viewport': 'technical', 'robots': 'technical', 'lang': 'technical',
  'favicon': 'technical', 'mixed-content': 'technical', 'ssl': 'technical',
  'robots-txt': 'technical', 'sitemap': 'technical', 'response-time': 'technical',
  'structured-data': 'technical',
  'og-tags': 'social', 'og-image': 'social', 'twitter-card': 'social',
  'lazy-loading': 'performance', 'img-dimensions': 'performance',
  'inline-css': 'performance', 'inline-js': 'performance', 'render-blocking': 'performance',
  'img-alt': 'accessibility',
};

export interface SalesPageResult {
  page: string;
  url: string;
  score: number;
  issues: SalesIssue[];
}

export interface SalesAuditResult {
  url: string;
  siteName: string;
  siteScore: number;
  totalPages: number;
  errors: number;
  warnings: number;
  infos: number;
  pages: SalesPageResult[];
  siteWideIssues: SalesIssue[];
  quickWins: SalesIssue[];
  topRisks: SalesIssue[];
  generatedAt: string;
}

// --- HTML parsing helpers ---

function extractTag(html: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  const matches: string[] = [];
  let m;
  while ((m = regex.exec(html)) !== null) matches.push(m[1].trim());
  return matches;
}

function extractMetaContent(html: string, nameOrProp: string): string | null {
  const r1 = new RegExp(`<meta[^>]*(?:name|property)=["']${nameOrProp}["'][^>]*content=["']([^"']*)["']`, 'i');
  const r2 = new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*(?:name|property)=["']${nameOrProp}["']`, 'i');
  const m = html.match(r1) || html.match(r2);
  return m ? m[1] : null;
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim() : '';
}

function extractMetaDescription(html: string): string {
  return extractMetaContent(html, 'description') || '';
}

function countWords(html: string): number {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

function extractLinks(html: string): { href: string; text: string }[] {
  const links: { href: string; text: string }[] = [];
  const regex = /<a\s+([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const attrs = m[1];
    const text = m[2].replace(/<[^>]+>/g, '').trim();
    const hrefMatch = attrs.match(/href=["']([^"']*)["']/);
    if (hrefMatch) links.push({ href: hrefMatch[1], text });
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
  const regex = /<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi;
  let total = 0;
  let m;
  while ((m = regex.exec(html)) !== null) {
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

// --- Page discovery ---

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEO-Audit-Bot/1.0)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/xml') && !contentType.includes('application/xml')) return null;
    return await res.text();
  } catch { return null; }
}

function normalizeUrl(base: string, href: string): string | null {
  try {
    const u = new URL(href, base);
    // Only same-origin pages
    const baseOrigin = new URL(base).origin;
    if (u.origin !== baseOrigin) return null;
    // Skip anchors, files, etc.
    if (u.hash) u.hash = '';
    const path = u.pathname;
    if (/\.(pdf|jpg|jpeg|png|gif|svg|webp|mp4|mp3|zip|css|js|ico|woff|woff2|ttf|eot)$/i.test(path)) return null;
    return u.toString();
  } catch { return null; }
}

async function discoverPages(baseUrl: string, maxPages: number = 25): Promise<string[]> {
  const found = new Set<string>();
  found.add(baseUrl);

  // Try sitemap first
  const sitemapUrls = await parseSitemap(baseUrl);
  for (const u of sitemapUrls) {
    if (found.size >= maxPages) break;
    found.add(u);
  }

  // If sitemap didn't yield enough, crawl from homepage
  if (found.size < 5) {
    const html = await fetchHtml(baseUrl);
    if (html) {
      const links = extractLinks(html);
      for (const link of links) {
        if (found.size >= maxPages) break;
        const normalized = normalizeUrl(baseUrl, link.href);
        if (normalized && !found.has(normalized)) {
          found.add(normalized);
        }
      }
    }
  }

  return Array.from(found);
}

async function parseSitemap(baseUrl: string): Promise<string[]> {
  const urls: string[] = [];
  try {
    const sitemapUrl = `${baseUrl}/sitemap.xml`;
    const res = await fetch(sitemapUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return urls;
    const text = await res.text();
    if (!text.trimStart().startsWith('<?xml') && !text.includes('<urlset') && !text.includes('<sitemapindex')) return urls;

    // Handle sitemap index
    if (text.includes('<sitemapindex')) {
      const locRegex = /<loc>([^<]+)<\/loc>/gi;
      let m;
      const subSitemaps: string[] = [];
      while ((m = locRegex.exec(text)) !== null) subSitemaps.push(m[1]);
      // Parse first sub-sitemap only
      if (subSitemaps.length > 0) {
        try {
          const subRes = await fetch(subSitemaps[0], { redirect: 'follow', signal: AbortSignal.timeout(5000) });
          if (subRes.ok) {
            const subText = await subRes.text();
            const subLocRegex = /<loc>([^<]+)<\/loc>/gi;
            let sm;
            while ((sm = subLocRegex.exec(subText)) !== null) urls.push(sm[1]);
          }
        } catch { /* skip */ }
      }
    } else {
      const locRegex = /<loc>([^<]+)<\/loc>/gi;
      let m;
      while ((m = locRegex.exec(text)) !== null) urls.push(m[1]);
    }
  } catch { /* skip */ }
  return urls;
}

// --- Page audit (HTML-only, no API) ---

function auditPageFromHtml(url: string, html: string): SalesPageResult {
  const issues: SalesIssue[] = [];
  const pagePath = new URL(url).pathname || '/';
  const pageName = pagePath === '/' ? 'Home' : pagePath.replace(/^\//, '').replace(/\/$/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  // Title
  const title = extractTitle(html);
  if (!title) {
    issues.push({ check: 'title', severity: 'error', message: 'Missing page title', recommendation: 'Add a unique, descriptive title tag between 30-60 characters.', opportunityCost: 'Pages without titles rarely rank in search results.' });
  } else if (title.length < 30) {
    issues.push({ check: 'title', severity: 'warning', message: `Title too short (${title.length} chars)`, recommendation: 'Expand the title to at least 30 characters for better SEO.', value: title, opportunityCost: 'Short titles miss keyword opportunities and reduce click-through rates.' });
  } else if (title.length > 60) {
    issues.push({ check: 'title', severity: 'warning', message: `Title too long (${title.length} chars)`, recommendation: 'Shorten to under 60 characters to prevent truncation in search results.', value: title });
  }

  // Meta description
  const metaDesc = extractMetaDescription(html);
  if (!metaDesc) {
    issues.push({ check: 'meta-description', severity: 'error', message: 'Missing meta description', recommendation: 'Add a compelling meta description between 50-160 characters.', opportunityCost: 'Without a meta description, Google generates its own snippet — often poorly.' });
  } else if (metaDesc.length < 50) {
    issues.push({ check: 'meta-description', severity: 'warning', message: `Meta description too short (${metaDesc.length} chars)`, recommendation: 'Expand to at least 50 characters.', value: metaDesc });
  } else if (metaDesc.length > 160) {
    issues.push({ check: 'meta-description', severity: 'warning', message: `Meta description too long (${metaDesc.length} chars)`, recommendation: 'Shorten to under 160 characters.', value: metaDesc });
  }

  // H1
  const h1s = extractTag(html, 'h1');
  if (h1s.length === 0) {
    issues.push({ check: 'h1', severity: 'error', message: 'Missing H1 tag', recommendation: 'Add exactly one H1 tag that describes the main content.', opportunityCost: 'Missing H1 tags signal poor page structure to search engines.' });
  } else if (h1s.length > 1) {
    issues.push({ check: 'h1', severity: 'warning', message: `Multiple H1 tags (${h1s.length})`, recommendation: 'Use only one H1 per page.' });
  }

  // Heading hierarchy
  const headingRegex = /<h([1-6])[^>]*>/gi;
  const levels: number[] = [];
  let hm;
  while ((hm = headingRegex.exec(html)) !== null) levels.push(parseInt(hm[1]));
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) {
      issues.push({ check: 'heading-hierarchy', severity: 'warning', message: `Heading hierarchy skips from H${levels[i - 1]} to H${levels[i]}`, recommendation: `Don't skip heading levels.` });
      break;
    }
  }

  // Images
  const imgs = extractImgTags(html);
  const noAlt = imgs.filter(i => !i.alt || i.alt.trim() === '');
  if (noAlt.length > 0) {
    issues.push({ check: 'img-alt', severity: 'warning', message: `${noAlt.length} image${noAlt.length > 1 ? 's' : ''} missing alt text`, recommendation: 'Add descriptive alt text to all images.', opportunityCost: 'Missing alt text hurts accessibility scores and image search visibility.' });
  }

  // Canonical
  const canonical = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i);
  if (!canonical) {
    issues.push({ check: 'canonical', severity: 'warning', message: 'Missing canonical tag', recommendation: 'Add a canonical tag to prevent duplicate content issues.' });
  }

  // Viewport
  const viewport = html.match(/<meta[^>]*name=["']viewport["']/i);
  if (!viewport) {
    issues.push({ check: 'viewport', severity: 'error', message: 'Missing viewport meta tag', recommendation: 'Add viewport meta tag for mobile responsiveness.', opportunityCost: 'Google uses mobile-first indexing. No viewport = poor mobile experience = lower rankings.' });
  }

  // Structured data
  const jsonLd = html.match(/<script[^>]*type=["']application\/ld\+json["']/i);
  if (!jsonLd) {
    issues.push({ check: 'structured-data', severity: 'info', message: 'No structured data found', recommendation: 'Add JSON-LD structured data for rich snippets in search results.', opportunityCost: 'Structured data can increase click-through rates by 20-30% with rich snippets.' });
  }

  // Robots meta
  const robotsMeta = extractMetaContent(html, 'robots');
  if (robotsMeta && robotsMeta.includes('noindex')) {
    issues.push({ check: 'robots', severity: 'warning', message: 'Page is set to noindex', recommendation: 'This page will not appear in search results.', value: robotsMeta });
  }

  // OG tags
  const ogTitle = extractMetaContent(html, 'og:title');
  const ogDesc = extractMetaContent(html, 'og:description');
  if (!ogTitle) {
    issues.push({ check: 'og-tags', severity: 'warning', message: 'Missing Open Graph title', recommendation: 'Add og:title for social sharing previews.' });
  }
  if (!ogDesc) {
    issues.push({ check: 'og-tags', severity: 'warning', message: 'Missing Open Graph description', recommendation: 'Add og:description for social sharing.' });
  }
  const ogImage = extractMetaContent(html, 'og:image');
  if (!ogImage) {
    issues.push({ check: 'og-image', severity: 'warning', message: 'Missing Open Graph image', recommendation: 'Add og:image (1200x630px) for social sharing.', opportunityCost: 'Links shared without an image get 2-3x fewer clicks on social media.' });
  }

  // Content length
  const wordCount = countWords(html);
  if (wordCount < 300) {
    issues.push({ check: 'content-length', severity: 'warning', message: `Thin content (${wordCount} words)`, recommendation: 'Pages with fewer than 300 words may rank poorly.', opportunityCost: 'Thin pages are often outranked by competitors with richer content.' });
  }

  // Internal links
  const links = extractLinks(html);
  const baseOrigin = new URL(url).origin;
  const internalLinks = links.filter(l => {
    try { return new URL(l.href, url).origin === baseOrigin; } catch { return l.href.startsWith('/'); }
  });
  if (internalLinks.length === 0) {
    issues.push({ check: 'internal-links', severity: 'info', message: 'No internal links found', recommendation: 'Add internal links to distribute page authority.' });
  }

  // Empty link text
  const linkRegex = /<a\s+([^>]*)>([\s\S]*?)<\/a>/gi;
  let emptyLinkCount = 0;
  let lm;
  while ((lm = linkRegex.exec(html)) !== null) {
    const innerContent = lm[2];
    const linkAttrs = lm[1];
    const hrefAttr = linkAttrs.match(/href=["']([^"']*)['"]/);
    if (!hrefAttr || hrefAttr[1].startsWith('#')) continue;
    const textOnly = innerContent.replace(/<[^>]+>/g, '').trim();
    const hasImage = /<img\b/i.test(innerContent);
    const hasSvg = /<svg\b/i.test(innerContent);
    const hasAriaLabel = /aria-label/i.test(linkAttrs);
    if (!textOnly && !hasImage && !hasSvg && !hasAriaLabel) emptyLinkCount++;
  }
  if (emptyLinkCount > 0) {
    issues.push({ check: 'link-text', severity: 'warning', message: `${emptyLinkCount} link${emptyLinkCount > 1 ? 's' : ''} with empty anchor text`, recommendation: 'Add descriptive anchor text.' });
  }

  // Mixed content
  if (url.startsWith('https://')) {
    const resourcePatterns = [
      /<(?:img|script|iframe|source|embed|video|audio)[^>]*src=["']http:\/\/[^"']+["']/gi,
      /<link[^>]*href=["']http:\/\/[^"']+["'][^>]*rel=["']stylesheet["']/gi,
    ];
    let mixedCount = 0;
    for (const pattern of resourcePatterns) {
      const matches = html.match(pattern) || [];
      mixedCount += matches.filter(r => !r.includes('http://schemas') && !r.includes('http://www.w3.org')).length;
    }
    if (mixedCount > 0) {
      issues.push({ check: 'mixed-content', severity: 'error', message: `${mixedCount} mixed content resource${mixedCount > 1 ? 's' : ''}`, recommendation: 'Update all resources to HTTPS.', opportunityCost: 'Mixed content triggers browser security warnings, destroying user trust.' });
    }
  }

  // Twitter Card
  const twitterCard = extractMetaContent(html, 'twitter:card');
  if (!twitterCard) {
    issues.push({ check: 'twitter-card', severity: 'info', message: 'Missing Twitter Card tags', recommendation: 'Add twitter:card meta tags for X/Twitter sharing.' });
  }

  // Language attribute
  const htmlLang = html.match(/<html[^>]*\blang=["']([^"']*)["']/i);
  if (!htmlLang) {
    issues.push({ check: 'lang', severity: 'warning', message: 'Missing lang attribute on <html>', recommendation: 'Add lang="en" (or appropriate language) to the html tag.' });
  }

  // Favicon
  const favicon = html.match(/<link[^>]*rel=["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*>/i);
  if (!favicon) {
    issues.push({ check: 'favicon', severity: 'info', message: 'No favicon detected', recommendation: 'Add a favicon for brand recognition.' });
  }

  // Lazy loading
  const imgsWithoutLazy = imgs.filter(i => !i.loading || i.loading !== 'lazy');
  if (imgs.length > 3 && imgsWithoutLazy.length > 2) {
    issues.push({ check: 'lazy-loading', severity: 'info', message: `${imgsWithoutLazy.length} of ${imgs.length} images without lazy loading`, recommendation: 'Add loading="lazy" to below-the-fold images.' });
  }

  // Inline CSS
  const inlineCSSSize = extractStyleBlocks(html);
  if (inlineCSSSize > 15000) {
    issues.push({ check: 'inline-css', severity: 'warning', message: `Large inline CSS (${Math.round(inlineCSSSize / 1024)}KB)`, recommendation: 'Move CSS to external stylesheets for better caching.' });
  }

  // Inline JS
  const inlineJSSize = extractInlineScripts(html);
  if (inlineJSSize > 10000) {
    issues.push({ check: 'inline-js', severity: 'warning', message: `Large inline JavaScript (${Math.round(inlineJSSize / 1024)}KB)`, recommendation: 'Move scripts to external files.' });
  }

  // External resources
  const resources = countExternalResources(html);
  if (resources.stylesheets + resources.scripts > 15) {
    issues.push({ check: 'render-blocking', severity: 'warning', message: `${resources.stylesheets} CSS + ${resources.scripts} JS files`, recommendation: 'Reduce external resources to improve load time.' });
  }

  // URL structure
  const slug = new URL(url).pathname;
  if (slug.length > 75) {
    issues.push({ check: 'url', severity: 'warning', message: `URL path too long (${slug.length} chars)`, recommendation: 'Shorten URL paths for better usability and SEO.', value: slug });
  }

  // H1 matches title
  if (h1s.length === 1 && title) {
    const h1Clean = h1s[0].replace(/<[^>]+>/g, '').trim().toLowerCase();
    const titleClean = title.trim().toLowerCase();
    if (h1Clean === titleClean && h1Clean.length > 0) {
      issues.push({ check: 'h1-title-match', severity: 'info', message: 'H1 and title tag are identical', recommendation: 'Differentiate H1 from title for maximum keyword coverage.' });
    }
  }

  // Assign categories
  for (const issue of issues) {
    issue.category = CHECK_CATEGORY[issue.check] || 'technical';
  }

  // Score
  let score = 100;
  for (const issue of issues) {
    if (issue.severity === 'error') score -= 15;
    else if (issue.severity === 'warning') score -= 7;
    else score -= 2;
  }
  score = Math.max(0, Math.min(100, score));

  return { page: pageName, url, score, issues };
}

// --- Site-wide checks ---

async function siteWideChecks(baseUrl: string): Promise<SalesIssue[]> {
  const issues: SalesIssue[] = [];

  // SSL
  if (!baseUrl.startsWith('https://')) {
    issues.push({ check: 'ssl', severity: 'error', message: 'Site is not using HTTPS', recommendation: 'Enable SSL/HTTPS immediately.', opportunityCost: 'Google penalizes non-HTTPS sites. Users see "Not Secure" warnings, destroying trust.' });
  }

  // Robots.txt
  try {
    const robotsRes = await fetch(`${baseUrl}/robots.txt`, { redirect: 'follow', signal: AbortSignal.timeout(5000) });
    if (!robotsRes.ok) {
      issues.push({ check: 'robots-txt', severity: 'warning', message: 'Missing robots.txt', recommendation: 'Create a robots.txt file to guide search engine crawlers.' });
    } else {
      const robotsTxt = await robotsRes.text();
      const looksLikeHtml = robotsTxt.trimStart().startsWith('<!') || robotsTxt.trimStart().startsWith('<html');
      if (looksLikeHtml) {
        issues.push({ check: 'robots-txt', severity: 'warning', message: 'Missing robots.txt', recommendation: 'Create a robots.txt file.' });
      } else {
        const lines = robotsTxt.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
        let currentUA = '';
        const blocks: { ua: string; disallow: string[] }[] = [];
        for (const line of lines) {
          if (line.toLowerCase().startsWith('user-agent:')) {
            currentUA = line.split(':')[1]?.trim() || '';
            blocks.push({ ua: currentUA, disallow: [] });
          } else if (line.toLowerCase().startsWith('disallow:') && blocks.length > 0) {
            blocks[blocks.length - 1].disallow.push(line.split(':').slice(1).join(':').trim());
          }
        }
        const wildcardBlock = blocks.find(b => b.ua === '*');
        if (wildcardBlock?.disallow.includes('/')) {
          issues.push({ check: 'robots-txt', severity: 'error', message: 'robots.txt blocks all crawlers', recommendation: 'Remove "Disallow: /" to allow search engines to index your site.', opportunityCost: 'Your site is completely invisible to search engines.' });
        }
        if (!robotsTxt.toLowerCase().includes('sitemap:')) {
          issues.push({ check: 'robots-txt', severity: 'info', message: 'robots.txt missing sitemap reference', recommendation: 'Add Sitemap: directive to robots.txt.' });
        }
      }
    }
  } catch { /* skip */ }

  // Sitemap
  try {
    const sitemapRes = await fetch(`${baseUrl}/sitemap.xml`, { redirect: 'follow', signal: AbortSignal.timeout(5000) });
    if (!sitemapRes.ok) {
      issues.push({ check: 'sitemap', severity: 'warning', message: 'Missing XML sitemap', recommendation: 'Create a sitemap.xml for better indexing.', opportunityCost: 'Without a sitemap, search engines may miss pages on your site.' });
    } else {
      const sitemapText = await sitemapRes.text();
      const isXml = sitemapText.trimStart().startsWith('<?xml') || sitemapText.includes('<urlset') || sitemapText.includes('<sitemapindex');
      if (!isXml) {
        issues.push({ check: 'sitemap', severity: 'warning', message: 'Missing XML sitemap', recommendation: 'Create a sitemap.xml.' });
      } else {
        const sitemapUrls = (sitemapText.match(/<loc>([^<]+)<\/loc>/gi) || []).length;
        if (sitemapUrls === 0) {
          issues.push({ check: 'sitemap', severity: 'warning', message: 'XML sitemap is empty', recommendation: 'Ensure sitemap lists all indexable pages.' });
        }
      }
    }
  } catch { /* skip */ }

  // Response time
  try {
    const startTime = Date.now();
    await fetch(baseUrl, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
    const responseTime = Date.now() - startTime;
    if (responseTime > 3000) {
      issues.push({ check: 'response-time', severity: 'error', message: `Slow server response (${(responseTime / 1000).toFixed(1)}s)`, recommendation: 'Optimize server response time to under 600ms.', value: `${responseTime}ms`, opportunityCost: '53% of mobile users abandon sites that take over 3 seconds to load.' });
    } else if (responseTime > 1000) {
      issues.push({ check: 'response-time', severity: 'warning', message: `Server response ${(responseTime / 1000).toFixed(1)}s`, recommendation: 'Aim for under 600ms response time.', value: `${responseTime}ms` });
    }
  } catch { /* skip */ }

  // Assign categories
  for (const issue of issues) {
    issue.category = CHECK_CATEGORY[issue.check] || 'technical';
  }

  return issues;
}

// --- Main entry point ---

export async function runSalesAudit(inputUrl: string, maxPages: number = 25): Promise<SalesAuditResult> {
  // Normalize URL
  let baseUrl = inputUrl.trim();
  if (!baseUrl.startsWith('http')) baseUrl = `https://${baseUrl}`;
  baseUrl = baseUrl.replace(/\/+$/, '');

  console.log(`[sales-audit] Starting audit for ${baseUrl}`);

  // Discover pages
  const pageUrls = await discoverPages(baseUrl, maxPages);
  console.log(`[sales-audit] Discovered ${pageUrls.length} pages`);

  // Fetch and audit each page in batches
  const results: SalesPageResult[] = [];
  const titleCache: { title: string; page: string }[] = [];
  const descCache: { desc: string; page: string }[] = [];
  const batch = 5;

  for (let i = 0; i < pageUrls.length; i += batch) {
    const chunk = pageUrls.slice(i, i + batch);
    const chunkResults = await Promise.all(
      chunk.map(async (pageUrl) => {
        const html = await fetchHtml(pageUrl);
        if (!html) return null;
        const result = auditPageFromHtml(pageUrl, html);

        // Cache for duplicate detection
        const title = extractTitle(html).toLowerCase().trim();
        const desc = extractMetaDescription(html).toLowerCase().trim();
        if (title) titleCache.push({ title, page: result.page });
        if (desc) descCache.push({ desc, page: result.page });

        return result;
      })
    );
    results.push(...chunkResults.filter((r): r is SalesPageResult => r !== null));
  }

  // Site-wide checks
  const siteWideIssues = await siteWideChecks(baseUrl);

  // Duplicate titles
  const titleMap = new Map<string, string[]>();
  for (const item of titleCache) {
    if (!titleMap.has(item.title)) titleMap.set(item.title, []);
    titleMap.get(item.title)!.push(item.page);
  }
  for (const [title, pgs] of titleMap) {
    if (pgs.length > 1) {
      siteWideIssues.push({
        check: 'duplicate-title', severity: 'error', category: 'content',
        message: `Duplicate title across ${pgs.length} pages`,
        recommendation: `Make each page title unique. Pages: ${pgs.join(', ')}`,
        value: title, opportunityCost: 'Duplicate titles cause keyword cannibalization — your own pages compete against each other.',
      });
    }
  }

  // Duplicate descriptions
  const descMap = new Map<string, string[]>();
  for (const item of descCache) {
    if (!descMap.has(item.desc)) descMap.set(item.desc, []);
    descMap.get(item.desc)!.push(item.page);
  }
  for (const [desc, pgs] of descMap) {
    if (pgs.length > 1) {
      siteWideIssues.push({
        check: 'duplicate-description', severity: 'warning', category: 'content',
        message: `Duplicate meta description across ${pgs.length} pages`,
        recommendation: `Write unique descriptions for each page. Pages: ${pgs.join(', ')}`,
        value: desc.slice(0, 80) + (desc.length > 80 ? '...' : ''),
      });
    }
  }

  // Sort pages best-to-worst
  results.sort((a, b) => b.score - a.score);

  // Count totals
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
    : 0;

  // Extract site name from homepage title or URL
  const siteName = results[0]
    ? extractTitle(await fetchHtml(baseUrl) || '').replace(/\s*[-|–—]\s*.*$/, '').trim() || new URL(baseUrl).hostname
    : new URL(baseUrl).hostname;

  // Identify quick wins (high-impact, easy fixes)
  const allIssues = [...siteWideIssues, ...results.flatMap(r => r.issues)];
  const quickWinChecks = ['meta-description', 'title', 'og-tags', 'og-image', 'img-alt', 'lang', 'structured-data'];
  const quickWins = allIssues
    .filter(i => quickWinChecks.includes(i.check) && (i.severity === 'error' || i.severity === 'warning'))
    .filter((v, idx, arr) => arr.findIndex(a => a.check === v.check && a.message === v.message) === idx)
    .slice(0, 5);

  // Top risks (errors with opportunity cost)
  const topRisks = allIssues
    .filter(i => i.severity === 'error' && i.opportunityCost)
    .filter((v, idx, arr) => arr.findIndex(a => a.check === v.check && a.message === v.message) === idx)
    .slice(0, 5);

  return {
    url: baseUrl,
    siteName,
    siteScore,
    totalPages: results.length,
    errors: totalErrors,
    warnings: totalWarnings,
    infos: totalInfos,
    pages: results,
    siteWideIssues,
    quickWins,
    topRisks,
    generatedAt: new Date().toISOString(),
  };
}
