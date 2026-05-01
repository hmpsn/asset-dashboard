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
import type { PageMetaInput, WorkspaceSchemaInput } from './data-sources.js';
import { extractDescription } from './extractors/description.js';
import { extractFaq } from './extractors/faq.js';
import { extractPageElements } from './extractors/page-elements.js';
import { createAiBudget } from './extractors/page-elements/ai-budget.js';
import type { AiBudget } from './extractors/page-elements/ai-budget.js';
import { getPageElements, upsertPageElements } from '../page-elements-store.js';
import type { PageElementCatalog } from '../../shared/types/page-elements.js';
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
import type { SchemaIndustrySubtype, SchemaPageRole } from '../../shared/types/schema-plan.js';
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
  inactivePlanStatus?: string;
}

function detectExistingSchemas(html: string): string[] {
  const $ = cheerio.load(html);
  const types: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).html() || '{}') as Record<string, unknown>;
      const t = json['@type'];
      if (typeof t === 'string') types.push(t);
      else if (Array.isArray(t)) types.push(...(t as string[]));
      const graph = json['@graph'] as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(graph)) {
        for (const n of graph) {
          if (typeof n['@type'] === 'string') types.push(n['@type']);
        }
      }
    } catch { /* ignore unparseable */ } // catch-ok: malformed JSON-LD on third-party pages
  });
  return Array.from(new Set(types));
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

function extractVisibleOffers(html: string, fallbackName: string): OfferData[] {
  const $ = cheerio.load(html || '');
  $('script, style, noscript').remove();
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  const matches = text.matchAll(/(?:US\$|\$)\s?(\d{1,5}(?:,\d{3})?(?:\.\d{2})?)/g);
  const offers: OfferData[] = [];
  for (const match of matches) {
    const rawPrice = match[1]?.replace(/,/g, '');
    if (!rawPrice) continue;
    const before = text.slice(Math.max(0, match.index - 80), match.index).trim();
    const name = before.match(/([A-Z][A-Za-z0-9 +&/-]{2,40})$/)?.[1]?.trim();
    offers.push({
      name: name || fallbackName,
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

function buildGenerationDiagnostics(input: {
  role?: SchemaPageRole;
  roleSource: SchemaRoleSource;
  emittedTypes: string[];
  skippedSchemaTypes: SkippedSchemaType[];
  richResultsEligibility: RichResultEligibility[];
  validationFindings: ValidationFinding[];
  validationStatus?: 'valid' | 'warnings' | 'errors';
  inactivePlanStatus?: string;
}): SchemaGenerationDiagnostics {
  const skippedSchemaTypes = [...input.skippedSchemaTypes];
  if (input.inactivePlanStatus && input.roleSource === 'auto-detect') {
    skippedSchemaTypes.unshift({
      type: 'SchemaSitePlan',
      reason: `Plan role ignored: schema site plan is ${input.inactivePlanStatus}, not active.`,
    });
  }
  return {
    plannedRole: input.role,
    effectiveRole: input.role,
    roleSource: input.roleSource,
    emittedTypes: input.emittedTypes,
    skippedSchemaTypes,
    richResultsEligibility: input.richResultsEligibility,
    validationStatus: input.validationStatus ?? validationStatus(input.validationFindings),
  };
}

export async function generateLeanSchema(input: LeanGeneratorInput): Promise<LeanGeneratorOutput> {
  // Fix 1: strip trailing slashes from baseUrl to prevent //path canonical URLs
  const baseUrl = input.baseUrl.replace(/\/+$/, '');

  const businessKind: BusinessKind = input.workspace.businessProfile?.address ? 'local' : 'unknown';
  const classified: ClassifiedPage = input.pageKindOverride
    ? {
        kind: input.pageKindOverride,
        primaryType: pageKindToPrimaryType(input.pageKindOverride, businessKind),
        pagePath: input.pageMeta.publishedPath,
      }
    : classifyPage(`${baseUrl}${input.pageMeta.publishedPath}`, baseUrl, { businessKind });
  const role = input.schemaRoleOverride?.role;
  const roleSource: SchemaRoleSource = input.schemaRoleOverride?.source ?? 'auto-detect';
  const industrySubtype = input.schemaRoleOverride?.industrySubtype ?? input.workspace.industrySubtype;
  const skippedSchemaTypes: SkippedSchemaType[] = [];

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

  // Lazy-refresh element catalog: read from store; if missing or
  // stale-vs-Webflow-lastPublished, extract from current HTML + persist.
  // Per audit §2.4 — HTML is already in scope (input.html). Per spec §3.4 —
  // 100% lazy; no cron, no eager extraction.
  const workspaceId = input.workspace.id;
  const pagePath = input.pageMeta.publishedPath;
  let catalog: PageElementCatalog | undefined;
  if (workspaceId && pagePath) {
    const stored = getPageElements(workspaceId, pagePath);
    if (!stored || isCatalogStale(stored.sourcePublishedAt, input.pageMeta.sourcePublishedAt ?? null)) {
      try {
        const aiBudget = input.aiBudget ?? createAiBudget(0); // PR1: zero AI calls
        catalog = await extractPageElements(input.html ?? '', {
          pageBaseUrl: baseUrl,
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
        pageBaseUrl: baseUrl,
        sourcePublishedAt: input.pageMeta.sourcePublishedAt ?? null,
        aiBudget: input.aiBudget ?? createAiBudget(0),
        workspaceId: workspaceId ?? 'schema-preview',
      });
    } catch (err) { // catch-ok: in-memory enrichment is optional
      log.warn({ err, pageId: input.pageId }, 'page-element extraction failed; planned rich role will fall back conservatively');
    }
  }
  pageData = { ...pageData, elements: catalog };

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
  const offers = extractVisibleOffers(input.html, pageData.cleanTitle || pageData.title);

  if (role === 'product') {
    schema = buildProductSchema({ baseUrl, pageData, businessProfile: input.workspace.businessProfile, offers });
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
    schema = buildPricingPageSchema({ baseUrl, pageData, offers });
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
    schema = buildProfilePageSchema({ baseUrl, pageData });
    reason = 'Author/profile page — ProfilePage with Person mainEntity from visible page data.';
  } else if (role === 'faq') {
    schema = buildWebPageSchema({ baseUrl, pageData });
    reason = 'FAQ role — WebPage base; FAQPage is emitted only when valid Q&A pairs are visible.';
  } else if (role === 'howto') {
    schema = buildArticleSchema({ baseUrl, pageData }, 'Article');
    reason = 'How-to role — Article base; HowTo is emitted only when visible step lists are extracted.';
  } else if (role === 'video') {
    schema = buildArticleSchema({ baseUrl, pageData }, 'Article');
    reason = 'Video role — Article base; VideoObject is emitted only when required video fields are verified.';
  } else if (role === 'job-posting' || role === 'course' || role === 'event') {
    schema = buildWebPageSchema({ baseUrl, pageData });
    const type = roleToDiagnosticsType(role)!;
    reason = `${type} role — WebPage fallback because required rich-result fields were not fully verified.`;
    skippedSchemaTypes.push({
      type,
      reason: `${type} skipped: required fields were not fully verified from visible or workspace data.`,
    });
  } else if (role === 'review' || role === 'recipe') {
    schema = buildWebPageSchema({ baseUrl, pageData });
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
          baseUrl,
          pageData,
          businessProfile: input.workspace.businessProfile,
          siteHasSearch: input.workspace.siteHasSearch,
          industrySubtype,
        });
        reason = 'Local business homepage — LocalBusiness with verified contact info.';
      } else {
        schema = buildHomepageSchema({ baseUrl, pageData, businessProfile: input.workspace.businessProfile, siteHasSearch: input.workspace.siteHasSearch });
        reason = 'Homepage — Organization + WebSite (sitewide entities).';
      }
      break;
    case 'BlogPosting':
      schema = buildArticleSchema({ baseUrl, pageData }, 'BlogPosting');
      reason = 'Blog post — BlogPosting with author/publisher/dates.';
      break;
    case 'CaseStudy':
      schema = buildArticleSchema({ baseUrl, pageData }, 'Article');
      reason = 'Case study — Article (not Service) with about="Case study".';
      break;
    case 'Service':
      schema = buildServiceSchema({ baseUrl, pageData, businessProfile: input.workspace.businessProfile });
      reason = 'Service detail page — Service with provider reference.';
      break;
    case 'Location':
      schema = buildLocalBusinessSchema({
        baseUrl,
        pageData,
        businessProfile: input.workspace.businessProfile,
        siteHasSearch: input.workspace.siteHasSearch,
        industrySubtype,
      });
      reason = 'Location page — LocalBusiness with verified business profile details when available.';
      break;
    case 'AboutPage':
      schema = buildAboutPageSchema({ baseUrl, pageData, businessProfile: input.workspace.businessProfile });
      reason = 'About page — AboutPage with LocalBusiness mainEntity when address is set.';
      break;
    case 'ContactPage':
      schema = buildContactPageSchema({ baseUrl, pageData, businessProfile: input.workspace.businessProfile });
      reason = 'Contact page — ContactPage with LocalBusiness mainEntity when address is set.';
      break;
    case 'BlogIndex': {
      const children = resolveHubChildren(input);
      if (children) {
        schema = buildBlogIndexSchema({ baseUrl, pageData, children });
        reason = 'Blog index — Blog with cross-page child @id references.';
      } else {
        schema = buildCollectionPageSchema({ baseUrl, pageData });
        reason = 'Blog index — CollectionPage (no child context available).';
      }
      break;
    }
    case 'ServiceIndex': {
      const children = resolveHubChildren(input);
      if (children) {
        schema = buildServiceHubSchema({ baseUrl, pageData, children });
        reason = 'Service index — Service + OfferCatalog with child @id references.';
      } else {
        schema = buildCollectionPageSchema({ baseUrl, pageData });
        reason = 'Service index — CollectionPage (no child context available).';
      }
      break;
    }
    case 'CaseStudyIndex': {
      const children = resolveHubChildren(input);
      if (children) {
        schema = buildCollectionPageSchema({ baseUrl, pageData, children });
        reason = 'Case study index — CollectionPage + ItemList with child @id references.';
      } else {
        schema = buildCollectionPageSchema({ baseUrl, pageData });
        reason = 'Case study index — CollectionPage (no child context available).';
      }
      break;
    }
    case 'Legal':
    case 'WebPage':
      schema = buildWebPageSchema({ baseUrl, pageData });
      reason = 'Generic page — WebPage with breadcrumb.';
      break;
    default: {
      // Exhaustiveness check — TS will error here if a new PageKind value is added
      // without a corresponding case above.
      const _exhaustive: never = classified.kind;
      void _exhaustive;
      schema = buildWebPageSchema({ baseUrl, pageData });
      reason = 'Generic page — WebPage (unreachable fallback).';
      break;
    }
    }
  }

  // Validate the base schema BEFORE FAQ enrichment so we can distinguish FAQ-specific
  // errors from pre-existing base errors (e.g. a BlogPosting missing datePublished
  // shouldn't cause us to roll back a perfectly valid FAQPage append).
  const baseValidationFindings = validateLeanSchema(schema, classified.primaryType);

  // Surgical FAQ enrichment: if the page has accordion FAQ structure, append a FAQPage node.
  const faqPairs = await extractFaq(input.html || '');
  if (faqPairs.length >= 2) {
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
    role,
    roleSource,
    emittedTypes: declaredTypes,
    skippedSchemaTypes,
    richResultsEligibility,
    validationFindings,
    validationStatus: publishValidation.status,
    inactivePlanStatus: input.inactivePlanStatus,
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
