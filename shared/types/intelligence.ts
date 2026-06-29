// shared/types/intelligence.ts
// Unified Workspace Intelligence Layer — shared types for server and frontend.
// Spec: docs/superpowers/specs/unified-workspace-intelligence.md §3, §11

import type { AnalyticsInsight, InsightType, InsightSeverity } from './analytics.js';
import type { DiagnosticStatus } from './diagnostics.js';
import type { KeywordStrategy, AudiencePersona, PageKeywordMap, QuickWin, CannibalizationItem, KeywordGapItem, TopicCluster } from './workspace.js';
import type { OpportunityComponent } from './recommendations.js';
import type { BriefingSummary } from './briefing.js';
import type { PageElementCatalog } from './page-elements.js';
import type { SiteInventorySlice } from './site-inventory.js';
import type { EntityResolutionSlice } from './entity-resolution.js';
import type { EeatAsset, EeatAssetType } from './eeat-assets.js';
import type { StoredGenerationQuality } from './generation-quality.js';
import type {
  TrackedAction,
  ActionOutcome,
  WorkspaceLearnings,
  ActionPlaybook,
  LearningsConfidence,
  LearningsTrend,
  TopWin,
} from './outcome-tracking.js';

// ── Slice selection ─────────────────────────────────────────────────────

export const INTELLIGENCE_SLICES = [
  'seoContext',
  'insights',
  'learnings',
  'pageProfile',
  'contentPipeline',
  'siteHealth',
  'clientSignals',
  'operational',
  'pageElements',
  'siteInventory',
  'localSeo',
  'entityResolution',
  'eeatAssets',
  'generationQuality',
] as const;

export type IntelligenceSlice = typeof INTELLIGENCE_SLICES[number];

export const OPTION_SCOPED_INTELLIGENCE_SLICES = [
  'pageProfile',
  'pageElements',
  'siteInventory',
] as const satisfies readonly IntelligenceSlice[];

export const PROMPT_FORMATTABLE_INTELLIGENCE_SLICES = [
  'seoContext',
  'insights',
  'learnings',
  'pageProfile',
  'contentPipeline',
  'siteHealth',
  'clientSignals',
  'operational',
  'pageElements',
  'localSeo',
  'eeatAssets',
] as const satisfies readonly IntelligenceSlice[];

export function isIntelligenceSlice(value: string): value is IntelligenceSlice {
  return (INTELLIGENCE_SLICES as readonly string[]).includes(value);
}

export function isPromptFormattableIntelligenceSlice(value: string): value is typeof PROMPT_FORMATTABLE_INTELLIGENCE_SLICES[number] {
  return (PROMPT_FORMATTABLE_INTELLIGENCE_SLICES as readonly string[]).includes(value);
}

// ── Options ─────────────────────────────────────────────────────────────

export interface IntelligenceOptions {
  /** Which slices to include (default: all available) */
  slices?: readonly IntelligenceSlice[];
  /** Page-specific context (triggers per-page enrichment) */
  pagePath?: string;
  /** Domain filter for learnings */
  learningsDomain?: 'content' | 'strategy' | 'technical' | 'all';
  /** Token budget hint for downstream prompt formatting */
  tokenBudget?: number;
  /** Optional Webflow site id for siteInventory assembly. */
  siteId?: string;
  /** Optional resolved live base URL for siteInventory assembly. */
  siteBaseUrl?: string;
  /** Optional Webflow token for live CMS inventory assembly. */
  webflowToken?: string;
  /**
   * Opt-in: fetch backlink profile from the configured SEO data provider.
   * OFF by default — the provider call adds network latency and costs credits.
   * Only enable for callers that actually surface backlink data (e.g. admin AI chat).
   */
  enrichWithBacklinks?: boolean;
  /**
   * Opt-in: run live Wikidata/SPARQL disambiguation for entityResolution candidates.
   * OFF by default to avoid external lookup latency for callers that only need
   * deterministic candidate extraction.
   */
  resolveEntityReferences?: boolean;
}

// ── Core return type ────────────────────────────────────────────────────

export interface WorkspaceIntelligence {
  version: 1;
  workspaceId: string;
  assembledAt: string; // ISO timestamp — consumers know data freshness

  seoContext?: SeoContextSlice;
  insights?: InsightsSlice;
  learnings?: LearningsSlice;
  pageProfile?: PageProfileSlice;
  /** Per-page structural element catalog (videos, HowTo lists, citations, etc.).
   *  Populated when buildWorkspaceIntelligence is called with opts.pagePath. */
  pageElements?: PageElementSlice;
  /** Site/page/CMS inventory for collection-aware schema generation. */
  siteInventory?: SiteInventorySlice;
  contentPipeline?: ContentPipelineSlice;
  siteHealth?: SiteHealthSlice;
  clientSignals?: ClientSignalsSlice;
  operational?: OperationalSlice;
  /** Local SEO posture, markets, full candidate list, and pre-formatted prompt block. */
  localSeo?: LocalSeoSlice;
  /** Entity grounding for schema surfaces (Thing/Place + Wikidata disambiguation).
   *  Always undefined until the EntityResolutionSlice assembler phase ships. */
  entityResolution?: EntityResolutionSlice;
  /** Workspace-scoped E-E-A-T trust-signal inventory. */
  eeatAssets?: EeatAssetsSlice;
  /** Latest internal generation-quality telemetry for workspace-scoped AI generation health. */
  generationQuality?: GenerationQualitySlice;
}

// ── Slice interfaces ────────────────────────────────────────────────────

export interface SeoContextSlice {
  strategy: KeywordStrategy | undefined;
  /** Raw legacy `workspace.brandVoice` text — no headers, no voice-profile authority.
   *  This is the pre-authority source field; DO NOT inject it directly into AI prompts.
   *  Prompt callers MUST use `effectiveBrandVoiceBlock` instead — it honors the voice
   *  profile authority rule (calibrated profile → DNA/samples/guardrails, else legacy).
   *  This raw field remains for callers that need the pre-authority text (diagnostics,
   *  UI editing, shadow-mode parity checks). */
  brandVoice: string;
  /**
   *  Pre-formatted prompt block with voice-authority applied. Inject DIRECTLY into prompts
   *  — it already carries the emphatic BRAND VOICE header when non-empty. Source of
   *  truth: buildEffectiveBrandVoiceBlock(workspaceId) in the SEO context source.
   *
   *  Authority rule:
   *    - profile.status === 'calibrated' → voice profile block (Layer 2 system prompt covers DNA)
   *    - profile has saved DNA/guardrails and rendered profile content → voice profile block
   *    - otherwise → legacy workspace.brandVoice + brand-docs block
   *
   *  Empty string means "no brand voice configured" — render nothing.
   */
  effectiveBrandVoiceBlock: string;
  businessContext: string;
  personas: AudiencePersona[];
  /** Raw text — no headers. Use formatKnowledgeBaseForPrompt() before injecting into prompts.
   *  formatSeoContextSection renders this with a KNOWLEDGE BASE header automatically. */
  knowledgeBase: string;
  pageKeywords?: PageKeywordMap;
  // New in 3A
  businessProfile?: BusinessProfile;
  backlinkProfile?: BacklinkProfile;
  serpFeatures?: SerpFeatures;
  rankTracking?: RankTrackingSummary;
  discoveredQuerySummary?: DiscoveredQuerySummary;
  geoVolumeLabel?: string;
  strategyHistory?: StrategyHistory;
  /**
   * Latest competitor snapshots from competitor_snapshots table (migration 070).
   * One entry per tracked competitor domain with current keyword count and organic
   * traffic. Optional — only present when competitor domains are configured and
   * at least one snapshot exists. Advisor uses this to flag competitive gaps.
   */
  competitorSnapshots?: Array<{
    competitorDomain: string;
    snapshotDate: string;
    keywordCount: number | null;
    organicTraffic: number | null;
    topKeywords: Array<{ keyword: string; position: number; volume: number }>;
  }>;
  /**
   * Low-effort, high-impact keyword fixes from the quick_wins table (SI1).
   * Carries `roiScore` so the advisor can recite grounded prioritization.
   * Optional — only present when at least one quick win exists. Read by
   * assembleSeoContext via listQuickWins(). Strategy-level (not per-page).
   */
  quickWins?: QuickWin[];
  /**
   * Keyword cannibalization issues from the cannibalization_issues table (SI4).
   * Optional — only present when at least one issue exists. Read by
   * assembleSeoContext via listCannibalizationIssues().
   */
  cannibalizationIssues?: CannibalizationItem[];
  /**
   * Keyword gaps from the keyword_gaps table (SEO Gen-Quality P5) — keywords
   * competitors rank for that the workspace does not. Optional — only present when
   * at least one gap exists. Read by assembleSeoContext via listKeywordGaps().
   */
  keywordGaps?: KeywordGapItem[];
  /**
   * Topic clusters from the topic_clusters table (SEO Gen-Quality P5) — topical
   * authority coverage per cluster. Optional — only present when at least one
   * cluster exists. Read by assembleSeoContext via listTopicClusters().
   */
  topicClusters?: TopicCluster[];
  /**
   * The resolved #1 recommendation's Opportunity Value breakdown (SI2/MW6),
   * so the advisor recites the same explainable "why this is #1" the client sees.
   *
   * `emvPerWeek` is ADMIN/AI-ONLY (owner decision) — it is carried here for the
   * admin advisor prompt (formatSeoContextSection) but MUST be stripped on every
   * client-facing serialization. The formatter injects `components` evidence
   * directly per the authority-layered fields rule (no format helper).
   *
   * Optional — undefined when no active recs exist or the rec carries no
   * opportunity (legacy sets). Populated from loadRecommendations() +
   * summary.topRecommendationId.
   */
  topOpportunity?: {
    recommendationId: string;
    value: number;
    /** Admin/AI-only — never serialize to a client surface. */
    emvPerWeek: number;
    components: OpportunityComponent[];
  };
  /** SEO Decision Engine P8 (AI-visibility / LLM citation) — aggregates-only AI-visibility
   *  summary from the latest `chat_gpt` LLM-mention snapshot. AGGREGATES ONLY — never raw
   *  LLM transcripts. Undefined when the `ai-visibility` flag is off for the workspace OR
   *  there is no snapshot yet (so flag-off / no-data = no change). All numerics are absent
   *  rather than 0 when the underlying snapshot column is NULL (never invented). */
  aiVisibility?: {
    /** Times the client domain was cited in LLM answers; undefined when not measured. */
    mentions?: number;
    /** Share of voice vs co-mentioned brands, 0..1; undefined when not measured. */
    shareOfVoice?: number;
    /** Most-cited co-mentioned competitor brand (max by mentions). */
    topCompetitor?: { name: string; mentions: number };
    /** Most-cited source domain feeding LLM answers (max by mentions) — the AEO target. */
    topSourceDomain?: { domain: string; mentions: number };
  };
}

export interface InsightsSlice {
  /** Top 100 by impactScore — the prompt-facing bound. Full-iteration consumers read this. */
  all: AnalyticsInsight[];
  /**
   * Top 25 per type ordered by impactScore desc (G3 cap — prompt-size guard).
   * NEVER compute counts or totals from these lists: use `countsByType` instead.
   */
  byType: Partial<Record<InsightType, AnalyticsInsight[]>>;
  /**
   * Full PRE-cap insight counts per type, computed from the complete workspace set
   * before the `byType` 25-per-type cap is applied. The authoritative source for
   * any "how many insights of type X" read.
   */
  countsByType: Partial<Record<InsightType, number>>;
  /**
   * Full PRE-cap type×severity count matrix (same complete-set basis as
   * `countsByType`). For consumers that need jointly-filtered totals — e.g. the
   * client portal summary excludes admin-only types AND positive severity, which
   * neither `countsByType` nor `bySeverity` alone can express.
   */
  countsByTypeBySeverity: Partial<Record<InsightType, Record<InsightSeverity, number>>>;
  /** Full PRE-cap severity counts, computed from the complete workspace set. */
  bySeverity: Record<InsightSeverity, number>;
  topByImpact: AnalyticsInsight[];
  forPage?: AnalyticsInsight[];
}

/**
 * A6 (audit #22): one anonymized cross-workspace win-rate prior, aggregated across
 * ALL workspaces on the platform for a single action type. Published only above the
 * cohort + sample floors (see server/platform-learnings-priors.ts) so a single
 * workspace's history can never be reverse-identified from it.
 *
 * HONESTY CONTRACT: this is a PLATFORM benchmark, never the workspace's own result.
 * Any surface that renders it MUST label it as cross-workspace ("across all clients
 * on the platform"), never as "your" win rate. Consumed only as the no_data/degraded
 * FALLBACK tier — a workspace with `availability: 'ready'` keeps its own learnings.
 */
export interface PlatformPriorEntry {
  actionType: string;
  /** Win rate (0..1) across all contributing workspaces for this action type. */
  winRate: number;
  /** Distinct workspaces that contributed scored outcomes (>= cohort floor). */
  contributingWorkspaces: number;
  /** Total scored actions behind the rate (>= sample floor). */
  scoredActions: number;
}

export interface LearningsSlice {
  availability: 'ready' | 'disabled' | 'no_data' | 'degraded';
  summary: WorkspaceLearnings | null;
  confidence: LearningsConfidence | null;
  /** Top action types by win rate — from summary.overall.topActionTypes */
  topActionTypes: Array<{ type: string; winRate: number; count: number }>;
  overallWinRate: number;
  recentTrend: LearningsTrend | null;
  playbooks: ActionPlaybook[];
  forPage?: {
    actions: TrackedAction[];
    outcomes: ActionOutcome[];
    hasActiveAction: boolean;
  };
  // New in 3A
  topWins?: TopWin[];
  winRateByActionType?: Record<string, number>;
  /**
   * A6 (audit #22): anonymized cross-workspace win-rate priors, populated by the
   * assembler ONLY when this workspace's own `availability` is `no_data` or
   * `degraded` (the fallback tier). Absent/undefined when availability is `ready`
   * (own learnings win) or `disabled`. Each entry is a labeled platform benchmark —
   * never present these as the workspace's own results. See PlatformPriorEntry.
   */
  platformPriors?: PlatformPriorEntry[];
  roiAttribution?: ROIAttribution[];
  weCalledIt?: WeCalledItEntry[];
  scoringConfig?: Partial<Record<string, {
    primary_metric: string;
    thresholds: { strong_win: number; win: number; neutral_band: number };
  }>>;
}

export interface PageProfileSlice {
  pagePath: string;
  primaryKeyword: string | null;
  searchIntent: string | null;
  optimizationScore: number | null;
  /** Platform-wide action recommendations filtered to this page (from recommendation store). */
  recommendations: string[];
  /** Per-page content gap topics from AI keyword analysis (getPageKeyword). */
  contentGaps: string[];
  insights: AnalyticsInsight[];
  actions: TrackedAction[];
  /** Structural SEO issues from Webflow audit snapshot (missing tags, OG issues, etc.). */
  auditIssues: string[];
  /** Keyword optimization issues from AI per-page keyword analysis. Distinct from auditIssues. */
  optimizationIssues: string[];
  /** Whether the primary keyword appears in key placement locations (from AI keyword analysis). */
  primaryKeywordPresence: { inTitle: boolean; inMeta: boolean; inContent: boolean; inSlug: boolean } | null;
  competitorKeywords: string[];
  topicCluster: string | null;
  estimatedDifficulty: string | null;
  schemaStatus: 'valid' | 'warnings' | 'errors' | 'none';
  linkHealth: { inbound: number; outbound: number; orphan: boolean };
  seoEdits: { currentTitle: string; currentMeta: string; lastEditedAt: string | null };
  /** Note: page_keywords stores current_position + previous_position only — not full history.
   *  'best' is derived from current/previous; trend from delta. Not a deep historical series. */
  rankHistory: { current: number | null; best: number | null; trend: 'up' | 'down' | 'stable' };
  contentStatus: 'has_brief' | 'has_post' | 'published' | 'decay_detected' | null;
  cwvStatus: 'good' | 'needs_improvement' | 'poor' | null;
}

export interface ContentPipelineSlice {
  briefs: { total: number; byStatus: Record<string, number> };
  posts: { total: number; byStatus: Record<string, number> };
  matrices: { total: number; cellsPlanned: number; cellsPublished: number };
  requests: { pending: number; inProgress: number; delivered: number };
  workOrders: { active: number; pending?: number };
  coverageGaps: string[];
  seoEdits: { pending: number; applied: number; inReview: number };
  // New in 3A
  subscriptions?: { active: number; totalPages: number };
  schemaDeployment?: { planned: number; deployed: number; types: string[] };
  rewritePlaybook?: { patterns: string[]; lastUsedAt: string | null };
  cannibalizationWarnings?: CannibalizationWarning[];
  decayAlerts?: DecayAlert[];
  suggestedBriefs?: number;
  copyPipeline?: CopyPipelineSummary;
  /**
   * D2 (audit #11): comparison-keyed (`keywordComparisonKey` from
   * shared/keyword-normalization.ts — already normalized, do NOT re-normalize for
   * comparison; apply the same function to the candidate keyword) target keywords of
   * briefs + non-error posts currently in the pipeline. Consumed by the recommendation
   * engine to suppress content-gap recs the pipeline is already producing. Optional —
   * degrades to absent/[] when the content stores are unavailable (suppression fails
   * open: recs are minted, never falsely resolved).
   */
  inFlightTargetKeywords?: string[];
  contentPricing?: {
    briefPrice: number;
    fullPostPrice: number;
    currency: string;
    briefLabel?: string;
    fullPostLabel?: string;
  };
}

export interface SiteHealthSlice {
  auditScore: number | null;
  auditScoreDelta: number | null;
  deadLinks: number;
  redirectChains: number;
  schemaErrors: number;
  orphanPages: number;
  cwvPassRate: { mobile: number | null; desktop: number | null };
  // New in 3A
  redirectDetails?: RedirectDetail[];
  aeoReadiness?: AeoReadiness;
  schemaValidation?: SchemaValidationSummary;
  performanceSummary?: PerformanceSummary | null;
  anomalyCount?: number;
  anomalyTypes?: string[];
  seoChangeVelocity?: number;
  /** Recent diagnostic reports (last 5, most recent first). Populated by assembleSiteHealth. */
  recentDiagnostics?: Array<{
    insightId: string | null;
    anomalyType: string;
    status: DiagnosticStatus;
    affectedPages: string[];
    completedAt: string | null;
    /** Root cause titles from completed reports — the AI-synthesized findings. */
    rootCauseTitles?: string[];
  }>;
  /**
   * Weekly metric trend from workspace_metrics_snapshots (migration 080).
   * Surfaces the most recent week's values plus the overall snapshot count so
   * the advisor can ground statements in the latest measured week. Optional —
   * only present when at least one snapshot exists. (The "best week since X"
   * anchor phrasing used in briefings is computed separately by
   * workspace-metrics-snapshots.ts:findBestWeekSince — it is NOT a field here.)
   */
  weeklyMetricsTrend?: {
    /** Most recent snapshot (newest first). */
    latestWeek: {
      snapshotDate: string;
      totalClicks: number | null;
      totalImpressions: number | null;
      avgPosition: number | null;
      auditScore: number | null;
      organicTrafficValue: number | null;
    };
    /** Total number of snapshots in the retention window (up to 90 days). */
    snapshotCount: number;
  };
}

export interface ClientSignalsSlice {
  keywordFeedback: { approved: string[]; rejected: string[]; patterns: { approveRate: number; topRejectionReasons: string[] } };
  contentGapVotes: { topic: string; votes: number }[];
  /**
   * RAW client-entered priorities only (client_business_priorities table, migration 021).
   * Read-only legacy field. Prompt/ranking callers MUST use `effectiveBusinessPriorities`
   * below, which is the single authority-resolved representation (client store + admin
   * store reconciled with precedence). There is intentionally no helper that re-formats
   * this raw field — any such helper would bypass the admin-store merge and silently
   * drop admin-set goals. See CLAUDE.md "Authority-layered fields".
   */
  businessPriorities: string[];
  /**
   * Pre-resolved, authority-layered business priorities. Source of truth:
   * `buildEffectiveBusinessPriorities()` (business-priorities-source.ts), which merges the
   * CLIENT store (client_business_priorities, 021) and the ADMIN store
   * (workspaces.business_priorities, 048) into one de-duplicated list with documented
   * precedence: client-entered priorities first, admin-set priorities as a supplement.
   * Intelligence-path callers (ranking, prompts) inject this DIRECTLY.
   */
  effectiveBusinessPriorities: string[];
  approvalPatterns: { approvalRate: number; avgResponseTime: number | null };
  recentChatTopics: string[];
  churnRisk: 'low' | 'medium' | 'high' | null;
  // New in 3A
  churnSignals?: ChurnSignalSummary[];
  roi?: { organicValue: number; growth: number; period: string } | null;
  engagement?: EngagementMetrics;
  compositeHealthScore?: number | null;
  /** Client-safe explanation of the weighted composite health score. No raw churn risk or internal diagnostics. */
  compositeHealthBreakdown?: ClientCompositeHealthBreakdown | null;
  serviceRequests?: { pending: number; total: number };
  /** Intent signals detected in client chat (service_interest / content_interest) */
  intentSignals?: {
    /** Count of unactioned (status = 'new') signals */
    newCount: number;
    /** Total signals created (all statuses) */
    totalCount: number;
    /** Signal types seen recently, most recent first (max 5) */
    recentTypes: Array<'service_interest' | 'content_interest'>;
  };
  /**
   * The most recent published briefing for the workspace, or null if none.
   * Populated by `assembleClientSignals` from `getLatestPublishedBriefing()`.
   * Always undefined until the assembler reads it (post-Phase 2 only).
   */
  latestBriefing?: BriefingSummary | null;
  clientActions?: {
    pending: number;
    approved: number;
    changesRequested: number;
    completed: number;
    recentDecisions: Array<{ title: string; status: string; sourceType: string; updatedAt: string }>;
  };
  /**
   * Strategy v3 (spec §7.5, data-flow rule #6) — the client's responses to SENT curated recs.
   * The outcome write alone is not enough for AdminChat/strategy to "see the loop" — this slice
   * field surfaces it. Counts derive from Recommendation.clientStatus across the rec set; the
   * outcome (approve→TrackedAction, decline→advisory learning) is recorded separately.
   * Populated by `assembleClientSignals` (P3 writes); read by the curated overview context (P4).
   * Field declared here in Phase 1 Lane 1A — Track B (P3 writes) and Track C (P4 reads) both
   * touch this file, so the shape is frozen before either dispatches.
   */
  recResponses?: {
    approved: number;
    declined: number;
    discussing: number;
    recentResponses: Array<{ title: string; clientStatus: string; respondedAt: string }>;
  };
}

export interface OperationalSlice {
  recentActivity: { type: string; description: string; timestamp: string }[];
  /** Migration 065 added page_url column. pageUrl is optional — present when annotation was scoped to a specific page. */
  annotations: { date: string; label: string; pageUrl?: string }[];
  pendingJobs: number;
  // New in 3A
  timeSaved?: { totalMinutes: number; byFeature: Record<string, number> } | null;
  approvalQueue?: { pending: number; oldestAge: number | null };
  clientActionQueue?: { pending: number; oldestAge: number | null };
  recommendationQueue?: { fixNow: number; fixSoon: number; fixLater: number };
  actionBacklog?: { pendingMeasurement: number; oldestAge: number | null };
  detectedPlaybooks?: string[];
  workOrders?: { active: number; pending: number };
  insightAcceptanceRate?: InsightAcceptanceRate | null;
  // New in Phase 4.2
  /**
   * Summary of page_edit_states by status for this workspace.
   * Allows the advisor to understand how many pages are in review, live, or
   * needing fixes without reading the full page list.
   * Optional — only present when the page_edit_states table is accessible.
   */
  pageEditStateSummary?: {
    /** Total page states tracked. */
    total: number;
    /** Count per status (e.g. 'clean', 'fix-proposed', 'in-review', 'approved', 'live', 'rejected', 'issue-detected'). */
    byStatus: Record<string, number>;
  };
  /**
   * Effective subscription tier after trial promotion (migration 072 trialEndsAt).
   * `computeEffectiveTier()` returns 'growth' for free workspaces mid-trial.
   * Optional — only present when the workspace record can be loaded.
   */
  effectiveTier?: 'free' | 'growth' | 'premium';
  /**
   * Per-feature usage remaining this month (positive integers; Infinity → unlimited).
   * Derived from `getUsageSummary()` in usage-tracking.ts.
   * Optional — only present when usage-tracking is accessible.
   */
  usageRemaining?: Partial<Record<string, number>>;
}

/**
 * Per-page structural-element catalog. Populated by assemblePageElements
 * when buildWorkspaceIntelligence is called with opts.pagePath. Schema
 * templates conditionally enrich JSON-LD based on the catalog.
 *
 * Empty when no page-path provided OR when the page has no detected elements.
 */
export interface PageElementSlice {
  /** The page path this slice was assembled for. */
  pagePath: string;
  /** The catalog itself. EMPTY_CATALOG-shape when extraction yielded nothing. */
  catalog: PageElementCatalog;
}

/**
 * Local SEO posture for a workspace — markets, visibility coverage, full candidate list.
 *
 * Design:
 *   - `candidates` carries the FULL candidate universe (up to LOCAL_CANDIDATE_HARD_CAP in
 *     server/local-seo.ts — currently 1000). MCP consumers see this directly so external
 *     agents can analyze the full set programmatically.
 *   - `effectiveLocalSeoBlock` is the pre-formatted text block for AI prompts. It samples
 *     internally (stratified per active market, capped at ~50 total) so prompt token
 *     budget stays bounded even on hyper-local workspaces. Per CLAUDE.md authority-layered
 *     fields rule, AI consumers inject this string DIRECTLY — never construct an alternate
 *     prompt block from `candidates`.
 *   - Specialized consumers (content generation) can call `selectRelevantLocalCandidates`
 *     from server/intelligence/local-seo-slice.ts to filter `candidates` by target
 *     keyword/topic before injection.
 *
 * Read by AdminChat, content generation, recommendation generation, and MCP tools via
 * `buildWorkspaceIntelligence({ slices: ['localSeo'] })`. Workspaces with no active local
 * markets receive an empty-but-valid slice — never undefined.
 */
export interface LocalSeoSlice {
  /** Configured client locations for this workspace. Only 'confirmed' locations are included. */
  locations: ReadonlyArray<{
    id: string;
    name: string;
    isPrimary: boolean;
    city?: string;
    stateOrRegion?: string;
    pageTargetPath?: string;
  }>;
  /** Whether local SEO is active for this workspace read model. */
  enabled: boolean;
  /** Configured local markets and their status. Not capped. */
  markets: ReadonlyArray<{
    id: string;
    label: string;
    status: 'active' | 'inactive' | 'needs_review';
    location: string;
    deviceMix?: ReadonlyArray<'desktop' | 'mobile'>;
  }>;
  /** Aggregate visibility counts across the full candidate universe. */
  visibility: {
    visible: number;
    possibleMatch: number;
    notVisible: number;
    notChecked: number;
    providerDegraded: number;
  };
  /** Full candidate list, sorted by score desc. Capped only by LOCAL_CANDIDATE_HARD_CAP upstream. */
  candidates: ReadonlyArray<{
    keyword: string;
    source: string;
    sourceLabel: string;
    pageTitle?: string;
    pagePath?: string;
    /**
     * Originating local market id for market-scoped candidates (local/intent
     * variants). Market-agnostic candidates (explicit, strategy, tracking, page
     * assignments, content gaps) carry null/undefined — never fabricated. Drives
     * per-market stratified sampling + selection in the slice's samplers.
     */
    marketId?: string | null;
    volume?: number;
    difficulty?: number;
    score: number;
  }>;
  /** SEO Gen-Quality P7.1 — services in the workspace's industry taxonomy with no active
   *  tracking keyword (the local_service_gap rec spine). Surfaced so AdminChat can reason about
   *  untargeted local services. Empty when flag off / no taxonomy / no gaps. */
  serviceGaps: ReadonlyArray<{
    serviceId: string;
    serviceLabel: string;
    starterKeywords: ReadonlyArray<string>;
  }>;
  /** SEO Gen-Quality P7.1 — competitors that repeatedly appear in the local pack, including how
   *  often the client was absent while they showed (the local_visibility rec spine). */
  competitorBrands: ReadonlyArray<{
    title: string;
    domain?: string;
    totalAppearances: number;
    winsAgainstClient: number;
    markets: ReadonlyArray<string>;
  }>;
  /** SEO Decision Engine P7 (GBP + reviews) — aggregates-only review/GBP summary for the
   *  workspace's OWN listing plus the single strongest local competitor (by review count).
   *  AGGREGATES ONLY — never individual reviews or authors. Undefined when there is neither an
   *  owned listing nor any competitor listing data (so flag-off / no-data = no change). */
  reviewSummary?: {
    /** Star rating of the client's own listing; undefined = no reviews yet (NEVER 0). */
    ownRating?: number;
    /** Review count of the client's own listing; undefined = no reviews yet (NEVER 0). */
    ownReviewCount?: number;
    /** 0..100 GBP completeness signal for the owned listing (deriveGbpCompletenessScore). */
    completenessScore?: number;
    /** Whether the owned listing is claimed; undefined when unknown. */
    claimed?: boolean;
    /** Strongest local competitor by review count (non-owned). */
    topCompetitor?: { name: string; rating?: number; reviewCount?: number };
  };
  /** Pre-formatted prompt block — stratified-sampled internally. Inject directly into prompts. */
  effectiveLocalSeoBlock: string;
  /** ISO timestamp of the latest visibility snapshot reflected here. */
  latestSnapshotAt: string | null;
}

export interface EeatAssetsSlice {
  availability: 'ready' | 'no_data';
  assets: EeatAsset[];
  byType: Array<{ type: EeatAssetType; count: number }>;
  /** Pre-formatted trust-signal block for prompt consumers. Inject directly. */
  effectiveTrustSignalsBlock: string;
}

export interface GenerationQualitySlice {
  /** Latest persisted generation-quality row, or null when the workspace has no observations yet. */
  latest: StoredGenerationQuality | null;
}

export interface BrandSlice {
  /** 'ready' when any approved identity field or a non-empty voice block exists. */
  availability: 'ready' | 'no_data';
  /** Structured, approved-only brand identity (each a single content blob). */
  identity: {
    mission?: string;
    vision?: string;
    values?: string;
    tagline?: string;
    elevatorPitch?: string;
    positioning?: string;
  };
  /** Voice metadata. P1: status only (structured tone/guardrails deferred to a later phase). */
  voice: { status: 'calibrated' | 'legacy' | 'none' };
  /** Authority-resolved voice block — identical to `seoContext.effectiveBrandVoiceBlock`. Inject directly; never re-derive from structured fields. */
  voicePromptBlock: string;
  /** Pre-formatted approved-identity block for prompt injection. Inject directly. */
  identityPromptBlock: string;
}

// ── Client Intelligence API types (Phase 4C) ────────────────────────────────
// Scrubbed, tier-gated view of WorkspaceIntelligence for client portal consumption.
// NEVER expose: knowledgeBase, brandVoice, churnRisk, impact_score, operational slice,
// admin-only insight types (strategy_alignment), or bridge source tags.

export interface ClientInsightsSummary {
  /** Total actionable insights (critical + warning + opportunity; positive excluded) */
  total: number;
  /** highPriority = critical+warning; mediumPriority = opportunity */
  highPriority: number;
  mediumPriority: number;
  /** Human-readable top insight titles (max 3) */
  topInsights: Array<{ title: string; type: string }>;
}

export interface ClientPipelineStatus {
  briefs: { total: number; inProgress: number };
  posts: { total: number; inProgress: number };
  /** Pending SEO edits awaiting client approval */
  pendingApprovals: number;
}

export interface ClientLearningHighlights {
  /** Overall win rate across all tracked actions (0-1) */
  overallWinRate: number;
  /** Top performing action type (e.g. "title_update") */
  topActionType: string | null;
  /** Count of strong_win outcomes from weCalledIt entries (up to 5; no date filter) */
  recentWins: number;
}

export interface ClientSiteHealthSummary {
  /** 0-100 audit score */
  auditScore: number | null;
  /** Direction vs previous audit */
  auditScoreDelta: number | null;
  /** CWV pass rate as 0-100 integer (average of available rates; currently mobile-only until assembler populates desktop) */
  cwvPassRatePct: number | null;
  /** Count of dead links */
  deadLinks: number;
}

export type ClientCompositeHealthComponentId = 'retention' | 'roi' | 'engagement';

export interface ClientCompositeHealthBreakdownRow {
  id: ClientCompositeHealthComponentId;
  label: string;
  /** 0-100 component score after the component's own bucket logic is applied. */
  score: number;
  /** Effective display weight as a percentage. Missing components are omitted and weights are normalized server-side. */
  weight: number;
  description: string;
}

export interface ClientCompositeHealthBreakdown {
  rows: ClientCompositeHealthBreakdownRow[];
}

export interface ClientKeywordFeedbackSummary {
  approvedCount: number;
  rejectedCount: number;
  /** Decimal fraction (0.91 for 91%). Multiply by 100 for display. */
  approveRate: number;
  approvedSamples: string[];
  rejectedSamples: string[];
  rejectionReasons: string[];
}

export interface ClientIntelligence {
  workspaceId: string;
  assembledAt: string;
  tier: 'free' | 'growth' | 'premium';

  // All tiers
  insightsSummary: ClientInsightsSummary | null;
  pipelineStatus: ClientPipelineStatus | null;

  // Growth+ only
  learningHighlights?: ClientLearningHighlights | null;
  rankTrackingSummary?: RankTrackingSummary | null;
  serpOpportunities?: number | null;
  /** Composite health score (0-100). Weighted: 40% churn + 30% ROI + 30% engagement. */
  compositeHealthScore?: number | null;
  /** Client-safe component breakdown for the composite health score. */
  compositeHealthBreakdown?: ClientCompositeHealthBreakdown | null;
  /** Client-safe summary of keyword approve/decline feedback. */
  keywordFeedbackSummary?: ClientKeywordFeedbackSummary | null;
  /** Predictions that came true — strongest wins from outcome tracking. */
  weCalledIt?: WeCalledItEntry[];
  copyPipelineStatus?: ClientCopyPipelineStatus | null;

  // Premium only
  siteHealthSummary?: ClientSiteHealthSummary | null;
  contentDecayAlerts?: ClientDecayAlert[] | null;
}

export interface ClientDecayAlert {
  pageUrl: string;
  clickDrop: number;
  detectedAt: string;
  hasRefreshBrief: boolean;
}

export interface ClientCopyPipelineStatus {
  totalSections: number;
  approvedSections: number;
  inReviewSections: number;
  approvalRate: number;
}

// ── New supporting types (Phase 3A) ─────────────────────────────────

export interface BusinessProfile {
  industry: string;
  goals: string[];
  targetAudience: string;
  phone?: string;
  email?: string;
  /** Prompt-friendly one-line address text (e.g. "street, city, state, zip, country"). */
  address?: string;
  /** Source-of-truth structured address for schema and contact-aware consumers. */
  addressParts?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
  socialProfiles?: string[];
  openingHours?: string;
  foundedDate?: string;
  numberOfEmployees?: string;
}

export interface BacklinkProfile {
  totalBacklinks: number;
  referringDomains: number;
  /** Omitted when trend cannot be computed from available API data. */
  trend?: 'growing' | 'stable' | 'declining';
}

export interface SerpFeatures {
  featuredSnippets: number;
  peopleAlsoAsk: number;
  localPack: boolean;
  /** Pages where a video carousel is present for the primary keyword. */
  videoCarousel: number;
  /** Pages whose primary keyword's SERP shows an AI Overview (answer-engine surface). */
  aiOverview: number;
}

export interface EngagementMetrics {
  lastLoginAt: string | null;
  loginFrequency: 'daily' | 'weekly' | 'monthly' | 'inactive';
  chatSessionCount: number;
  portalUsage: {
    /** Distinct calendar days with client portal activity (not literal page views). */
    pageViews: number;
    featuresUsed: string[];
  } | null;
}

/** Internal computation type for composite health scoring.
 *  The slice exposes only the final `score` as `compositeHealthScore?: number | null` (0-100). */
export interface CompositeHealthScore {
  score: number;
  components: {
    churn: { score: number; weight: 0.4 };
    roi: { score: number; weight: 0.3 };
    engagement: { score: number; weight: 0.3 };
  };
  computedAt: string;
}

export interface ChurnSignalSummary {
  type: string;
  severity: string;
  detectedAt: string;
  title: string;
  description: string;
}

export interface ROIAttribution {
  actionId: string;
  pageUrl: string;
  actionType: string;
  clicksBefore: number;
  clicksAfter: number;
  clickGain: number;
  measuredAt: string;
}

export interface WeCalledItEntry {
  actionId: string;
  prediction: string;
  /** Client-readable outcome sentence. Machine score stays in `score`. */
  outcome: string;
  score: string;
  pageUrl: string;
  measuredAt: string;
}

export interface RankTrackingSummary {
  trackedKeywords: number;
  avgPosition: number | null;
  positionChanges: { improved: number; declined: number; stable: number };
  /** Top changed keywords by absolute SERP movement, derived from latest rank snapshots. */
  topKeywordMovers?: RankTrackingKeywordMover[];
}

export interface RankTrackingKeywordMover {
  query: string;
  position: number;
  /** Signed getLatestRanks() movement: negative = improved/moved up, positive = declined/dropped. */
  change: number;
  direction: 'improved' | 'declined';
  clicks: number;
  impressions: number;
  /** Already a percentage (e.g., 6.3 for 6.3%). Do NOT multiply by 100. */
  ctr: number;
  pagePath?: string;
  pageTitle?: string;
  /**
   * Optional keyword value score when a caller has already joined value scoring
   * into rank context. The current getLatestRanks() read path does not compute it.
   */
  valueScore?: number;
}

export interface DiscoveredQuerySummary {
  /** All-time unique query count ever seen for this workspace. */
  totalDiscovered: number;
  /** Queries currently flagged status = 'lost_visibility'. */
  lostVisibilityCount: number;
  /** Top 10 by total_impressions DESC — for AI context. */
  topLostQueries: Array<{
    query: string;
    lastPosition: number | null;
    lastSeen: string;
    totalImpressions: number;
  }>;
}

export interface StrategyHistory {
  revisionsCount: number;
  lastRevisedAt: string;
}

export interface DecayAlert {
  pageUrl: string;
  clickDrop: number;
  detectedAt: string;
  hasRefreshBrief: boolean;
  isRepeatDecay: boolean;
}

export interface CannibalizationWarning {
  keyword: string;
  pages: string[];
  severity: 'low' | 'medium' | 'high';
}

/**
 * Superset normalized type for the unified CannibalizationAlert component (Wave 2 T5).
 *
 * Subsumes both `CannibalizationItem` (strategy, object pages) and `CannibalizationWarning`
 * (admin pipeline, string pages). Admin string-path entries map via `{ path }`.
 * `CannibalizationItem` / `CannibalizationWarning` are NOT deleted — server and other
 * consumers still reference them directly. This type is additive.
 */
export interface CannibalizationEntry {
  keyword: string;
  severity: 'high' | 'medium' | 'low';
  pages: {
    path: string;
    position?: number;
    impressions?: number;
    clicks?: number;
    source?: 'keyword_map' | 'gsc';
  }[];
  recommendation?: string;
  action?: 'canonical_tag' | 'redirect_301' | 'differentiate' | 'noindex';
  canonicalPath?: string;
}

export interface RedirectDetail {
  url: string;
  target: string;
  chainDepth: number;
  status: number;
}

export interface AeoReadiness {
  pagesChecked: number;
  passingRate: number;
}

export interface SchemaValidationSummary {
  valid: number;
  warnings: number;
  errors: number;
}

export interface PerformanceSummary {
  avgLcp: number | null;
  /** Interaction to Next Paint in milliseconds. INP replaced FID as a Core Web Vital. */
  avgInp?: number | null;
  avgFid: number | null;
  avgCls: number | null;
  score: number | null;
}

export interface InsightAcceptanceRate {
  totalShown: number;
  confirmed: number;
  dismissed: number;
  rate: number;
}

// ── Prompt formatter options ────────────────────────────────────────────

export type PromptVerbosity = 'compact' | 'standard' | 'detailed';

export interface PromptFormatOptions {
  sections?: readonly IntelligenceSlice[];
  verbosity?: PromptVerbosity;
  tokenBudget?: number;
  learningsDomain?: 'content' | 'strategy' | 'technical' | 'all';
  pagePath?: string;
  /** Client-facing prompts should keep aggregate rank context without exact changed queries. */
  includeRankMovers?: boolean;
}

// ── Suggested briefs (shared between server store + frontend API client) ──

export interface SuggestedBrief {
  id: string;
  workspaceId: string;
  keyword: string;
  pageUrl: string | null;
  source: string;
  reason: string;
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'accepted' | 'dismissed' | 'snoozed';
  createdAt: string;
  resolvedAt: string | null;
  snoozedUntil: string | null;
  dismissedKeywordHash: string | null;
}

// ── Content pipeline summary (for shared data accessor) ─────────────────

export interface ContentPipelineSummary {
  briefs: { total: number; byStatus: Record<string, number> };
  posts: { total: number; byStatus: Record<string, number> };
  matrices: { total: number; cellsPlanned: number; cellsPublished: number };
  requests: { pending: number; inProgress: number; delivered: number };
  workOrders: { active: number; pending?: number };
  seoEdits: { pending: number; applied: number; inReview: number };
}

// ── Copy pipeline summary (for workspace intelligence assembly) ────────

export interface CopyPipelineSummary {
  /** Total copy sections across all blueprint entries */
  totalSections: number;
  /** Count by status */
  approvedSections: number;
  draftSections: number;
  clientReviewSections: number;
  pendingSections: number;
  revisionSections: number;
  /** Already a percentage (e.g., 72 for 72%). Do NOT divide by 100. */
  approvalRate: number;
  /** Already a percentage. Approved sections where version === 1. */
  firstTryApprovalRate: number;
  /** Active intelligence patterns (terminology, tone, structure, keyword_usage) */
  activePatternsCount: number;
  /** Last batch job summary (null if no batch jobs exist) */
  lastBatchJob: {
    status: string;
    /** Already a percentage (e.g., 80 for 80%). */
    completionRate: number;
    createdAt: string;
  } | null;
  /** Entries with all sections approved */
  entriesWithCompleteCopy: number;
  /** Entries with at least one section but not all approved */
  entriesWithPendingCopy: number;
}
