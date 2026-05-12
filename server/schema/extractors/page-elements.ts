/**
 * Public entry-point for page-element extraction.
 *
 * Composes the per-element extractors. Pure function of HTML — caller
 * decides where the HTML comes from (fetchPublishedHtml(url) for static
 * pages and CMS items per audit §2.4).
 *
 * Returns a typed PageElementCatalog. Always returns; never throws — any
 * cheerio.load or sub-extractor failure degrades to an empty catalog with
 * the failure reason captured in diagnostics.rawCounts.error.
 */
import * as cheerio from 'cheerio';
import type { PageElementCatalog, SemanticPageData } from '../../../shared/types/page-elements.js';
import { extractVideos } from './page-elements/video.js';
import { extractLists } from './page-elements/howto.js';
import { extractCitations } from './page-elements/citation.js';
import { extractImages } from './page-elements/images.js';
import { extractTables } from './page-elements/tables.js';
import { extractTestimonials } from './page-elements/testimonials.js';
import { aiClassifyImages } from './page-elements/image-ai-classifier.js';
import { aiDisambiguateHowTo } from './page-elements/howto-ai-fallback.js';
import type { AiBudget } from './page-elements/ai-budget.js';
import { contentScope } from './page-elements/content-scope.js';
import { createLogger } from '../../logger.js';
import { parseJsonFallback } from '../../db/json-validation.js';

const log = createLogger('schema/extractors/page-elements');

export interface ExtractPageElementsOpts {
  /** Page's canonical URL — used by citation extractor and JSON-LD evidence matching. */
  pageBaseUrl: string;
  /** Webflow lastPublished at fetch time (drives stale detection). Null for static pages. */
  sourcePublishedAt: string | null;
  /** Per-regenerate AI budget. Used by AI-assisted extractors in PR2; ignored in PR1. */
  aiBudget: AiBudget;
  /** Workspace ID for AI token-logging attribution. Undefined when called outside a workspace context. */
  workspaceId?: string | undefined;
}

function emptyCatalog(opts: ExtractPageElementsOpts, errorMarker: 1 | 0 = 0): PageElementCatalog {
  return {
    extractedAt: new Date().toISOString(),
    sourcePublishedAt: opts.sourcePublishedAt,
    headings: [],
    tables: [],
    images: [],
    videos: [],
    lists: [],
    testimonials: [],
    codeBlocks: [],
    citations: [],
    diagnostics: {
      aiClassificationCalls: opts.aiBudget.used,
      hitAiBudgetCap: opts.aiBudget.exhausted,
      // The `error` count is non-zero only when the catch path fires. Operators
      // can grep diagnostics for `error: 1` to find pages whose extractors threw.
      rawCounts: {
        headings: 0,
        tables: 0,
        images: 0,
        videos: 0,
        lists: 0,
        testimonials: 0,
        codeBlocks: 0,
        citations: 0,
        error: errorMarker,
      },
    },
  };
}

function cleanSemanticText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
  return cleaned || undefined;
}

function isOpaqueIdentifier(value: string): boolean {
  const trimmed = value.trim();
  return /^[a-f0-9]{24}$/i.test(trimmed) || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed);
}

function cleanPublicText(value: unknown): string | undefined {
  const cleaned = cleanSemanticText(value);
  if (!cleaned || isOpaqueIdentifier(cleaned)) return undefined;
  return cleaned;
}

function cleanHttpUrl(value: unknown): string | undefined {
  const cleaned = cleanSemanticText(value);
  if (!cleaned) return undefined;
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.toString();
  } catch { // catch-ok: malformed/relative URL evidence is unsafe for public JSON-LD
    return undefined;
  }
}

function safePageOrigin(pageUrl: string | undefined): string | undefined {
  if (!pageUrl) return undefined;
  try {
    const parsed = new URL(pageUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.origin;
  } catch { // catch-ok: malformed URL evidence cannot produce a safe origin
    return undefined;
  }
}

function resolveSafeUrl(value: unknown, pageUrl: string | undefined): string | undefined {
  const cleaned = cleanSemanticText(value);
  if (!cleaned || isOpaqueIdentifier(cleaned)) return undefined;
  if (/^(?:data|javascript|file):/i.test(cleaned)) return undefined;

  const pageOrigin = safePageOrigin(pageUrl);
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.toString();
  } catch { /* relative path or malformed URL */ } // catch-ok

  if (!pageOrigin || !cleaned.startsWith('/')) return undefined;
  try {
    const resolved = new URL(cleaned, pageOrigin);
    if (resolved.origin !== pageOrigin) return undefined;
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return undefined;
    return resolved.toString();
  } catch { // catch-ok: malformed relative URL should be dropped
    return undefined;
  }
}

function firstResolvedSafeUrl(value: unknown, pageUrl: string | undefined): string | undefined {
  if (typeof value === 'string') return resolveSafeUrl(value, pageUrl);
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = firstResolvedSafeUrl(item, pageUrl);
      if (url) return url;
    }
    return undefined;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return resolveSafeUrl(obj.url, pageUrl) ?? resolveSafeUrl(obj.contentUrl, pageUrl);
  }
  return undefined;
}

function comparablePageUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    parsed.hash = '';
    parsed.search = '';
    const normalizedPath = parsed.pathname.replace(/\/$/, '') || '/';
    return `${parsed.protocol}//${parsed.hostname.replace(/^www\./i, '').toLowerCase()}${normalizedPath}`;
  } catch { // catch-ok: malformed URL evidence cannot match a page
    return undefined;
  }
}

function objectUrlCandidates(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === 'string') {
    const url = cleanHttpUrl(value);
    return url ? [url] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(objectUrlCandidates);
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return [
      ...objectUrlCandidates(obj['@id']),
      ...objectUrlCandidates(obj.url),
      ...objectUrlCandidates(obj.mainEntityOfPage),
    ];
  }
  return [];
}

function normalizePhone(value: unknown): string | undefined {
  const cleaned = cleanSemanticText(value);
  if (!cleaned) return undefined;
  const stripped = cleaned.replace(/^tel:/i, '').trim();
  const digitCount = stripped.replace(/\D/g, '').length;
  return digitCount >= 7 ? stripped : undefined;
}

function normalizeEmail(value: unknown): string | undefined {
  const cleaned = cleanSemanticText(value);
  if (!cleaned) return undefined;
  const stripped = cleaned.replace(/^mailto:/i, '').split('?')[0].trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(stripped) ? stripped : undefined;
}

const LOCAL_BUSINESS_TYPE_PRIORITY = [
  'Dentist',
  'MedicalBusiness',
  'MedicalOrganization',
  'FinancialService',
  'LocalBusiness',
] as const;

const LOCAL_BUSINESS_TYPES = new Set<string>(LOCAL_BUSINESS_TYPE_PRIORITY);

const BUSINESS_FALLBACK_TYPES = new Set([
  ...LOCAL_BUSINESS_TYPES,
  'Organization',
]);

function schemaTypes(node: Record<string, unknown> | undefined): string[] {
  if (!node) return [];
  const type = node['@type'];
  return (Array.isArray(type) ? type : [type])
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
    .filter(Boolean);
}

function firstSchemaType(node: Record<string, unknown> | undefined, allowed: Set<string>): SemanticPageData['businessType'] | undefined {
  const types = new Set(schemaTypes(node).filter(t => allowed.has(t)));
  const type = LOCAL_BUSINESS_TYPE_PRIORITY.find(t => types.has(t));
  return type as SemanticPageData['businessType'] | undefined;
}

function firstHttpUrl(value: unknown): string | undefined {
  if (typeof value === 'string') return cleanHttpUrl(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = firstHttpUrl(item);
      if (url) return url;
    }
    return undefined;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return cleanHttpUrl(obj.url) ?? cleanHttpUrl(obj.contentUrl);
  }
  return undefined;
}

function semanticGeoFromObject(value: unknown): SemanticPageData['geo'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const obj = value as Record<string, unknown>;
  const latitude = Number(obj.latitude);
  const longitude = Number(obj.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return undefined;
  return { latitude, longitude };
}

const DAY_MAP: Record<string, string> = {
  mo: 'Monday',
  mon: 'Monday',
  monday: 'Monday',
  tu: 'Tuesday',
  tue: 'Tuesday',
  tues: 'Tuesday',
  tuesday: 'Tuesday',
  we: 'Wednesday',
  wed: 'Wednesday',
  wednesday: 'Wednesday',
  th: 'Thursday',
  thu: 'Thursday',
  thur: 'Thursday',
  thurs: 'Thursday',
  thursday: 'Thursday',
  fr: 'Friday',
  fri: 'Friday',
  friday: 'Friday',
  sa: 'Saturday',
  sat: 'Saturday',
  saturday: 'Saturday',
  su: 'Sunday',
  sun: 'Sunday',
  sunday: 'Sunday',
};

const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function normalizeTime(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const match = raw.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return undefined;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const period = match[3];
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute > 59) return undefined;
  if (period === 'pm' && hour < 12) hour += 12;
  if (period === 'am' && hour === 12) hour = 0;
  if (hour > 23) return undefined;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function expandDays(raw: string): string[] | undefined {
  const parts = raw.split(/\s*,\s*/).filter(Boolean);
  const days: string[] = [];
  for (const part of parts) {
    const range = part.split(/\s*-\s*/).map(p => DAY_MAP[p.trim().toLowerCase()]).filter(Boolean);
    if (range.length === 1) {
      days.push(range[0]);
    } else if (range.length === 2) {
      const start = DAY_ORDER.indexOf(range[0]);
      const end = DAY_ORDER.indexOf(range[1]);
      if (start < 0 || end < 0) return undefined;
      if (start <= end) {
        days.push(...DAY_ORDER.slice(start, end + 1));
      } else {
        days.push(...DAY_ORDER.slice(start), ...DAY_ORDER.slice(0, end + 1));
      }
    } else {
      return undefined;
    }
  }
  return days.length ? Array.from(new Set(days)) : undefined;
}

function normalizeDayValues(value: unknown): string[] | undefined {
  const rawValues = Array.isArray(value) ? value : [value];
  const days: string[] = [];
  for (const rawValue of rawValues) {
    const cleaned = cleanPublicText(rawValue);
    if (!cleaned) return undefined;
    const withoutSchemaPrefix = cleaned.replace(/^https?:\/\/schema\.org\//i, '');
    const expanded = expandDays(withoutSchemaPrefix);
    if (!expanded?.length) return undefined;
    days.push(...expanded);
  }
  return days.length ? Array.from(new Set(days)) : undefined;
}

function normalizeHoursSpecification(value: unknown): SemanticPageData['hours'] | undefined {
  const specs = Array.isArray(value) ? value : [value];
  const hours: NonNullable<SemanticPageData['hours']> = [];
  for (const spec of specs) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) continue;
    const obj = spec as Record<string, unknown>;
    const days = normalizeDayValues(obj.dayOfWeek);
    const opens = normalizeTime(cleanPublicText(obj.opens));
    const closes = normalizeTime(cleanPublicText(obj.closes));
    if (!days?.length || !opens || !closes) continue;
    hours.push({ dayOfWeek: days.length === 1 ? days[0] : days, opens, closes });
  }
  return hours.length ? hours : undefined;
}

function parseOpeningHours(value: unknown): SemanticPageData['hours'] | undefined {
  const rawValues = Array.isArray(value) ? value : [value];
  const hours: NonNullable<SemanticPageData['hours']> = [];
  for (const rawValue of rawValues) {
    const text = cleanPublicText(rawValue);
    if (!text || /<[^>]+>/.test(text) || /\bclosed\b/i.test(text)) continue;
    const match = text.match(/^([A-Za-z,\s-]+)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*-\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$/i);
    if (!match) continue;
    const days = expandDays(match[1].trim());
    const opens = normalizeTime(match[2]);
    const closes = normalizeTime(match[3]);
    if (!days?.length || !opens || !closes) continue;
    hours.push({ dayOfWeek: days.length === 1 ? days[0] : days, opens, closes });
  }
  return hours.length ? hours : undefined;
}

function extractJsonLdObjects($: cheerio.CheerioAPI): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = parseJsonFallback<unknown>($(el).contents().text(), null);
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const obj = item as Record<string, unknown>;
        nodes.push(obj);
        const graph = obj['@graph'];
        if (Array.isArray(graph)) queue.push(...graph);
      }
    } catch { /* invalid inline JSON-LD is ignored by the semantic extractor */ } // catch-ok
  });
  return nodes;
}

function schemaNodeHasType(node: Record<string, unknown>, expected: string): boolean {
  return schemaTypes(node).some(type => type.toLowerCase() === expected.toLowerCase());
}

function firstAudienceType(value: unknown): string | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const audience = firstAudienceType(item);
      if (audience) return audience;
    }
    return undefined;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return cleanPublicText(obj.audienceType) ?? cleanPublicText(obj.name);
  }
  return cleanPublicText(value);
}

function cleanStringList(value: unknown, limit: number): string[] | undefined {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\r?\n|[;,]/).map(v => v.trim()).filter(Boolean)
      : [];
  const cleaned = rawItems
    .map(item => cleanPublicText(item))
    .filter((item): item is string => !!item)
    .slice(0, limit);
  return cleaned.length > 0 ? cleaned : undefined;
}

function normalizeVisibleText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function visibleTextContains(visibleText: string, value: string): boolean {
  const normalizedValue = normalizeVisibleText(value);
  return normalizedValue.length > 0 && visibleText.includes(normalizedValue);
}

function normalizeFaqPairs(
  node: Record<string, unknown>,
  opts: { pageUrl?: string; visibleText: string },
): Array<{ question: string; answer: string }> | undefined {
  if (!schemaNodeHasType(node, 'FAQPage')) return undefined;
  const matchesCurrentPage = nodeMatchesPage(node, opts.pageUrl);
  const entities = Array.isArray(node.mainEntity) ? node.mainEntity : [node.mainEntity];
  const pairs = entities.flatMap(entity => {
    if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return [];
    const questionNode = entity as Record<string, unknown>;
    if (!schemaNodeHasType(questionNode, 'Question')) return [];
    const question = cleanPublicText(questionNode.name);
    const acceptedAnswer = questionNode.acceptedAnswer;
    if (!acceptedAnswer || typeof acceptedAnswer !== 'object' || Array.isArray(acceptedAnswer)) return [];
    const answer = cleanPublicText((acceptedAnswer as Record<string, unknown>).text);
    if (!matchesCurrentPage && (!question || !answer || !visibleTextContains(opts.visibleText, question) || !visibleTextContains(opts.visibleText, answer))) return [];
    return question && answer ? [{ question, answer }] : [];
  });
  return pairs.length >= 2 ? pairs : undefined;
}

function normalizeReviewRating(rating: Record<string, unknown>): number | undefined {
  const ratingRaw = Number(rating.ratingValue);
  if (!Number.isFinite(ratingRaw) || ratingRaw < 1 || ratingRaw > 5) return undefined;

  const bestRating = rating.bestRating === undefined ? undefined : Number(rating.bestRating);
  const worstRating = rating.worstRating === undefined ? undefined : Number(rating.worstRating);
  if (bestRating !== undefined && (!Number.isFinite(bestRating) || bestRating !== 5)) return undefined;
  if (worstRating !== undefined && (!Number.isFinite(worstRating) || worstRating !== 1)) return undefined;

  return ratingRaw;
}

function normalizeReviewEvidence(
  nodes: Record<string, unknown>[],
  opts: { pageUrl?: string; visibleText: string },
): SemanticPageData['reviews'] | undefined {
  const reviews = nodes.flatMap(node => {
    if (!schemaNodeHasType(node, 'Review')) return [];
    const matchesCurrentPage = nodeMatchesPage(node, opts.pageUrl);
    const authorValue = node.author;
    const author = cleanPublicText(
      typeof authorValue === 'object' && authorValue && !Array.isArray(authorValue)
        ? (authorValue as Record<string, unknown>).name
        : authorValue,
    );
    const reviewBody = cleanPublicText(node.reviewBody);
    if (!author || !reviewBody) return [];
    if (!matchesCurrentPage && !visibleTextContains(opts.visibleText, reviewBody)) return [];
    const ratingValue = typeof node.reviewRating === 'object' && node.reviewRating && !Array.isArray(node.reviewRating)
      ? normalizeReviewRating(node.reviewRating as Record<string, unknown>)
      : undefined;
    return [{ author, reviewBody, ...(ratingValue !== undefined ? { ratingValue } : {}) }];
  });
  return reviews.length > 0 ? reviews : undefined;
}

function semanticAddressFromObject(value: unknown): SemanticPageData['address'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const obj = value as Record<string, unknown>;
  const street = cleanPublicText(obj.streetAddress);
  const city = cleanPublicText(obj.addressLocality);
  const state = cleanPublicText(obj.addressRegion);
  const postalCode = cleanPublicText(obj.postalCode);
  const country = cleanPublicText(obj.addressCountry);
  if (!street || !city || !state) return undefined;
  return {
    street,
    city,
    state,
    ...(postalCode ? { postalCode } : {}),
    ...(country ? { country } : {}),
  };
}

function firstItemprop($: cheerio.CheerioAPI, prop: string): string | undefined {
  const el = $(`[itemprop="${prop}"]`).first();
  if (!el.length) return undefined;
  return cleanSemanticText(el.attr('content') || el.attr('datetime') || el.text());
}

function currentPageUrl($: cheerio.CheerioAPI, opts: ExtractPageElementsOpts): string | undefined {
  const renderedCanonical = cleanHttpUrl($('link[rel="canonical"]').attr('href'));
  return renderedCanonical ?? cleanHttpUrl(opts.pageBaseUrl);
}

function nodeMatchesPage(node: Record<string, unknown>, pageUrl: string | undefined): boolean {
  const comparablePage = comparablePageUrl(pageUrl);
  if (!comparablePage) return false;
  return objectUrlCandidates([
    node.url,
    node['@id'],
    node.mainEntityOfPage,
  ]).some(candidate => comparablePageUrl(candidate) === comparablePage);
}

function extractSemantics($: cheerio.CheerioAPI, opts: ExtractPageElementsOpts): SemanticPageData | undefined {
  const jsonLdNodes = extractJsonLdObjects($);
  const pageUrl = currentPageUrl($, opts);
  const visibleBody = $('body').clone();
  visibleBody.find('script,style,noscript').remove();
  const visibleText = normalizeVisibleText(visibleBody.text());
  const localBusinessNodes = jsonLdNodes.filter(node => schemaTypes(node).some(t => LOCAL_BUSINESS_TYPES.has(t)));
  const localBusinessNode = localBusinessNodes.find(node => nodeMatchesPage(node, pageUrl)) ?? localBusinessNodes[0];
  const businessNode = localBusinessNode ?? jsonLdNodes.find(node => schemaTypes(node).some(t => BUSINESS_FALLBACK_TYPES.has(t)));
  const businessType = firstSchemaType(localBusinessNode, LOCAL_BUSINESS_TYPES);
  const businessName = cleanPublicText(businessNode?.name);
  const phone = normalizePhone(businessNode?.telephone)
    ?? normalizePhone($('a[href^="tel:"]').first().attr('href'));
  const email = normalizeEmail(businessNode?.email)
    ?? normalizeEmail($('a[href^="mailto:"]').first().attr('href'));
  const jsonLdAddress = semanticAddressFromObject(businessNode?.address);
  const itempropAddress = semanticAddressFromObject({
    streetAddress: firstItemprop($, 'streetAddress'),
    addressLocality: firstItemprop($, 'addressLocality'),
    addressRegion: firstItemprop($, 'addressRegion'),
    postalCode: firstItemprop($, 'postalCode'),
    addressCountry: firstItemprop($, 'addressCountry'),
  });
  const sameAsRaw = businessNode?.sameAs;
  const sameAs = Array.isArray(sameAsRaw)
    ? sameAsRaw.map(v => cleanSemanticText(v)).filter((v): v is string => !!v && /^https?:\/\//.test(v))
    : undefined;
  const geo = semanticGeoFromObject(businessNode?.geo);
  const primaryImage = firstHttpUrl(businessNode?.image);
  const priceRange = cleanPublicText(businessNode?.priceRange);
  const hours = normalizeHoursSpecification(businessNode?.openingHoursSpecification)
    ?? parseOpeningHours(businessNode?.openingHours);
  const softwareApplicationNodes = jsonLdNodes.filter(node => schemaNodeHasType(node, 'SoftwareApplication'));
  const softwareApplicationNode = softwareApplicationNodes.find(node => nodeMatchesPage(node, pageUrl))
    ?? softwareApplicationNodes[0];
  const softwareApplicationName = cleanPublicText(softwareApplicationNode?.name);
  const softwareApplicationDescription = cleanPublicText(softwareApplicationNode?.description);
  const softwareApplicationUrl = resolveSafeUrl(softwareApplicationNode?.url, pageUrl)
    ?? resolveSafeUrl(softwareApplicationNode?.['@id'], pageUrl);
  const softwareApplicationCategory = cleanPublicText(softwareApplicationNode?.applicationCategory);
  const softwareApplicationOs = cleanPublicText(softwareApplicationNode?.operatingSystem);
  const softwareApplicationFeatureList = cleanStringList(softwareApplicationNode?.featureList, 8);
  const softwareApplicationAudienceType = firstAudienceType(softwareApplicationNode?.audience);
  const softwareApplicationOfferValue = softwareApplicationNode?.offers;
  const softwareApplicationOfferUrl = firstResolvedSafeUrl(softwareApplicationOfferValue, pageUrl);
  const softwareApplicationOfferAvailability = cleanPublicText(
    typeof softwareApplicationOfferValue === 'object' && softwareApplicationOfferValue && !Array.isArray(softwareApplicationOfferValue)
      ? (softwareApplicationOfferValue as Record<string, unknown>).availability
      : undefined,
  );
  const softwareApplication = softwareApplicationName
    ? {
      name: softwareApplicationName,
      ...(softwareApplicationDescription ? { description: softwareApplicationDescription } : {}),
      ...(softwareApplicationUrl ? { url: softwareApplicationUrl } : {}),
      ...(softwareApplicationCategory ? { applicationCategory: softwareApplicationCategory } : {}),
      ...(softwareApplicationOs ? { operatingSystem: softwareApplicationOs } : {}),
      ...(softwareApplicationFeatureList ? { featureList: softwareApplicationFeatureList } : {}),
      ...(softwareApplicationAudienceType ? { audience: { audienceType: softwareApplicationAudienceType } } : {}),
      ...(softwareApplicationOfferUrl || softwareApplicationOfferAvailability
        ? {
          offer: {
            ...(softwareApplicationOfferUrl ? { url: softwareApplicationOfferUrl } : {}),
            ...(softwareApplicationOfferAvailability ? { availability: softwareApplicationOfferAvailability } : {}),
          },
        }
        : {}),
    }
    : undefined;

  const audienceNodes = jsonLdNodes.filter(node => schemaNodeHasType(node, 'Audience'));
  const pageAudienceType = firstAudienceType(audienceNodes[0]) ?? softwareApplicationAudienceType;
  const pageAudience = pageAudienceType ? { audienceType: pageAudienceType } : undefined;
  const existingFaq = jsonLdNodes
    .map(node => normalizeFaqPairs(node, { pageUrl, visibleText }))
    .find((faq): faq is Array<{ question: string; answer: string }> => !!faq);
  const reviews = normalizeReviewEvidence(jsonLdNodes, { pageUrl, visibleText });

  const semantics: SemanticPageData = {
    ...(businessName ? { businessName } : {}),
    ...(businessType ? { businessType } : {}),
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
    ...(jsonLdAddress ?? itempropAddress ? { address: jsonLdAddress ?? itempropAddress } : {}),
    ...(geo ? { geo } : {}),
    ...(hours ? { hours } : {}),
    ...(sameAs && sameAs.length > 0 ? { sameAs } : {}),
    ...(primaryImage ? { primaryImage } : {}),
    ...(priceRange ? { priceRange } : {}),
    ...(softwareApplication ? { softwareApplication } : {}),
    ...(pageAudience ? { pageAudience } : {}),
    ...(existingFaq ? { existingFaq } : {}),
    ...(reviews ? { reviews } : {}),
  };
  return Object.keys(semantics).length > 0 ? semantics : undefined;
}

export async function extractPageElements(
  html: string,
  opts: ExtractPageElementsOpts,
): Promise<PageElementCatalog> {
  // The function documents a "never throws" contract — wrap the entire body
  // so any future sub-extractor that calls into less-defensive code (regex,
  // URL parsing) cannot break that guarantee. Callers (generator.ts) rely on
  // it to keep schema generation flowing when extraction degrades.
  try {
    const $ = cheerio.load(html ?? '');

    // PR1 elements
    const videos = extractVideos($);
    let lists = extractLists($);
    // Capture parallel raw item text for AI disambiguation (PR2).
    // Scope must match extractLists EXACTLY (article ol+ul, with whole-document
    // fallback) so the resulting itemsByList[i] is aligned with lists[i] by
    // DOM order. The disambiguator slices itemsByList[i] per list — a flat
    // concat would silently send list-0's items as the prompt for every
    // subsequent list (review-caught data corruption bug).
    const $listScope = contentScope($).find('ol, ul');
    const itemsByList: string[][] = [];
    $listScope.each((_, el) => {
      const items = $(el).children('li').toArray().map(li => $(li).text().trim());
      itemsByList.push(items);
    });
    lists = await aiDisambiguateHowTo(lists, itemsByList, {
      budget: opts.aiBudget,
      workspaceId: opts.workspaceId,
    });
    const citations = extractCitations($, opts.pageBaseUrl);

    // PR2 elements (images / tables / testimonials)
    let images = extractImages($);
    images = await aiClassifyImages(images, {
      budget: opts.aiBudget,
      workspaceId: opts.workspaceId,
    });
    const tables = extractTables($);
    const testimonials = extractTestimonials($);
    const semantics = extractSemantics($, opts);

    // PR3 elements — empty arrays until PR3
    const headings: PageElementCatalog['headings'] = [];
    const codeBlocks: PageElementCatalog['codeBlocks'] = [];

    return {
      extractedAt: new Date().toISOString(),
      sourcePublishedAt: opts.sourcePublishedAt,
      headings,
      tables,
      images,
      videos,
      lists,
      testimonials,
      codeBlocks,
      citations,
      ...(semantics ? { semantics } : {}),
      diagnostics: {
        aiClassificationCalls: opts.aiBudget.used,
        hitAiBudgetCap: opts.aiBudget.exhausted,
        rawCounts: {
          headings: headings.length,
          tables: tables.length,
          images: images.length,
          videos: videos.length,
          lists: lists.length,
          testimonials: testimonials.length,
          codeBlocks: codeBlocks.length,
          citations: citations.length,
        },
      },
    };
  } catch (err) { // catch-ok: the public contract guarantees no throw — degrade to empty catalog
    log.warn({ err, pageBaseUrl: opts.pageBaseUrl }, 'extractPageElements failed; returning empty catalog');
    return emptyCatalog(opts, 1);
  }
}
