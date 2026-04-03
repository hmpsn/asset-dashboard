// shared/types/intelligence.ts
// Unified Workspace Intelligence Layer — shared types for server and frontend.
// Spec: docs/superpowers/specs/unified-workspace-intelligence.md §3, §11

import type { AnalyticsInsight, InsightType, InsightSeverity } from './analytics.js';
import type { KeywordStrategy, AudiencePersona, PageKeywordMap } from './workspace.js';
import type {
  TrackedAction,
  ActionOutcome,
  WorkspaceLearnings,
  ActionPlaybook,
  LearningsConfidence,
  LearningsTrend,
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
  slices?: IntelligenceSlice[];
  /** Page-specific context (triggers per-page enrichment) */
  pagePath?: string;
  /** Domain filter for learnings */
  learningsDomain?: 'content' | 'strategy' | 'technical' | 'all';
  /** Token budget hint for downstream prompt formatting */
  tokenBudget?: number;
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
  /** Raw text — no headers. Use formatBrandVoiceForPrompt() before injecting into prompts.
   *  formatSeoContextSection renders this with an emphatic BRAND VOICE header automatically. */
  brandVoice: string;
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
  keywordRecommendations?: Array<{ keyword: string; volume: number; difficulty: number; relevance: number }>;
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
  topWins?: TrackedAction[];
  winRateByActionType?: Record<string, number>;
  roiAttribution?: ROIAttribution[];
  weCalledIt?: WeCalledItEntry[];
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
}

export interface OperationalSlice {
  recentActivity: { type: string; description: string; timestamp: string }[];
  /** Note: analytics_annotations table does NOT have a pageUrl column.
   *  pageUrl is optional — populated only if derivable from context. May need schema update in Phase 3. */
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

// ── New supporting types (Phase 3A) ─────────────────────────────────

export interface BusinessProfile {
  industry: string;
  goals: string[];
  targetAudience: string;
}

export interface BacklinkProfile {
  totalBacklinks: number;
  referringDomains: number;
  trend: 'growing' | 'stable' | 'declining';
}

export interface SerpFeatures {
  featuredSnippets: number;
  peopleAlsoAsk: number;
  localPack: boolean;
}

export interface EngagementMetrics {
  lastLoginAt: string | null;
  loginFrequency: 'daily' | 'weekly' | 'monthly' | 'inactive';
  chatSessionCount: number;
  portalUsage: { pageViews: number; featuresUsed: string[] } | null;
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
  sections?: IntelligenceSlice[];
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
