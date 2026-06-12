/**
 * Canonical data extraction for schema generation.
 * Reads from Webflow page meta, page HTML, and workspace settings.
 * No AI calls.
 */
import * as cheerio from 'cheerio';
import { scrubBrandSuffix } from './templates/helpers.js';
import { contentScope } from './extractors/page-elements/content-scope.js';
import type { PageElementCatalog } from '../../shared/types/page-elements.js';
import type { SchemaEvidenceSource, SchemaFieldEvidence, SchemaFieldTarget, SchemaServiceOffer, SchemaServiceProfile } from '../../shared/types/site-inventory.js';
import type { BusinessProfileContact } from '../../shared/types/workspace.js';
import type { SchemaIndustrySubtype } from '../../shared/types/schema-plan.js';
import type { ResolvedEntity } from '../../shared/types/entity-resolution.js';
import { EEAT_ASSET_TYPE, type EeatAsset } from '../../shared/types/eeat-assets.js';
import { normalizeDomainHost } from '../domain-normalization.js';
import { parseJsonFallback } from '../db/json-validation.js';
import { capitalizeWord } from '../utils/strings.js';

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
  /** Page-scoped entity grounding resolved by the entityResolution intelligence slice. */
  entityResolution?: {
    articleAbout?: ResolvedEntity;
    articleMentions?: ResolvedEntity[];
    areaServed?: ResolvedEntity;
  };
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
  /** Workspace-level entity grounding resolved by the entityResolution intelligence slice. */
  entityResolution?: {
    knowsAbout?: ResolvedEntity[];
  };
  /** Optional workspace E-E-A-T assets used for author/credential schema enrichment. */
  eeatAssets?: EeatAsset[];
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
  /** Optional role/title for Person.author from E-E-A-T profile assets. */
  authorJobTitle?: string;
  /** Optional profile/corroboration URLs for Person.author.sameAs. */
  authorSameAs?: string[];
  /** Optional author credentials for Person.author.hasCredential. */
  authorCredentials?: string[];
  /** Visible article/body word count. Additive Article signal; full articleBody is intentionally not emitted. */
  wordCount?: number;
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
  /** Typed entity grounding for Organization.knowsAbout. */
  knowsAboutEntities?: ResolvedEntity[];
  /** Typed entity grounding for Article.about. */
  articleAboutEntity?: ResolvedEntity;
  /** Typed entity grounding for Article.mentions. */
  articleMentionEntities?: ResolvedEntity[];
  /** Typed entity grounding for Service/LocalBusiness areaServed. */
  areaServedEntity?: ResolvedEntity;
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

function buildBreadcrumbs(publishedPath: string, leafName: string, baseUrl: string, canonicalUrl?: string): BreadcrumbItem[] {
  let pathForCrumbs = publishedPath;
  let leafUrl = '';
  if (canonicalUrl) {
    try {
      const parsed = new URL(canonicalUrl);
      pathForCrumbs = parsed.pathname;
      leafUrl = parsed.href;
    } catch { // catch-ok: malformed canonical crumbs should fall back to publishedPath
      leafUrl = '';
    }
  }
  const segs = pathForCrumbs.replace(/^\//, '').split('/').filter(Boolean);
  const items: BreadcrumbItem[] = [{ name: 'Home', url: baseUrl }];
  let acc = baseUrl;
  segs.forEach((s, i) => {
    acc = `${acc}/${s}`;
    const segmentName = s.replace(/-/g, ' ').replace(/\b\w+\b/g, word => capitalizeWord(word));
    items.push({
      name: i === segs.length - 1 ? leafName : segmentName,
      url: i === segs.length - 1 && leafUrl ? leafUrl : acc,
    });
  });
  return items;
}

function sameSiteUrl(candidate: string, baseUrl: string): string | undefined {
  try {
    const parsed = new URL(candidate);
    const base = new URL(baseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    if (normalizeDomainHost(parsed.hostname) !== normalizeDomainHost(base.hostname)) return undefined;
    return parsed.href.replace(/\/$/, parsed.pathname === '/' ? '/' : '');
  } catch { // catch-ok: malformed or relative canonical URL falls back to configured base URL
    return undefined;
  }
}

function safeHttpUrl(candidate: string | null | undefined): string | undefined {
  if (!candidate?.trim()) return undefined;
  try {
    const parsed = new URL(candidate.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.toString();
  } catch { // catch-ok: malformed logo URLs are omitted from public schema
    return undefined;
  }
}

function deriveArticleSection(publishedPath: string): string | undefined {
  const segs = publishedPath.replace(/^\//, '').split('/').filter(Boolean);
  if (segs.length < 2) return undefined; // root or single-segment paths have no section
  return segs[0].replace(/-/g, ' ').replace(/\b\w+\b/g, word => capitalizeWord(word));
}

function pickCmsFieldWithSlug(fieldData: Record<string, unknown> | null | undefined, slugs: string[]): { value: string; slug: string } | undefined {
  if (!fieldData) return undefined;
  for (const slug of slugs) {
    const v = fieldData[slug];
    if (typeof v === 'string' && v.trim()) return { value: v.trim(), slug };
  }
  return undefined;
}

function firstVisibleText($: cheerio.CheerioAPI, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const text = $(selector).first().text().replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return undefined;
}

function fallbackDescriptionFromVisibleContent($: cheerio.CheerioAPI): string | undefined {
  const scope = contentScope($);
  const root = (scope.length > 0 ? scope : $('body')).clone();
  root.find('script,style,noscript,nav,footer,form,aside').remove();
  const raw = root.text().replace(/\s+/g, ' ').trim();
  if (!raw) return undefined;
  const normalized = raw.replace(/^\W+/, '').trim();
  if (!normalized) return undefined;
  // Keep fallback concise and snippet-like for schema descriptions.
  return normalized.length > 220 ? `${normalized.slice(0, 217).trimEnd()}...` : normalized;
}

function cleanAuthorName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw
    .replace(/\s+/g, ' ')
    .replace(/^(?:by|written by|author|posted by|reviewed by)\s*:?\s*/i, '')
    .replace(/\s+(?:on|updated|published)\s+.+$/i, '')
    .trim();
  if (!cleaned || cleaned.length > 80) return undefined;
  if (/\b(comment|share|subscribe|newsletter|published|updated)\b/i.test(cleaned)) return undefined;
  return cleaned;
}

function extractVisibleAuthor($: cheerio.CheerioAPI): string | undefined {
  const scope = contentScope($);
  const selectors = [
    '[rel="author"]',
    '[itemprop="author"]',
    '.byline',
    '[class*="byline"]',
    '.author',
    '[class*="author"]',
  ];
  const root = scope.length > 0 ? scope : $('body');
  for (const selector of selectors) {
    const text = cleanAuthorName(root.find(selector).first().text());
    if (text) return text;
  }
  return undefined;
}

function schemaTypeList(node: Record<string, unknown>): string[] {
  const rawType = node['@type'];
  if (typeof rawType === 'string') return [rawType];
  if (Array.isArray(rawType)) return rawType.filter((type): type is string => typeof type === 'string');
  return [];
}

function normalizeComparablePageUrl(value: string | undefined, baseUrl: string): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const parsed = new URL(value, baseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    parsed.hash = '';
    const href = parsed.toString();
    return href.endsWith('/') && parsed.pathname !== '/' ? href.slice(0, -1) : href;
  } catch { // catch-ok: malformed JSON-LD URLs are skipped in author extraction fallback
    return undefined;
  }
}

function nodeUrlCandidates(node: Record<string, unknown>): string[] {
  const candidates: string[] = [];
  const directCandidates = [node.url, node['@id'], node.mainEntityOfPage];
  for (const candidate of directCandidates) {
    if (typeof candidate === 'string') {
      candidates.push(candidate);
      continue;
    }
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      const nestedId = (candidate as Record<string, unknown>)['@id'];
      const nestedUrl = (candidate as Record<string, unknown>).url;
      if (typeof nestedId === 'string') candidates.push(nestedId);
      if (typeof nestedUrl === 'string') candidates.push(nestedUrl);
    }
  }
  return candidates;
}

function extractJsonLdObjects($: cheerio.CheerioAPI): Record<string, unknown>[] {
  const objects: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    const parsed = parseJsonFallback<unknown>(raw, null);
    if (!parsed) return;
    const queue: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const node = item as Record<string, unknown>;
      objects.push(node);
      if (Array.isArray(node['@graph'])) {
        queue.push(...(node['@graph'] as unknown[]));
      }
    }
  });
  return objects;
}

function extractAuthorNameFromJsonLdValue(value: unknown): string | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const author = extractAuthorNameFromJsonLdValue(candidate);
      if (author) return author;
    }
    return undefined;
  }
  if (typeof value === 'string') {
    const cleaned = cleanAuthorName(value);
    return cleaned && looksLikePersonName(cleaned) ? cleaned : undefined;
  }
  if (typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  const cleanedName = cleanAuthorName(typeof obj.name === 'string' ? obj.name : undefined);
  if (!cleanedName) return undefined;
  const loweredTypes = schemaTypeList(obj).map(type => type.toLowerCase());
  if (loweredTypes.includes('person')) return cleanedName;
  if (loweredTypes.length > 0 && loweredTypes.every(type => type === 'organization')) return undefined;
  return looksLikePersonName(cleanedName) ? cleanedName : undefined;
}

function extractArticleJsonLdAuthor($: cheerio.CheerioAPI, opts: { baseUrl: string; canonicalUrl: string }): string | undefined {
  const nodes = extractJsonLdObjects($);
  if (nodes.length === 0) return undefined;
  const canonicalUrl = normalizeComparablePageUrl(opts.canonicalUrl, opts.baseUrl);
  const articleLikeNodes = nodes.filter(node => {
    const loweredTypes = schemaTypeList(node).map(type => type.toLowerCase());
    return loweredTypes.includes('blogposting') || loweredTypes.includes('article') || loweredTypes.includes('newsarticle');
  });
  if (articleLikeNodes.length === 0) return undefined;

  const matchingNodes = canonicalUrl
    ? articleLikeNodes.filter(node => nodeUrlCandidates(node)
      .some(candidate => normalizeComparablePageUrl(candidate, opts.baseUrl) === canonicalUrl))
    : articleLikeNodes;
  const candidateNodes = matchingNodes.length > 0 ? matchingNodes : articleLikeNodes;

  for (const node of candidateNodes) {
    const author = extractAuthorNameFromJsonLdValue(node.author);
    if (author) return author;
  }
  return undefined;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map(v => v?.trim()).filter((v): v is string => !!v)));
}

function normalizeAuthorIdentity(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikePersonName(value: string): boolean {
  if (!value) return false;
  if (value.length > 80) return false;
  if (/\d/.test(value)) return false;
  const blockedTokens = [
    'team',
    'staff',
    'company',
    'agency',
    'studio',
    'group',
    'clinic',
    'office',
    'department',
    'editorial',
    'leadership',
  ];
  const normalized = normalizeAuthorIdentity(value);
  if (blockedTokens.some(token => normalized.includes(token))) return false;
  const parts = normalized.split(' ').filter(Boolean);
  return parts.length >= 2;
}

function deriveEeatAuthorSignals(
  assets: EeatAsset[] | undefined,
): Pick<PageData, 'author' | 'authorJobTitle' | 'authorSameAs' | 'authorCredentials'> {
  if (!assets || assets.length === 0) return {};
  const teamBios = assets.filter(asset => asset.type === EEAT_ASSET_TYPE.TEAM_BIO);
  const credentials = assets.filter(asset => asset.type === EEAT_ASSET_TYPE.CREDENTIAL);
  const leadBio = teamBios[0];
  const attributedAuthor = cleanAuthorName(leadBio?.metadata?.attributionName);
  const titleAuthor = cleanAuthorName(leadBio?.title);
  const author = attributedAuthor || (titleAuthor && looksLikePersonName(titleAuthor) ? titleAuthor : undefined);
  const authorJobTitle = leadBio?.metadata?.attributionRole;
  const authorSameAs = uniqueStrings([leadBio?.url, leadBio?.metadata?.sourceUrl]);
  const authorCredentials = uniqueStrings(credentials.map(asset => asset.title));
  return {
    author,
    authorJobTitle: authorJobTitle || undefined,
    authorSameAs: authorSameAs.length > 0 ? authorSameAs : undefined,
    authorCredentials: authorCredentials.length > 0 ? authorCredentials : undefined,
  };
}

function countVisibleWords($: cheerio.CheerioAPI): number | undefined {
  const scope = contentScope($);
  const root = (scope.length > 0 ? scope : $('body')).clone();
  // Mostly defensive for body fallback; some CMS exports also nest utility blocks
  // inside article-rich text, and those should not inflate Article.wordCount.
  root.find('script,style,noscript,nav,footer,form,aside').remove();
  const text = root.text().replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  const words = text.match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g);
  return words && words.length > 0 ? words.length : undefined;
}

/** Derive the leaf URL slug (e.g. "/services/development" → "development"). */
function leafSlug(publishedPath: string): string | undefined {
  const segs = publishedPath.replace(/^\/|\/$/g, '').split('/').filter(Boolean);
  if (segs.length === 0) return undefined;
  return segs[segs.length - 1];
}

const SERVICE_SLUG_NOISE_TOKENS = new Set([
  'page',
  'pages',
  'category',
  'categories',
]);

const GENERIC_LEADING_BRAND_TOKENS = new Set(['a', 'an', 'the']);

function primaryBrandSlugTokens(workspaceName: string): Set<string> {
  const tokens = workspaceName
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map(part => part.trim())
    .filter(part => part.length >= 2 && !GENERIC_LEADING_BRAND_TOKENS.has(part));
  return new Set(tokens.slice(0, 1));
}

function cleanServiceSlug(slug: string, workspaceName: string): string | undefined {
  let cleaned = slug.trim().toLowerCase();
  if (!cleaned) return undefined;

  const slugParts = cleaned.split('-').filter(Boolean);
  const brandTokens = primaryBrandSlugTokens(workspaceName);
  if (slugParts[0] === 'service' || slugParts[0] === 'services') {
    cleaned = slugParts.slice(1).join('-');
  } else if (slugParts.length > 2 && brandTokens.has(slugParts[0]) && (slugParts[1] === 'service' || slugParts[1] === 'services')) {
    cleaned = slugParts.slice(2).join('-');
  }

  const parts = cleaned
    .split('-')
    .map(part => part.trim())
    .filter(Boolean)
    .filter((part, index, allParts) => {
      if (SERVICE_SLUG_NOISE_TOKENS.has(part)) return false;
      if (index === 0 && (part === 'service' || part === 'services') && allParts.length > 1) return false;
      return true;
    });
  if (parts.length === 0) return undefined;
  return parts.map(part => capitalizeWord(part)).join(' ');
}

function serviceTypeFromTitleCandidate(candidate: string | undefined): string | undefined {
  if (!candidate) return undefined;
  const cleaned = candidate
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return undefined;
  // Slug-like values should not outrank the dedicated slug cleaner.
  if (cleaned.includes('-') && !cleaned.includes(' ')) return undefined;
  const withoutSeoSuffix = cleaned.split(/\s+\|\s+/)[0]?.trim() || cleaned;
  const withoutProviderContext = withoutSeoSuffix
    .replace(/\s+at\s+[^|–—-]*(?:dental|dentist|studio|clinic|company|co\.?|llc|inc\.?|group|partners|agency|medical|health|orthodontics?|smiles?)\b.*$/i, '')
    .replace(/\s+[–—-]\s+[^|–—-]*(?:dental|dentist|studio|clinic|company|co\.?|llc|inc\.?|group|partners|agency|medical|health|orthodontics?|smiles?)\b.*$/i, '')
    .trim();
  const withoutPrefix = (withoutProviderContext || withoutSeoSuffix)
    .replace(/^[A-Za-z0-9&'’.-]{2,30}\s+services?\s+/i, '')
    .replace(/^services?\s+/i, '')
    .trim();
  if (!withoutPrefix) return undefined;
  return withoutPrefix.length <= 80 ? withoutPrefix : undefined;
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
  const h1Title = firstVisibleText($, ['article h1', '.w-richtext h1', 'main h1', 'h1']);
  const htmlTitle = $('head > title').text().trim();
  const title = seoTitle || h1Title || metaTitle || htmlTitle || input.pageMeta.slug;
  const cleanTitle = scrubBrandSuffix(title, input.workspace.name);

  const seoDesc = input.pageMeta.seo?.description?.trim();
  const metaDesc = metaContent($, 'meta[name="description"]');
  const ogDesc = metaContent($, 'meta[property="og:description"]');
  const description = seoDesc || metaDesc || ogDesc || fallbackDescriptionFromVisibleContent($);

  const ogImage = metaContent($, 'meta[property="og:image"]');
  const twitterImage = metaContent($, 'meta[name="twitter:image"]');
  const linkImage = $('link[rel="image_src"]').attr('href') || undefined;
  const image = ogImage || twitterImage || linkImage;

  const cmsFieldData = input.pageMeta.cmsFieldData ?? null;
  const wordCount = countVisibleWords($);
  const fieldEvidence: SchemaFieldEvidence[] = [...(input.pageMeta.fieldEvidence ?? [])];
  const evidenceSources: Partial<Record<string, SchemaEvidenceSource>> = {};
  const publisherLogoUrl = safeHttpUrl(input.workspace.publisherLogoUrl);
  if (h1Title && !seoTitle) evidenceSources.title = 'rendered-html';
  if (description) evidenceSources.description = 'rendered-html';
  if (image) evidenceSources.image = 'rendered-html';
  if (publisherLogoUrl) {
    evidenceSources.logo = 'business-profile';
    fieldEvidence.push({
      field: 'logo',
      source: 'business-profile',
      status: 'resolved',
      message: 'Organization logo resolved from the workspace brand logo URL.',
    });
  }

  const datePublishedCms = pickCmsFieldWithSlug(cmsFieldData, ['published-on', 'published-date', 'date-published']);
  const dateModifiedCms = pickCmsFieldWithSlug(cmsFieldData, ['updated-on', 'last-updated']);
  const datePublished = $('time[itemprop="datePublished"]').attr('datetime')
    || datePublishedCms?.value
    || input.pageMeta.createdOn
    || input.pageMeta.lastPublished
    || undefined;
  const dateModified = $('time[itemprop="dateModified"]').attr('datetime')
    || dateModifiedCms?.value
    || input.pageMeta.lastPublished
    || datePublished
    || undefined;
  const renderedCanonical = $('link[rel="canonical"]').attr('href')?.trim();
  const renderedCanonicalUrl = renderedCanonical ? sameSiteUrl(renderedCanonical, input.baseUrl) : undefined;
  const fallbackCanonicalUrl = `${input.baseUrl}${input.pageMeta.publishedPath}`;
  const canonicalUrl = renderedCanonicalUrl || fallbackCanonicalUrl;
  const canonicalBaseUrl = (() => {
    try {
      return new URL(canonicalUrl).origin;
    } catch { // catch-ok: canonicalUrl was assembled defensively; fallback preserves existing behavior
      return input.baseUrl;
    }
  })();
  if (renderedCanonicalUrl && renderedCanonicalUrl !== fallbackCanonicalUrl) {
    evidenceSources.canonicalUrl = 'rendered-html';
    fieldEvidence.push({
      field: 'canonicalUrl',
      source: 'rendered-html',
      status: 'resolved',
      message: 'canonicalUrl resolved from same-site rendered canonical link.',
    });
  }
  const authorCms = pickCmsFieldWithSlug(cmsFieldData, ['author-name', 'author', 'written-by']);
  const authorFromJsonLd = extractArticleJsonLdAuthor($, { baseUrl: input.baseUrl, canonicalUrl });
  const visibleAuthor = extractVisibleAuthor($);
  const eeatAuthorSignals = deriveEeatAuthorSignals(input.workspace.eeatAssets);
  const author = authorCms?.value ?? authorFromJsonLd ?? visibleAuthor ?? eeatAuthorSignals.author;
  const authorMatchesEeat = !!(
    author
    && eeatAuthorSignals.author
    && normalizeAuthorIdentity(author) === normalizeAuthorIdentity(eeatAuthorSignals.author)
  );
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
  } else if (authorFromJsonLd) {
    evidenceSources.author = 'existing-json-ld';
    fieldEvidence.push({
      field: 'author',
      source: 'existing-json-ld',
      status: 'resolved',
      message: 'Author resolved from existing Article/BlogPosting JSON-LD.',
    });
  } else if (visibleAuthor) {
    evidenceSources.author = 'rendered-html';
    fieldEvidence.push({ field: 'author', source: 'rendered-html' });
  } else if (eeatAuthorSignals.author) {
    evidenceSources.author = 'workspace-intelligence';
    fieldEvidence.push({
      field: 'author',
      source: 'workspace-intelligence',
      status: 'resolved',
      message: 'Author resolved from workspace E-E-A-T team bio inventory.',
    });
  }

  const inLanguage = input.pageMeta.locale?.trim() || input.workspace.defaultLocale || 'en';
  const articleSection = deriveArticleSection(input.pageMeta.publishedPath);

  // Derive Article.keywords (comma-joined) from per-page keywords.
  const pageKeywords = input.pageMeta.pageKeywords;
  const keywords = pageKeywords?.primary
    ? [pageKeywords.primary, ...(pageKeywords.secondary ?? [])].filter(Boolean).join(', ')
    : undefined;

  // Derive Service.areaServed + LocalBusiness.areaServed from BusinessProfile address.
  const areaServed = formatAreaServed(input.workspace.businessProfile?.address);

  // Derive Service labels from mapped profile (authoritative), then visible/CMS title, then cleaned slug.
  const slug = leafSlug(input.pageMeta.publishedPath);
  const fallbackServiceLabel = slug
    ? cleanServiceSlug(slug, input.workspace.name) || slug.replace(/-/g, ' ').replace(/\b\w+\b/g, word => capitalizeWord(word))
    : undefined;
  const derivedServiceLabel = serviceTypeFromTitleCandidate(input.pageMeta.serviceProfile?.serviceName)
    || serviceTypeFromTitleCandidate(cleanTitle)
    || serviceTypeFromTitleCandidate(title)
    || fallbackServiceLabel;
  const serviceType = input.pageMeta.serviceProfile?.serviceType || derivedServiceLabel;
  const serviceName = input.pageMeta.serviceProfile?.serviceName || derivedServiceLabel;
  const serviceAreaServed = input.pageMeta.serviceProfile?.areaServed;
  const resolvedAreaServed = input.pageMeta.entityResolution?.areaServed;
  const knowsAboutEntities = input.workspace.entityResolution?.knowsAbout;
  // NOTE: Wikidata URIs for knowsAbout entities are emitted as `sameAs` on the
  // embedded Thing nodes inside `knowsAbout` (via resolvedEntityToThingNode in
  // helpers.ts). They MUST NOT be aggregated onto Organization.sameAs — that
  // would falsely assert the customer Org is identical to those topic entities.

  return {
    title,
    cleanTitle,
    description,
    image,
    canonicalUrl,
    publisher: {
      name: input.workspace.name,
      logoUrl: publisherLogoUrl,
    },
    datePublished,
    dateModified,
    author,
    authorJobTitle: authorMatchesEeat ? eeatAuthorSignals.authorJobTitle : undefined,
    authorSameAs: authorMatchesEeat ? eeatAuthorSignals.authorSameAs : undefined,
    authorCredentials: authorMatchesEeat ? eeatAuthorSignals.authorCredentials : undefined,
    wordCount,
    articleSection,
    inLanguage,
    breadcrumbs: buildBreadcrumbs(input.pageMeta.publishedPath, cleanTitle, canonicalBaseUrl, canonicalUrl),
    keywords,
    areaServed: serviceAreaServed || resolvedAreaServed?.label || areaServed,
    areaServedEntity: resolvedAreaServed,
    serviceType,
    serviceName,
    offers: input.pageMeta.serviceProfile?.offers,
    knowsAbout: input.workspace.siteKeywordsForKnowsAbout?.slice(0, 5).map(s => s.toLowerCase()),
    knowsAboutEntities,
    articleAboutEntity: input.pageMeta.entityResolution?.articleAbout,
    articleMentionEntities: input.pageMeta.entityResolution?.articleMentions,
    elements: input.pageMeta.elements,
    fieldEvidence,
    evidenceSources,
  };
}
