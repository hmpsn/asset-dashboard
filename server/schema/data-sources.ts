/**
 * Canonical data extraction for schema generation.
 * Reads from Webflow page meta, page HTML, and workspace settings.
 * No AI calls.
 */
import * as cheerio from 'cheerio';

export interface PageMetaInput {
  title: string;
  slug: string;
  publishedPath: string;
  seo?: { title?: string | null; description?: string | null };
  lastPublished?: string | null;
  createdOn?: string | null;
  /** Per-locale code (e.g. "en", "en-US") for this specific page. Falls back to workspace.defaultLocale. */
  locale?: string | null;
  /** When this page is a Webflow CMS item, the resolved fieldData blob from /collections/:id/items/:itemId. */
  cmsFieldData?: Record<string, unknown> | null;
}

export interface WorkspaceSchemaInput {
  name: string;
  publisherLogoUrl: string | null;
  businessProfile: BusinessProfile | null;
  /** Default site-wide locale from Webflow site.locales[0] or "en" if absent. */
  defaultLocale: string;
}

export interface BusinessProfile {
  phone?: string;
  email?: string;
  address?: { street?: string; city?: string; state?: string; zip?: string; country?: string };
  socialProfiles?: string[];
  openingHours?: string;
  foundedDate?: string;
}

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export interface PageData {
  title: string;
  /** title with " | <brand>" suffix removed, used for schema name fields and breadcrumb labels. */
  cleanTitle: string;
  description?: string;
  image?: string;
  canonicalUrl: string;
  publisher: { name: string; logoUrl?: string };
  datePublished?: string;
  dateModified?: string;
  /** Article author name when known (CMS field or workspace name). undefined → template emits Organization fallback. */
  author?: string;
  /** Section derived from URL path (e.g. "/blog/foo" → "Blog"). undefined for homepage and root pages. */
  articleSection?: string;
  /** BCP-47 language tag for this page. Always populated (workspace.defaultLocale fallback). */
  inLanguage: string;
  breadcrumbs: BreadcrumbItem[];
}

export interface ExtractInput {
  pageMeta: PageMetaInput;
  html: string;
  baseUrl: string;
  workspace: WorkspaceSchemaInput;
}

function metaContent($: cheerio.CheerioAPI, selector: string): string | undefined {
  const v = $(selector).attr('content');
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

function capitalize(s: string): string {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

function buildBreadcrumbs(publishedPath: string, pageTitle: string, baseUrl: string): BreadcrumbItem[] {
  const segs = publishedPath.replace(/^\//, '').split('/').filter(Boolean);
  const items: BreadcrumbItem[] = [{ name: 'Home', url: baseUrl }];
  let acc = baseUrl;
  segs.forEach((s, i) => {
    acc = `${acc}/${s}`;
    items.push({
      name: i === segs.length - 1 ? pageTitle : capitalize(s.replace(/-/g, ' ')),
      url: acc,
    });
  });
  return items;
}

export function extractPageData(input: ExtractInput): PageData {
  const $ = cheerio.load(input.html || '');

  // Title precedence: page meta SEO title > page meta title > HTML <title>
  const seoTitle = input.pageMeta.seo?.title?.trim();
  const metaTitle = input.pageMeta.title?.trim();
  const htmlTitle = $('head > title').text().trim();
  const title = seoTitle || metaTitle || htmlTitle || input.pageMeta.slug;

  // Description: SEO description > meta description > og:description
  const seoDesc = input.pageMeta.seo?.description?.trim();
  const metaDesc = metaContent($, 'meta[name="description"]');
  const ogDesc = metaContent($, 'meta[property="og:description"]');
  const description = seoDesc || metaDesc || ogDesc;

  // Image: og:image > twitter:image > <link rel="image_src">
  const ogImage = metaContent($, 'meta[property="og:image"]');
  const twitterImage = metaContent($, 'meta[name="twitter:image"]');
  const linkImage = $('link[rel="image_src"]').attr('href') || undefined;
  const image = ogImage || twitterImage || linkImage;

  // Dates: HTML microformat → CMS timestamps (Webflow CMS templates often lack <time itemprop>)
  const datePublished = $('time[itemprop="datePublished"]').attr('datetime')
    || input.pageMeta.createdOn
    || input.pageMeta.lastPublished
    || undefined;
  const dateModified = $('time[itemprop="dateModified"]').attr('datetime')
    || input.pageMeta.lastPublished
    || undefined;

  const canonicalUrl = `${input.baseUrl}${input.pageMeta.publishedPath}`;

  return {
    title,
    description,
    image,
    canonicalUrl,
    publisher: {
      name: input.workspace.name,
      logoUrl: input.workspace.publisherLogoUrl ?? undefined,
    },
    datePublished,
    dateModified,
    breadcrumbs: buildBreadcrumbs(input.pageMeta.publishedPath, title, input.baseUrl),
  };
}
