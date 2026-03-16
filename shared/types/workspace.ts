// ── Workspace domain types ──────────────────────────────────────

export interface EventGroup {
  id: string;
  name: string;
  order: number;
  color: string;
  defaultPageFilter?: string;
  allowedPages?: string[];
}

export interface EventDisplayConfig {
  eventName: string;
  displayName: string;
  pinned: boolean;
  group?: string;
}

export interface PageKeywordMap {
  pagePath: string;
  pageTitle: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  searchIntent?: string;
  currentPosition?: number;
  impressions?: number;
  clicks?: number;
  // SEMRush enrichment
  volume?: number;
  difficulty?: number;
  cpc?: number;
  secondaryMetrics?: { keyword: string; volume: number; difficulty: number }[];
}

export interface KeywordGapItem {
  keyword: string;
  volume: number;
  difficulty: number;
  competitorPosition: number;
  competitorDomain: string;
}

export interface ContentGap {
  topic: string;           // suggested content topic
  targetKeyword: string;   // primary keyword to target
  intent: 'informational' | 'commercial' | 'transactional' | 'navigational';
  priority: 'high' | 'medium' | 'low';
  rationale: string;       // why this content should be created
  suggestedPageType?: 'blog' | 'landing' | 'service' | 'location' | 'product' | 'pillar' | 'resource';
}

export interface QuickWin {
  pagePath: string;
  currentKeyword?: string;
  action: string;          // specific action to take
  estimatedImpact: 'high' | 'medium' | 'low';
  rationale: string;
}

export interface KeywordStrategy {
  siteKeywords: string[];        // top-level target keywords for the whole site
  siteKeywordMetrics?: { keyword: string; volume: number; difficulty: number }[]; // SEMRush data for site keywords
  pageMap: PageKeywordMap[];     // keyword assignments per page
  opportunities: string[];       // keyword gaps / untapped opportunities
  contentGaps?: ContentGap[];    // specific content pieces that should be created
  quickWins?: QuickWin[];        // low-effort, high-impact fixes
  keywordGaps?: KeywordGapItem[]; // keywords competitors rank for but we don't
  businessContext?: string;      // user-provided context (locations, services, industry)
  semrushMode?: 'quick' | 'full' | 'none'; // which SEMRush mode was used
  generatedAt: string;
}

export type PageEditStatus = 'clean' | 'issue-detected' | 'fix-proposed' | 'in-review' | 'approved' | 'rejected' | 'live';

export interface PageEditState {
  pageId: string;
  slug?: string;
  status: PageEditStatus;
  auditIssues?: string[];
  fields?: string[];
  source?: 'audit' | 'editor' | 'cms' | 'schema' | 'bulk-fix' | 'bulk-rewrite' | 'pattern-apply' | 'cart-fix' | 'content-delivery' | 'recommendation' | 'request-resolved';
  approvalBatchId?: string;
  contentRequestId?: string;
  workOrderId?: string;
  recommendationId?: string;
  rejectionNote?: string;
  updatedAt: string;
  updatedBy?: 'admin' | 'client' | 'system';
}

export interface AudiencePersona {
  id: string;
  name: string;                   // e.g. "Small Business Owner"
  description: string;            // demographic / psychographic overview
  painPoints: string[];           // what problems they face
  goals: string[];                // what they're trying to achieve
  objections: string[];           // common hesitations / barriers
  preferredContentFormat?: string; // e.g. "how-to guides", "case studies"
  buyingStage?: 'awareness' | 'consideration' | 'decision';
}

export interface Workspace {
  id: string;
  name: string;
  webflowSiteId?: string;
  webflowSiteName?: string;
  webflowToken?: string;
  gscPropertyUrl?: string;
  ga4PropertyId?: string;
  clientPassword?: string;
  clientEmail?: string;
  liveDomain?: string;
  eventConfig?: EventDisplayConfig[];
  eventGroups?: EventGroup[];
  keywordStrategy?: KeywordStrategy;
  competitorDomains?: string[];
  personas?: AudiencePersona[];
  // Feature toggles
  clientPortalEnabled?: boolean;
  seoClientView?: boolean;
  analyticsClientView?: boolean;
  autoReports?: boolean;
  autoReportFrequency?: 'weekly' | 'monthly';
  // Branding
  brandVoice?: string;           // brand voice guidelines, tone description, style notes
  knowledgeBase?: string;          // business knowledge: services, capabilities, FAQs, platform info
  rewritePlaybook?: string;        // instructions for AI-assisted page rewriting (AEO, tone, structure)
  brandLogoUrl?: string;
  brandAccentColor?: string;
  // Monetization
  tier?: 'free' | 'growth' | 'premium';
  trialEndsAt?: string;              // ISO date — 14-day Growth trial
  stripeCustomerId?: string;         // Stripe Customer ID for subscriptions
  stripeSubscriptionId?: string;     // Active Stripe Subscription ID (Growth/Premium recurring)
  // Client onboarding
  onboardingEnabled?: boolean;       // admin toggle — show questionnaire to clients
  onboardingCompleted?: boolean;     // set true after client submits questionnaire
  // Portal contacts (emails captured from shared-password visitors)
  portalContacts?: { email: string; name?: string; capturedAt: string }[];
  // Audit issue suppressions (per-page check exclusions)
  auditSuppressions?: { check: string; pageSlug: string; pagePattern?: string; reason?: string; createdAt: string }[];
  // SEO edit tracking (legacy — kept for backward compat, written by updatePageState)
  seoEditTracking?: Record<string, { status: 'flagged' | 'in-review' | 'live'; updatedAt: string; fields?: string[] }>;
  // Unified page edit states (new — replaces seoEditTracking)
  pageEditStates?: Record<string, PageEditState>;
  // Webflow CMS publish target configuration
  publishTarget?: {
    collectionId: string;
    collectionName: string;
    fieldMap: {
      title: string;
      slug: string;
      body: string;
      metaTitle?: string;
      metaDescription?: string;
      summary?: string;
      featuredImage?: string;
      author?: string;
      publishDate?: string;
      category?: string;
    };
  };
  // Content pricing (per-workspace, exposed to client portal)
  contentPricing?: {
    briefPrice: number;       // e.g. 150 (in dollars)
    fullPostPrice: number;    // e.g. 500
    currency: string;         // e.g. 'USD'
    briefLabel?: string;      // optional custom label
    fullPostLabel?: string;
    briefDescription?: string;
    fullPostDescription?: string;
  };
  folder: string;
  createdAt: string;
}
