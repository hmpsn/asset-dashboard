/**
 * Lean schema generator orchestrator.
 *
 * Pipeline:
 *   1. Classify page → primary @type (deterministic, no AI)
 *   2. Extract canonical page data from HTML + meta + workspace (no AI)
 *   3. Surgical AI for description (only if missing) + FAQ (only if accordion present)
 *   4. Build typed template
 *   5. Validate against Google rich-result rules
 *   6. Return LeanGeneratorOutput (matches the shape SchemaPageSuggestion expects)
 */

import * as cheerio from 'cheerio';
import { classifyPage } from './classifier.js';
import type { BusinessKind, ClassifiedPage, PageKind } from './classifier.js';
import { extractPageData } from './data-sources.js';
import type { PageData, PageMetaInput, WorkspaceSchemaInput } from './data-sources.js';
import { extractDescription } from './extractors/description.js';
import { extractFaq } from './extractors/faq.js';
import { extractPageElements } from './extractors/page-elements.js';
import { createAiBudget } from './extractors/page-elements/ai-budget.js';
import type { AiBudget } from './extractors/page-elements/ai-budget.js';
import { getPageElements, upsertPageElements } from '../page-elements-store.js';
import type { PageElementCatalog, SemanticPageData } from '../../shared/types/page-elements.js';
import { buildArticleSchema } from './templates/article.js';
import { buildServiceSchema, buildProductSchema } from './templates/service.js';
import { buildPricingPageSchema, buildProfilePageSchema } from './templates/rich-roles.js';
import type { OfferData } from './templates/rich-roles.js';
import { buildLocalBusinessSchema } from './templates/local-business.js';
import { buildAboutPageSchema, buildContactPageSchema, buildCollectionPageSchema, buildWebPageSchema, buildBlogIndexSchema, buildServiceHubSchema } from './templates/static.js';
import { buildHomepageSchema } from './templates/homepage.js';
import { validateLeanSchema } from './validator.js';
import { checkRichResultsEligibility } from './rich-results.js';
import type { RichResultEligibility } from './rich-results.js';
import type { ValidationFinding } from '../../shared/types/schema-validation.js';
import type { SchemaGenerationDiagnostics, SchemaRoleSource, SkippedSchemaType } from '../../shared/types/schema-generation.js';
import type { CanonicalEntity, SchemaIndustrySubtype, SchemaPageRole } from '../../shared/types/schema-plan.js';
import type { SchemaCmsDeliveryStatus, SchemaCollectionIdentity, SchemaFieldEvidence } from '../../shared/types/site-inventory.js';
import type { SiteContext, SiteContextPage } from './site-context.js';
import { validateForGoogleRichResults } from '../schema-validator.js';
import { createLogger } from '../logger.js';

const log = createLogger('schema/generator');

function pageKindToPrimaryType(kind: PageKind, businessKind: BusinessKind = 'unknown'): string {
  const map: Record<PageKind, string> = {
    Homepage:       businessKind === 'local' ? 'LocalBusiness' : 'Organization',
    BlogPosting:    'BlogPosting',
    BlogIndex:      'CollectionPage',
    Service:        'Service',
    ServiceIndex:   'CollectionPage',
    CaseStudy:      'Article',
    CaseStudyIndex: 'CollectionPage',
    AboutPage:      'AboutPage',
    ContactPage:    'ContactPage',
    Location:       'LocalBusiness',
    Legal:          'WebPage',
    WebPage:        'WebPage',
  };
  return map[kind] ?? 'WebPage';
}

/** Subset of SchemaPageSuggestion that the generator returns. */
export interface LeanGeneratorOutput {
  pageId: string;
  pageTitle: string;
  slug: string;
  url: string;
  existingSchemas: string[];
  suggestedSchemas: Array<{
    type: string;
    reason: string;
    priority: 'high' | 'medium' | 'low';
    template: Record<string, unknown>;
  }>;
  /** Typed validation findings — preferred consumer surface (PR2 completeness widget reads this). */
  validationFindings?: ValidationFinding[];
  /** Backwards-compat: severity=error findings flattened to messages. Snapshot storage + legacy frontend consume this. */
  validationErrors?: string[];
  richResultsEligibility?: RichResultEligibility[];
  generationDiagnostics?: SchemaGenerationDiagnostics;
}

export interface LeanGeneratorInput {
  pageId: string;
  pageMeta: PageMetaInput;
  html: string;
  baseUrl: string;
  workspace: WorkspaceSchemaInput;
  /** Optional override for existing schema detection (saves Cheerio re-parsing in batch). */
  existingSchemas?: string[];
  /** Per-regenerate AI budget passed by the schema-suggester orchestrator. PR1 always zero. */
  aiBudget?: AiBudget;
  /**
   * Optional cross-page context assembled once per regenerate-all run.
   * When absent, generator behaves exactly as before (no hub enrichment).
   * Workstream D will extend SiteContext with role/exclusion fields.
   */
  siteContext?: SiteContext;
  pageKindOverride?: PageKind;
  schemaRoleOverride?: {
    role: SchemaPageRole;
    source: Exclude<SchemaRoleSource, 'auto-detect'>;
    industrySubtype?: SchemaIndustrySubtype;
  };
  canonicalEntityRefs?: string[];
  plannedSchemaRole?: SchemaPageRole;
  roleDecisionDiagnostics?: SkippedSchemaType[];
  inactivePlanStatus?: string;
  collectionIdentity?: SchemaCollectionIdentity;
  cmsDeliveryStatus?: SchemaCmsDeliveryStatus;
}

function jsonLdObjectsFromHtml(html: string): Record<string, unknown>[] {
  const $ = cheerio.load(html);
  const objects: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).html() || '{}') as unknown;
      if (!json || typeof json !== 'object' || Array.isArray(json)) return;
      const node = json as Record<string, unknown>;
      objects.push(node);
      const graph = node['@graph'] as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(graph)) {
        objects.push(...graph.filter((n): n is Record<string, unknown> => !!n && typeof n === 'object' && !Array.isArray(n)));
      }
    } catch { /* ignore unparseable */ } // catch-ok: malformed JSON-LD on third-party pages
  });
  return objects;
}

function detectExistingSchemas(html: string): string[] {
  const types: string[] = [];
  const pushTypes = (rawType: unknown) => {
    if (typeof rawType === 'string') {
      types.push(rawType);
    } else if (Array.isArray(rawType)) {
      types.push(...rawType.filter((value): value is string => typeof value === 'string'));
    }
  };
  for (const node of jsonLdObjectsFromHtml(html)) {
    pushTypes(node['@type']);
  }
  return Array.from(new Set(types));
}

function hasLocalBusinessJsonLdEvidence(html: string): boolean {
  const localTypes = new Set(['Dentist', 'MedicalBusiness', 'MedicalOrganization', 'LocalBusiness', 'FinancialService']);
  return detectExistingSchemas(html).some(type => localTypes.has(type));
}

function schemaNodeHasType(node: Record<string, unknown>, expected: string): boolean {
  const type = node['@type'];
  if (typeof type === 'string') return type === expected;
  return Array.isArray(type) && type.some(value => value === expected);
}

function hasAudienceEvidence(value: unknown): boolean {
  if (!value) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasAudienceEvidence);
  if (typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.audienceType === 'string' && obj.audienceType.trim().length > 0
    || typeof obj.name === 'string' && obj.name.trim().length > 0;
}

function hasSoftwareApplicationAudienceJsonLdEvidence(html: string): boolean {
  return jsonLdObjectsFromHtml(html).some(node =>
    schemaNodeHasType(node, 'SoftwareApplication') && hasAudienceEvidence(node.audience),
  );
}

function shouldRefreshStoredCatalogForJsonLdEvidence(catalog: PageElementCatalog, html: string): boolean {
  if (!html.trim()) return false;
  const semantics = catalog.semantics;
  const detectedTypes = new Set(detectExistingSchemas(html));
  const hasType = (...types: string[]) => types.some(type => detectedTypes.has(type));

  if (hasLocalBusinessJsonLdEvidence(html) && (!semantics?.businessType || !semantics?.address)) return true;
  if (hasType('SoftwareApplication') && !semantics?.softwareApplication) return true;
  if (hasType('Audience') && !semantics?.pageAudience) return true;
  if (hasSoftwareApplicationAudienceJsonLdEvidence(html) && !semantics?.pageAudience) return true;
  if (hasType('FAQPage') && !semantics?.existingFaq) return true;
  if (hasType('Review') && !semantics?.reviews) return true;
  return false;
}

function plainText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  return $('body').text().replace(/\s+/g, ' ').trim();
}

/**
 * Lazy-refresh staleness check for the page-element catalog.
 *
 * Refresh policy (preserves work, never freezes the cache):
 *   1. If both timestamps present and parseable → refresh iff input > stored.
 *   2. If presence differs (one null, one set) → refresh (CMS↔static migration
 *      or first-time republish acquisition).
 *   3. If either timestamp is unparseable (NaN) → refresh (corrupted row should
 *      not freeze the catalog forever).
 *   4. If both null → no refresh signal; rely on caller to invalidate
 *      (typical for static pages with no published-at metadata).
 */
export function isCatalogStale(
  storedSourcePublishedAt: string | null,
  inputSourcePublishedAt: string | null,
): boolean {
  if (storedSourcePublishedAt === null && inputSourcePublishedAt === null) return false;
  if (storedSourcePublishedAt === null || inputSourcePublishedAt === null) return true;
  const storedMs = new Date(storedSourcePublishedAt).getTime();
  const inputMs = new Date(inputSourcePublishedAt).getTime();
  if (!Number.isFinite(storedMs) || !Number.isFinite(inputMs)) return true;
  return inputMs > storedMs;
}

/** Returns child @id objects for a hub page when siteContext is present and has resolvable children; null otherwise. */
function resolveHubChildren(input: LeanGeneratorInput): Array<{ id: string }> | null {
  const hubCtx = input.siteContext?.pages.find(p => p.path === input.pageMeta.publishedPath);
  if (!hubCtx || hubCtx.childPaths.length === 0) return null;
  const resolved = hubCtx.childPaths
    .map(cp => input.siteContext!.pages.find(p => p.path === cp))
    .filter((p): p is SiteContextPage => p !== undefined)
    .map(p => ({ id: p.id }));
  // Defensive: if every childPath failed to resolve (shouldn't happen since childPaths
  // are populated from the same sitePages array), return null so callers fall back to
  // CollectionPage instead of emitting an empty hub.
  return resolved.length > 0 ? resolved : null;
}

function looksDiscountOrPromoContext(context: string): boolean {
  return /\b(?:off|discount|promo|promotion|coupon|save|saving|rebate)\b/i.test(context);
}

const OFFER_NAME_LEADING_NOISE = new Set([
  'pricing',
  'package',
  'packages',
  'plan',
  'plans',
  'service',
  'services',
]);

function normalizeOfferName(candidate: string | undefined): string | undefined {
  if (!candidate) return undefined;
  const cleaned = candidate
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[|>]+/g, ' ')
    .trim();
  if (!cleaned) return undefined;
  if (/[a-z][A-Z]/.test(cleaned) && !/\s/.test(cleaned)) return undefined;
  const sentenceTail = cleaned.split(/[\n\r|:;.!?]+/).map(part => part.trim()).filter(Boolean).pop() ?? cleaned;
  const withoutPricingTail = sentenceTail
    .replace(/\b(?:cost|price|pricing|starts?|starting|from|for|only|is)\b\s*$/i, '')
    .replace(/\b(?:cost|price)\s+is\s*$/i, '')
    .replace(/\b(?:cost|price)\b\s*$/i, '')
    .trim();
  if (!withoutPricingTail) return undefined;
  const words = withoutPricingTail.split(/\s+/).filter(Boolean);
  if (words.length === 0) return undefined;
  const tailWords = words.slice(-4);
  const first = tailWords[0]?.toLowerCase();
  const meaningfulWords = first && OFFER_NAME_LEADING_NOISE.has(first) && tailWords.length > 2
    ? tailWords.slice(1)
    : tailWords;
  const normalized = meaningfulWords.join(' ');
  if (!/[A-Za-z]/.test(normalized)) return undefined;
  if (normalized.length < 3 || normalized.length > 70) return undefined;
  return normalized;
}

function extractVisibleOffers(html: string): OfferData[] {
  const $ = cheerio.load(html || '');
  $('script, style, noscript').remove();
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  const matches = text.matchAll(/(?:US\$|\$)\s?(\d{1,5}(?:,\d{3})?(?:\.\d{2})?)/g);
  const offers: OfferData[] = [];
  for (const match of matches) {
    const rawPrice = match[1]?.replace(/,/g, '');
    if (!rawPrice) continue;
    const before = text.slice(Math.max(0, (match.index ?? 0) - 90), match.index).trim();
    const after = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 45).trim();
    const nearContext = `${text.slice(Math.max(0, (match.index ?? 0) - 24), match.index)} ${after}`.trim();
    if (looksDiscountOrPromoContext(nearContext)) continue;
    const rawName = before.match(/([A-Za-z][A-Za-z0-9 +&/().'-]{2,70})$/)?.[1]?.trim();
    const name = normalizeOfferName(rawName);
    if (!name) continue;
    offers.push({
      name,
      price: rawPrice,
      priceCurrency: 'USD',
    });
    if (offers.length >= 6) break;
  }
  return offers;
}

function hasGraphType(schema: Record<string, unknown>, type: string): boolean {
  const graph = schema['@graph'] as Array<Record<string, unknown>> | undefined;
  return Array.isArray(graph) && graph.some(node => node['@type'] === type);
}

function graphNodeByType(schema: Record<string, unknown>, type: string): Record<string, unknown> | undefined {
  return graphArray(schema).find(node => nodeTypeList(node).includes(type));
}

function compactSchemaNode(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => {
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }));
}

function schemaIdRef(id: string): { '@id': string } {
  return { '@id': id };
}

function audienceNode(audienceType: string | undefined): Record<string, unknown> | undefined {
  const cleaned = safePublicText(audienceType);
  return cleaned ? { '@type': 'Audience', audienceType: cleaned } : undefined;
}

function mergeMissingSchemaFields(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    if (target[key] === undefined || target[key] === null || target[key] === '') {
      target[key] = value;
    }
  }
}

function applyTrustedJsonLdEvidence(input: {
  schema: Record<string, unknown>;
  pageData: PageData;
  semantics?: SemanticPageData;
  role?: SchemaPageRole;
  canonicalEntityRefs?: string[];
}): void {
  const { schema, pageData, semantics, role } = input;
  if (!semantics) return;
  const graph = graphArray(schema);
  if (graph.length === 0) return;

  let softwareApplicationId: string | undefined;
  const softwareApplication = semantics.softwareApplication;
  const existingSoftware = graphNodeByType(schema, 'SoftwareApplication');
  const canonicalSoftwareRef = (input.canonicalEntityRefs ?? []).find(ref => ref.includes('#software'))
    ?? input.canonicalEntityRefs?.[0];
  if (softwareApplication?.name) {
    softwareApplicationId = typeof existingSoftware?.['@id'] === 'string' ? existingSoftware['@id'] : undefined;
    const shouldMaterializeSoftware = !!existingSoftware || role !== 'audience' || !canonicalSoftwareRef;
    if (shouldMaterializeSoftware) {
      softwareApplicationId = softwareApplicationId ?? `${pageData.canonicalUrl}#software`;
      const softwareNode = compactSchemaNode({
        '@type': 'SoftwareApplication',
        '@id': softwareApplicationId,
        'name': softwareApplication.name,
        'description': softwareApplication.description ?? pageData.description,
        'url': softwareApplication.url ?? pageData.canonicalUrl,
        'applicationCategory': softwareApplication.applicationCategory,
        'operatingSystem': softwareApplication.operatingSystem,
        'featureList': softwareApplication.featureList,
        'audience': audienceNode(softwareApplication.audience?.audienceType ?? semantics.pageAudience?.audienceType),
        'offers': softwareApplication.offer
          ? compactSchemaNode({
            '@type': 'Offer',
            'url': softwareApplication.offer.url,
            'availability': softwareApplication.offer.availability,
          })
          : undefined,
      });
      if (existingSoftware) {
        mergeMissingSchemaFields(existingSoftware, softwareNode);
      } else {
        graph.push(softwareNode);
      }
    } else {
      softwareApplicationId = canonicalSoftwareRef;
    }
  }

  const webPageLike = graph.find(node => {
    const types = nodeTypeList(node);
    return types.some(type => ['WebPage', 'CollectionPage', 'AboutPage', 'ContactPage', 'ProfilePage'].includes(type));
  });
  const audience = audienceNode(semantics.pageAudience?.audienceType ?? softwareApplication?.audience?.audienceType);
  if (webPageLike && audience && !webPageLike.audience) {
    webPageLike.audience = audience;
  }
  if (webPageLike && softwareApplicationId) {
    if (role === 'audience' && !webPageLike.about) {
      webPageLike.about = schemaIdRef(softwareApplicationId);
    } else {
      addCanonicalReferencesToNode(webPageLike, [softwareApplicationId]);
    }
  }

  const serviceNode = graphNodeByType(schema, 'Service');
  const reviewTargetId = softwareApplicationId
    ?? (typeof serviceNode?.['@id'] === 'string' ? serviceNode['@id'] : undefined)
    ?? (typeof webPageLike?.['@id'] === 'string' ? webPageLike['@id'] : undefined);
  const existingReviewCount = graph.filter(node => node['@type'] === 'Review').length;
  const validReviews = (semantics.reviews ?? []).filter(review =>
    !!review.author && !!review.reviewBody && (Number.isFinite(review.ratingValue) || !!review.datePublished));
  if (reviewTargetId && validReviews.length > 0) {
    validReviews.slice(0, 3).forEach((review, idx) => {
      const reviewRating = Number.isFinite(review.ratingValue)
        ? {
            '@type': 'Rating',
            'ratingValue': review.ratingValue,
            'bestRating': 5,
            'worstRating': 1,
          }
        : undefined;
      graph.push(compactSchemaNode({
        '@type': 'Review',
        '@id': `${pageData.canonicalUrl}#review-existing-${existingReviewCount + idx}`,
        'itemReviewed': schemaIdRef(reviewTargetId),
        'reviewRating': reviewRating,
        'author': { '@type': 'Person', 'name': review.author },
        'reviewBody': review.reviewBody,
        'datePublished': review.datePublished,
      }));
    });
  }
}

function isCollectionIndexKind(kind: PageKind): boolean {
  return kind === 'BlogIndex' || kind === 'ServiceIndex' || kind === 'CaseStudyIndex';
}

function hasQuestionLikeContent(html: string): boolean {
  const text = plainText(html);
  const matches = text.match(/\b(?:what|why|when|where|which|who|how|can|do|does|did|is|are|should|will|would)[^?]{8,220}\?/gi);
  return (matches?.length ?? 0) >= 2;
}

function validationStatus(findings: ValidationFinding[]): 'valid' | 'warnings' | 'errors' {
  if (findings.some(f => f.severity === 'error')) return 'errors';
  if (findings.some(f => f.severity === 'warning')) return 'warnings';
  return 'valid';
}

function roleToDiagnosticsType(role: SchemaPageRole): string | null {
  const map: Partial<Record<SchemaPageRole, string>> = {
    product: 'Product',
    faq: 'FAQPage',
    howto: 'HowTo',
    video: 'VideoObject',
    pricing: 'Offer',
    author: 'ProfilePage',
    'job-posting': 'JobPosting',
    course: 'Course',
    event: 'Event',
    review: 'Review',
    recipe: 'Recipe',
  };
  return map[role] ?? null;
}

function normalizeSchemaUrlPath(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return path;
  } catch { // catch-ok: malformed plan URLs are ignored by canonical entity enrichment
    return null;
  }
}

function normalizeSchemaNodeId(id: string | undefined): string | null {
  if (!id) return null;
  try {
    const parsed = new URL(id);
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${parsed.origin}${path}${parsed.search}${parsed.hash}`;
  } catch { // catch-ok: malformed node ids cannot be matched safely
    return null;
  }
}

function isValidHttpUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch { // catch-ok: invalid URL means the entity is not safe to emit
    return false;
  }
}

function canonicalEntityNode(entity: CanonicalEntity): Record<string, unknown> | null {
  if (!isValidHttpUrl(entity.id) || !entity.type || !entity.name || !isValidHttpUrl(entity.canonicalUrl)) return null;
  return dropEmptySchemaFields({
    '@type': entity.type,
    '@id': entity.id,
    'name': entity.name,
    'url': entity.canonicalUrl,
    'description': entity.description,
  });
}

function canonicalEntityNodeEntries(
  canonicalEntities: CanonicalEntity[],
): Array<{ entity: CanonicalEntity; node: Record<string, unknown> }> {
  const seenNormalizedIds = new Set<string>();
  return canonicalEntities.reduce<Array<{ entity: CanonicalEntity; node: Record<string, unknown> }>>((entries, entity) => {
    const node = canonicalEntityNode(entity);
    if (!node) return entries;
    const normalizedId = normalizeSchemaNodeId(entity.id);
    if (normalizedId) {
      if (seenNormalizedIds.has(normalizedId)) return entries;
      seenNormalizedIds.add(normalizedId);
    }
    entries.push({ entity, node });
    return entries;
  }, []);
}

function dropEmptySchemaFields(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

function graphArray(schema: Record<string, unknown>): Array<Record<string, unknown>> {
  const graph = schema['@graph'];
  if (Array.isArray(graph)) return graph as Array<Record<string, unknown>>;
  return [];
}

function nodeTypeList(node: Record<string, unknown>): string[] {
  const type = node['@type'];
  if (typeof type === 'string' && type.trim()) return [type.trim()];
  if (Array.isArray(type)) return type.filter((item): item is string => typeof item === 'string' && !!item.trim());
  return [];
}

function refIds(value: unknown): Set<string> {
  const ids = new Set<string>();
  const visit = (item: unknown) => {
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (!item || typeof item !== 'object') return;
    const record = item as Record<string, unknown>;
    if (typeof record['@id'] === 'string') ids.add(record['@id']);
  };
  visit(value);
  return ids;
}

function replaceReferenceIds(value: unknown, oldId: string, newId: string): void {
  if (!value || oldId === newId) return;
  if (Array.isArray(value)) {
    for (const item of value) replaceReferenceIds(item, oldId, newId);
    return;
  }
  if (typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (record['@id'] === oldId) record['@id'] = newId;
  for (const nested of Object.values(record)) replaceReferenceIds(nested, oldId, newId);
}

function addCanonicalReferencesToNode(node: Record<string, unknown>, refs: string[]): void {
  const normalizedRefs = refs
    .filter(ref => typeof ref === 'string' && ref.trim())
    .map(ref => ({ '@id': ref.trim() }));
  if (normalizedRefs.length === 0) return;

  const existingAbout = refIds(node.about);
  const existingMentions = refIds(node.mentions);
  const missingRefs = normalizedRefs.filter(ref => !existingAbout.has(ref['@id']) && !existingMentions.has(ref['@id']));
  if (missingRefs.length === 0) return;

  if (!node.about) {
    node.about = missingRefs.length === 1 ? missingRefs[0] : missingRefs;
    return;
  }
  const currentMentions = Array.isArray(node.mentions)
    ? node.mentions
    : node.mentions
      ? [node.mentions]
      : [];
  node.mentions = [...currentMentions, ...missingRefs];
}

function applyCanonicalEntityGraph(input: {
  schema: Record<string, unknown>;
  pageCanonicalUrl: string;
  canonicalEntities: CanonicalEntity[];
  entityRefs: string[];
}): void {
  const graph = graphArray(input.schema);
  if (graph.length === 0) return;

  const pagePath = normalizeSchemaUrlPath(input.pageCanonicalUrl);
  const existingById = new Map<string, Record<string, unknown>>();
  const existingByNormalizedId = new Map<string, Record<string, unknown>>();
  for (const node of graph) {
    const id = node['@id'];
    if (typeof id === 'string' && id.trim()) {
      existingById.set(id, node);
      const normalizedId = normalizeSchemaNodeId(id);
      if (normalizedId) existingByNormalizedId.set(normalizedId, node);
    }
  }

  const entityNodes = canonicalEntityNodeEntries(input.canonicalEntities);

  for (const { entity, node } of entityNodes) {
    const entityPath = normalizeSchemaUrlPath(entity.canonicalUrl);
    if (!pagePath || !entityPath || pagePath !== entityPath) continue;
    const normalizedEntityId = normalizeSchemaNodeId(entity.id);
    const existing = existingById.get(entity.id)
      ?? (normalizedEntityId ? existingByNormalizedId.get(normalizedEntityId) : undefined);
    if (existing) {
      const existingId = typeof existing['@id'] === 'string' ? existing['@id'] : undefined;
      for (const [key, value] of Object.entries(node)) {
        if (existing[key] === undefined || existing[key] === null || existing[key] === '') {
          existing[key] = value;
        }
      }
      if (existingId && normalizedEntityId && existingId !== entity.id && normalizeSchemaNodeId(existingId) === normalizedEntityId) {
        existing['@id'] = entity.id;
        for (const graphNode of graph) replaceReferenceIds(graphNode, existingId, entity.id);
        existingById.delete(existingId);
        existingById.set(entity.id, existing);
        existingByNormalizedId.set(normalizedEntityId, existing);
      }
    } else {
      graph.push(node);
      existingById.set(entity.id, node);
      if (normalizedEntityId) existingByNormalizedId.set(normalizedEntityId, node);
    }
  }

  const validEntityIds = new Set(entityNodes.map(({ entity }) => entity.id));
  const refs = input.entityRefs.filter(ref => validEntityIds.has(ref));
  if (refs.length === 0) return;
  const referenceTarget = graph.find(node => {
    const types = nodeTypeList(node);
    return types.some(type => ['WebPage', 'AboutPage', 'ContactPage', 'CollectionPage', 'Blog', 'ProfilePage'].includes(type));
  }) ?? graph[0];
  if (referenceTarget) addCanonicalReferencesToNode(referenceTarget, refs);
}

function isOpaqueIdentifier(value: string): boolean {
  const trimmed = value.trim();
  return /^[a-f0-9]{24}$/i.test(trimmed) || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed);
}

function safePublicText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned || isOpaqueIdentifier(cleaned)) return undefined;
  return cleaned;
}

function formatAreaServed(address: { city?: string; state?: string } | undefined): string | undefined {
  const city = safePublicText(address?.city);
  const state = safePublicText(address?.state);
  if (city && state) return `${city}, ${state}`;
  return city || state;
}

function stripWww(hostname: string): string {
  return hostname.replace(/^www\./i, '').toLowerCase();
}

function sameSiteOrigin(url: string, baseUrl: string): string | undefined {
  try {
    const parsed = new URL(url);
    const base = new URL(baseUrl);
    if (stripWww(parsed.hostname) !== stripWww(base.hostname)) return undefined;
    return parsed.origin;
  } catch { // catch-ok: malformed canonical URL should not block schema generation
    return undefined;
  }
}

function mergeSemanticBusinessProfile(
  semantics: PageElementCatalog['semantics'] | undefined,
  fallback: WorkspaceSchemaInput['businessProfile'],
  fieldEvidence: SchemaFieldEvidence[] | undefined,
): WorkspaceSchemaInput['businessProfile'] {
  const isFallbackEvidence = (field: string) => (fieldEvidence ?? []).some(e =>
    e.field === field && e.source === 'business-profile' && e.status === 'fallback-used');
  const preferSemanticOverFallback = (field: string, fallbackValue: string | undefined, semanticValue: string | undefined) =>
    isFallbackEvidence(field)
      ? safePublicText(semanticValue) ?? safePublicText(fallbackValue)
      : safePublicText(fallbackValue) ?? safePublicText(semanticValue);
  const semanticAddress = semantics?.address;
  const fallbackAddress = fallback?.address;
  const address = {
    street: preferSemanticOverFallback('streetAddress', fallbackAddress?.street, semanticAddress?.street),
    city: preferSemanticOverFallback('addressLocality', fallbackAddress?.city, semanticAddress?.city),
    state: preferSemanticOverFallback('addressRegion', fallbackAddress?.state, semanticAddress?.state),
    zip: preferSemanticOverFallback('postalCode', fallbackAddress?.zip, semanticAddress?.postalCode),
    country: preferSemanticOverFallback('addressCountry', fallbackAddress?.country, semanticAddress?.country),
  };
  const hasAddress = Object.values(address).some(Boolean);
  const phone = preferSemanticOverFallback('phone', fallback?.phone, semantics?.phone);
  const email = preferSemanticOverFallback('email', fallback?.email, semantics?.email);
  const openingHours = safePublicText(fallback?.openingHours);
  const socialProfiles = fallback?.socialProfiles?.length
    ? fallback.socialProfiles
    : semantics?.sameAs;
  if (!fallback && !hasAddress && !phone && !email && !openingHours && !socialProfiles?.length) return null;
  return {
    ...(fallback ?? {}),
    phone,
    email,
    openingHours,
    socialProfiles,
    address: hasAddress ? address : fallback?.address,
  };
}

function semanticFieldEvidence(semantics: PageElementCatalog['semantics'] | undefined): SchemaFieldEvidence[] {
  if (!semantics) return [];
  const evidence: SchemaFieldEvidence[] = [];
  const push = (field: string, message: string) => evidence.push({
    field,
    source: 'existing-json-ld',
    status: 'resolved',
    message,
  });
  if (semantics.businessName) push('locationName', 'locationName resolved from existing local business JSON-LD.');
  if (semantics.businessType) push('businessType', 'businessType resolved from existing local business JSON-LD.');
  if (semantics.address?.street) push('streetAddress', 'streetAddress resolved from existing local business JSON-LD.');
  if (semantics.address?.city) push('addressLocality', 'addressLocality resolved from existing local business JSON-LD.');
  if (semantics.address?.state) push('addressRegion', 'addressRegion resolved from existing local business JSON-LD.');
  if (semantics.address?.postalCode) push('postalCode', 'postalCode resolved from existing local business JSON-LD.');
  if (semantics.address?.country) push('addressCountry', 'addressCountry resolved from existing local business JSON-LD.');
  if (semantics.geo) push('geo', 'geo resolved from existing local business JSON-LD.');
  if (semantics.phone) push('phone', 'phone resolved from existing local business JSON-LD when no stronger source is present.');
  if (semantics.email) push('email', 'email resolved from existing local business JSON-LD when no stronger source is present.');
  if (semantics.primaryImage) push('image', 'image resolved from existing local business JSON-LD.');
  if (semantics.hours?.length) push('openingHoursSpecification', 'openingHoursSpecification normalized from existing local business JSON-LD.');
  if (semantics.softwareApplication) push('softwareApplication', 'SoftwareApplication evidence resolved from existing JSON-LD.');
  if (semantics.softwareApplication?.featureList?.length) push('featureList', 'SoftwareApplication featureList resolved from existing JSON-LD.');
  if (semantics.pageAudience) push('audienceType', 'Audience evidence resolved from existing JSON-LD.');
  if (semantics.existingFaq?.length) push('schemaJsonLd', 'FAQPage evidence resolved from existing JSON-LD.');
  if (semantics.reviews?.length) push('schemaJsonLd', 'Review evidence resolved from existing JSON-LD.');
  return evidence;
}

function buildGenerationDiagnostics(input: {
  plannedRole?: SchemaPageRole;
  role?: SchemaPageRole;
  roleSource: SchemaRoleSource;
  emittedTypes: string[];
  skippedSchemaTypes: SkippedSchemaType[];
  richResultsEligibility: RichResultEligibility[];
  validationFindings: ValidationFinding[];
  validationStatus?: 'valid' | 'warnings' | 'errors';
  inactivePlanStatus?: string;
  collection?: SchemaCollectionIdentity;
  cmsDeliveryStatus?: SchemaCmsDeliveryStatus;
  evidenceSources?: SchemaGenerationDiagnostics['evidenceSources'];
  fieldEvidence?: SchemaGenerationDiagnostics['fieldEvidence'];
  canonicalEntityReferences?: string[];
}): SchemaGenerationDiagnostics {
  const skippedSchemaTypes = [...input.skippedSchemaTypes];
  if (input.inactivePlanStatus && input.roleSource === 'auto-detect') {
    skippedSchemaTypes.unshift({
      type: 'SchemaSitePlan',
      reason: `Plan role ignored: schema site plan is ${input.inactivePlanStatus}, not active.`,
    });
  }
  return {
    plannedRole: input.plannedRole ?? input.role,
    effectiveRole: input.role,
    roleSource: input.roleSource,
    canonicalEntityReferences: input.canonicalEntityReferences?.length ? input.canonicalEntityReferences : undefined,
    collection: input.collection,
    emittedTypes: input.emittedTypes,
    skippedSchemaTypes,
    missingRequiredFields: skippedSchemaTypes.flatMap(s => s.missingFields ?? []),
    evidenceSources: input.evidenceSources,
    fieldEvidence: input.fieldEvidence,
    fieldResolutionStatuses: Array.from(new Set(
      (input.fieldEvidence ?? [])
        .map(e => e.status)
        .filter((status): status is NonNullable<typeof status> => Boolean(status)),
    )),
    richResultsEligibility: input.richResultsEligibility,
    validationStatus: input.validationStatus ?? validationStatus(input.validationFindings),
    cmsDeliveryStatus: input.cmsDeliveryStatus,
  };
}

export async function generateLeanSchema(input: LeanGeneratorInput): Promise<LeanGeneratorOutput> {
  // Fix 1: strip trailing slashes from baseUrl to prevent //path canonical URLs
  const baseUrl = input.baseUrl.replace(/\/+$/, '');

  const role = input.schemaRoleOverride?.role;
  const roleSource: SchemaRoleSource = input.schemaRoleOverride?.source ?? 'auto-detect';
  const industrySubtype = input.schemaRoleOverride?.industrySubtype ?? input.workspace.industrySubtype;
  const skippedSchemaTypes: SkippedSchemaType[] = [];
  if (input.roleDecisionDiagnostics?.length) {
    skippedSchemaTypes.push(...input.roleDecisionDiagnostics);
  }

  // Fix 2: warn when HTML is empty — existing-schema detection returns [] silently
  if (!input.html || input.html.trim().length === 0) {
    log.debug({ pageId: input.pageId }, 'lean schema generated without HTML — existing-schema detection returned empty; downstream consumers should treat as best-effort');
  }

  // Page data — deterministic
  let pageData = extractPageData({
    pageMeta: input.pageMeta,
    html: input.html,
    baseUrl,
    workspace: input.workspace,
  });
  const schemaBaseUrl = sameSiteOrigin(pageData.canonicalUrl, baseUrl) ?? baseUrl;

  // Lazy-refresh element catalog: read from store; if missing or
  // stale-vs-Webflow-lastPublished, extract from current HTML + persist.
  // Per audit §2.4 — HTML is already in scope (input.html). Per spec §3.4 —
  // 100% lazy; no cron, no eager extraction.
  const workspaceId = input.workspace.id;
  const pagePath = input.pageMeta.publishedPath;
  let catalog: PageElementCatalog | undefined;
  if (workspaceId && pagePath) {
    const stored = getPageElements(workspaceId, pagePath);
    const shouldRefreshForJsonLdEvidence = !!stored && shouldRefreshStoredCatalogForJsonLdEvidence(stored.catalog, input.html ?? '');
    if (!stored || isCatalogStale(stored.sourcePublishedAt, input.pageMeta.sourcePublishedAt ?? null) || shouldRefreshForJsonLdEvidence) {
      try {
        const aiBudget = input.aiBudget ?? createAiBudget(0); // PR1: zero AI calls
        catalog = await extractPageElements(input.html ?? '', {
          pageBaseUrl: pageData.canonicalUrl,
          sourcePublishedAt: input.pageMeta.sourcePublishedAt ?? null,
          aiBudget,
          workspaceId,
        });
        upsertPageElements(workspaceId, pagePath, catalog);
      } catch (err) { // catch-ok: extraction or persistence failure — schema generation continues
        // The catch covers two distinct failure modes:
        //   1. extractPageElements throws → catalog is undefined; schema falls
        //      back to non-enriched behavior (this is the "skipped" path).
        //   2. extractPageElements succeeds but upsertPageElements throws (FK
        //      violation, disk error, etc.) → catalog IS populated and the
        //      enrichment proceeds in-memory; only persistence is skipped.
        // The log distinguishes the two so operators can tell which path fired.
        if (catalog) {
          log.warn({ err, workspaceId, pagePath }, 'page-element persistence failed; schema enrichment proceeds with in-memory catalog');
        } else {
          log.warn({ err, workspaceId, pagePath }, 'page-element extraction failed; schema enrichment skipped');
        }
      }
    } else {
      catalog = stored.catalog;
    }
  }
  if (!catalog && (role === 'howto' || role === 'video')) {
    try {
      catalog = await extractPageElements(input.html ?? '', {
        pageBaseUrl: pageData.canonicalUrl,
        sourcePublishedAt: input.pageMeta.sourcePublishedAt ?? null,
        aiBudget: input.aiBudget ?? createAiBudget(0),
        workspaceId: workspaceId ?? 'schema-preview',
      });
    } catch (err) { // catch-ok: in-memory enrichment is optional
      log.warn({ err, pageId: input.pageId }, 'page-element extraction failed; planned rich role will fall back conservatively');
    }
  }
  const semanticData = catalog?.semantics ?? input.pageMeta.elements?.semantics;
  const businessProfileForPage = mergeSemanticBusinessProfile(semanticData, input.workspace.businessProfile, pageData.fieldEvidence);
  pageData = {
    ...pageData,
    elements: catalog ?? pageData.elements,
    areaServed: formatAreaServed(businessProfileForPage?.address) ?? pageData.areaServed,
    fieldEvidence: [
      ...(pageData.fieldEvidence ?? []),
      ...semanticFieldEvidence(semanticData),
    ],
    evidenceSources: {
      ...(pageData.evidenceSources ?? {}),
      ...(semanticData?.businessName ? { locationName: 'existing-json-ld' as const } : {}),
      ...(semanticData?.businessType ? { businessType: 'existing-json-ld' as const } : {}),
      ...(semanticData?.address ? { address: 'existing-json-ld' as const } : {}),
      ...(semanticData?.geo ? { geo: 'existing-json-ld' as const } : {}),
      ...(semanticData?.hours?.length ? { openingHoursSpecification: 'existing-json-ld' as const } : {}),
      ...(semanticData?.softwareApplication ? { softwareApplication: 'existing-json-ld' as const } : {}),
      ...(semanticData?.softwareApplication?.featureList?.length ? { featureList: 'existing-json-ld' as const } : {}),
      ...(semanticData?.pageAudience ? { audienceType: 'existing-json-ld' as const } : {}),
    },
  };
  const businessKind: BusinessKind = businessProfileForPage?.address ? 'local' : 'unknown';
  const classified: ClassifiedPage = input.pageKindOverride
    ? {
        kind: input.pageKindOverride,
        primaryType: pageKindToPrimaryType(input.pageKindOverride, businessKind),
        pagePath: input.pageMeta.publishedPath,
      }
    : classifyPage(`${schemaBaseUrl}${input.pageMeta.publishedPath}`, schemaBaseUrl, { businessKind });

  // Surgical AI: only if no description was found
  if (!pageData.description) {
    const aiDescription = await extractDescription({
      existingDescription: undefined,
      title: pageData.title,
      pageBody: plainText(input.html),
      workspace: input.workspace,
    });
    if (aiDescription) {
      pageData = { ...pageData, description: aiDescription };
    }
  }

  // Build template by explicit role first, then deterministic PageKind.
  let schema: Record<string, unknown>;
  let reason: string;
  const offers = extractVisibleOffers(input.html);
  const serviceOffers = pageData.offers && pageData.offers.length > 0 ? pageData.offers : offers;

  if (role === 'product') {
    schema = buildProductSchema({ baseUrl: schemaBaseUrl, pageData, businessProfile: businessProfileForPage, offers });
    reason = offers.length > 0
      ? 'Product page — Product with visible price-backed Offer data.'
      : 'Product page — Product without Offer because no visible price/currency was verified.';
    if (offers.length === 0) {
      skippedSchemaTypes.push({
        type: 'Offer',
        reason: 'Product emitted without Offer: price/currency not verified.',
        missingFields: ['price', 'priceCurrency'],
      });
    }
  } else if (role === 'pricing') {
    schema = buildPricingPageSchema({ baseUrl: schemaBaseUrl, pageData, offers });
    reason = offers.length > 0
      ? 'Pricing page — WebPage with visible price-backed Offer nodes.'
      : 'Pricing page — WebPage only because no visible price/currency was verified.';
    if (offers.length === 0) {
      skippedSchemaTypes.push({
        type: 'Offer',
        reason: 'Offer skipped: price/currency not verified.',
        missingFields: ['price', 'priceCurrency'],
      });
    }
  } else if (role === 'author') {
    schema = buildProfilePageSchema({ baseUrl: schemaBaseUrl, pageData });
    reason = 'Author/profile page — ProfilePage with Person mainEntity from visible page data.';
  } else if (role === 'faq') {
    schema = buildWebPageSchema({ baseUrl: schemaBaseUrl, pageData });
    reason = 'FAQ role — WebPage base; FAQPage is emitted only when valid Q&A pairs are visible.';
  } else if (role === 'howto') {
    schema = buildArticleSchema({ baseUrl: schemaBaseUrl, pageData }, 'Article');
    reason = 'How-to role — Article base; HowTo is emitted only when visible step lists are extracted.';
  } else if (role === 'video') {
    schema = buildArticleSchema({ baseUrl: schemaBaseUrl, pageData }, 'Article');
    reason = 'Video role — Article base; VideoObject is emitted only when required video fields are verified.';
  } else if (role === 'job-posting' || role === 'course' || role === 'event') {
    schema = buildWebPageSchema({ baseUrl: schemaBaseUrl, pageData });
    const type = roleToDiagnosticsType(role)!;
    reason = `${type} role — WebPage fallback because required rich-result fields were not fully verified.`;
    skippedSchemaTypes.push({
      type,
      reason: `${type} skipped: required fields were not fully verified from visible or workspace data.`,
    });
  } else if (role === 'review' || role === 'recipe') {
    schema = buildWebPageSchema({ baseUrl: schemaBaseUrl, pageData });
    const type = roleToDiagnosticsType(role)!;
    reason = `${type} role — WebPage fallback because required rich-result fields were not fully verified.`;
    skippedSchemaTypes.push({
      type,
      reason: `${type} skipped: required fields were not fully verified from visible page data.`,
    });
  } else {
    switch (classified.kind) {
    case 'Homepage':
      if (classified.primaryType === 'LocalBusiness') {
        schema = buildLocalBusinessSchema({
          baseUrl: schemaBaseUrl,
          pageData,
          businessProfile: businessProfileForPage,
          siteHasSearch: input.workspace.siteHasSearch,
          industrySubtype,
        });
        reason = 'Local business homepage — LocalBusiness with verified contact info.';
      } else {
        schema = buildHomepageSchema({ baseUrl: schemaBaseUrl, pageData, businessProfile: businessProfileForPage, siteHasSearch: input.workspace.siteHasSearch });
        reason = 'Homepage — Organization + WebSite (sitewide entities).';
        skippedSchemaTypes.push({
          type: 'LocalBusiness',
          reason: 'Homepage LocalBusiness skipped: no verified primary business address.',
          missingFields: ['address'],
        });
      }
      break;
    case 'BlogPosting':
      schema = buildArticleSchema({ baseUrl: schemaBaseUrl, pageData }, 'BlogPosting');
      reason = 'Blog post — BlogPosting with author/publisher/dates.';
      break;
    case 'CaseStudy':
      schema = buildArticleSchema({ baseUrl: schemaBaseUrl, pageData }, 'Article');
      reason = 'Case study — Article (not Service) with about="Case study".';
      break;
    case 'Service':
      schema = buildServiceSchema({ baseUrl: schemaBaseUrl, pageData, businessProfile: businessProfileForPage, offers: serviceOffers });
      reason = 'Service detail page — Service with provider reference.';
      if (serviceOffers.length === 0) {
        skippedSchemaTypes.push({
          type: 'Offer',
          reason: 'Offer skipped: no visible or mapped price/currency was verified.',
          missingFields: ['price', 'priceCurrency'],
        });
      }
      break;
    case 'Location':
        schema = buildLocalBusinessSchema({
          baseUrl: schemaBaseUrl,
          pageData,
          businessProfile: businessProfileForPage,
          siteHasSearch: input.workspace.siteHasSearch,
          industrySubtype,
        });
      reason = 'Location page — LocalBusiness with verified business profile details when available.';
      if (!businessProfileForPage?.address || !Object.values(businessProfileForPage.address).some(Boolean)) {
        skippedSchemaTypes.push({
          type: 'PostalAddress',
          reason: 'Location address skipped: no verified human-readable address fields were resolved.',
          missingFields: ['streetAddress', 'addressLocality', 'addressRegion', 'postalCode'],
        });
      }
      break;
    case 'AboutPage':
      schema = buildAboutPageSchema({ baseUrl: schemaBaseUrl, pageData, businessProfile: businessProfileForPage, semantics: semanticData });
      reason = 'About page — AboutPage with LocalBusiness mainEntity when address is set.';
      break;
    case 'ContactPage':
      schema = buildContactPageSchema({ baseUrl: schemaBaseUrl, pageData, businessProfile: input.workspace.businessProfile, semantics: semanticData });
      reason = 'Contact page — ContactPage with canonical business identity mainEntity.';
      break;
    case 'BlogIndex': {
      const children = resolveHubChildren(input);
      if (children) {
        schema = buildBlogIndexSchema({ baseUrl: schemaBaseUrl, pageData, children });
        reason = 'Blog index — Blog with cross-page child @id references.';
      } else {
        schema = buildCollectionPageSchema({ baseUrl: schemaBaseUrl, pageData });
        reason = 'Blog index — CollectionPage (no child context available).';
      }
      break;
    }
    case 'ServiceIndex': {
      const children = resolveHubChildren(input);
      if (children) {
        schema = buildServiceHubSchema({ baseUrl: schemaBaseUrl, pageData, children });
        reason = 'Service index — Service + OfferCatalog with child @id references.';
      } else {
        schema = buildCollectionPageSchema({ baseUrl: schemaBaseUrl, pageData });
        reason = 'Service index — CollectionPage (no child context available).';
      }
      break;
    }
    case 'CaseStudyIndex': {
      const children = resolveHubChildren(input);
      if (children) {
        schema = buildCollectionPageSchema({ baseUrl: schemaBaseUrl, pageData, children });
        reason = 'Case study index — CollectionPage + ItemList with child @id references.';
      } else {
        schema = buildCollectionPageSchema({ baseUrl: schemaBaseUrl, pageData });
        reason = 'Case study index — CollectionPage (no child context available).';
      }
      break;
    }
    case 'Legal':
    case 'WebPage':
      schema = buildWebPageSchema({ baseUrl: schemaBaseUrl, pageData });
      reason = 'Generic page — WebPage with breadcrumb.';
      break;
    default: {
      // Exhaustiveness check — TS will error here if a new PageKind value is added
      // without a corresponding case above.
      const _exhaustive: never = classified.kind;
      void _exhaustive;
      schema = buildWebPageSchema({ baseUrl: schemaBaseUrl, pageData });
      reason = 'Generic page — WebPage (unreachable fallback).';
      break;
    }
    }
  }

  const canonicalEntities = input.siteContext?.canonicalEntities ?? [];
  const validCanonicalEntityIds = new Set(
    canonicalEntityNodeEntries(canonicalEntities).map(({ entity }) => entity.id),
  );
  const canonicalEntityRefs = (input.canonicalEntityRefs ?? []).filter(ref => validCanonicalEntityIds.has(ref));
  applyCanonicalEntityGraph({
    schema,
    pageCanonicalUrl: pageData.canonicalUrl,
    canonicalEntities,
    entityRefs: canonicalEntityRefs,
  });
  applyTrustedJsonLdEvidence({
    schema,
    pageData,
    semantics: semanticData,
    role,
    canonicalEntityRefs,
  });

  // Validate the base schema BEFORE FAQ enrichment so we can distinguish FAQ-specific
  // errors from pre-existing base errors (e.g. a BlogPosting missing datePublished
  // shouldn't cause us to roll back a perfectly valid FAQPage append).
  const baseValidationFindings = validateLeanSchema(schema, classified.primaryType);

  // Surgical FAQ enrichment: if the page has accordion FAQ structure, append a FAQPage node.
  const requireDedicatedFaq = isCollectionIndexKind(classified.kind);
  const extractedFaqPairs = await extractFaq(input.html || '', { requireDedicatedSection: requireDedicatedFaq });
  const faqPairs = extractedFaqPairs.length >= 2
    ? extractedFaqPairs
    : (semanticData?.existingFaq ?? []);
  if (!hasGraphType(schema, 'FAQPage') && faqPairs.length >= 2) {
    const faqNode = {
      '@type': 'FAQPage',
      '@id': `${pageData.canonicalUrl}#faq`,
      'mainEntity': faqPairs.map(pair => ({
        '@type': 'Question',
        'name': pair.question,
        'acceptedAnswer': { '@type': 'Answer', 'text': pair.answer },
      })),
    };
    ((schema['@graph'] as Array<Record<string, unknown>>)).push(faqNode);
    // Re-validate and roll back ONLY if FAQ append introduced new errors
    // (i.e. errors that weren't in the base set). Pre-existing base errors
    // remain — they're surfaced via validationFindings/validationErrors regardless.
    const postFaqFindings = validateLeanSchema(schema, classified.primaryType);
    // Identity key combines ruleId (class) + type (@type of node) + field (specific field path)
    // because ruleId alone is a class identifier (e.g. `required-field-missing` covers every
    // missing-field error regardless of node/field). Without the composite key, a new FAQ-introduced
    // finding of the same class as a pre-existing one would be incorrectly filtered out, leaving an
    // invalid FAQPage node attached. See PR #372 review (BUG-0001).
    const findingKey = (f: { ruleId: string; type: string; field?: string }) => `${f.ruleId}::${f.type}::${f.field ?? ''}`;
    const baseFindingKeySet = new Set(baseValidationFindings.map(findingKey));
    const faqIntroducedFindings = postFaqFindings.filter(f => !baseFindingKeySet.has(findingKey(f)));
    if (faqIntroducedFindings.length > 0) {
      log.debug({ pageId: input.pageId, errors: faqIntroducedFindings }, 'FAQPage extraction produced invalid schema; skipping');
      (schema['@graph'] as Array<Record<string, unknown>>).pop();
    }
  }
  if (requireDedicatedFaq && faqPairs.length === 0 && hasQuestionLikeContent(input.html || '')) {
    skippedSchemaTypes.push({
      type: 'FAQPage',
      reason: 'FAQPage skipped: question-like index/card content was found, but no dedicated FAQ section was detected.',
      missingFields: ['dedicated FAQ section'],
    });
  }
  if (role === 'faq' && !hasGraphType(schema, 'FAQPage')) {
    skippedSchemaTypes.push({
      type: 'FAQPage',
      reason: 'FAQPage skipped: no valid Q&A pairs found.',
      missingFields: ['mainEntity'],
    });
  }
  if (role === 'howto' && !hasGraphType(schema, 'HowTo')) {
    skippedSchemaTypes.push({
      type: 'HowTo',
      reason: 'HowTo skipped: no visible step list was extracted.',
      missingFields: ['step'],
    });
  }
  if (role === 'video' && !hasGraphType(schema, 'VideoObject')) {
    skippedSchemaTypes.push({
      type: 'VideoObject',
      reason: 'VideoObject skipped: required video fields were not verified.',
      missingFields: ['uploadDate', 'thumbnailUrl'],
    });
  }

  // Surface validation findings of the FINAL schema (after FAQ resolution) to caller
  const validationFindings = validateLeanSchema(schema, classified.primaryType);

  // Fix 3: compute rich results eligibility and pass through to caller
  const richResultsEligibility = checkRichResultsEligibility(schema);
  const publishValidation = validateForGoogleRichResults(schema);

  // Determine declared types for the suggestion `type` field
  const graph = (schema['@graph'] as Array<Record<string, unknown>>) ?? [];
  const declaredTypes = graph.map(n => n['@type']).filter((t): t is string => typeof t === 'string');
  const generationDiagnostics = buildGenerationDiagnostics({
    plannedRole: input.plannedSchemaRole,
    role,
    roleSource,
    emittedTypes: declaredTypes,
    skippedSchemaTypes,
    richResultsEligibility,
    validationFindings,
    validationStatus: publishValidation.status,
    inactivePlanStatus: input.inactivePlanStatus,
    collection: input.collectionIdentity,
    cmsDeliveryStatus: input.cmsDeliveryStatus,
    evidenceSources: pageData.evidenceSources,
    fieldEvidence: pageData.fieldEvidence,
    canonicalEntityReferences: canonicalEntityRefs,
  });

  return {
    pageId: input.pageId,
    pageTitle: pageData.title,
    slug: input.pageMeta.slug,
    url: pageData.canonicalUrl,
    existingSchemas: input.existingSchemas ?? detectExistingSchemas(input.html),
    suggestedSchemas: [
      {
        type: declaredTypes.join(' + '),
        reason,
        priority: 'high',
        template: schema,
      },
    ],
    validationFindings: validationFindings.length > 0 ? validationFindings : undefined,
    // Backwards-compat: undefined ⇔ no errors. Gate on errors.length, not findings.length —
    // otherwise we emit `[]` when only warnings exist (latent today; surfaces the moment
    // recommended-tier fields are populated). See PR #372 review (BUG-0002).
    validationErrors: (() => {
      const errors = validationFindings.filter(f => f.severity === 'error').map(f => f.message);
      return errors.length > 0 ? errors : undefined;
    })(),
    richResultsEligibility: richResultsEligibility.length > 0 ? richResultsEligibility : undefined,
    generationDiagnostics,
  };
}
