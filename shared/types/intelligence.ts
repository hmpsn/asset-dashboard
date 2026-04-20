// shared/types/intelligence.ts
// Unified Workspace Intelligence Layer — shared types for server and frontend.
// Spec: docs/superpowers/specs/unified-workspace-intelligence.md §3, §11

import type { AnalyticsInsight, InsightType, InsightSeverity } from './analytics.js';
import type { DiagnosticStatus } from './diagnostics.js';
import type { KeywordStrategy, AudiencePersona, PageKeywordMap } from './workspace.js';
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

export type IntelligenceSlice =
  | 'seoContext'
  | 'insights'
  | 'learnings'
  | 'pageProfile'
  | 'contentPipeline'
  | 'siteHealth'
  | 'clientSignals'
  | 'operational';

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
  /**
   * Opt-in: fetch backlink profile from the configured SEO data provider.
   * OFF by default — the provider call adds network latency and costs credits.
   * Only enable for callers that actually surface backlink data (e.g. admin AI chat).
   */
  enrichWithBacklinks?: boolean;
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
  contentPipeline?: ContentPipelineSlice;
  siteHealth?: SiteHealthSlice;
  clientSignals?: ClientSignalsSlice;
  operational?: OperationalSlice;
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
   *  truth: buildSeoContext(workspaceId).brandVoiceBlock.
   *
   *  Authority rule:
   *    - profile.status === 'calibrated' → voice profile block (Layer 2 system prompt covers DNA)
   *    - profile has real content (samples/examples) → voice profile block
   *    - otherwise → legacy workspace.brandVoice + readBrandDocs() block
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
  strategyHistory?: StrategyHistory;
}

export interface InsightsSlice {
  all: AnalyticsInsight[];
  byType: Partial<Record<InsightType, AnalyticsInsight[]>>;
  bySeverity: Record<InsightSeverity, number>;
  topByImpact: AnalyticsInsight[];
  forPage?: AnalyticsInsight[];
}

export interface LearningsSlice {
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
  workOrders: { active: number };
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
}

export interface ClientSignalsSlice {
  keywordFeedback: { approved: string[]; rejected: string[]; patterns: { approveRate: number; topRejectionReasons: string[] } };
  contentGapVotes: { topic: string; votes: number }[];
  businessPriorities: string[];
  approvalPatterns: { approvalRate: number; avgResponseTime: number | null };
  recentChatTopics: string[];
  churnRisk: 'low' | 'medium' | 'high' | null;
  // New in 3A
  churnSignals?: ChurnSignalSummary[];
  roi?: { organicValue: number; growth: number; period: string } | null;
  engagement?: EngagementMetrics;
  compositeHealthScore?: number | null;
  feedbackItems?: Array<{ id: string; type: string; status: string; createdAt: string }>;
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
}

export interface OperationalSlice {
  recentActivity: { type: string; description: string; timestamp: string }[];
  /** Migration 065 added page_url column. pageUrl is optional — present when annotation was scoped to a specific page. */
  annotations: { date: string; label: string; pageUrl?: string }[];
  pendingJobs: number;
  // New in 3A
  timeSaved?: { totalMinutes: number; byFeature: Record<string, number> } | null;
  approvalQueue?: { pending: number; oldestAge: number | null };
  recommendationQueue?: { fixNow: number; fixSoon: number; fixLater: number };
  actionBacklog?: { pendingMeasurement: number; oldestAge: number | null };
  detectedPlaybooks?: string[];
  workOrders?: { active: number; pending: number };
  insightAcceptanceRate?: InsightAcceptanceRate | null;
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
  address?: string;
  socialProfiles?: string[];
  openingHours?: string;
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
  outcome: string;
  score: string;
  pageUrl: string;
  measuredAt: string;
}

export interface RankTrackingSummary {
  trackedKeywords: number;
  avgPosition: number | null;
  positionChanges: { improved: number; declined: number; stable: number };
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
  workOrders: { active: number };
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
