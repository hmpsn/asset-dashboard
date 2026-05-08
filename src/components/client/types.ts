// ── Re-exported shared types ─────────────────────────────────────
export type {
  SearchQuery, SearchPage, SearchOverview, PerformanceTrend,
  SearchComparison, GA4Overview, GA4DailyTrend, GA4TopPage, GA4TopSource,
  GA4DeviceBreakdown, GA4CountryBreakdown, GA4Event, GA4EventTrend,
  GA4ConversionSummary, GA4EventPageBreakdown, GA4Comparison,
  GA4NewVsReturning, GA4OrganicOverview, GA4LandingPage,
} from '../../../shared/types/analytics.ts';

export type {
  EventGroup, EventDisplayConfig,
} from '../../../shared/types/workspace.ts';

export type {
  RequestCategory, RequestStatus, RequestAttachment, RequestNote, ClientRequest,
} from '../../../shared/types/requests.ts';

export type {
  ApprovalItem, ApprovalBatch,
} from '../../../shared/types/approvals.ts';

// ── Client-specific types (not shared with server) ──────────────

import type { EventDisplayConfig, EventGroup } from '../../../shared/types/workspace.ts';
import type { MetricsSource } from '../../../shared/types/keywords.js';

export interface ContentPricing { briefPrice: number; fullPostPrice: number; currency: string; briefLabel?: string; fullPostLabel?: string; briefDescription?: string; fullPostDescription?: string; }
export interface BusinessProfile { phone?: string; email?: string; address?: { street?: string; city?: string; state?: string; zip?: string; country?: string }; socialProfiles?: string[]; openingHours?: string; foundedDate?: string; numberOfEmployees?: string; }
export interface WorkspaceInfo { id: string; name: string; webflowSiteId?: string; webflowSiteName?: string; gscPropertyUrl?: string; ga4PropertyId?: string; liveDomain?: string; eventConfig?: EventDisplayConfig[]; eventGroups?: EventGroup[]; requiresPassword?: boolean; clientPortalEnabled?: boolean; seoClientView?: boolean; analyticsClientView?: boolean; siteIntelligenceClientView?: boolean; contentPricing?: ContentPricing | null; tier?: 'free' | 'growth' | 'premium'; baseTier?: 'free' | 'growth' | 'premium'; isTrial?: boolean; trialDaysRemaining?: number; trialEndsAt?: string | null; stripeEnabled?: boolean; billingMode?: 'platform' | 'external'; onboardingEnabled?: boolean; onboardingCompleted?: boolean; brandLogoUrl?: string; brandAccentColor?: string; bookingUrl?: string | null; businessProfile?: BusinessProfile | null; }
export interface AuditSummary { id: string; createdAt: string; siteScore: number; totalPages: number; errors: number; warnings: number; previousScore?: number; }
export interface SeoIssue { check: string; severity: 'error' | 'warning' | 'info'; category?: string; message: string; recommendation: string; value?: string; affectedPages?: string[]; }
export interface PageAuditResult { pageId: string; page: string; slug: string; url: string; score: number; issues: SeoIssue[]; noindex?: boolean; }
export interface CwvMetricSummary { value: number | null; rating: 'good' | 'needs-improvement' | 'poor' | null; }
export interface CwvStrategyResult { assessment: 'good' | 'needs-improvement' | 'poor' | 'no-data'; fieldDataAvailable: boolean; lighthouseScore: number; metrics: { LCP: CwvMetricSummary; INP: CwvMetricSummary; CLS: CwvMetricSummary; }; }
export interface CwvSummary { mobile?: CwvStrategyResult; desktop?: CwvStrategyResult; }
export interface AuditDetail {
  id: string; createdAt: string; siteName: string; logoUrl?: string; previousScore?: number;
  audit: { siteScore: number; totalPages: number; errors: number; warnings: number; infos: number; pages: PageAuditResult[]; siteWideIssues: SeoIssue[]; cwvSummary?: CwvSummary; };
  scoreHistory: Array<{ id: string; createdAt: string; siteScore: number }>;
  auditDiff?: { resolved: number; newIssues: number };
}
export interface ChatMessage { role: 'user' | 'assistant'; content: string; }

export interface ActivityLogItem {
  id: string;
  workspaceId?: string;
  type: string;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
  actorId?: string;
  actorName?: string;
  createdAt: string;
}

export interface RankHistoryEntry { date: string; positions: Record<string, number> }
export interface LatestRank { query: string; position: number; clicks: number; impressions: number; ctr: number; change?: number }
export interface AnnotationItem { id: string; date: string; label: string; description?: string; color?: string; createdAt: string }
export interface AnomalyItem { id: string; workspaceId?: string; workspaceName?: string; type: string; severity: string; title: string; description: string; metric: string; currentValue: number; previousValue: number; changePct: number; aiSummary?: string; detectedAt: string; dismissedAt?: string; acknowledgedAt?: string; source: string }

export interface ContentPlanReviewCell {
  cellId: string;
  matrixId: string;
  matrixName: string;
  targetKeyword: string;
  plannedUrl?: string;
  status: string;
  variableValues?: Record<string, string>;
}

export type ApprovalPageKeyword = { pagePath: string; primaryKeyword: string; secondaryKeywords?: string[] };

export interface ClientContentRequest {
  id: string; topic: string; targetKeyword: string; intent: string; priority: string;
  status: 'pending_payment' | 'requested' | 'brief_generated' | 'client_review' | 'approved' | 'changes_requested' | 'in_progress' | 'post_review' | 'delivered' | 'published' | 'declined';
  source?: 'strategy' | 'client'; briefId?: string; postId?: string;
  serviceType?: 'brief_only' | 'full_post'; pageType?: 'blog' | 'landing' | 'service' | 'location' | 'product' | 'pillar' | 'resource'; upgradedAt?: string;
  deliveryUrl?: string; deliveryNotes?: string; clientFeedback?: string;
  comments?: { id: string; author: 'client' | 'team'; content: string; createdAt: string }[];
  requestedAt: string; updatedAt: string;
}

/**
 * Disambiguates the dual-purpose `changes_requested` status for progress-bar display.
 *
 * `changes_requested` can mean "client wants brief revisions" (came from client_review)
 * OR "client wants post revisions" (came from post_review). The state machine merged
 * these into one terminal label, but the progress bar needs them separated so it
 * correctly reflects the user's actual phase on the timeline.
 *
 * `postId` is the disambiguator — it's only populated when admin transitioned to
 * post_review (Task 5 auto-populates from listPosts via briefId match). For brief-flow
 * `changes_requested`, postId is undefined.
 *
 * Returns the status the progress bar should treat the request as. For non-changes_requested
 * statuses, returns `req.status` unchanged.
 */
export function getDisplayStatus(req: ClientContentRequest): ClientContentRequest['status'] {
  if (req.status === 'changes_requested' && req.postId) {
    return 'post_review';
  }
  return req.status;
}

export interface ClientBriefPreview {
  id: string; targetKeyword: string; suggestedTitle: string; suggestedMetaDesc: string;
  wordCountTarget: number; intent: string; audience: string; contentFormat?: string;
  executiveSummary?: string; outline: { heading: string; notes: string; wordCount?: number; keywords?: string[] }[];
  difficultyScore?: number; trafficPotential?: string;
  toneAndStyle?: string;
  ctaRecommendations?: string[];
  secondaryKeywords?: string[];
  topicalEntities?: string[];
  peopleAlsoAsk?: string[];
  serpAnalysis?: { contentType: string; avgWordCount: number; commonElements: string[]; gaps: string[] };
  internalLinkSuggestions?: string[];
  competitorInsights?: string;
  eeatGuidance?: { experience: string; expertise: string; authority: string; trust: string };
  contentChecklist?: string[];
  schemaRecommendations?: { type: string; notes: string }[];
}

export type SortKey = 'clicks' | 'impressions' | 'ctr' | 'position';
export type ClientTab = 'overview' | 'performance' | 'search' | 'health' | 'strategy' | 'analytics' | 'inbox' | 'approvals' | 'requests' | 'content' | 'plans' | 'roi' | 'content-plan' | 'brand';

export interface ClientKeywordStrategy {
  siteKeywords: string[];
  siteKeywordMetrics?: { keyword: string; volume: number; difficulty: number }[];
  pageMap: { pagePath: string; pageTitle?: string; primaryKeyword: string; secondaryKeywords?: string[]; searchIntent?: string; currentPosition?: number; impressions?: number; clicks?: number; volume?: number; difficulty?: number; metricsSource?: MetricsSource; validated?: boolean; gscKeywords?: { query: string; clicks: number; impressions: number; position: number }[] }[];
  opportunities: string[];
  contentGaps?: { topic: string; targetKeyword: string; intent: string; priority: string; rationale: string; suggestedPageType?: 'blog' | 'landing' | 'service' | 'location' | 'product' | 'pillar' | 'resource'; volume?: number; difficulty?: number; impressions?: number; competitorProof?: string; trendDirection?: 'rising' | 'declining' | 'stable'; serpFeatures?: string[]; questionKeywords?: string[]; opportunityScore?: number }[];
  quickWins?: { pagePath: string; action: string; estimatedImpact: string; rationale: string }[];
  keywordGaps?: { keyword: string; volume?: number; difficulty?: number }[];
  topicClusters?: { topic: string; keywords: string[]; ownedCount: number; totalCount: number; coveragePercent: number; avgPosition?: number; topCompetitor?: string; topCompetitorCoverage?: number; gap: string[] }[];
  cannibalization?: { keyword: string; pages: { path: string; position?: number; impressions?: number; clicks?: number; source: 'keyword_map' | 'gsc' }[]; severity: 'high' | 'medium' | 'low'; recommendation: string }[];
  questionKeywords?: { seed: string; questions: { keyword: string; volume: number }[] }[];
  businessContext?: string;
  generatedAt: string;
}

export const SEV = {
  error: { bg: 'bg-red-500/10', border: 'border-red-500/20', text: 'text-accent-danger' },
  warning: { bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: 'text-accent-warning' },
  info: { bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: 'text-accent-info' },
} as const;

export const CAT_LABELS: Record<string, { label: string; color: string }> = {
  content: { label: 'Content', color: '#60a5fa' }, technical: { label: 'Technical', color: '#2dd4bf' },
  social: { label: 'Social', color: '#fb923c' }, performance: { label: 'Performance', color: '#fbbf24' },
  accessibility: { label: 'Accessibility', color: '#34d399' },
};

export const QUICK_QUESTIONS = [
  'What are my biggest opportunities right now?',
  'How is my site performing overall? Any red flags?',
  'Which pages should I focus on improving first?',
  'What content should I create next to grow traffic?',
  'Is there anything waiting for my attention or approval?',
];

export const LEARN_SEO_QUESTIONS = [
  'Explain my site health score — what does it mean?',
  'What is CTR and why does it matter for my site?',
  'What are impressions vs clicks in simple terms?',
  'How does SEO actually help my business grow?',
  'What is a keyword strategy and do I need one?',
];
