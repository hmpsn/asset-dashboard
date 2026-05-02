/**
 * Canonical data extraction for schema generation.
 * Reads from Webflow page meta, page HTML, and workspace settings.
 * No AI calls.
 */
import * as cheerio from 'cheerio';
import { scrubBrandSuffix } from './templates/helpers.js';
import type { PageElementCatalog } from '../../shared/types/page-elements.js';
import type { SchemaEvidenceSource, SchemaFieldEvidence, SchemaFieldTarget, SchemaServiceOffer, SchemaServiceProfile } from '../../shared/types/site-inventory.js';
import type { BusinessProfileContact } from '../../shared/types/workspace.js';
import type { SchemaIndustrySubtype } from '../../shared/types/schema-plan.js';

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
  /** Resolved collection field targets from the siteInventory slice. */
  cmsFieldTargets?: Partial<Record<SchemaFieldTarget, string>>;
  /** Field-level resolution evidence assembled from rendered/CMS/fallback sources. */
  fieldEvidence?: SchemaFieldEvidence[];
  /** Service-specific CMS context assembled from collection field mappings. */
  serviceProfile?: SchemaServiceProfile;
  /** Per-page keyword strategy from seoContext slice. Populated when buildWorkspaceIntelligence
   *  is called with opts.pagePath. Drives Article.keywords schema field emission. */
  pageKeywords?: { primary: string; secondary: string[] };
  /** Per-page structural elements catalog. Populated by the generator
   *  via extractPageElements() before the template is built. Empty when
   *  the catalog has not been generated yet. */
  elements?: PageElementCatalog;
  /** Webflow lastPublished at fetch time. Null for static (sitemap) pages.
   *  Drives stale-detection in the page-elements lazy refresh. */
  sourcePublishedAt?: string | null;
}

export interface WorkspaceSchemaInput {
  /** Workspace ID — used by the generator to scope page-elements store reads/writes. */
  id?: string;
  name: string;
  publisherLogoUrl: string | null;
  businessProfile: BusinessProfileContact | null;
  /** Default site-wide locale from Webflow site.locales[0] or "en" if absent. */
  defaultLocale: string;
  /** Top-N siteKeywords (deduped, lowercased, declined-filter applied) for Organization.knowsAbout emission. */
  siteKeywordsForKnowsAbout?: string[];
  /** When true, schema generator emits WebSite.potentialAction (sitelinks SearchAction).
   *  Mirrors Workspace.siteHasSearch DB column. PR2 ships the admin toggle UI. */
  siteHasSearch?: boolean;
  /** Active schema-plan local business specialization. */
  industrySubtype?: SchemaIndustrySubtype;
}

/** Re-export so schema templates can import from a single data-sources module. */
export type { BusinessProfileContact as BusinessProfile } from '../../shared/types/workspace.js';

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
  /** Comma-joined keywords string for Article.keywords schema field. Empty when no pageMap entry. */
  keywords?: string;
  /** AreaServed value derived from BusinessProfile.address.city/state for Service+LocalBusiness. */
  areaServed?: string;
  /** ServiceType derived from URL slug for Service template. */
  serviceType?: string;
  /** Service display name resolved from a mapped CMS field when available. */
  serviceName?: string;
  /** Verified offers resolved from visible content or mapped CMS fields. */
  offers?: SchemaServiceOffer[];
  /** Top-N siteKeywords for Organization.knowsAbout — passed through from workspace. */
  knowsAbout?: string[];
  /** Catalog of structural elements detected on the page (videos, HowTo
   *  lists, citations, etc.). Drives conditional schema enrichment. */
  elements?: PageElementCatalog;
  fieldEvidence?: SchemaFieldEvidence[];
  evidenceSources?: Partial<Record<string, SchemaEvidenceSource>>;
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

function pickCmsFieldWithSlug(fieldData: Record<string, unknown> | null | undefined, slugs: string[]): { value: string; slug: string } | undefined {
  if (!fieldData) return undefined;
  for (const slug of slugs) {
    const v = fieldData[slug];
    if (typeof v === 'string' && v.trim()) return { value: v.trim(), slug };
  }
  return undefined;
}

/** Capitalize a slug segment for human-readable output. */
function capitalizeSlugSegment(slug: string): string {
  return slug
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/** Derive the leaf URL slug (e.g. "/services/development" → "development"). */
function leafSlug(publishedPath: string): string | undefined {
  const segs = publishedPath.replace(/^\/|\/$/g, '').split('/').filter(Boolean);
  if (segs.length === 0) return undefined;
  return segs[segs.length - 1];
}

/** Format a Place name for areaServed. Returns "City, State" when both present, "City" or "State" if only one, undefined if neither. */
function formatAreaServed(address: { city?: string; state?: string } | undefined): string | undefined {
  if (!address) return undefined;
  const city = address.city?.trim();
  const state = address.state?.trim();
  if (city && state) return `${city}, ${state}`;
  if (city) return city;
  if (state) return state;
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
  const datePublishedCms = pickCmsFieldWithSlug(cmsFieldData, ['published-on', 'published-date', 'date-published']);
  const dateModifiedCms = pickCmsFieldWithSlug(cmsFieldData, ['updated-on', 'last-updated']);
  const authorCms = pickCmsFieldWithSlug(cmsFieldData, ['author-name', 'author', 'written-by']);
  const fieldEvidence: SchemaFieldEvidence[] = [...(input.pageMeta.fieldEvidence ?? [])];
  const evidenceSources: Partial<Record<string, SchemaEvidenceSource>> = {};
  if (description) evidenceSources.description = 'rendered-html';
  if (image) evidenceSources.image = 'rendered-html';

  const datePublished = $('time[itemprop="datePublished"]').attr('datetime')
    || datePublishedCms?.value
    || input.pageMeta.createdOn
    || input.pageMeta.lastPublished
    || undefined;
  const dateModified = $('time[itemprop="dateModified"]').attr('datetime')
    || dateModifiedCms?.value
    || input.pageMeta.lastPublished
    || undefined;

  const author = authorCms?.value ?? undefined;
  if (datePublishedCms) {
    evidenceSources.datePublished = `cms-field:${datePublishedCms.slug}`;
    fieldEvidence.push({ field: 'datePublished', source: `cms-field:${datePublishedCms.slug}` });
  }
  if (dateModifiedCms) {
    evidenceSources.dateModified = `cms-field:${dateModifiedCms.slug}`;
    fieldEvidence.push({ field: 'dateModified', source: `cms-field:${dateModifiedCms.slug}` });
  }
  if (authorCms) {
    evidenceSources.author = `cms-field:${authorCms.slug}`;
    fieldEvidence.push({ field: 'author', source: `cms-field:${authorCms.slug}` });
  }

  const inLanguage = input.pageMeta.locale?.trim() || input.workspace.defaultLocale || 'en';
  const articleSection = deriveArticleSection(input.pageMeta.publishedPath);
  const canonicalUrl = `${input.baseUrl}${input.pageMeta.publishedPath}`;

  // Derive Article.keywords (comma-joined) from per-page keywords.
  const pageKeywords = input.pageMeta.pageKeywords;
  const keywords = pageKeywords?.primary
    ? [pageKeywords.primary, ...(pageKeywords.secondary ?? [])].filter(Boolean).join(', ')
    : undefined;

  // Derive Service.areaServed + LocalBusiness.areaServed from BusinessProfile address.
  const areaServed = formatAreaServed(input.workspace.businessProfile?.address);

  // Derive Service.serviceType from URL slug.
  const slug = leafSlug(input.pageMeta.publishedPath);
  const serviceType = input.pageMeta.serviceProfile?.serviceType || (slug ? capitalizeSlugSegment(slug) : undefined);
  const serviceName = input.pageMeta.serviceProfile?.serviceName;
  const serviceAreaServed = input.pageMeta.serviceProfile?.areaServed;

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
    keywords,
    areaServed: serviceAreaServed || areaServed,
    serviceType,
    serviceName,
    offers: input.pageMeta.serviceProfile?.offers,
    knowsAbout: input.workspace.siteKeywordsForKnowsAbout?.slice(0, 5).map(s => s.toLowerCase()),
    elements: input.pageMeta.elements,
    fieldEvidence,
    evidenceSources,
  };
}
