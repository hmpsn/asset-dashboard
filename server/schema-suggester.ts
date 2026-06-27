import { discoverSitemapUrls, resolveStaticPagePathsFromSitemap } from './webflow.js';
import { getWorkspacePages } from './workspace-data.js';
import { getWorkspaceBySiteId } from './workspaces.js';
import { generateLeanSchema } from './schema/index.js';
import type { ContentBrief } from '../shared/types/content.ts';
import { fetchPageMeta } from './seo-audit.js';
import { fetchPublishedHtml } from './published-html.js';
import { resolvePagePath } from './utils/page-address.js';
import { resolveBaseUrl } from './url-helpers.js';
import { dedupeBy } from './utils/collections.js';
import { createAiBudget } from './schema/extractors/page-elements/ai-budget.js';
import type { AiBudget } from './schema/extractors/page-elements/ai-budget.js';
import { buildSchemaIntelligence } from './schema-intelligence.js';
import { assembleSiteContext } from './schema/site-context.js';
import type { SiteContext } from './schema/site-context.js';
import {
  PAGE_TYPE_LABELS,
  PAGE_TYPE_SCHEMA_MAP,
  SCHEMA_ROLE_TO_PAGE_KIND,
  type SchemaPageType,
} from './schema/role-type-registry.js';
import { getPageTypes, getSchemaPlan } from './schema-store.js';
import type { PageKind } from './schema/classifier.js';
import type { SchemaPageRole } from '../shared/types/schema-plan.js';
import type { SchemaGenerationDiagnostics, SchemaSourcePageMeta } from '../shared/types/schema-generation.js';
import { isUtilitySchemaPath } from './schema/site-inventory.js';
import type { SchemaCmsDeliveryStatus, SchemaCollectionIdentity, SiteInventoryCmsItem, SiteInventorySlice } from '../shared/types/site-inventory.js';
import type { WebflowPage } from './webflow-pages.js';
import { ENTITY_SURFACES } from '../shared/types/entity-resolution.js';
import type { EntityResolutionSlice, ResolvedEntity } from '../shared/types/entity-resolution.js';
import type { EeatAsset } from '../shared/types/eeat-assets.js';

/**
 * AI budget allocation for the page-element AI extractors.
 * 100 image classifications + 20 HowTo disambiguations = 120 total per regenerate-all.
 */
function allocateElementAiBudget(): AiBudget {
  return createAiBudget(120);
}

// Re-export from the standalone rich-results module so existing external callers
// (e.g. frontend SchemaPageCard.tsx, route handlers) keep working. The actual
// implementation lives in server/schema/rich-results.ts to break a circular
// import between schema-suggester.ts and the schema/ package.
export { checkRichResultsEligibility } from './schema/rich-results.js';
export type { RichResultEligibility } from './schema/rich-results.js';
import type { RichResultEligibility } from './schema/rich-results.js';
import type { ValidationFinding } from '../shared/types/schema-validation.js';

export interface SchemaPageSuggestion {
  pageId: string;
  pageTitle: string;
  slug: string;
  publishedPath?: string | null;
  url: string;
  existingSchemas: string[];
  existingSchemaJson?: Record<string, unknown>[];
  suggestedSchemas: SchemaSuggestion[];
  validationErrors?: string[];
  validationFindings?: ValidationFinding[];
  richResultsEligibility?: RichResultEligibility[];
  generationDiagnostics?: SchemaGenerationDiagnostics;
  collectionIdentity?: SchemaCollectionIdentity;
  cmsDeliveryStatus?: SchemaCmsDeliveryStatus;
  savedPageType?: string;  // Persisted page type from DB
}

export interface SchemaSuggestion {
  type: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  template: Record<string, unknown>;
}

export { PAGE_TYPE_LABELS, PAGE_TYPE_SCHEMA_MAP, SCHEMA_ROLE_TO_PAGE_KIND };
export type { SchemaPageType };

const WEAK_CMS_PLAN_ROLES = new Set<SchemaPageRole>([
  'generic',
  'lead-gen',
  'audience',
  'pillar',
  'partnership',
  'comparison',
]);

export function isWeakCmsPlanRole(role: SchemaPageRole): boolean {
  return WEAK_CMS_PLAN_ROLES.has(role);
}

export function shouldCollectionRoleOverridePlan(opts: {
  isCmsItem?: boolean;
  planRole?: SchemaPageRole;
  collectionRole?: SchemaPageRole;
  collectionRoleSource?: 'mapped' | 'inferred' | 'none';
}): boolean {
  return !!(
    opts.isCmsItem
    && opts.planRole
    && isWeakCmsPlanRole(opts.planRole)
    && opts.collectionRole
    && opts.collectionRoleSource
    && opts.collectionRoleSource !== 'none'
  );
}

function isBlogIndexPath(pagePath: string): boolean {
  const normalized = pagePath === '/' ? '/' : pagePath.toLowerCase().replace(/\/$/, '');
  return ['/blog', '/blogs', '/news', '/insights', '/resources'].includes(normalized);
}

export function pageKindForRole(role: SchemaPageRole, pagePath: string): PageKind | undefined {
  if (role === 'blog' && isBlogIndexPath(pagePath)) return undefined;
  return SCHEMA_ROLE_TO_PAGE_KIND[role];
}

function pathMatchesRolePath(rolePath: string, pagePath: string): boolean {
  const normalizedPage = pagePath === '/' ? '/' : pagePath.replace(/\/$/, '');
  const normalizedRole = rolePath === '/' ? '/' : rolePath.replace(/\/$/, '');
  return normalizedRole === normalizedPage;
}

function findPlanRole(plan: ReturnType<typeof getSchemaPlan>, pagePath: string) {
  return plan?.pageRoles.find(pr => pathMatchesRolePath(pr.pagePath, pagePath));
}

async function readSchemaPageIntelligence(
  siteId: string,
  baseUrl: string,
  pagePath: string,
  tokenOverride?: string,
  /**
   * When true, the entityResolution slice performs blocking Wikidata fetches
   * (up to 8 × 2.5s timeout each) to resolve entity references. Default false
   * to keep foreground schema generation fast — the bulk background path
   * (generateSchemaSuggestions) opts in so a single warm pass populates the
   * shared 30-day cache for later foreground calls.
   */
  resolveEntities: boolean = false,
) {
  try {
    return await buildSchemaIntelligence({
      siteId,
      siteBaseUrl: baseUrl,
      pagePath,
      tokenOverride,
      includePageElements: true,
      includeEntityResolution: resolveEntities,
    });
  } catch { // catch-ok: schema generation can proceed without optional page intelligence
    return undefined;
  }
}

function entityResolutionForPage(
  slice: EntityResolutionSlice | undefined,
  pagePath: string,
): {
  knowsAbout?: ResolvedEntity[];
  articleAbout?: ResolvedEntity;
  articleMentions?: ResolvedEntity[];
  areaServed?: ResolvedEntity;
} {
  // Allow-list pattern: only 'ready' and 'degraded' surface usable entities.
  // 'disabled', 'no_data', 'not_requested' all return empty.
  if (!slice || (slice.availability !== 'ready' && slice.availability !== 'degraded')) {
    return {};
  }

  const relevant = slice.entities;
  const knowsAbout = dedupeBy(relevant.filter(entity =>
    entity.surfaces.includes(ENTITY_SURFACES.organizationKnowsAbout)
      && entity.type === 'Thing',
  ), entity => entity.id);
  const pageScoped = (entity: ResolvedEntity) => !entity.pagePath || entity.pagePath === pagePath;
  const articleAbout = relevant.find(entity =>
    pageScoped(entity)
      && entity.type === 'Thing'
      && entity.surfaces.includes(ENTITY_SURFACES.articleAbout),
  );
  const articleMentions = dedupeBy(relevant.filter(entity =>
    pageScoped(entity)
      && entity.type === 'Thing'
      && entity.surfaces.includes(ENTITY_SURFACES.articleMentions),
  ), entity => entity.id);
  const areaServed = relevant.find(entity =>
    entity.type === 'Place'
      && entity.surfaces.includes(ENTITY_SURFACES.areaServed),
  );

  return {
    knowsAbout: knowsAbout.length > 0 ? knowsAbout : undefined,
    articleAbout,
    articleMentions: articleMentions.length > 0 ? articleMentions : undefined,
    areaServed,
  };
}

function resolveRoleOverride(opts: {
  siteId: string;
  pagePath: string;
  ctxPageType?: SchemaPageType;
  persistedPageType?: SchemaPageType;
  collectionRole?: SchemaPageRole;
  collectionRoleSource?: 'mapped' | 'inferred' | 'none';
  isCmsItem?: boolean;
}) {
  const latestPlan = getSchemaPlan(opts.siteId);
  const activePlan = latestPlan?.status === 'active' ? latestPlan : null;
  const planRole = findPlanRole(activePlan, opts.pagePath);
  const hasCollectionRole = !!(opts.collectionRole && opts.collectionRoleSource && opts.collectionRoleSource !== 'none');
  const shouldCollectionBeatPlan = shouldCollectionRoleOverridePlan({
    isCmsItem: opts.isCmsItem,
    planRole: planRole?.role,
    collectionRole: opts.collectionRole,
    collectionRoleSource: hasCollectionRole ? opts.collectionRoleSource : 'none',
  });
  if (opts.ctxPageType && opts.ctxPageType !== 'auto') {
    const role = opts.ctxPageType as SchemaPageRole;
    return {
      pageKindOverride: pageKindForRole(role, opts.pagePath),
      schemaRoleOverride: { role, source: 'ui' as const, industrySubtype: planRole?.industrySubtype },
      canonicalEntityRefs: planRole?.entityRefs ?? [],
      plannedRole: planRole?.role ?? role,
      inactivePlanStatus: activePlan ? undefined : latestPlan?.status,
      activePlan,
    };
  }
  if (planRole && !shouldCollectionBeatPlan) {
    return {
      pageKindOverride: pageKindForRole(planRole.role, opts.pagePath),
      schemaRoleOverride: {
        role: planRole.role,
        source: 'site-plan' as const,
        industrySubtype: planRole.industrySubtype,
      },
      canonicalEntityRefs: planRole.entityRefs,
      plannedRole: planRole.role,
      inactivePlanStatus: undefined,
      activePlan,
    };
  }
  if (opts.collectionRole && opts.collectionRoleSource === 'mapped') {
    return {
      pageKindOverride: pageKindForRole(opts.collectionRole, opts.pagePath),
      schemaRoleOverride: {
        role: opts.collectionRole,
        source: 'collection-map' as const,
      },
      canonicalEntityRefs: planRole?.entityRefs ?? [],
      plannedRole: planRole?.role ?? opts.collectionRole,
      roleDecisionDiagnostics: shouldCollectionBeatPlan && planRole ? [{
        type: 'SchemaSitePlan',
        reason: `Site plan role ${planRole.role} ignored: ${opts.collectionRole} collection role has higher confidence.`,
      }] : undefined,
      inactivePlanStatus: latestPlan && latestPlan.status !== 'active' ? latestPlan.status : undefined,
      activePlan,
    };
  }
  if (opts.collectionRole && opts.collectionRoleSource === 'inferred') {
    return {
      pageKindOverride: pageKindForRole(opts.collectionRole, opts.pagePath),
      schemaRoleOverride: {
        role: opts.collectionRole,
        source: 'collection-inferred' as const,
      },
      canonicalEntityRefs: planRole?.entityRefs ?? [],
      plannedRole: planRole?.role ?? opts.collectionRole,
      roleDecisionDiagnostics: shouldCollectionBeatPlan && planRole ? [{
        type: 'SchemaSitePlan',
        reason: `Site plan role ${planRole.role} ignored: ${opts.collectionRole} collection role has higher confidence.`,
      }] : undefined,
      inactivePlanStatus: latestPlan && latestPlan.status !== 'active' ? latestPlan.status : undefined,
      activePlan,
    };
  }
  if (opts.persistedPageType && opts.persistedPageType !== 'auto') {
    const role = opts.persistedPageType as SchemaPageRole;
    return {
      pageKindOverride: pageKindForRole(role, opts.pagePath),
      schemaRoleOverride: { role, source: 'saved-page-type' as const, industrySubtype: planRole?.industrySubtype },
      canonicalEntityRefs: planRole?.entityRefs ?? [],
      plannedRole: planRole?.role ?? role,
      inactivePlanStatus: latestPlan && latestPlan.status !== 'active' ? latestPlan.status : undefined,
      activePlan,
    };
  }
  return {
    pageKindOverride: undefined,
    schemaRoleOverride: undefined,
    canonicalEntityRefs: planRole?.entityRefs ?? [],
    plannedRole: planRole?.role,
    inactivePlanStatus: latestPlan && latestPlan.status !== 'active' ? latestPlan.status : undefined,
    activePlan,
  };
}

// (RICH_RESULTS_ELIGIBLE + checkRichResultsEligibility moved to ./schema/rich-results.ts
//  to break circular import. Re-exports near the top of this file preserve the public API.)

// Context from the workspace/strategy for richer schema generation
export interface SchemaContext {
  companyName?: string;
  liveDomain?: string;
  logoUrl?: string;
  pageKeywords?: { primary: string; secondary: string[] };
  siteKeywords?: string[];
  workspaceId?: string;
  pageType?: SchemaPageType;
  _siteId?: string;  // Internal: passed through for site template storage
  _architectureTree?: import('./site-architecture.js').SiteNode;    // Full site tree for breadcrumb + nav generation
  _gscPageData?: { clicks: number; impressions: number; position: number; ctr: number };  // Internal: GSC per-page metrics
  _ga4PageData?: { pageviews: number; users: number; avgEngagementTime: number };  // Internal: GA4 per-page metrics
  _businessProfile?: {  // Internal: verified business data — bypasses page-content verification checks
    phone?: string;
    email?: string;
    address?: { street?: string; city?: string; state?: string; zip?: string; country?: string };
    socialProfiles?: string[];
    openingHours?: string;
    foundedDate?: string;
    numberOfEmployees?: string;
  };
  /** Default site-wide BCP-47 locale from Webflow site.locales.primary.tag. Defaults to 'en' when unset. */
  _defaultLocale?: string;
  /** When true, WebSite.potentialAction (sitelinks SearchAction) is emitted.
   *  Source: Workspace.siteHasSearch DB column. PR1 always reads as undefined
   *  (DB column defaults to 0 / false); PR2 ships the admin toggle UI. */
  _siteHasSearch?: boolean;
  /** Validation errors from the prior schema generation for this page — used to avoid repeating known mistakes. */
  _existingErrors?: Array<{ message: string }>;
  _eeatAssets?: EeatAsset[];
}

// ── E-E-A-T extraction from content briefs ─────────────────────────
interface EeatData {
  authorName?: string;
  authorTitle?: string;
  expertiseTopics?: string[];
}

/**
 * Extract author/expertise data from a content brief's eeatGuidance field.
 * Returns null if the brief has no usable E-E-A-T data.
 */
export function extractEeatFromBrief(brief: ContentBrief): EeatData | null {
  const g = brief.eeatGuidance;
  if (!g) return null;

  const result: EeatData = {};

  // Try to extract an author name from the expertise or experience fields
  // Common patterns: "Written by Dr. Jane Smith", "Author: John Doe, MD", "Expert: ..."
  const namePatterns = [
    /(?:written by|author[:\s]+|by\s+)([A-Z][a-z]+(?: [A-Z][a-z'.]+){1,3})/i,
    /(?:expert[:\s]+|reviewed by[:\s]+)([A-Z][a-z]+(?: [A-Z][a-z'.]+){1,3})/i,
  ];

  const allText = [g.expertise, g.experience, g.authority, g.trust].filter(Boolean).join(' ');
  for (const pattern of namePatterns) {
    const match = allText.match(pattern);
    if (match) {
      result.authorName = match[1].trim();
      break;
    }
  }

  // Extract author title/credentials from expertise field
  const titlePatterns = [
    /(?:credentials?|title|role)[:\s]+([^.]+)/i,
    /\b((?:Dr|MD|PhD|CPA|RN|DDS|DMD|DO|JD|Esq)\b[^.]*)/i,
    /\b((?:certified|licensed|board-certified)[^.]+)/i,
  ];
  for (const pattern of titlePatterns) {
    const match = (g.expertise || '').match(pattern);
    if (match) {
      result.authorTitle = match[1].trim();
      break;
    }
  }

  // Extract expertise topics from the expertise field
  if (g.expertise) {
    // Look for comma-separated or "and"-separated topic lists
    const topicMatch = g.expertise.match(/(?:expertise in|specializ(?:es?|ing) in|expert in|covers?|topics?[:\s]+)([^.]+)/i);
    if (topicMatch) {
      result.expertiseTopics = topicMatch[1]
        .split(/,\s*|\s+and\s+/)
        .map(t => t.trim())
        .filter(t => t.length > 1 && t.length < 60);
    }
  }

  // Return null if nothing useful was extracted
  if (!result.authorName && !result.authorTitle && !result.expertiseTopics?.length) {
    return null;
  }

  return result;
}
/** Maps the lean generator's output shape to the public SchemaPageSuggestion. */
function leanToSuggestion(lean: import('./schema/index.js').LeanGeneratorOutput): SchemaPageSuggestion {
  return {
    pageId: lean.pageId,
    pageTitle: lean.pageTitle,
    slug: lean.slug,
    publishedPath: lean.publishedPath,
    url: lean.url,
    existingSchemas: lean.existingSchemas,
    suggestedSchemas: lean.suggestedSchemas,
    validationErrors: lean.validationErrors,
    validationFindings: lean.validationFindings,
    richResultsEligibility: lean.richResultsEligibility,
    generationDiagnostics: lean.generationDiagnostics,
    collectionIdentity: lean.generationDiagnostics?.collection,
    cmsDeliveryStatus: lean.generationDiagnostics?.cmsDeliveryStatus,
  };
}

function collectionIdentity(item: SiteInventoryCmsItem): SchemaCollectionIdentity {
  return {
    collectionId: item.collectionId,
    collectionName: item.collectionName,
    collectionSlug: item.collectionSlug,
    itemId: item.itemId,
    itemPath: item.path,
  };
}

function cmsDeliveryStatus(item: SiteInventoryCmsItem): SchemaCmsDeliveryStatus {
  if (!item.collectionId || !item.itemId) {
    return {
      mode: 'cms-field',
      status: 'blocked',
      message: 'CMS publish blocked: collection item identity was not resolved.',
    };
  }
  if (!item.schemaFieldSlug) {
    return {
      mode: 'cms-field',
      status: 'blocked',
      message: `CMS publish blocked: no mapped schema field for collection ${item.collectionName || item.collectionId}.`,
    };
  }
  if (!item.schemaFieldAvailable) {
    return {
      mode: 'cms-field',
      status: 'blocked',
      fieldSlug: item.schemaFieldSlug,
      message: `CMS publish blocked: mapped field ${item.schemaFieldSlug} was not found on ${item.collectionName || item.collectionId}.`,
    };
  }
  return {
    mode: 'cms-field',
    status: 'ready',
    fieldSlug: item.schemaFieldSlug,
    message: `CMS field ready: ${item.schemaFieldSlug}.`,
  };
}

function shouldSkipBulkPage(path: string, activePlanRole?: SchemaPageRole): boolean {
  const exclusion = isUtilitySchemaPath(path);
  return exclusion.isUtility && (!activePlanRole || WEAK_CMS_PLAN_ROLES.has(activePlanRole));
}

function utilitySkipMessage(skippedUtilities: Map<string, number>): string {
  const total = Array.from(skippedUtilities.values()).reduce((sum, count) => sum + count, 0);
  if (total === 0) return '';
  const reasons = Array.from(skippedUtilities.entries())
    .map(([reason, count]) => `${count} ${reason}`)
    .join(', ');
  return ` · skipped ${total} utility page${total === 1 ? '' : 's'} (${reasons})`;
}

function recordSkippedUtility(skippedUtilities: Map<string, number>, path: string): void {
  const reason = isUtilitySchemaPath(path).reason ?? 'utility page';
  skippedUtilities.set(reason, (skippedUtilities.get(reason) ?? 0) + 1);
}

function cmsItemToSiteContextPage(item: SiteInventoryCmsItem): WebflowPage {
  const slug = item.path.replace(/^\/|\/$/g, '').split('/').pop() || item.path.replace(/^\//, '');
  return {
    id: item.pageId,
    title: item.title,
    slug,
    publishedPath: item.path,
    lastPublished: item.lastPublished,
  };
}

function optionalTimestamp(value: unknown): string | null | undefined {
  if (typeof value === 'string') return value;
  return value === null ? null : undefined;
}

function sourcePageMetaFromWebflowPage(page: WebflowPage): SchemaSourcePageMeta {
  return {
    id: page.id,
    title: page.title || '',
    slug: page.slug || resolvePagePath(page).replace(/^\//, ''),
    publishedPath: page.publishedPath,
    seo: page.seo,
    openGraph: page.openGraph,
    lastPublished: optionalTimestamp(page.lastPublished),
    createdOn: optionalTimestamp(page.createdOn),
  };
}

export function buildSiteContextPages(
  staticPages: WebflowPage[],
  cmsItems: SiteInventoryCmsItem[] = [],
  activePlan: ReturnType<typeof getSchemaPlan> | null = null,
): WebflowPage[] {
  const byPath = new Map<string, WebflowPage>();
  for (const page of staticPages) {
    byPath.set(resolvePagePath(page).replace(/\/$/, '').toLowerCase() || '/', page);
  }
  for (const item of cmsItems) {
    if (shouldSkipBulkPage(item.path, findPlanRole(activePlan, item.path)?.role)) continue;
    const key = item.path.replace(/\/$/, '').toLowerCase() || '/';
    if (!byPath.has(key)) byPath.set(key, cmsItemToSiteContextPage(item));
  }
  return Array.from(byPath.values());
}

export async function generateSchemaForPage(
  siteId: string,
  pageId: string,
  tokenOverride?: string,
  ctx: SchemaContext = {},
): Promise<SchemaPageSuggestion | null> {
  const baseUrl = await resolveBaseUrl({ liveDomain: ctx.liveDomain, webflowSiteId: siteId }, tokenOverride);
  if (!baseUrl) return null;

  const wsId = ctx.workspaceId || getWorkspaceBySiteId(siteId)?.id;
  const rawPages = wsId ? await getWorkspacePages(wsId, siteId) : [];
  const sitemapUrls = rawPages.length > 0 ? await discoverSitemapUrls(baseUrl) : [];
  const allPages = resolveStaticPagePathsFromSitemap(rawPages, sitemapUrls, baseUrl);
  let siteInventory: SiteInventorySlice | undefined = wsId
    ? (await buildSchemaIntelligence({
      siteId,
      siteBaseUrl: baseUrl,
      tokenOverride,
      includeSiteInventory: true,
    })).siteInventory
    : undefined;

  const cmsItem = siteInventory?.cmsItems.find(item => item.pageId === pageId);
  if (cmsItem) {
    const latestPlan = getSchemaPlan(siteId);
    const activePlan = latestPlan?.status === 'active' ? latestPlan : null;
    const contextPages = buildSiteContextPages(allPages, siteInventory?.cmsItems, activePlan);
    const siteContextForCms = contextPages.length > 0
      ? assembleSiteContext(contextPages, baseUrl, activePlan?.canonicalEntities ?? [])
      : undefined;
    const itemHtml = await fetchPublishedHtml(cmsItem.url);
    const roleOverride = resolveRoleOverride({
      siteId,
      pagePath: cmsItem.path,
      ctxPageType: ctx.pageType,
      persistedPageType: getPageTypes(siteId)[cmsItem.pageId] as SchemaPageType | undefined,
      collectionRole: cmsItem.effectiveRole,
      collectionRoleSource: cmsItem.roleSource,
      isCmsItem: true,
    });
    const pageIntel = wsId
      ? await readSchemaPageIntelligence(siteId, baseUrl, cmsItem.path, tokenOverride)
      : undefined;
    const entities = entityResolutionForPage(pageIntel?.entityResolution, cmsItem.path);
    const aiBudget = allocateElementAiBudget();
    const lean = await generateLeanSchema({
      pageId: cmsItem.pageId,
      pageMeta: {
        title: cmsItem.title,
        slug: cmsItem.path.replace(/^\//, ''),
        publishedPath: cmsItem.path,
        seo: undefined,
        lastPublished: cmsItem.lastPublished,
        createdOn: cmsItem.createdOn,
        cmsFieldData: cmsItem.fieldData,
        cmsFieldTargets: cmsItem.fieldTargets,
        fieldEvidence: cmsItem.fieldEvidence,
        serviceProfile: cmsItem.itemServiceProfile,
        pageKeywords: pageIntel?.pageKeywords,
        elements: pageIntel?.pageElements,
        sourcePublishedAt: cmsItem.lastPublished ?? null,
        entityResolution: {
          articleAbout: entities.articleAbout,
          articleMentions: entities.articleMentions,
          areaServed: entities.areaServed,
        },
      },
      html: itemHtml || '',
      baseUrl,
      workspace: {
        id: wsId,
        name: ctx.companyName || '',
        publisherLogoUrl: ctx.logoUrl ?? null,
        businessProfile: cmsItem.itemBusinessProfile ?? ctx._businessProfile ?? null,
        defaultLocale: ctx._defaultLocale ?? 'en',
        siteKeywordsForKnowsAbout: ctx.siteKeywords,
        siteHasSearch: ctx._siteHasSearch ?? false,
        eeatAssets: ctx._eeatAssets,
        entityResolution: { knowsAbout: entities.knowsAbout },
        industrySubtype: roleOverride.schemaRoleOverride?.industrySubtype,
      },
      aiBudget,
      siteContext: siteContextForCms,
      pageKindOverride: roleOverride.pageKindOverride,
      schemaRoleOverride: roleOverride.schemaRoleOverride,
      canonicalEntityRefs: roleOverride.canonicalEntityRefs,
      plannedSchemaRole: roleOverride.plannedRole,
      roleDecisionDiagnostics: roleOverride.roleDecisionDiagnostics,
      inactivePlanStatus: roleOverride.inactivePlanStatus,
      collectionIdentity: collectionIdentity(cmsItem),
      cmsDeliveryStatus: cmsDeliveryStatus(cmsItem),
    });
    return {
      ...leanToSuggestion(lean),
      savedPageType: getPageTypes(siteId)[cmsItem.pageId],
    };
  }

  const matchedPage = allPages.find(p => p.id === pageId);
  const meta = matchedPage ? sourcePageMetaFromWebflowPage(matchedPage) : await fetchPageMeta(pageId, tokenOverride);
  if (!meta) return null;

  const slug = meta.slug || '';
  const isHomepage = !slug || slug === 'index' || slug === 'home';

  // Fix 6: look up full publishedPath from getWorkspacePages — fetchPageMeta only
  // returns the leaf slug, which loses parent folder for nested pages (e.g. the page
  // published at /services/web-design would produce /web-design from slug alone).
  // Fall back to derived path if page list fails or page is not found.
  let publishedPath = isHomepage ? '/' : resolvePagePath({ slug });
  let siteContextForPage: SiteContext | undefined;
  try {
    if (wsId) {
      if (matchedPage?.publishedPath) {
        publishedPath = matchedPage.publishedPath;
      }
      const latestPlan = getSchemaPlan(siteId);
      const activePlan = latestPlan?.status === 'active' ? latestPlan : null;
      const contextPages = buildSiteContextPages(allPages, siteInventory?.cmsItems, activePlan);
      siteContextForPage = assembleSiteContext(
        contextPages,
        baseUrl,
        activePlan?.canonicalEntities ?? [],
      );
    }
  } catch { /* page list failure — fall back to derived path */ } // catch-ok

  const url = publishedPath === '/' ? baseUrl : `${baseUrl}${publishedPath}`;
  const html = await fetchPublishedHtml(url);
  const roleOverride = resolveRoleOverride({
    siteId,
    pagePath: publishedPath,
    ctxPageType: ctx.pageType,
    persistedPageType: getPageTypes(siteId)[pageId] as SchemaPageType | undefined,
  });

  // Per-page slice fetch for pageKeywords (Audit Correction 4: pageKeywords is a PageKeywordMap
  // populated only when buildWorkspaceIntelligence is called with opts.pagePath).
  // 5-min LRU + single-flight dedup makes this cheap — no local cache needed.
  const pageIntel = ctx.workspaceId
    ? await readSchemaPageIntelligence(siteId, baseUrl, publishedPath, tokenOverride)
    : undefined;
  const entities = entityResolutionForPage(pageIntel?.entityResolution, publishedPath);

  const aiBudget = allocateElementAiBudget();
  const lean = await generateLeanSchema({
    pageId,
    pageMeta: {
      title: meta.title || '',
      slug,
      publishedPath,
      seo: meta.seo,
      lastPublished: meta.lastPublished,
      createdOn: meta.createdOn,
      pageKeywords: pageIntel?.pageKeywords,
      elements: pageIntel?.pageElements,
      // Static pages can carry a Webflow `lastPublished` timestamp too — pass
      // it through so isCatalogStale can drive lazy refresh on republish.
      // Falls back to null when the Webflow response omits the field.
      sourcePublishedAt: meta.lastPublished ?? null,
      entityResolution: {
        articleAbout: entities.articleAbout,
        articleMentions: entities.articleMentions,
        areaServed: entities.areaServed,
      },
    },
    html: html || '',
    baseUrl,
    workspace: {
      id: wsId,
      name: ctx.companyName || '',
      publisherLogoUrl: ctx.logoUrl ?? null,
      businessProfile: ctx._businessProfile ?? null,
      defaultLocale: ctx._defaultLocale ?? 'en',
      siteKeywordsForKnowsAbout: ctx.siteKeywords, // NEW
      siteHasSearch: ctx._siteHasSearch ?? false, // NEW
      eeatAssets: ctx._eeatAssets,
      entityResolution: { knowsAbout: entities.knowsAbout },
      industrySubtype: roleOverride.schemaRoleOverride?.industrySubtype,
    },
    aiBudget, // PR2: thread per-call budget so AI extractors can run within cap
    siteContext: siteContextForPage, // cross-page hub enrichment
    pageKindOverride: roleOverride.pageKindOverride,
    schemaRoleOverride: roleOverride.schemaRoleOverride,
    canonicalEntityRefs: roleOverride.canonicalEntityRefs,
    plannedSchemaRole: roleOverride.plannedRole,
    roleDecisionDiagnostics: roleOverride.roleDecisionDiagnostics,
    inactivePlanStatus: roleOverride.inactivePlanStatus,
  });

  return {
    ...leanToSuggestion(lean),
    savedPageType: getPageTypes(siteId)[pageId],
  };
}

export async function generateSchemaSuggestions(
  siteId: string,
  tokenOverride?: string,
  ctx: SchemaContext = {},
  onProgress?: (partial: SchemaPageSuggestion[], done: boolean, message: string) => void,
  isCancelled?: () => boolean,
): Promise<SchemaPageSuggestion[]> {
  const baseUrl = await resolveBaseUrl({ liveDomain: ctx.liveDomain, webflowSiteId: siteId }, tokenOverride);
  if (!baseUrl) return [];

  const wsId = ctx.workspaceId || getWorkspaceBySiteId(siteId)?.id;
  const rawPages = wsId ? await getWorkspacePages(wsId, siteId) : [];
  const sitemapUrls = rawPages.length > 0 ? await discoverSitemapUrls(baseUrl) : [];
  const pages = resolveStaticPagePathsFromSitemap(rawPages, sitemapUrls, baseUrl);
  const latestPlan = getSchemaPlan(siteId);
  const activePlan = latestPlan?.status === 'active' ? latestPlan : null;
  const siteInventory = wsId
    ? (await buildSchemaIntelligence({
        siteId,
        tokenOverride,
        siteBaseUrl: baseUrl,
        includeSiteInventory: true,
      })).siteInventory
    : undefined;
  const savedPageTypes = getPageTypes(siteId);

  const contextPages = buildSiteContextPages(pages, siteInventory?.cmsItems, activePlan);
  let siteContext: SiteContext | undefined = contextPages.length > 0
    ? assembleSiteContext(contextPages, baseUrl, activePlan?.canonicalEntities ?? [])
    : undefined;

  // ONE shared budget for the entire regenerate-all run (static + CMS loops).
  // This enforces the per-run cap (100 image classifications + 20 HowTo calls)
  // across all pages rather than resetting on each page.
  const aiBudget = allocateElementAiBudget();

  const results: SchemaPageSuggestion[] = [];
  const skippedUtilities = new Map<string, number>();

  for (const page of pages) {
    if (isCancelled?.()) break;
    const slug = page.slug || '';
    const publishedPath = resolvePagePath(page);
    if (shouldSkipBulkPage(publishedPath, findPlanRole(activePlan, publishedPath)?.role)) {
      recordSkippedUtility(skippedUtilities, publishedPath);
      continue;
    }
    const url = publishedPath === '/' ? baseUrl : `${baseUrl}${publishedPath}`;
    const html = await fetchPublishedHtml(url);
    const pageMeta = sourcePageMetaFromWebflowPage(page);
    const roleOverride = resolveRoleOverride({
      siteId,
      pagePath: publishedPath,
      ctxPageType: undefined,
      persistedPageType: savedPageTypes[page.id] as SchemaPageType | undefined,
    });

    const pageIntel = wsId
      ? await readSchemaPageIntelligence(siteId, baseUrl, publishedPath, tokenOverride, true)
      : undefined;
    const entities = entityResolutionForPage(pageIntel?.entityResolution, publishedPath);

    const lean = await generateLeanSchema({
      pageId: page.id,
      pageMeta: {
        title: page.title || '',
        slug,
        publishedPath,
        seo: page.seo,
        pageKeywords: pageIntel?.pageKeywords,
        elements: pageIntel?.pageElements,
        lastPublished: pageMeta.lastPublished,
        sourcePublishedAt: pageMeta.lastPublished ?? null,
        entityResolution: {
          articleAbout: entities.articleAbout,
          articleMentions: entities.articleMentions,
          areaServed: entities.areaServed,
        },
      },
      html: html || '',
      baseUrl,
      workspace: {
        id: wsId,
        name: ctx.companyName || '',
        publisherLogoUrl: ctx.logoUrl ?? null,
        businessProfile: ctx._businessProfile ?? null,
        defaultLocale: ctx._defaultLocale ?? 'en',
        siteKeywordsForKnowsAbout: ctx.siteKeywords, // NEW
        siteHasSearch: ctx._siteHasSearch ?? false, // NEW
        eeatAssets: ctx._eeatAssets,
        entityResolution: { knowsAbout: entities.knowsAbout },
        industrySubtype: roleOverride.schemaRoleOverride?.industrySubtype,
      },
      aiBudget, // PR2: shared budget — drains across all static pages in this run
      siteContext, // cross-page hub enrichment
      pageKindOverride: roleOverride.pageKindOverride,
      schemaRoleOverride: roleOverride.schemaRoleOverride,
      canonicalEntityRefs: roleOverride.canonicalEntityRefs,
      plannedSchemaRole: roleOverride.plannedRole,
      roleDecisionDiagnostics: roleOverride.roleDecisionDiagnostics,
      inactivePlanStatus: roleOverride.inactivePlanStatus,
    });
    results.push({
      ...leanToSuggestion(lean),
      savedPageType: savedPageTypes[page.id],
    });
    onProgress?.(results, false, `Processed ${results.length} of ${pages.length} static pages${utilitySkipMessage(skippedUtilities)}...`);
  }

  // CMS pages — same lean path
  {
    const cmsItems = siteInventory?.cmsItems ?? [];
    for (const item of cmsItems) {
      if (isCancelled?.()) break;
      if (shouldSkipBulkPage(item.path, findPlanRole(activePlan, item.path)?.role)) {
        recordSkippedUtility(skippedUtilities, item.path);
        continue;
      }
      const itemHtml = await fetchPublishedHtml(item.url);
      const roleOverride = resolveRoleOverride({
        siteId,
        pagePath: item.path,
        ctxPageType: undefined,
        persistedPageType: savedPageTypes[item.pageId] as SchemaPageType | undefined,
        collectionRole: item.effectiveRole,
        collectionRoleSource: item.roleSource,
        isCmsItem: true,
      });
      const cmsPageIntel = wsId
        ? await readSchemaPageIntelligence(siteId, baseUrl, item.path, tokenOverride, true)
        : undefined;
      const entities = entityResolutionForPage(cmsPageIntel?.entityResolution, item.path);

      const itemLean = await generateLeanSchema({
        pageId: item.pageId,
        pageMeta: {
          title: item.title,
          slug: item.path.replace(/^\//, ''),
          publishedPath: item.path,
          seo: undefined,
          lastPublished: item.lastPublished,
          createdOn: item.createdOn,
          cmsFieldData: item.fieldData,
          cmsFieldTargets: item.fieldTargets,
          fieldEvidence: item.fieldEvidence,
          serviceProfile: item.itemServiceProfile,
          pageKeywords: cmsPageIntel?.pageKeywords,
          elements: cmsPageIntel?.pageElements,
          sourcePublishedAt: item.lastPublished ?? null, // CMS items carry Webflow lastPublished
          entityResolution: {
            articleAbout: entities.articleAbout,
            articleMentions: entities.articleMentions,
            areaServed: entities.areaServed,
          },
        },
        html: itemHtml || '',
        baseUrl,
        workspace: {
          id: wsId,
          name: ctx.companyName || '',
          publisherLogoUrl: ctx.logoUrl ?? null,
          businessProfile: item.itemBusinessProfile ?? ctx._businessProfile ?? null,
          defaultLocale: ctx._defaultLocale ?? 'en',
          siteKeywordsForKnowsAbout: ctx.siteKeywords, // NEW
          siteHasSearch: ctx._siteHasSearch ?? false, // NEW
          eeatAssets: ctx._eeatAssets,
          entityResolution: { knowsAbout: entities.knowsAbout },
          industrySubtype: roleOverride.schemaRoleOverride?.industrySubtype,
        },
        aiBudget, // PR2: same shared budget — drains across CMS pages in same run
        siteContext,
        pageKindOverride: roleOverride.pageKindOverride,
        schemaRoleOverride: roleOverride.schemaRoleOverride,
        canonicalEntityRefs: roleOverride.canonicalEntityRefs,
        plannedSchemaRole: roleOverride.plannedRole,
        roleDecisionDiagnostics: roleOverride.roleDecisionDiagnostics,
        inactivePlanStatus: roleOverride.inactivePlanStatus,
        collectionIdentity: collectionIdentity(item),
        cmsDeliveryStatus: cmsDeliveryStatus(item),
      });
      results.push({
        ...leanToSuggestion(itemLean),
        savedPageType: savedPageTypes[item.pageId],
      });
    }
  }

  onProgress?.(results, true, `Done${utilitySkipMessage(skippedUtilities)}`);
  return results;
}
