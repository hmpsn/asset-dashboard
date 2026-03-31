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
  brandVoice: string;
  businessContext: string;
  personas: AudiencePersona[];
  knowledgeBase: string;
  pageKeywords?: PageKeywordMap;
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
}

export interface PageProfileSlice {
  pagePath: string;
  primaryKeyword: string | null;
  searchIntent: string | null;
  optimizationScore: number | null;
  recommendations: string[];
  contentGaps: string[];
  insights: AnalyticsInsight[];
  actions: TrackedAction[];
  auditIssues: string[];
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
  seoEdits: { pending: number; applied: number; dismissed: number };
}

export interface SiteHealthSlice {
  auditScore: number | null;
  auditScoreDelta: number | null;
  deadLinks: number;
  redirectChains: number;
  schemaErrors: number;
  orphanPages: number;
  cwvPassRate: { mobile: number | null; desktop: number | null };
}

export interface ClientSignalsSlice {
  keywordFeedback: { approved: string[]; rejected: string[] };
  contentGapVotes: { topic: string; votes: number }[];
  businessPriorities: string[];
  approvalPatterns: { approvalRate: number; avgResponseTime: number | null };
  recentChatTopics: string[];
  churnRisk: 'low' | 'medium' | 'high' | null;
}

export interface OperationalSlice {
  recentActivity: { type: string; description: string; timestamp: string }[];
  /** Note: analytics_annotations table does NOT have a pageUrl column.
   *  pageUrl is optional — populated only if derivable from context. May need schema update in Phase 3. */
  annotations: { date: string; label: string; pageUrl?: string }[];
  pendingJobs: number;
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

// ── Content pipeline summary (for shared data accessor) ─────────────────

export interface ContentPipelineSummary {
  briefs: { total: number; byStatus: Record<string, number> };
  posts: { total: number; byStatus: Record<string, number> };
  matrices: { total: number; cellsPlanned: number; cellsPublished: number };
  requests: { pending: number; inProgress: number; delivered: number };
  workOrders: { active: number };
  seoEdits: { pending: number; applied: number; dismissed: number };
}
