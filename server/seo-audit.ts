import { listPages, filterPublishedPages } from './webflow.js';

const WEBFLOW_API = 'https://api.webflow.com/v2';

function getToken(tokenOverride?: string): string | null {
  return tokenOverride || process.env.WEBFLOW_API_TOKEN || null;
}

export type Severity = 'error' | 'warning' | 'info';

export interface SeoIssue {
  check: string;
  severity: Severity;
  message: string;
  recommendation: string;
  value?: string;
}

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

async function getSiteSubdomain(siteId: string, tokenOverride?: string): Promise<string | null> {
  const token = getToken(tokenOverride);
  if (!token) return null;
  const res = await fetch(`${WEBFLOW_API}/sites/${siteId}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) return null;
  const data = await res.json() as { shortName?: string };
  return data.shortName || null;
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

function extractImgTags(html: string): { src: string; alt: string }[] {
  const imgs: { src: string; alt: string }[] = [];
  const regex = /<img\s+([^>]*)>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const attrs = m[1];
    const src = attrs.match(/src=["']([^"']*)["']/)?.[1] || '';
    const alt = attrs.match(/alt=["']([^"']*)["']/)?.[1] || '';
    imgs.push({ src, alt });
  }
  return imgs;
}

function auditPage(
  pageName: string,
  slug: string,
  url: string,
  meta: PageMeta | null,
  html: string | null,
): PageSeoResult {
  const issues: SeoIssue[] = [];

  // --- Title tag ---
  const seoTitle = meta?.seo?.title || meta?.title || '';
  if (!seoTitle) {
    issues.push({ check: 'title', severity: 'error', message: 'Missing page title', recommendation: 'Add a unique, descriptive title tag between 30-60 characters.' });
  } else if (seoTitle.length < 30) {
    issues.push({ check: 'title', severity: 'warning', message: `Title too short (${seoTitle.length} chars)`, recommendation: 'Expand the title to at least 30 characters for better SEO.', value: seoTitle });
  } else if (seoTitle.length > 60) {
    issues.push({ check: 'title', severity: 'warning', message: `Title too long (${seoTitle.length} chars)`, recommendation: 'Shorten the title to under 60 characters to prevent truncation in search results.', value: seoTitle });
  }

  // --- Meta description ---
  const metaDesc = meta?.seo?.description || '';
  if (!metaDesc) {
    issues.push({ check: 'meta-description', severity: 'error', message: 'Missing meta description', recommendation: 'Add a compelling meta description between 50-160 characters that summarizes the page content.' });
  } else if (metaDesc.length < 50) {
    issues.push({ check: 'meta-description', severity: 'warning', message: `Meta description too short (${metaDesc.length} chars)`, recommendation: 'Expand the meta description to at least 50 characters.', value: metaDesc });
  } else if (metaDesc.length > 160) {
    issues.push({ check: 'meta-description', severity: 'warning', message: `Meta description too long (${metaDesc.length} chars)`, recommendation: 'Shorten to under 160 characters to avoid truncation in search results.', value: metaDesc });
  }

  // --- Open Graph ---
  const ogTitle = meta?.openGraph?.title || '';
  const ogDesc = meta?.openGraph?.description || '';
  if (!ogTitle && !meta?.openGraph?.titleCopied) {
    issues.push({ check: 'og-tags', severity: 'warning', message: 'Missing Open Graph title', recommendation: 'Add an og:title for better social media sharing previews.' });
  }
  if (!ogDesc && !meta?.openGraph?.descriptionCopied) {
    issues.push({ check: 'og-tags', severity: 'warning', message: 'Missing Open Graph description', recommendation: 'Add an og:description for better social media sharing previews.' });
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

    // OG image from HTML
    const ogImage = extractMetaContent(html, 'og:image');
    if (!ogImage) {
      issues.push({ check: 'og-image', severity: 'warning', message: 'Missing Open Graph image', recommendation: 'Add an og:image for social media sharing previews. Recommended size: 1200x630px.' });
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

    // Check for empty link text
    const emptyLinks = links.filter(l => !l.text && !l.href.startsWith('#'));
    if (emptyLinks.length > 0) {
      issues.push({ check: 'link-text', severity: 'warning', message: `${emptyLinks.length} link${emptyLinks.length > 1 ? 's' : ''} with empty anchor text`, recommendation: 'Add descriptive anchor text to all links for better accessibility and SEO.' });
    }
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
  const subdomain = await getSiteSubdomain(siteId, tokenOverride);
  const baseUrl = subdomain ? `https://${subdomain}.webflow.io` : '';
  console.log(`SEO audit: subdomain=${subdomain}, baseUrl=${baseUrl}`);
  const allPages = await listPages(siteId, tokenOverride);
  const pages = filterPublishedPages(allPages);
  console.log(`SEO audit: ${allPages.length} total pages, ${pages.length} published (filtered out ${allPages.length - pages.length})`);

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

  // Site-wide checks: duplicate titles, duplicate descriptions
  const siteWideIssues: SeoIssue[] = [];

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

  results.sort((a, b) => a.score - b.score);

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
