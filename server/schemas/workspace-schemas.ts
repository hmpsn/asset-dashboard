/**
 * Zod schemas for workspace JSON columns.
 * Uses .passthrough() on all object schemas for forward compatibility.
 */
import { z } from 'zod';
import { METRICS_SOURCE } from '../../shared/types/keywords.js';

// ── Event config ──

export const eventDisplayConfigSchema = z.object({
  eventName: z.string(),
  displayName: z.string(),
  pinned: z.boolean(),
  group: z.string().optional(),
}).passthrough();

export const eventDisplayConfigArraySchema = z.array(eventDisplayConfigSchema);

export const eventGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  order: z.number(),
  color: z.string(),
  defaultPageFilter: z.string().optional(),
  allowedPages: z.array(z.string()).optional(),
}).passthrough();

export const eventGroupArraySchema = z.array(eventGroupSchema);

// ── Keyword strategy ──

// Mirrors the PageKeywordMap interface in shared/types/workspace.ts.
// Required fields match the write-time shape; everything else is optional so
// historical or partial blobs (e.g. before SEMRush enrichment ran) round-trip
// through parseJsonSafe without being rejected. .passthrough() preserves any
// fields not yet captured here.
export const pageKeywordMapSchema = z.object({
  pagePath: z.string(),
  pageTitle: z.string(),
  primaryKeyword: z.string(),
  secondaryKeywords: z.array(z.string()),
  searchIntent: z.string().optional(),
  currentPosition: z.number().optional(),
  previousPosition: z.number().optional(),
  impressions: z.number().optional(),
  clicks: z.number().optional(),
  gscKeywords: z.array(z.object({
    query: z.string(),
    clicks: z.number(),
    impressions: z.number(),
    position: z.number(),
  }).passthrough()).optional(),
  volume: z.number().optional(),
  difficulty: z.number().optional(),
  cpc: z.number().optional(),
  secondaryMetrics: z.array(z.object({
    keyword: z.string(),
    volume: z.number(),
    difficulty: z.number(),
  }).passthrough()).optional(),
  metricsSource: z.enum([
    METRICS_SOURCE.EXACT,
    METRICS_SOURCE.PARTIAL_MATCH,
    METRICS_SOURCE.BULK_LOOKUP,
    METRICS_SOURCE.AI_ESTIMATE,
  ]).optional(),
  validated: z.boolean().optional(),
  optimizationIssues: z.array(z.string()).optional(),
  recommendations: z.array(z.string()).optional(),
  contentGaps: z.array(z.string()).optional(),
  optimizationScore: z.number().optional(),
  analysisGeneratedAt: z.string().optional(),
  primaryKeywordPresence: z.object({
    inTitle: z.boolean(),
    inMeta: z.boolean(),
    inContent: z.boolean(),
    inSlug: z.boolean(),
  }).passthrough().optional(),
  longTailKeywords: z.array(z.string()).optional(),
  competitorKeywords: z.array(z.string()).optional(),
  estimatedDifficulty: z.string().optional(),
  keywordDifficulty: z.number().optional(),
  monthlyVolume: z.number().optional(),
  topicCluster: z.string().optional(),
  searchIntentConfidence: z.number().optional(),
  serpFeatures: z.array(z.string()).optional(),
}).passthrough();

// NOTE: pageMap is stored in a separate page_keywords table and stripped from this
// column before saving. It is reassembled at the route layer. Mark optional so
// parseJsonSafe does not reject the stored blob and silently return the empty fallback.
// siteKeywords / opportunities are also optional because the PATCH endpoint supports
// partial updates — a blob with only { siteKeywords, generatedAt } must round-trip
// through parseJsonSafe without being rejected.
export const keywordStrategySchema = z.object({
  siteKeywords: z.array(z.string()).optional(),
  pageMap: z.array(pageKeywordMapSchema).optional(),
  opportunities: z.array(z.string()).optional(),
  siteKeywordMetrics: z.array(z.object({
    keyword: z.string(),
    volume: z.number(),
    difficulty: z.number(),
  })).optional(),
  generatedAt: z.string().optional(),
}).passthrough();

// ── Personas ──

export const audiencePersonaSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  painPoints: z.array(z.string()),
  goals: z.array(z.string()),
  objections: z.array(z.string()),
  preferredContentFormat: z.string().optional(),
  buyingStage: z.enum(['awareness', 'consideration', 'decision']).optional(),
}).passthrough();

export const personasArraySchema = z.array(audiencePersonaSchema);

// ── Content pricing ──

export const contentPricingSchema = z.object({
  briefPrice: z.number(),
  fullPostPrice: z.number(),
  currency: z.string(),
  briefLabel: z.string().optional(),
  fullPostLabel: z.string().optional(),
  briefDescription: z.string().optional(),
  fullPostDescription: z.string().optional(),
}).passthrough();

// ── Portal contacts ──

export const portalContactSchema = z.object({
  email: z.string(),
  name: z.string().optional(),
  capturedAt: z.string(),
}).passthrough();

export const portalContactsArraySchema = z.array(portalContactSchema);

// ── Audit suppressions ──

export const auditSuppressionSchema = z.object({
  check: z.string(),
  pageSlug: z.string(),
  pagePattern: z.string().optional(),
  reason: z.string().optional(),
  createdAt: z.string(),
}).passthrough();

export const auditSuppressionsArraySchema = z.array(auditSuppressionSchema);

// ── Publish target ──

export const publishTargetSchema = z.object({
  collectionId: z.string(),
  collectionName: z.string(),
  fieldMap: z.object({
    title: z.string(),
    slug: z.string(),
    body: z.string(),
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
    summary: z.string().optional(),
    author: z.string().optional(),
    category: z.string().optional(),
    featuredImage: z.string().optional(),
    publishDate: z.string().optional(),
  }).passthrough(),
}).passthrough();

// ── Business profile ──

export const businessProfileSchema = z.object({
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z.object({
    street: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
    country: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();

// ── Intelligence profile (strategy context: industry, goals, target audience) ──

export const intelligenceProfileSchema = z.object({
  industry: z.string().optional(),
  goals: z.array(z.string()).optional(),
  targetAudience: z.string().optional(),
}).passthrough();

// ── Competitor domains (simple string array) ──

export const competitorDomainsSchema = z.array(z.string());

// ── Recommendation set (recommendation_sets table) ──

// Mirrors the Recommendation interface in shared/types/recommendations.ts.
// .passthrough() preserves any new fields added to the in-memory model that
// aren't yet captured in the schema. parseJsonSafeArray validates each
// recommendation individually so a single malformed row doesn't drop the
// entire set.
export const recommendationSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  priority: z.enum(['fix_now', 'fix_soon', 'fix_later', 'ongoing']),
  type: z.enum([
    'technical', 'content', 'content_refresh', 'schema', 'metadata',
    'performance', 'accessibility', 'strategy', 'aeo',
  ]),
  title: z.string(),
  description: z.string(),
  insight: z.string(),
  impact: z.enum(['high', 'medium', 'low']),
  effort: z.enum(['low', 'medium', 'high']),
  impactScore: z.number(),
  source: z.string(),
  affectedPages: z.array(z.string()),
  trafficAtRisk: z.number(),
  impressionsAtRisk: z.number(),
  estimatedGain: z.string(),
  actionType: z.enum(['automated', 'manual', 'content_creation', 'purchase']),
  productType: z.string().optional(),
  productPrice: z.number().optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'dismissed']),
  assignedTo: z.enum(['team', 'client']).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).passthrough();

// Mirrors RecommendationSet['summary'] in shared/types/recommendations.ts.
export const recommendationSummarySchema = z.object({
  fixNow: z.number(),
  fixSoon: z.number(),
  fixLater: z.number(),
  ongoing: z.number(),
  totalImpactScore: z.number(),
  trafficAtRisk: z.number(),
  estimatedRecoverableClicks: z.number(),
  estimatedRecoverableImpressions: z.number(),
}).passthrough();

// ── Audit snapshots (audit_snapshots table) ──

// Mirrors SeoIssue / PageSeoResult / SeoAuditResult / ActionItem from
// server/seo-audit.ts and server/audit-page.ts. Read-time schemas mark
// non-essential fields optional so historical and simplified blobs round-trip
// without being rejected (matches the lenient .partial() pattern used in
// insight-schemas.ts). category is z.string() rather than the strict
// CheckCategory enum so legacy snapshots with non-canonical categories pass.
// .passthrough() preserves unknown fields.

const seoIssueSchema = z.object({
  check: z.string(),
  severity: z.enum(['error', 'warning', 'info']),
  category: z.string().optional(),
  message: z.string().optional(),
  recommendation: z.string().optional(),
  value: z.string().optional(),
  suggestedFix: z.string().optional(),
  affectedPages: z.array(z.string()).optional(),
}).passthrough();

const pageSeoResultSchema = z.object({
  pageId: z.string(),
  url: z.string(),
  score: z.number(),
  issues: z.array(seoIssueSchema).default([]),
  page: z.string().optional(),
  slug: z.string().optional(),
  noindex: z.boolean().optional(),
  publishedPath: z.string().nullable().optional(),
}).passthrough();

const cwvMetricSummarySchema = z.object({
  value: z.number().nullable(),
  rating: z.enum(['good', 'needs-improvement', 'poor']).nullable(),
}).passthrough();

const cwvStrategyResultSchema = z.object({
  assessment: z.enum(['good', 'needs-improvement', 'poor', 'no-data']),
  fieldDataAvailable: z.boolean(),
  lighthouseScore: z.number(),
  metrics: z.object({
    LCP: cwvMetricSummarySchema,
    INP: cwvMetricSummarySchema,
    CLS: cwvMetricSummarySchema,
  }).passthrough(),
}).passthrough();

const cwvSummarySchema = z.object({
  mobile: cwvStrategyResultSchema.optional(),
  desktop: cwvStrategyResultSchema.optional(),
}).passthrough();

const deadLinkSchema = z.object({
  url: z.string(),
  status: z.union([z.number(), z.literal('timeout'), z.literal('error')]),
  statusText: z.string(),
  foundOn: z.string(),
  foundOnSlug: z.string(),
  anchorText: z.string(),
  type: z.enum(['internal', 'external']),
}).passthrough();

// .catch([]) on the nested arrays: if a single page / issue / dead link fails
// validation we drop just that array (down to []) instead of rejecting the
// whole audit and falling back to EMPTY_AUDIT (which would zero out
// siteScore + all counters). This preserves partial data for callers that
// only need top-level scores, matching the resilience semantics of the
// per-item parseJsonSafeArray used at the top-level columns.
export const seoAuditResultSchema = z.object({
  siteScore: z.number(),
  totalPages: z.number(),
  errors: z.number(),
  warnings: z.number(),
  infos: z.number().optional().default(0),
  pages: z.array(pageSeoResultSchema).catch([]),
  siteWideIssues: z.array(seoIssueSchema).catch([]),
  cwvSummary: cwvSummarySchema.optional(),
  deadLinkSummary: z.object({
    total: z.number(),
    internal: z.number(),
    external: z.number(),
    redirects: z.number(),
  }).passthrough().optional(),
  deadLinkDetails: z.array(deadLinkSchema).optional().catch(undefined),
}).passthrough();

export const actionItemSchema = z.object({
  id: z.string(),
  snapshotId: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.enum(['planned', 'in-progress', 'completed']),
  priority: z.enum(['high', 'medium', 'low']),
  category: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).passthrough();
