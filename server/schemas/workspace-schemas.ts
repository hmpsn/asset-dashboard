/**
 * Zod schemas for workspace JSON columns.
 * Uses .passthrough() on all object schemas for forward compatibility.
 */
import { z } from 'zod';
import { METRICS_SOURCE } from '../../shared/types/keywords.js';
import {
  EEAT_ASSET_TYPE,
  EEAT_RECOMMENDATION_SURFACE,
  TRUST_SIGNAL_SEVERITY,
} from '../../shared/types/eeat-assets.js';

// ── Event config ──

export const eventDisplayConfigSchema = z.object({
  eventName: z.string(),
  displayName: z.string(),
  pinned: z.boolean(),
  group: z.string().optional(),
  // P1a: which website action this pinned event measures. Optional + additive → flag-OFF
  // byte-identical; existing pinned events with no outcomeType aggregate as 'other'.
  outcomeType: z.enum(['form_fill', 'call', 'booking', 'email', 'directions', 'chat', 'other']).optional(),
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
    METRICS_SOURCE.URL_LEVEL,
    METRICS_SOURCE.PARTIAL_MATCH,
    METRICS_SOURCE.BULK_LOOKUP,
    METRICS_SOURCE.AI_ESTIMATE,
  ]).optional(),
  urlLevelKeywords: z.array(z.object({
    keyword: z.string(),
    position: z.number(),
    volume: z.number(),
    difficulty: z.number(),
    cpc: z.number(),
    traffic: z.number().optional(),
    url: z.string().optional(),
  }).passthrough()).optional(),
  urlLevelKeywordSource: z.enum(['semrush', 'dataforseo']).optional(),
  optimizationScoreHistory: z.array(z.object({
    score: z.number(),
    recordedAt: z.string(),
    source: z.enum(['page-analysis', 'bulk-analysis', 'strategy', 'unknown']),
  }).passthrough()).optional(),
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
  missingTrustSignals: z.array(z.object({
    signal: z.string(),
    rationale: z.string(),
    severity: z.enum([
      TRUST_SIGNAL_SEVERITY.HIGH,
      TRUST_SIGNAL_SEVERITY.MEDIUM,
      TRUST_SIGNAL_SEVERITY.LOW,
    ]),
    recommendedAssetTypes: z.array(z.enum([
      EEAT_ASSET_TYPE.TESTIMONIAL,
      EEAT_ASSET_TYPE.CASE_STUDY,
      EEAT_ASSET_TYPE.CREDENTIAL,
      EEAT_ASSET_TYPE.BEFORE_AFTER_GALLERY,
      EEAT_ASSET_TYPE.TEAM_BIO,
      EEAT_ASSET_TYPE.AWARD,
      EEAT_ASSET_TYPE.RESEARCH,
      EEAT_ASSET_TYPE.CLIENT_LOGO,
    ])),
  }).passthrough()).optional(),
  eeatAssetRecommendations: z.array(z.object({
    assetId: z.string(),
    type: z.enum([
      EEAT_ASSET_TYPE.TESTIMONIAL,
      EEAT_ASSET_TYPE.CASE_STUDY,
      EEAT_ASSET_TYPE.CREDENTIAL,
      EEAT_ASSET_TYPE.BEFORE_AFTER_GALLERY,
      EEAT_ASSET_TYPE.TEAM_BIO,
      EEAT_ASSET_TYPE.AWARD,
      EEAT_ASSET_TYPE.RESEARCH,
      EEAT_ASSET_TYPE.CLIENT_LOGO,
    ]),
    title: z.string(),
    reason: z.string(),
    surface: z.enum([
      EEAT_RECOMMENDATION_SURFACE.CONTENT_BRIEF,
      EEAT_RECOMMENDATION_SURFACE.PAGE_INTELLIGENCE,
      EEAT_RECOMMENDATION_SURFACE.SCHEMA,
    ]),
    url: z.string().optional(),
  }).passthrough()).optional(),
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
  // Strategy v3 §12b — typed parallel to `opportunities`; optional so legacy/sparse blobs still parse,
  // and so parseJsonSafe preserves it once the curated keyword-opportunity path (P5 #6b) writes it.
  opportunitiesDetailed: z.array(z.object({
    keyword: z.string(),
    volume: z.number().optional(),
    difficulty: z.number().optional(),
    rationale: z.string().optional(),
  })).optional(),
  siteKeywordMetrics: z.array(z.object({
    keyword: z.string(),
    volume: z.number(),
    difficulty: z.number(),
  })).optional(),
  generatedAt: z.string().optional(),
  maxPages: z.number().optional(),
  seoDataStatus: z.object({
    mode: z.enum(['quick', 'full', 'none']),
    provider: z.string().optional(),
    status: z.enum(['disabled', 'available', 'degraded']),
    reasons: z.array(z.string()).optional(),
    fallbackProviderAvailable: z.boolean().optional(),
  }).passthrough().optional(),
}).passthrough();

// strategy_history.strategy_json (migration 030, FK-rebuilt in 119) stores the
// FULL prior KeywordStrategy blob spread with the five table-backed arrays that
// the live blob strips (contentGaps/quickWins/keywordGaps/topicClusters/
// cannibalization — see keyword-strategy-persistence.ts history INSERT). The
// stored shape can be a SPARSE patch-built blob, so — like keywordStrategySchema
// — EVERY field is .optional() and the object is .passthrough(); a too-strict
// schema would silently return the fallback and break /diff + the refresh
// summary (Schema-vs-stored-shape rule). Consumers only read siteKeywords +
// contentGaps[].targetKeyword, but we keep the arrays passthrough so unrelated
// item fields survive validation.
export const strategyHistoryStrategySchema = keywordStrategySchema.extend({
  contentGaps: z.array(z.object({
    targetKeyword: z.string().optional(),
  }).passthrough()).optional(),
  quickWins: z.array(z.object({}).passthrough()).optional(),
  keywordGaps: z.array(z.object({}).passthrough()).optional(),
  topicClusters: z.array(z.object({}).passthrough()).optional(),
  cannibalization: z.array(z.object({}).passthrough()).optional(),
}).passthrough();

export type StrategyHistoryStrategy = z.infer<typeof strategyHistoryStrategySchema>;

// strategy_history.page_map_json stores the prior page_keywords snapshot. In
// practice this is full PageKeywordMap rows (from listPageKeywords), but legacy /
// manually-seeded history rows can be MINIMAL ({ pagePath, primaryKeyword } only)
// — and both consumers (/diff + refresh summary) read only those two fields. Per
// the Schema-vs-stored-shape rule the schema must reflect what is stored, not the
// richest in-memory shape: a too-strict reuse of pageKeywordMapSchema (which
// requires pageTitle + secondaryKeywords) would drop minimal rows and silently
// break the page-map diff. So only the two consumed fields are required; the rest
// passes through. parseJsonSafeArray validates each item individually so one
// malformed row does not drop the whole snapshot.
export const strategyHistoryPageMapSchema = z.object({
  pagePath: z.string(),
  primaryKeyword: z.string(),
}).passthrough();

// Prior-snapshot page shape needed to recompute Orient-zone metrics (visibility
// score + clicks/impressions/position deltas). page_map_json stores the full
// PageKeywordMap, so these fields are present; this schema types the subset we read.
export const strategyHistoryOrientPageSchema = z.object({
  currentPosition: z.number().optional(),
  volume: z.number().optional(),
  clicks: z.number().optional(),
  impressions: z.number().optional(),
  gscKeywords: z.array(z.object({
    query: z.string(),
    clicks: z.number(),
    impressions: z.number(),
    position: z.number(),
  })).optional(),
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
// Mirrors OpportunityScore / OpportunityComponent in
// shared/types/recommendations.ts. Validated at the read boundary so a corrupt
// opportunity blob is caught rather than silently passed through .passthrough().
export const opportunityComponentSchema = z.object({
  dimension: z.enum(['demand', 'winnability', 'intent', 'effort', 'businessFit', 'timing', 'evidence']),
  rawValue: z.union([z.number(), z.string()]).nullable(),
  normalized: z.number(),
  weight: z.number(),
  contribution: z.number(),
  evidence: z.string(),
});

export const opportunityScoreSchema = z.object({
  value: z.number(),
  emvPerWeek: z.number(),
  // P4 CPC-proxy placeholder. CLOSED schema (no .passthrough()) → without this line the
  // field is stripped on every rec-set reload, so calibration-snapshot survival would
  // depend on a value that never round-trips. Admin/AI-only (stripped on public routes).
  // `.default(0)` (NOT bare `.optional()`): every PRE-P4 stored `opportunity` blob has no
  // `predictedEmv` key. Because `recommendationSchema.opportunity` is
  // `opportunityScoreSchema.optional().catch(undefined)`, a REQUIRED `predictedEmv` would
  // fail validation and drop the WHOLE legacy `opportunity` object on read — degrading the
  // client OV breakdown, the PATCH calibration snapshot, and the OV-divergence canary until
  // regen. `.default(0)` lets a legacy blob round-trip (predictedEmv → 0) with the rest of
  // `opportunity` intact, while keeping the in-memory type `predictedEmv: number` (a bare
  // `.optional()` would make it `number | undefined` and break the OpportunityScore type).
  predictedEmv: z.number().default(0),
  roiPerEffortDay: z.number(),
  confidence: z.number(),
  calibration: z.number(),
  groundedSpine: z.enum(['roiScore', 'opportunityScore', 'computed']),
  components: z.array(opportunityComponentSchema),
  calibrationVersion: z.string(),
  modelVersion: z.string(),
});

export const recommendationSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  priority: z.enum(['fix_now', 'fix_soon', 'fix_later', 'ongoing']),
  type: z.enum([
    'technical', 'content', 'content_refresh', 'schema', 'metadata',
    'performance', 'accessibility', 'strategy', 'aeo',
    // SEO Gen-Quality P5 — first-class orphan-subsystem rec types. MUST stay in lockstep
    // with RecType (shared/types/recommendations.ts): a new RecType absent from this enum
    // fails validation and is silently DROPPED on every reload (Schema vs stored shape rule).
    'keyword_gap', 'topic_cluster', 'cannibalization',
    // SEO Gen-Quality P7.1 — first-class local-visibility rec types. Same lockstep rule:
    // omitting either of these drops every local rec on the next reload (P5's hard-won lesson).
    'local_visibility', 'local_service_gap',
    // P4 Lane C — competitor gap send. Same lockstep rule: absent here → every competitor
    // rec silently dropped on reload (Schema vs stored shape rule, CLAUDE.md).
    'competitor',
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
  // D2 (audit #11): content-gap recs carry their target keyword for publish-time
  // resolution matching. Optional — absent on legacy rows and non-content recs.
  targetKeyword: z.string().optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'dismissed']),
  assignedTo: z.enum(['team', 'client']).optional(),
  // ── Strategy v3 lifecycle axes (lockstep with Recommendation in shared/types/recommendations.ts).
  // All .optional(): every PRE-v3 stored blob lacks these keys, so a REQUIRED field would drop the
  // whole rec on read (the "Schema vs stored shape" rule). Explicit (not passthrough-only) so a
  // mistyped write — e.g. clientStatus:'snet' — is caught at the read boundary, not silently kept.
  clientStatus: z.enum(['system', 'curated', 'sent', 'approved', 'declined', 'discussing']).optional(),
  lifecycle: z.enum(['active', 'throttled', 'struck']).optional(),
  throttledUntil: z.string().optional(),
  sentAt: z.string().optional(),
  autoSent: z.boolean().optional(),
  struckAt: z.string().optional(),
  cascade: z.object({
    removedKeywords: z.array(z.string()).optional(),
    removedClusters: z.array(z.string()).optional(),
    reversible: z.boolean(),
  }).optional(),
  sendChannel: z.enum(['deliverable', 'rec']).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // Unified Opportunity Value breakdown (PR1). Optional on legacy rows; a malformed
  // opportunity degrades to undefined (rec survives) rather than dropping the whole rec.
  opportunity: opportunityScoreSchema.optional().catch(undefined),
}).passthrough();

// Mirrors RecommendationSet['summary'] in shared/types/recommendations.ts.
// topRecommendationId is optional in the schema so that summaries persisted
// before Task 3.3 (which lacked the field) still parse without falling back to
// the empty default. Callers should treat undefined as null (no active rec).
export const recommendationSummarySchema = z.object({
  fixNow: z.number(),
  fixSoon: z.number(),
  fixLater: z.number(),
  ongoing: z.number(),
  totalImpactScore: z.number(),
  trafficAtRisk: z.number(),
  totalOpportunityValue: z.number().optional(),
  actionableOpportunityValue: z.number().optional(),
  topOpportunityValue: z.number().optional(),
  // Legacy persisted rows may still carry the pre-OV aggregate recovery fields.
  estimatedRecoverableClicks: z.number().optional(),
  estimatedRecoverableImpressions: z.number().optional(),
  topRecommendationId: z.string().nullable().optional(),
  // One-line rendered rationale for the #1 (from its opportunity.components, PR6).
  topOpportunityRationale: z.string().optional(),
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

// ── The Issue (Client) — outcome value + segment config (P0) ──────

/** Per-workspace converted-outcome value powering the dollar verdict. */
export const outcomeValueSchema = z.object({
  valuePerOutcome: z.number().nonnegative(),
  unitLabel: z.string().min(1),
  currency: z.string().min(1),
  basis: z.enum(['client_provided', 'agency_estimate', 'ai_enriched']),
  monthlyRetainer: z.number().nonnegative().optional(),
}).passthrough();

/** Admin-confirmed segment classification override (non-local 3-way). */
export const segmentConfigSchema = z.object({
  segment: z.enum(['local_smb', 'b2b_saas', 'board_vc', 'professional_services', 'multi_location']),
  outcomeNounSingular: z.string().optional(),
  outcomeNounPlural: z.string().optional(),
  reportingAudience: z.enum(['self', 'board', 'partners', 'owners']).optional(),
}).passthrough();

// SEO Decision Engine P4 — workspace SERP target geo. Required fields (locationCode +
// languageCode) MUST match what BusinessFootprintTab writes, or parseJsonSafe returns
// the null fallback and the override silently vanishes (CLAUDE.md "Schema vs stored shape").
export const targetGeoSchema = z.object({
  locationCode: z.number(),
  languageCode: z.string().min(1),
  countryCode: z.string().optional(),
  label: z.string().optional(),
}).passthrough();

// ── The Issue (Client) — Webflow form-source mapping (P1a) ────────

/** Per-workspace mapping of a Webflow form to a typed outcome. Stored in the webflow_form_sources
 *  JSON column; parsed item-by-item via parseJsonSafeArray so one bad mapping doesn't drop the rest. */
export const webflowFormMappingSchema = z.object({
  formId: z.string(),
  formName: z.string(),
  outcomeType: z.enum(['form_fill', 'call', 'booking', 'email', 'directions', 'chat', 'other']),
}).passthrough();
