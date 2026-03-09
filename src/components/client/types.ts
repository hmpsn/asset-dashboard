export interface SearchQuery { query: string; clicks: number; impressions: number; ctr: number; position: number; }
export interface SearchPage { page: string; clicks: number; impressions: number; ctr: number; position: number; }
export interface SearchOverview {
  totalClicks: number; totalImpressions: number; avgCtr: number; avgPosition: number;
  topQueries: SearchQuery[]; topPages: SearchPage[];
  dateRange: { start: string; end: string };
}
export interface PerformanceTrend { date: string; clicks: number; impressions: number; ctr: number; position: number; }
export interface EventGroup { id: string; name: string; order: number; color: string; defaultPageFilter?: string; allowedPages?: string[]; }
export interface EventDisplayConfig { eventName: string; displayName: string; pinned: boolean; group?: string; }
export interface ContentPricing { briefPrice: number; fullPostPrice: number; currency: string; briefLabel?: string; fullPostLabel?: string; briefDescription?: string; fullPostDescription?: string; }
export interface WorkspaceInfo { id: string; name: string; webflowSiteId?: string; webflowSiteName?: string; gscPropertyUrl?: string; ga4PropertyId?: string; liveDomain?: string; eventConfig?: EventDisplayConfig[]; eventGroups?: EventGroup[]; requiresPassword?: boolean; clientPortalEnabled?: boolean; seoClientView?: boolean; analyticsClientView?: boolean; contentPricing?: ContentPricing | null; tier?: 'free' | 'growth' | 'premium'; baseTier?: 'free' | 'growth' | 'premium'; isTrial?: boolean; trialDaysRemaining?: number; trialEndsAt?: string | null; stripeEnabled?: boolean; }
export interface AuditSummary { id: string; createdAt: string; siteScore: number; totalPages: number; errors: number; warnings: number; previousScore?: number; }
export interface SeoIssue { check: string; severity: 'error' | 'warning' | 'info'; category?: string; message: string; recommendation: string; value?: string; }
export interface PageAuditResult { pageId: string; page: string; slug: string; url: string; score: number; issues: SeoIssue[]; }
export interface AuditDetail {
  id: string; createdAt: string; siteName: string; logoUrl?: string; previousScore?: number;
  audit: { siteScore: number; totalPages: number; errors: number; warnings: number; infos: number; pages: PageAuditResult[]; siteWideIssues: SeoIssue[]; };
  scoreHistory: Array<{ id: string; createdAt: string; siteScore: number }>;
}
export interface ChatMessage { role: 'user' | 'assistant'; content: string; }
export interface GA4Overview {
  totalUsers: number; totalSessions: number; totalPageviews: number;
  avgSessionDuration: number; bounceRate: number; newUserPercentage: number;
  dateRange: { start: string; end: string };
}
export interface GA4DailyTrend { date: string; users: number; sessions: number; pageviews: number; }
export interface GA4TopPage { path: string; pageviews: number; users: number; avgEngagementTime: number; }
export interface GA4TopSource { source: string; medium: string; users: number; sessions: number; }
export interface GA4DeviceBreakdown { device: string; users: number; sessions: number; percentage: number; }
export interface GA4CountryBreakdown { country: string; users: number; sessions: number; }
export interface GA4Event { eventName: string; eventCount: number; users: number; }
export interface GA4EventTrend { date: string; eventCount: number; }
export interface GA4ConversionSummary { eventName: string; conversions: number; users: number; rate: number; }
export interface GA4EventPageBreakdown { eventName: string; pagePath: string; eventCount: number; users: number; }

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

export interface SearchComparison {
  current: { clicks: number; impressions: number; ctr: number; position: number };
  previous: { clicks: number; impressions: number; ctr: number; position: number };
  change: { clicks: number; impressions: number; ctr: number; position: number };
  changePercent: { clicks: number; impressions: number; ctr: number; position: number };
}

export interface GA4Comparison {
  current: GA4Overview;
  previous: GA4Overview;
  change: { users: number; sessions: number; pageviews: number; bounceRate: number; avgSessionDuration: number };
  changePercent: { users: number; sessions: number; pageviews: number };
}

export interface GA4NewVsReturning {
  segment: string;
  users: number;
  sessions: number;
  bounceRate: number;
  engagementRate: number;
  avgEngagementTime: number;
  percentage: number;
}

export interface GA4OrganicOverview {
  organicUsers: number;
  organicSessions: number;
  organicPageviews: number;
  organicBounceRate: number;
  engagementRate: number;
  avgEngagementTime: number;
  shareOfTotalUsers: number;
  dateRange: { start: string; end: string };
}

export interface GA4LandingPage {
  landingPage: string;
  sessions: number;
  users: number;
  bounceRate: number;
  avgEngagementTime: number;
  conversions: number;
}

export type SortKey = 'clicks' | 'impressions' | 'ctr' | 'position';
export type ClientTab = 'overview' | 'performance' | 'search' | 'health' | 'strategy' | 'analytics' | 'inbox' | 'approvals' | 'requests' | 'content' | 'plans' | 'roi';

export interface ClientKeywordStrategy {
  siteKeywords: string[];
  siteKeywordMetrics?: { keyword: string; volume: number; difficulty: number }[];
  pageMap: { pagePath: string; pageTitle?: string; primaryKeyword: string; secondaryKeywords?: string[]; searchIntent?: string; currentPosition?: number; impressions?: number; clicks?: number; volume?: number; difficulty?: number }[];
  opportunities: string[];
  contentGaps?: { topic: string; targetKeyword: string; intent: string; priority: string; rationale: string; suggestedPageType?: 'blog' | 'landing' | 'service' | 'location' | 'product' | 'pillar' | 'resource' }[];
  quickWins?: { pagePath: string; action: string; estimatedImpact: string; rationale: string }[];
  keywordGaps?: { keyword: string; volume?: number; difficulty?: number }[];
  businessContext?: string;
  generatedAt: string;
}

export type RequestCategory = 'bug' | 'content' | 'design' | 'seo' | 'feature' | 'other';
export type RequestStatus = 'new' | 'in_review' | 'in_progress' | 'on_hold' | 'completed' | 'closed';
export interface RequestAttachment { id: string; filename: string; originalName: string; mimeType: string; size: number; }
export interface RequestNote { id: string; author: 'client' | 'team'; content: string; attachments?: RequestAttachment[]; createdAt: string; }
export interface ClientRequest {
  id: string; workspaceId: string; title: string; description: string;
  category: RequestCategory; priority: string; status: RequestStatus;
  submittedBy?: string; pageUrl?: string; attachments?: RequestAttachment[]; notes: RequestNote[]; createdAt: string; updatedAt: string;
}

export interface ApprovalItem {
  id: string; pageId: string; pageTitle: string; pageSlug: string;
  field: 'seoTitle' | 'seoDescription' | 'schema'; currentValue: string; proposedValue: string;
  clientValue?: string; status: 'pending' | 'approved' | 'rejected' | 'applied'; clientNote?: string;
  reason?: string;
}
export interface ApprovalBatch {
  id: string; workspaceId: string; siteId: string; name: string;
  items: ApprovalItem[]; status: string; createdAt: string;
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
