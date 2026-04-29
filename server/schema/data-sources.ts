/**
 * Canonical data extraction for schema generation.
 * Reads from Webflow page meta, page HTML, and workspace settings.
 * No AI calls.
 */
import * as cheerio from 'cheerio';
import { scrubBrandSuffix } from './templates/helpers.js';

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

function buildBreadcrumbs(publishedPath: string, leafName: string, baseUrl: string): BreadcrumbItem[] {
  const segs = publishedPath.replace(/^\//, '').split('/').filter(Boolean);
  const items: BreadcrumbItem[] = [{ name: 'Home', url: baseUrl }];
  let acc = baseUrl;
  segs.forEach((s, i) => {
    acc = `${acc}/${s}`;
    items.push({
      name: i === segs.length - 1 ? leafName : capitalize(s.replace(/-/g, ' ')),
      url: acc,
    });
  });
  return items;
}

function deriveArticleSection(publishedPath: string): string | undefined {
  const segs = publishedPath.replace(/^\//, '').split('/').filter(Boolean);
  if (segs.length < 2) return undefined; // root or single-segment paths have no section
  return capitalize(segs[0].replace(/-/g, ' '));
}

/** Reads common CMS field-data slugs in priority order; Webflow conventions vary by collection. */
function pickCmsField(fieldData: Record<string, unknown> | null | undefined, slugs: string[]): string | undefined {
  if (!fieldData) return undefined;
  for (const slug of slugs) {
    const v = fieldData[slug];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

export function extractPageData(input: ExtractInput): PageData {
  const $ = cheerio.load(input.html || '');

  const seoTitle = input.pageMeta.seo?.title?.trim();
  const metaTitle = input.pageMeta.title?.trim();
  const htmlTitle = $('head > title').text().trim();
  const title = seoTitle || metaTitle || htmlTitle || input.pageMeta.slug;
  const cleanTitle = scrubBrandSuffix(title, input.workspace.name);

  const seoDesc = input.pageMeta.seo?.description?.trim();
  const metaDesc = metaContent($, 'meta[name="description"]');
  const ogDesc = metaContent($, 'meta[property="og:description"]');
  const description = seoDesc || metaDesc || ogDesc;

  const ogImage = metaContent($, 'meta[property="og:image"]');
  const twitterImage = metaContent($, 'meta[name="twitter:image"]');
  const linkImage = $('link[rel="image_src"]').attr('href') || undefined;
  const image = ogImage || twitterImage || linkImage;

  const cmsFieldData = input.pageMeta.cmsFieldData ?? null;
  const datePublished = $('time[itemprop="datePublished"]').attr('datetime')
    || pickCmsField(cmsFieldData, ['published-on', 'published-date', 'date-published'])
    || input.pageMeta.createdOn
    || input.pageMeta.lastPublished
    || undefined;
  const dateModified = $('time[itemprop="dateModified"]').attr('datetime')
    || pickCmsField(cmsFieldData, ['updated-on', 'last-updated'])
    || input.pageMeta.lastPublished
    || undefined;

  const author = pickCmsField(cmsFieldData, ['author-name', 'author', 'written-by']) ?? undefined;

  const inLanguage = input.pageMeta.locale?.trim() || input.workspace.defaultLocale || 'en';
  const articleSection = deriveArticleSection(input.pageMeta.publishedPath);
  const canonicalUrl = `${input.baseUrl}${input.pageMeta.publishedPath}`;

  return {
    title,
    cleanTitle,
    description,
    image,
    canonicalUrl,
    publisher: {
      name: input.workspace.name,
      logoUrl: input.workspace.publisherLogoUrl ?? undefined,
    },
    datePublished,
    dateModified,
    author,
    articleSection,
    inLanguage,
    breadcrumbs: buildBreadcrumbs(input.pageMeta.publishedPath, cleanTitle, input.baseUrl),
  };
}
