import {
  extractTag, extractMetaContent, countWords, extractLinks,
  extractImgTags, extractStyleBlocks, extractInlineScripts, countExternalResources,
  stripHiddenElements,
} from './seo-audit-html.js';
import { isProgrammingError } from './errors.js';
import { createLogger } from './logger.js';


const log = createLogger('audit-page');
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
  affectedPages?: string[];
}

export interface PageSeoResult {
  pageId: string;
  page: string;
  slug: string;
  url: string;
  score: number;
  issues: SeoIssue[];
  noindex?: boolean;
}

interface PageMeta {
  id: string;
  title: string;
  slug: string;
  seo?: { title?: string; description?: string };
  openGraph?: { title?: string; description?: string; titleCopied?: boolean; descriptionCopied?: boolean };
}

export const CHECK_CATEGORY: Record<string, CheckCategory> = {
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
  // AEO (Answer Engine Optimization)
  'aeo-author': 'content', 'aeo-date': 'content', 'aeo-answer-first': 'content',
  'aeo-faq-no-schema': 'technical', 'aeo-hidden-content': 'technical',
  'aeo-citations': 'content', 'aeo-dark-patterns': 'technical',
  'aeo-trust-pages': 'content',
};

const CRITICAL_CHECKS = new Set([
  'title', 'meta-description', 'canonical', 'h1', 'robots',
  'duplicate-title', 'mixed-content', 'ssl', 'robots-txt',
]);
const MODERATE_CHECKS = new Set([
  'content-length', 'heading-hierarchy', 'internal-links', 'img-alt',
  'og-tags', 'og-image', 'link-text', 'url', 'lang', 'viewport',
  'duplicate-description', 'img-filesize', 'html-size',
]);

// Slug patterns that indicate a content/article page where AEO editorial checks apply
const CONTENT_PAGE_PATTERNS = /(?:^|\/)(?:blog|articles?|resources?|news|posts?|guides?|learn|insights?|case-stud(?:y|ies)|whitepapers?|reports?)(?:\/|$)/i;

/** Returns true if the slug looks like a content/article page (vs homepage, service page, etc.) */
export function isContentPage(slug: string): boolean {
  return CONTENT_PAGE_PATTERNS.test(slug);
}

export function auditPage(
  pageId: string,
  pageName: string,
  slug: string,
  url: string,
  meta: PageMeta | null,
  html: string | null,
): PageSeoResult {
  const issues: SeoIssue[] = [];
  let isNoindex = false;

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
    // Strip hidden elements (Webflow conditional visibility, display:none) before content checks
    // to avoid false positives from elements that aren't visible to users or crawlers.
    const visibleHtml = stripHiddenElements(html);

    // H1 tags
    const h1s = extractTag(visibleHtml, 'h1');
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
    while ((hm = headingRegex.exec(visibleHtml)) !== null) levels.push(parseInt(hm[1]));
    for (let i = 1; i < levels.length; i++) {
      if (levels[i] - levels[i - 1] > 1) {
        issues.push({ check: 'heading-hierarchy', severity: 'warning', message: `Heading hierarchy skips from H${levels[i - 1]} to H${levels[i]}`, recommendation: `Don't skip heading levels. Use H${levels[i - 1] + 1} before H${levels[i]}.` });
        break;
      }
    }

    // Images without alt text (only flag images truly missing the alt attribute, not decorative alt="")
    const imgs = extractImgTags(visibleHtml);
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
    isNoindex = !!(robotsMeta && robotsMeta.includes('noindex'));
    if (isNoindex) {
      issues.push({ check: 'robots', severity: 'info', message: 'Page is set to noindex', recommendation: 'This page will not appear in search results. Remove noindex if this page should be indexed.', value: robotsMeta || undefined });
    }

    // Content length
    const wordCount = countWords(visibleHtml);
    if (wordCount < 300) {
      issues.push({ check: 'content-length', severity: 'warning', message: `Thin content (${wordCount} words)`, recommendation: 'Pages with fewer than 300 words may rank poorly. Add more valuable content.' });
    }

    // Internal links
    const links = extractLinks(visibleHtml);
    const internalLinks = links.filter(l => l.href.startsWith('/') || l.href.includes('webflow.io'));
    if (internalLinks.length === 0) {
      issues.push({ check: 'internal-links', severity: 'info', message: 'No internal links found', recommendation: 'Add internal links to help search engines discover other pages and distribute page authority.' });
    }

    // Check for empty link text (exclude links containing images, icons, SVGs, or aria-labels)
    const linkRegex2 = /<a\s+([^>]*)>([\s\S]*?)<\/a>/gi;
    let emptyLinkCount = 0;
    let lm2;
    while ((lm2 = linkRegex2.exec(visibleHtml)) !== null) {
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
        } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'audit-page: programming error'); /* skip malformed URLs */ }
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

    // --- AEO (Answer Engine Optimization) CHECKS ---
    // These checks help pages get cited by LLMs and AI answer engines.
    // Content-specific AEO checks only run on blog/article pages.
    const contentPage = isContentPage(slug);

    // AEO-1: Author/reviewer attribution detection (content pages only)
    if (contentPage) {
      const authorMeta = extractMetaContent(html, 'author');
      const hasAuthorSchema = /"author"/i.test(html) && /"@type"\s*:\s*"Person"/i.test(html);
      const hasByline = /<[^>]*class=["'][^"']*(?:author|byline|writer|reviewer)[^"']*["'][^>]*>/i.test(html);
      const hasReviewedBy = /(?:reviewed|verified|fact[- ]checked)\s+by/i.test(html);
      if (!authorMeta && !hasAuthorSchema && !hasByline && !hasReviewedBy) {
        issues.push({
          check: 'aeo-author', severity: 'info',
          message: 'No author attribution detected',
          recommendation: 'Add author information (byline, author meta tag, or Person schema) to improve E-E-A-T trust signals. LLMs and AI answer engines prefer content with clear editorial accountability.',
        });
      }
    }

    // AEO-2: Last-updated / review date detection (content pages only)
    if (contentPage) {
      const hasDateModified = /"dateModified"/i.test(html);
      const hasVisibleDate = /(?:last\s+(?:updated|modified|reviewed)|published\s+on|updated\s+on|reviewed\s+on)\s*:?\s*\w/i.test(html);
      const hasTimeDateElement = /<time[^>]*datetime=/i.test(html);
      if (!hasDateModified && !hasVisibleDate && !hasTimeDateElement) {
        issues.push({
          check: 'aeo-date', severity: 'info',
          message: 'No content date or "last updated" indicator found',
          recommendation: 'Add a visible "Last updated" or "Reviewed on" date and dateModified in your schema. AI systems trust dated content more — it signals the information is maintained.',
        });
      }
    }

    // AEO-3: Answer-first content structure (content pages only)
    const bodyText = visibleHtml
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '');
    const afterH1Match = bodyText.match(/<\/h1>([\s\S]{200,800}?)(?:<h[2-6]|$)/i);
    if (afterH1Match) {
      const introText = afterH1Match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const introWords = introText.split(/\s+/).slice(0, 40);
      const genericIntroPatterns = /^(?:welcome\s+to|in\s+(?:this|today)|are\s+you\s+looking|if\s+you(?:'re|\s+are)\s+(?:looking|searching|wondering)|(?:we|our\s+team)\s+(?:are|is)\s+(?:here|dedicated|committed|passionate)|at\s+\w+,\s+we)/i;
      if (contentPage && genericIntroPatterns.test(introWords.join(' '))) {
        issues.push({
          check: 'aeo-answer-first', severity: 'info',
          message: 'Page opens with generic intro instead of a direct answer',
          recommendation: 'Restructure to put a 2-3 sentence direct answer immediately after the H1. AI retrievers extract answer spans from the top of the page — generic intros ("Welcome to…", "Are you looking for…") waste that prime position.',
        });
      }
    }

    // AEO-4: FAQ content without FAQPage schema (content pages only)
    if (contentPage) {
      const faqHeadingPattern = /<h[2-4][^>]*>[^<]*(?:FAQ|Frequently\s+Asked|Common\s+Questions)[^<]*<\/h[2-4]>/i;
      const hasQuestionHeadings = (bodyText.match(/<h[2-4][^>]*>[^<]*\?[^<]*<\/h[2-4]>/gi) || []).length >= 3;
      const hasFaqSchema = /"FAQPage"/i.test(html);
      if ((faqHeadingPattern.test(html) || hasQuestionHeadings) && !hasFaqSchema) {
        issues.push({
          check: 'aeo-faq-no-schema', severity: 'warning',
          message: 'FAQ content detected but no FAQPage schema found',
          recommendation: 'This page has FAQ-structured content (question headings) but no FAQPage JSON-LD schema. Adding FAQ schema dramatically increases citation likelihood — LLMs disproportionately cite FAQ-marked pages because they match question prompts and are cleanly chunked.',
        });
      }
    }

    // AEO-5: Hidden content behind UI (content pages only — service/contact pages
    // intentionally use accordions for layout, not content hiding)
    if (contentPage) {
      const hiddenContentBlocks = (html.match(/<(?:div|section|article)[^>]*(?:style=["'][^"']*display\s*:\s*none|aria-hidden=["']true["']|class=["'][^"']*(?:accordion-body|tab-pane|collapse\b|hidden\b))[^>]*>[\s\S]{100,}?<\/(?:div|section|article)>/gi) || []);
      if (hiddenContentBlocks.length > 0) {
        const totalHiddenChars = hiddenContentBlocks.reduce((sum, b) => sum + b.replace(/<[^>]+>/g, '').length, 0);
        if (totalHiddenChars > 500) {
          issues.push({
            check: 'aeo-hidden-content', severity: 'warning',
            message: `${hiddenContentBlocks.length} content block${hiddenContentBlocks.length > 1 ? 's' : ''} hidden behind UI elements (~${Math.round(totalHiddenChars / 100) * 100} chars)`,
            recommendation: 'Critical content is hidden behind accordions, tabs, or collapsed sections. LLMs and search crawlers often read only what\'s visible in the initial DOM. Move important answers into the main content flow.',
          });
        }
      }
    }

    // AEO-6: Citation/reference density (content pages only)
    if (contentPage) {
      const allLinks = extractLinks(html);
      const authorityDomains = /\.gov$|\.edu$|\.org$|pubmed|scholar\.google|doi\.org|ncbi\.nlm|mayoclinic|webmd|clevelandclinic|who\.int|cdc\.gov|ada\.org|nih\.gov/i;
      const externalCitations = allLinks.filter(l => {
        if (!l.href.startsWith('http')) return false;
        try {
          const host = new URL(l.href).hostname;
          if (host.includes('webflow.io') || host.includes('facebook.') || host.includes('twitter.') || host.includes('instagram.') || host.includes('linkedin.') || host.includes('youtube.')) return false;
          return true;
        } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'audit-page: programming error'); return false; }
      });
      const authorityCitations = externalCitations.filter(l => {
        try { return authorityDomains.test(new URL(l.href).hostname); } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'audit-page: programming error'); return false; }
      });
      const wordCount2 = countWords(html);
      if (wordCount2 > 500 && externalCitations.length === 0) {
        issues.push({
          check: 'aeo-citations', severity: 'info',
          message: 'No external citations or references found',
          recommendation: 'Add citations to authoritative sources (journals, .gov, .edu, industry bodies). LLMs prefer pages where claims are grounded in evidence. Target: 1 citation per ~200 words for medical content, 1 per ~400 for business content.',
        });
      } else if (wordCount2 > 800 && externalCitations.length > 0 && authorityCitations.length === 0) {
        issues.push({
          check: 'aeo-citations', severity: 'info',
          message: `${externalCitations.length} external link${externalCitations.length > 1 ? 's' : ''} but none to authoritative sources`,
          recommendation: 'Your page links externally but not to high-authority sources (.gov, .edu, medical journals, professional associations). Adding citations to primary sources significantly increases AI citation trust.',
        });
      }
    }

    // AEO-7: Dark patterns (content pages only — auto-play is irrelevant on contact/landing pages
    // which legitimately use background video for design purposes)
    if (contentPage) {
      const hasAutoPlay = /<video[^>]*autoplay/i.test(html) || /<audio[^>]*autoplay/i.test(html);
      const hasAggressiveModal = /<div[^>]*class=["'][^"']*(?:popup|modal|overlay|interstitial)[^"']*["'][^>]*(?:style=["'][^"']*(?:display\s*:\s*(?:block|flex)|position\s*:\s*fixed))/i.test(html);
      if (hasAutoPlay) {
        issues.push({
          check: 'aeo-dark-patterns', severity: 'info',
          message: 'Auto-playing media detected',
          recommendation: 'Auto-play video/audio can trigger spam signals in retrieval systems. Use click-to-play instead.',
        });
      }
      if (hasAggressiveModal) {
        issues.push({
          check: 'aeo-dark-patterns', severity: 'info',
          message: 'Popup/overlay modal detected in initial HTML',
          recommendation: 'Aggressive popups and interstitials reduce content accessibility for AI retrievers. Avoid overlays that block the main content on load.',
        });
      }
    }

  }

  // Auto-assign categories
  for (const issue of issues) {
    issue.category = CHECK_CATEGORY[issue.check] || 'technical';
  }

  // Score: start at 100, deduct per issue with weighted severity.
  // Weights calibrated to match industry tools (SEMRush, Ahrefs):
  //   - Errors are meaningful deductions (broken fundamentals)
  //   - Warnings are mild deductions (improvement opportunities)
  //   - Info/notices have zero score impact (aspirational recommendations)
  let score = 100;
  for (const issue of issues) {
    const isCritical = CRITICAL_CHECKS.has(issue.check);
    const isModerate = MODERATE_CHECKS.has(issue.check);
    if (issue.severity === 'error') {
      score -= isCritical ? 15 : 10;
    } else if (issue.severity === 'warning') {
      score -= isCritical ? 5 : isModerate ? 3 : 2;
    }
    // info severity: no score impact (industry standard)
  }
  score = Math.max(0, Math.min(100, score));

  return { pageId, page: pageName, slug, url, score, issues, ...(isNoindex ? { noindex: true } : {}) };
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
export function isExcludedPage(slug: string, title?: string): boolean {
  const s = (slug || '').toLowerCase().replace(/^\//, '');
  const t = (title || '').toLowerCase();
  if (EXCLUDED_SLUGS.has(s)) return true;
  for (const kw of EXCLUDED_SLUG_KEYWORDS) {
    if (s.includes(kw) || t.includes(kw)) return true;
  }
  return false;
}

