import { discoverSitemapUrls, getCollectionSchema, listCollections, resolveStaticPagePathsFromSitemap } from './webflow.js';
import { getWorkspacePages } from './workspace-data.js';
import { listWorkspaces } from './workspaces.js';
import { generateLeanSchema } from './schema/index.js';
import { buildWorkspaceIntelligence } from './workspace-intelligence.js';
import { callAI } from './ai.js';
import { createLogger } from './logger.js';
import type { ContentBrief } from '../shared/types/content.ts';
import type { SchemaValidation } from './schema-validator.js';
import { fetchPageMeta } from './seo-audit.js';
import { fetchPublishedHtml, resolvePagePath } from './helpers.js';
import { resolveBaseUrl } from './url-helpers.js';
import { createAiBudget } from './schema/extractors/page-elements/ai-budget.js';
import type { AiBudget } from './schema/extractors/page-elements/ai-budget.js';
import { isFeatureEnabled } from './feature-flags.js';
import { assembleSiteContext } from './schema/site-context.js';
import type { SiteContext } from './schema/site-context.js';
import { getSchemaPlan } from './schema-store.js';
import type { PageKind } from './schema/classifier.js';
import type { SchemaPageRole } from '../shared/types/schema-plan.js';
import type { SchemaGenerationDiagnostics } from '../shared/types/schema-generation.js';
import { buildSiteInventory, isUtilitySchemaPath } from './schema/site-inventory.js';
import type { SchemaCmsDeliveryStatus, SchemaCollectionIdentity, SiteInventoryCmsItem, SiteInventorySlice } from '../shared/types/site-inventory.js';

const log = createLogger('schema');

/**
 * AI budget allocation for the page-element AI extractors.
 * 100 image classifications + 20 HowTo disambiguations = 120 total per regenerate-all.
 * Returns a zero-cap budget when the feature flag is off so all consumers fall through to rule-based.
 */
function allocateElementAiBudget(): AiBudget {
  const enabled = isFeatureEnabled('schema-ai-element-classifier');
  return createAiBudget(enabled ? 120 : 0);
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

// Page type hints for tailored schema generation
export type SchemaPageType = 'auto' | 'homepage' | 'pillar' | 'service' | 'audience' | 'lead-gen' | 'blog' | 'about' | 'contact' | 'location' | 'product' | 'partnership' | 'faq' | 'case-study' | 'comparison' | 'author' | 'howto' | 'video' | 'job-posting' | 'course' | 'event' | 'review' | 'pricing' | 'recipe' | 'generic';

export const PAGE_TYPE_LABELS: Record<SchemaPageType, string> = {
  auto: 'Auto-detect',
  homepage: 'Homepage',
  pillar: 'Pillar / Product Page',
  service: 'Service Page',
  audience: 'Audience / Use Case',
  'lead-gen': 'Lead-Gen / Conversion',
  blog: 'Blog Post',
  about: 'About / Team',
  contact: 'Contact',
  location: 'Location',
  product: 'Product',
  partnership: 'Partnership',
  faq: 'FAQ',
  'case-study': 'Case Study',
  comparison: 'Comparison',
  author: 'Author Profile',
  howto: 'How-To / Tutorial',
  video: 'Video Page',
  'job-posting': 'Job Posting',
  course: 'Course / Training',
  event: 'Event',
  review: 'Review',
  pricing: 'Pricing Page',
  recipe: 'Recipe',
  generic: 'General Page',
};

// Deterministic mapping: page type → recommended Schema.org types
export const PAGE_TYPE_SCHEMA_MAP: Record<SchemaPageType, { primary: string[]; secondary: string[] }> = {
  auto: { primary: [], secondary: [] },
  homepage: { primary: ['Organization', 'WebSite'], secondary: [] },
  pillar: { primary: ['Article', 'CollectionPage'], secondary: ['Person', 'BreadcrumbList'] },
  service: { primary: ['Service'], secondary: ['Offer', 'BreadcrumbList'] },
  audience: { primary: ['WebPage'], secondary: ['BreadcrumbList'] },
  'lead-gen': { primary: ['WebPage'], secondary: ['BreadcrumbList'] },
  blog: { primary: ['BlogPosting'], secondary: ['Person', 'BreadcrumbList', 'speakable'] },
  about: { primary: ['AboutPage', 'Organization'], secondary: ['Person', 'BreadcrumbList'] },
  contact: { primary: ['ContactPage'], secondary: ['Organization', 'BreadcrumbList'] },
  location: { primary: ['LocalBusiness'], secondary: ['Place', 'GeoCoordinates', 'BreadcrumbList'] },
  product: { primary: ['Product'], secondary: ['Offer', 'AggregateRating', 'BreadcrumbList'] },
  partnership: { primary: ['WebPage'], secondary: ['Organization', 'BreadcrumbList'] },
  faq: { primary: ['FAQPage'], secondary: ['BreadcrumbList'] },
  'case-study': { primary: ['Article'], secondary: ['Person', 'CreativeWork', 'BreadcrumbList'] },
  comparison: { primary: ['WebPage'], secondary: ['ItemList', 'BreadcrumbList'] },
  author: { primary: ['Person', 'ProfilePage'], secondary: ['BreadcrumbList'] },
  howto: { primary: ['HowTo'], secondary: ['Article', 'BreadcrumbList'] },
  video: { primary: ['VideoObject'], secondary: ['Article', 'BreadcrumbList'] },
  'job-posting': { primary: ['JobPosting'], secondary: ['BreadcrumbList'] },
  course: { primary: ['Course'], secondary: ['CourseInstance', 'BreadcrumbList'] },
  event: { primary: ['Event'], secondary: ['Offer', 'Place', 'BreadcrumbList'] },
  review: { primary: ['Review'], secondary: ['AggregateRating', 'BreadcrumbList'] },
  pricing: { primary: ['WebPage'], secondary: ['Offer', 'BreadcrumbList'] },
  recipe: { primary: ['Recipe'], secondary: ['HowToStep', 'NutritionInformation', 'BreadcrumbList'] },
  generic: { primary: ['WebPage'], secondary: ['BreadcrumbList'] },
};

export const SCHEMA_ROLE_TO_PAGE_KIND: Partial<Record<SchemaPageRole, PageKind>> = {
  homepage:     'Homepage',
  pillar:       'WebPage',
  audience:     'WebPage',
  'lead-gen':   'WebPage',
  blog:         'BlogPosting',
  service:      'Service',
  about:        'AboutPage',
  contact:      'ContactPage',
  location:     'Location',
  partnership:  'WebPage',
  'case-study': 'CaseStudy',
  comparison:   'WebPage',
  generic:      'WebPage',
};

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

function resolveRoleOverride(opts: {
  siteId: string;
  pagePath: string;
  ctxPageType?: SchemaPageType;
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
      plannedRole: planRole?.role ?? opts.collectionRole,
      roleDecisionDiagnostics: shouldCollectionBeatPlan && planRole ? [{
        type: 'SchemaSitePlan',
        reason: `Site plan role ${planRole.role} ignored: ${opts.collectionRole} collection role has higher confidence.`,
      }] : undefined,
      inactivePlanStatus: latestPlan && latestPlan.status !== 'active' ? latestPlan.status : undefined,
      activePlan,
    };
  }
  return {
    pageKindOverride: undefined,
    schemaRoleOverride: undefined,
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
  businessContext?: string;
  pageKeywords?: { primary: string; secondary: string[] };
  searchIntent?: string;
  siteKeywords?: string[];
  workspaceId?: string;
  knowledgeBase?: string;
  pageType?: SchemaPageType;
  _siteId?: string;  // Internal: passed through for site template storage
  _architectureTree?: import('./site-architecture.js').SiteNode;    // Full site tree for breadcrumb + nav generation
  _personasBlock?: string;  // Internal: audience personas for richer schema targeting
  _gscPageData?: { clicks: number; impressions: number; position: number; ctr: number };  // Internal: GSC per-page metrics
  _ga4PageData?: { pageviews: number; users: number; avgEngagementTime: number };  // Internal: GA4 per-page metrics
  _pageHealthScore?: number;  // Internal: 0-100 from analytics intelligence layer
  _pageHealthTrend?: 'improving' | 'declining' | 'stable';  // Internal: trend direction
  _quickWinStatus?: boolean;  // Internal: is this page a quick-win candidate?
  _faqOpportunities?: Array<{ query: string; impressions: number; position: number }>;  // Internal: question queries from GSC
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
  /** Site-level SERP features from SEO data provider — used to steer schema type selection. */
  _serpFeatures?: { featuredSnippets: number; peopleAlsoAsk: number; localPack: boolean; videoCarousel: number };
  /** Referring-domain count from backlink profile — used to calibrate schema ambition. */
  _backlinkReferringDomains?: number;
  /** Validation errors from the prior schema generation for this page — used to avoid repeating known mistakes. */
  _existingErrors?: Array<{ message: string }>;
}

// ── Analytics Intelligence helpers for prompt enrichment ────────────

const QUESTION_PREFIXES = /^(how|what|why|when|where|which|can|do|does|is|are|should|will|would)\b/i;

/**
 * Extract question-type queries from GSC data that target a specific page.
 * These are FAQ candidates — questions people search to find this page.
 */
export function extractFaqOpportunities(
  queryPageData: Array<{ query: string; page: string; impressions: number; position: number }>,
  pageUrl: string,
): Array<{ query: string; impressions: number; position: number }> {
  return queryPageData
    .filter(row => row.page === pageUrl && QUESTION_PREFIXES.test(row.query))
    .map(({ query, impressions, position }) => ({ query, impressions, position }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 10);
}

/**
 * Build the intelligence enrichment block for the schema generation prompt.
 * Returns empty string if no intelligence data is available.
 */
export function buildSchemaIntelligenceBlock(ctx: SchemaContext): string {
  const lines: string[] = [];

  if (ctx._pageHealthScore != null) {
    const trend = ctx._pageHealthTrend ? ` (${ctx._pageHealthTrend})` : '';
    lines.push(`- Page Health Score: ${ctx._pageHealthScore}/100${trend}`);
  }

  if (ctx._quickWinStatus === true) {
    lines.push(`- Quick Win: Yes — this page is close to page 1 and worth extra schema richness`);
  }

  const faqBlock: string[] = [];
  if (ctx._faqOpportunities && ctx._faqOpportunities.length > 0) {
    faqBlock.push(`\nFAQ OPPORTUNITIES (question queries people use to find this page — do NOT auto-generate FAQ schema from these; surface as insight only):`);
    for (const opp of ctx._faqOpportunities) {
      faqBlock.push(`- "${opp.query}" (${opp.impressions.toLocaleString()} impressions, pos ${Math.round(opp.position)})`);
    }
  }

  if (lines.length === 0 && faqBlock.length === 0) return '';

  const parts: string[] = [];
  if (lines.length > 0) {
    parts.push(`\nANALYTICS INTELLIGENCE:\n${lines.join('\n')}`);
  }
  if (faqBlock.length > 0) {
    parts.push(faqBlock.join('\n'));
  }

  return parts.join('\n');
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

export async function generateSchemaForPage(
  siteId: string,
  pageId: string,
  tokenOverride?: string,
  ctx: SchemaContext = {},
  gscMap?: Map<string, { clicks: number; impressions: number; position: number; ctr: number }>,
  ga4Map?: Map<string, { pageviews: number; users: number; avgEngagementTime: number }>,
  queryPageData?: Array<{ query: string; page: string; impressions: number; position: number }>,
  insightsMap?: Map<string, { healthScore?: number; healthTrend?: string; isQuickWin?: boolean }>,
): Promise<SchemaPageSuggestion | null> {
  const baseUrl = await resolveBaseUrl({ liveDomain: ctx.liveDomain, webflowSiteId: siteId }, tokenOverride);
  if (!baseUrl) return null;

  const wsId = ctx.workspaceId || listWorkspaces().find(w => w.webflowSiteId === siteId)?.id;
  const rawPages = wsId ? await getWorkspacePages(wsId, siteId) : [];
  const sitemapUrls = rawPages.length > 0 ? await discoverSitemapUrls(baseUrl) : [];
  const allPages = resolveStaticPagePathsFromSitemap(rawPages, sitemapUrls, baseUrl);
  let siteInventory: SiteInventorySlice | undefined;
  if (wsId) {
    siteInventory = await buildSiteInventory({
      siteId,
      baseUrl,
      pages: allPages,
      tokenOverride,
      businessProfile: ctx._businessProfile ?? null,
    });
  }

  const cmsItem = siteInventory?.cmsItems.find(item => item.pageId === pageId);
  if (cmsItem) {
    const itemHtml = await fetchPublishedHtml(cmsItem.url);
    const roleOverride = resolveRoleOverride({
      siteId,
      pagePath: cmsItem.path,
      ctxPageType: ctx.pageType,
      collectionRole: cmsItem.effectiveRole,
      collectionRoleSource: cmsItem.roleSource,
      isCmsItem: true,
    });
    let pageKeywords: { primary: string; secondary: string[] } | undefined;
    if (wsId) {
      try {
        const perPageIntel = await buildWorkspaceIntelligence(wsId, { slices: ['seoContext'], pagePath: cmsItem.path });
        if (perPageIntel?.seoContext?.pageKeywords) {
          pageKeywords = {
            primary: perPageIntel.seoContext.pageKeywords.primaryKeyword || '',
            secondary: perPageIntel.seoContext.pageKeywords.secondaryKeywords || [],
          };
        }
      } catch { /* intelligence not ready — pageKeywords stays undefined */ } // catch-ok
    }
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
        pageKeywords,
        sourcePublishedAt: cmsItem.lastPublished ?? null,
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
        industrySubtype: roleOverride.schemaRoleOverride?.industrySubtype,
      },
      aiBudget,
      pageKindOverride: roleOverride.pageKindOverride,
      schemaRoleOverride: roleOverride.schemaRoleOverride,
      plannedSchemaRole: roleOverride.plannedRole,
      roleDecisionDiagnostics: roleOverride.roleDecisionDiagnostics,
      inactivePlanStatus: roleOverride.inactivePlanStatus,
      collectionIdentity: collectionIdentity(cmsItem),
      cmsDeliveryStatus: cmsDeliveryStatus(cmsItem),
    });
    return leanToSuggestion(lean);
  }

  const meta = await fetchPageMeta(pageId, tokenOverride);
  if (!meta) return null;

  const slug = meta.slug || '';
  const isHomepage = !slug || slug === 'index' || slug === 'home';

  // Fix 6: look up full publishedPath from getWorkspacePages — fetchPageMeta only
  // returns the leaf slug, which loses parent folder for nested pages (e.g. the page
  // published at /services/web-design would produce /web-design from slug alone).
  // Fall back to derived path if page list fails or page is not found.
  let publishedPath = isHomepage ? '/' : `/${slug}`;
  let siteContextForPage: SiteContext | undefined;
  try {
    if (wsId) {
      const matched = allPages.find(p => p.id === pageId);
      if (matched?.publishedPath) {
        publishedPath = matched.publishedPath;
      }
      const activePlan = getSchemaPlan(siteId);
      siteContextForPage = assembleSiteContext(
        allPages,
        baseUrl,
        activePlan?.status === 'active' ? activePlan.canonicalEntities : [],
      );
    }
  } catch { /* page list failure — fall back to derived path */ } // catch-ok

  const url = publishedPath === '/' ? baseUrl : `${baseUrl}${publishedPath}`;
  const html = await fetchPublishedHtml(url);
  const roleOverride = resolveRoleOverride({
    siteId,
    pagePath: publishedPath,
    ctxPageType: ctx.pageType,
  });

  // Per-page slice fetch for pageKeywords (Audit Correction 4: pageKeywords is a PageKeywordMap
  // populated only when buildWorkspaceIntelligence is called with opts.pagePath).
  // 5-min LRU + single-flight dedup makes this cheap — no local cache needed.
  let pageKeywords: { primary: string; secondary: string[] } | undefined;
  if (ctx.workspaceId) {
    try {
      const perPageIntel = await buildWorkspaceIntelligence(ctx.workspaceId, { slices: ['seoContext'], pagePath: publishedPath });
      if (perPageIntel?.seoContext?.pageKeywords) {
        pageKeywords = {
          primary: perPageIntel.seoContext.pageKeywords.primaryKeyword || '',
          secondary: perPageIntel.seoContext.pageKeywords.secondaryKeywords || [],
        };
      }
    } catch { /* intelligence not ready — pageKeywords stays undefined */ } // catch-ok
  }

  const aiBudget = allocateElementAiBudget();
  const lean = await generateLeanSchema({
    pageId,
    pageMeta: {
      title: meta.title || '',
      slug,
      publishedPath,
      seo: meta.seo,
      // Fix 4: pass CMS timestamps for datePublished/dateModified fallback —
      // The Webflow API may return these even though the local PageMeta interface omits them.
      lastPublished: (meta as unknown as Record<string, unknown>).lastPublished as string | undefined,
      createdOn: (meta as unknown as Record<string, unknown>).createdOn as string | undefined,
      pageKeywords,
      // Static pages can carry a Webflow `lastPublished` timestamp too — pass
      // it through so isCatalogStale can drive lazy refresh on republish.
      // Falls back to null when the Webflow response omits the field.
      sourcePublishedAt: ((meta as unknown as Record<string, unknown>).lastPublished as string | undefined) ?? null,
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
      industrySubtype: roleOverride.schemaRoleOverride?.industrySubtype,
    },
    aiBudget, // PR2: thread per-call budget so AI extractors can run within cap
    siteContext: siteContextForPage, // cross-page hub enrichment
    pageKindOverride: roleOverride.pageKindOverride,
    schemaRoleOverride: roleOverride.schemaRoleOverride,
    plannedSchemaRole: roleOverride.plannedRole,
    roleDecisionDiagnostics: roleOverride.roleDecisionDiagnostics,
    inactivePlanStatus: roleOverride.inactivePlanStatus,
  });

  // Surface unused parameters to satisfy TS noUnusedParameters via void casts.
  // These are kept in the signature for backwards compatibility with PR #354's
  // intelligence wiring; the lean generator does not use them in MVP scope.
  void gscMap; void ga4Map; void queryPageData; void insightsMap;

  return leanToSuggestion(lean);
}

export async function generateSchemaSuggestions(
  siteId: string,
  tokenOverride?: string,
  ctx: SchemaContext = {},
  onProgress?: (partial: SchemaPageSuggestion[], done: boolean, message: string) => void,
  isCancelled?: () => boolean,
  gscMap?: Map<string, { clicks: number; impressions: number; position: number; ctr: number }>,
  ga4Map?: Map<string, { pageviews: number; users: number; avgEngagementTime: number }>,
  queryPageData?: Array<{ query: string; page: string; impressions: number; position: number }>,
  insightsMap?: Map<string, { healthScore?: number; healthTrend?: string; isQuickWin?: boolean }>,
  validationsByPageId?: Map<string, SchemaValidation>,
): Promise<SchemaPageSuggestion[]> {
  void gscMap; void ga4Map; void queryPageData; void insightsMap; void validationsByPageId;

  const baseUrl = await resolveBaseUrl({ liveDomain: ctx.liveDomain, webflowSiteId: siteId }, tokenOverride);
  if (!baseUrl) return [];

  const wsId = ctx.workspaceId || listWorkspaces().find(w => w.webflowSiteId === siteId)?.id;
  const rawPages = wsId ? await getWorkspacePages(wsId, siteId) : [];
  const sitemapUrls = rawPages.length > 0 ? await discoverSitemapUrls(baseUrl) : [];
  const pages = resolveStaticPagePathsFromSitemap(rawPages, sitemapUrls, baseUrl);
  const latestPlan = getSchemaPlan(siteId);
  const activePlan = latestPlan?.status === 'active' ? latestPlan : null;
  const siteInventory = wsId
    ? await buildSiteInventory({
        siteId,
        baseUrl,
        pages,
        tokenOverride,
        businessProfile: ctx._businessProfile ?? null,
      })
    : undefined;

  let siteContext: SiteContext | undefined = pages.length > 0
    ? assembleSiteContext(pages, baseUrl, activePlan?.canonicalEntities ?? [])
    : undefined;

  // PR2: ONE shared budget for the entire regenerate-all run (static + CMS loops).
  // Allocates 120 slots when schema-ai-element-classifier is enabled; 0 when off.
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
    const roleOverride = resolveRoleOverride({
      siteId,
      pagePath: publishedPath,
      ctxPageType: undefined,
    });

    // Per-page slice fetch for pageKeywords (5-min LRU + single-flight dedup — cheap).
    let pageKeywords: { primary: string; secondary: string[] } | undefined;
    if (wsId) {
      try {
        const perPageIntel = await buildWorkspaceIntelligence(wsId, { slices: ['seoContext'], pagePath: publishedPath });
        if (perPageIntel?.seoContext?.pageKeywords) {
          pageKeywords = {
            primary: perPageIntel.seoContext.pageKeywords.primaryKeyword || '',
            secondary: perPageIntel.seoContext.pageKeywords.secondaryKeywords || [],
          };
        }
      } catch { /* intelligence not ready — pageKeywords stays undefined */ } // catch-ok
    }

    const lean = await generateLeanSchema({
      pageId: page.id,
      pageMeta: {
        title: page.title || '',
        slug,
        publishedPath,
        seo: page.seo,
        pageKeywords,
        // Pass Webflow `lastPublished` through when available — drives
        // isCatalogStale-based refresh on static-page republish. The
        // WebflowPage interface uses [key: string]: unknown so we read
        // the field via index access.
        lastPublished: typeof (page as Record<string, unknown>).lastPublished === 'string'
          ? ((page as Record<string, unknown>).lastPublished as string)
          : undefined,
        sourcePublishedAt: typeof (page as Record<string, unknown>).lastPublished === 'string'
          ? ((page as Record<string, unknown>).lastPublished as string)
          : null,
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
        industrySubtype: roleOverride.schemaRoleOverride?.industrySubtype,
      },
      aiBudget, // PR2: shared budget — drains across all static pages in this run
      siteContext, // cross-page hub enrichment
      pageKindOverride: roleOverride.pageKindOverride,
      schemaRoleOverride: roleOverride.schemaRoleOverride,
      plannedSchemaRole: roleOverride.plannedRole,
      roleDecisionDiagnostics: roleOverride.roleDecisionDiagnostics,
      inactivePlanStatus: roleOverride.inactivePlanStatus,
    });
    results.push(leanToSuggestion(lean));
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
        collectionRole: item.effectiveRole,
        collectionRoleSource: item.roleSource,
        isCmsItem: true,
      });
      // Per-page slice fetch for CMS item pageKeywords.
      let cmsPageKeywords: { primary: string; secondary: string[] } | undefined;
      if (wsId) {
        try {
          const cmsPerPageIntel = await buildWorkspaceIntelligence(wsId, { slices: ['seoContext'], pagePath: item.path });
          if (cmsPerPageIntel?.seoContext?.pageKeywords) {
            cmsPageKeywords = {
              primary: cmsPerPageIntel.seoContext.pageKeywords.primaryKeyword || '',
              secondary: cmsPerPageIntel.seoContext.pageKeywords.secondaryKeywords || [],
            };
          }
        } catch { /* intelligence not ready — cmsPageKeywords stays undefined */ } // catch-ok
      }

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
          pageKeywords: cmsPageKeywords,
          sourcePublishedAt: item.lastPublished ?? null, // CMS items carry Webflow lastPublished
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
          industrySubtype: roleOverride.schemaRoleOverride?.industrySubtype,
        },
        aiBudget, // PR2: same shared budget — drains across CMS pages in same run
        pageKindOverride: roleOverride.pageKindOverride,
        schemaRoleOverride: roleOverride.schemaRoleOverride,
        plannedSchemaRole: roleOverride.plannedRole,
        roleDecisionDiagnostics: roleOverride.roleDecisionDiagnostics,
        inactivePlanStatus: roleOverride.inactivePlanStatus,
        collectionIdentity: collectionIdentity(item),
        cmsDeliveryStatus: cmsDeliveryStatus(item),
      });
      results.push(leanToSuggestion(itemLean));
    }
  }

  onProgress?.(results, true, `Done${utilitySkipMessage(skippedUtilities)}`);
  return results;
}

// ── CMS Template Schema Generator ──
// Generates a schema template for a CMS collection page using Webflow's
// {{wf ...}} template tags so each collection item gets dynamic schema.

export interface CmsTemplateSchemaResult {
  templateString: string;           // Raw JSON-LD with {{wf}} tags (ready for custom code)
  schemaTypes: string[];            // Schema.org types generated
  fieldsUsed: string[];             // CMS field slugs referenced
  collectionName: string;
  collectionSlug: string;
}

// Convert placeholder __WF:path:Type__ to Webflow template tag
function wfTag(fieldPath: string, fieldType: string): string {
  return `{{wf {&quot;path&quot;:&quot;${fieldPath}&quot;,&quot;type&quot;:&quot;${fieldType}&quot;\\} }}`;
}

// Build a readable field list for the AI prompt
function describeFields(fields: Array<{ slug: string; displayName: string; type: string }>): string {
  return fields.map(f => `- ${f.slug} (${f.type}): "${f.displayName}"`).join('\n');
}

export async function generateCmsTemplateSchema(
  siteId: string,
  collectionId: string,
  tokenOverride?: string,
  ctx: SchemaContext = {},
): Promise<CmsTemplateSchemaResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;

  // Fetch collection info
  const [collections, collSchema] = await Promise.all([
    listCollections(siteId, tokenOverride),
    getCollectionSchema(collectionId, tokenOverride),
  ]);
  const collection = collections.find(c => c.id === collectionId);
  if (!collection || collSchema.fields.length === 0) return null;

  const siteUrl = ctx.liveDomain
    ? (ctx.liveDomain.startsWith('http') ? ctx.liveDomain : `https://${ctx.liveDomain}`)
    : '';
  const companyName = ctx.companyName || '(company name)';

  // Build the field descriptions for the AI
  const fieldDescriptions = describeFields(collSchema.fields);

  // If no AI, build a basic template
  if (!apiKey) {
    return buildFallbackCmsTemplate(collection, collSchema.fields, siteUrl, companyName);
  }

  const prompt = `You are a Google Structured Data expert. Generate a JSON-LD schema template for a Webflow CMS collection page.

This schema will be injected into every page of the "${collection.displayName}" collection (slug: "${collection.slug}"). Instead of static values, use PLACEHOLDER tags for CMS field data.

PLACEHOLDER FORMAT: Use exactly this syntax for dynamic CMS values:
  __WF:field-slug:FieldType__

For reference fields (fields from a linked collection), use:
  __WF:ref-field-slug:sub-field-slug:FieldType__

SITE INFO:
- Company: ${companyName}
- Site URL: ${siteUrl || '(not available)'}
- Logo: ${ctx.logoUrl || '(not available)'}
- Collection: ${collection.displayName} (slug: ${collection.slug})
${ctx.businessContext ? `- Business Context: ${ctx.businessContext}` : ''}

AVAILABLE CMS FIELDS:
${fieldDescriptions}

REQUIREMENTS:
1. Return ONE JSON-LD object with "@context": "https://schema.org" and an "@graph" array
2. Map CMS fields to the most appropriate schema.org properties based on field names and types
3. Use __WF:slug:PlainText__ for the item slug in URLs: "${siteUrl}/${collection.slug}/__WF:slug:PlainText__"
4. Use __WF:name:PlainText__ for the item name
5. For Phone fields use __WF:field-slug:Phone__
6. For ImageRef fields use __WF:field-slug:ImageRef__
7. For Email fields use __WF:field-slug:Email__
8. For Date fields use __WF:field-slug:Date__
9. For Link fields use __WF:field-slug:Link__
10. For reference fields pointing to another collection's field, use __WF:ref-field:sub-field:PlainText__
11. Include Organization node with static company data (not dynamic)
12. Include BreadcrumbList: Home → ${collection.displayName} → __WF:name:PlainText__
13. Choose the most appropriate @type for collection items (Dentist, Article, BlogPosting, Product, Service, Event, Person, Place, etc.) based on the collection name and fields
14. ONLY use fields that exist in the AVAILABLE CMS FIELDS list above
15. If a field doesn't exist for a schema property, OMIT that property entirely — do not guess field names
16. NEVER include empty arrays, empty strings, or empty objects
17. Use consistent @id naming: "${siteUrl}/${collection.slug}/__WF:slug:PlainText__/#typename"

Return ONLY the raw JSON-LD. No markdown, no explanation.`;

  try {
    const aiResult = await callAI({
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 3000,
      temperature: 0.2,
      responseFormat: { type: 'json_object' },
      feature: 'cms-schema-template',
      maxRetries: 3,
    });

    const content = aiResult.text;
    if (!content) return null;

    let jsonStr = content;
    const mdMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (mdMatch) jsonStr = mdMatch[1].trim();

    // Validate it's parseable JSON (with placeholders as strings)
    try { JSON.parse(jsonStr); } catch (err) {
      log.debug({ err }, 'schema-suggester: expected error — degrading gracefully');
      log.error('AI returned invalid JSON');
      return null;
    }

    // Convert placeholders to Webflow template tags
    const templateString = convertPlaceholders(jsonStr);

    // Extract which fields were used
    const fieldsUsed = extractUsedFields(jsonStr, collSchema.fields);

    // Extract schema types
    const typeMatches = jsonStr.match(/"@type"\s*:\s*"([^"]+)"/g) || [];
    const schemaTypes = typeMatches
      .map(m => m.match(/"@type"\s*:\s*"([^"]+)"/)?.[1])
      .filter(Boolean) as string[];

    return {
      templateString,
      schemaTypes: [...new Set(schemaTypes)],
      fieldsUsed,
      collectionName: collection.displayName,
      collectionSlug: collection.slug,
    };
  } catch (err) {
    log.error({ err: err }, 'AI generation failed');
    return null;
  }
}

// Convert __WF:path:Type__ placeholders to {{wf {&quot;...&quot;} }} tags
function convertPlaceholders(jsonStr: string): string {
  // Match __WF:path:Type__ and __WF:ref:subfield:Type__
  return jsonStr.replace(/__WF:([^_]+)__/g, (_match, inner: string) => {
    const parts = inner.split(':');
    if (parts.length === 3) {
      // Reference field: __WF:ref-field:sub-field:Type__
      const [refField, subField, type] = parts;
      return wfTag(`${refField}:${subField}`, type);
    } else if (parts.length === 2) {
      // Direct field: __WF:field-slug:Type__
      const [fieldSlug, type] = parts;
      return wfTag(fieldSlug, type);
    }
    return _match; // leave unrecognized patterns as-is
  });
}

// Figure out which CMS fields were referenced
function extractUsedFields(jsonStr: string, allFields: Array<{ slug: string }>): string[] {
  const used = new Set<string>();
  const matches = jsonStr.matchAll(/__WF:([^:_]+)/g);
  for (const m of matches) {
    if (allFields.some(f => f.slug === m[1])) {
      used.add(m[1]);
    }
  }
  return [...used];
}

// Fallback template without AI
function buildFallbackCmsTemplate(
  collection: { displayName: string; slug: string },
  fields: Array<{ slug: string; displayName: string; type: string }>,
  siteUrl: string,
  companyName: string,
): CmsTemplateSchemaResult {
  const baseItemUrl = `${siteUrl}/${collection.slug}/${wfTag('slug', 'PlainText')}`;
  const nameTag = wfTag('name', 'PlainText');

  const graph: string[] = [];

  // Organization
  graph.push(`    {
      "@type": "Organization",
      "@id": "${siteUrl}/#organization",
      "name": "${companyName}",
      "url": "${siteUrl}"
    }`);

  // WebPage
  graph.push(`    {
      "@type": "WebPage",
      "@id": "${baseItemUrl}/#webpage",
      "url": "${baseItemUrl}",
      "name": "${nameTag}",
      "inLanguage": "en"
    }`);

  // BreadcrumbList
  graph.push(`    {
      "@type": "BreadcrumbList",
      "@id": "${baseItemUrl}/#breadcrumb",
      "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": "${siteUrl}/"},
        {"@type": "ListItem", "position": 2, "name": "${collection.displayName}", "item": "${siteUrl}/${collection.slug}"},
        {"@type": "ListItem", "position": 3, "name": "${nameTag}", "item": "${baseItemUrl}"}
      ]
    }`);

  const templateString = `{
  "@context": "https://schema.org",
  "@graph": [
${graph.join(',\n')}
  ]
}`;

  const fieldsUsed = ['name', 'slug'].filter(s => fields.some(f => f.slug === s));

  return {
    templateString,
    schemaTypes: ['Organization', 'WebPage', 'BreadcrumbList'],
    fieldsUsed,
    collectionName: collection.displayName,
    collectionSlug: collection.slug,
  };
}
