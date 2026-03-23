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

import type { EventDisplayConfig } from '../../../shared/types/workspace.ts';
import type { GA4Overview } from '../../../shared/types/analytics.ts';

export interface ContentPricing { briefPrice: number; fullPostPrice: number; currency: string; briefLabel?: string; fullPostLabel?: string; briefDescription?: string; fullPostDescription?: string; }
export interface WorkspaceInfo { id: string; name: string; webflowSiteId?: string; webflowSiteName?: string; gscPropertyUrl?: string; ga4PropertyId?: string; liveDomain?: string; eventConfig?: EventDisplayConfig[]; eventGroups?: EventGroup[]; requiresPassword?: boolean; clientPortalEnabled?: boolean; seoClientView?: boolean; analyticsClientView?: boolean; contentPricing?: ContentPricing | null; tier?: 'free' | 'growth' | 'premium'; baseTier?: 'free' | 'growth' | 'premium'; isTrial?: boolean; trialDaysRemaining?: number; trialEndsAt?: string | null; stripeEnabled?: boolean; onboardingEnabled?: boolean; onboardingCompleted?: boolean; brandLogoUrl?: string; brandAccentColor?: string; }
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
}
export interface ChatMessage { role: 'user' | 'assistant'; content: string; }

export interface ClientContentRequest {
  id: string; topic: string; targetKeyword: string; intent: string; priority: string;
  status: 'pending_payment' | 'requested' | 'brief_generated' | 'client_review' | 'approved' | 'changes_requested' | 'in_progress' | 'delivered' | 'published' | 'declined';
  source?: 'strategy' | 'client'; briefId?: string;
  serviceType?: 'brief_only' | 'full_post'; pageType?: 'blog' | 'landing' | 'service' | 'location' | 'product' | 'pillar' | 'resource'; upgradedAt?: string;
  deliveryUrl?: string; deliveryNotes?: string;
  comments?: { id: string; author: 'client' | 'team'; content: string; createdAt: string }[];
  requestedAt: string; updatedAt: string;
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
export type ClientTab = 'overview' | 'performance' | 'search' | 'health' | 'strategy' | 'analytics' | 'inbox' | 'approvals' | 'requests' | 'content' | 'plans' | 'roi' | 'content-plan';

export interface ClientKeywordStrategy {
  siteKeywords: string[];
  siteKeywordMetrics?: { keyword: string; volume: number; difficulty: number }[];
  pageMap: { pagePath: string; pageTitle?: string; primaryKeyword: string; secondaryKeywords?: string[]; searchIntent?: string; currentPosition?: number; impressions?: number; clicks?: number; volume?: number; difficulty?: number; gscKeywords?: { query: string; clicks: number; impressions: number; position: number }[] }[];
  opportunities: string[];
  contentGaps?: { topic: string; targetKeyword: string; intent: string; priority: string; rationale: string; suggestedPageType?: 'blog' | 'landing' | 'service' | 'location' | 'product' | 'pillar' | 'resource'; volume?: number; difficulty?: number; impressions?: number }[];
  quickWins?: { pagePath: string; action: string; estimatedImpact: string; rationale: string }[];
  keywordGaps?: { keyword: string; volume?: number; difficulty?: number }[];
  businessContext?: string;
  generatedAt: string;
}

export const SEV = {
  error: { bg: 'bg-red-500/10', border: 'border-red-500/20', text: 'text-red-400' },
  warning: { bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: 'text-amber-400' },
  info: { bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: 'text-blue-400' },
} as const;

export const CAT_LABELS: Record<string, { label: string; color: string }> = {
  content: { label: 'Content', color: '#60a5fa' }, technical: { label: 'Technical', color: '#2dd4bf' },
  social: { label: 'Social', color: '#f472b6' }, performance: { label: 'Performance', color: '#fbbf24' },
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
