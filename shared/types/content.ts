// ── Content domain types ────────────────────────────────────────

export interface ContentBrief {
  id: string;
  workspaceId: string;
  targetKeyword: string;
  secondaryKeywords: string[];
  suggestedTitle: string;
  suggestedMetaDesc: string;
  outline: { heading: string; subheadings?: string[]; notes: string; wordCount?: number; keywords?: string[] }[];
  wordCountTarget: number;
  intent: string;
  audience: string;
  competitorInsights: string;
  internalLinkSuggestions: string[];
  createdAt: string;
  // Enhanced fields (v2)
  executiveSummary?: string;
  contentFormat?: string;
  toneAndStyle?: string;
  peopleAlsoAsk?: string[];
  topicalEntities?: string[];
  serpAnalysis?: { contentType: string; avgWordCount: number; commonElements: string[]; gaps: string[] };
  difficultyScore?: number;
  trafficPotential?: string;
  ctaRecommendations?: string[];
  // Enhanced fields (v3)
  eeatGuidance?: { experience: string; expertise: string; authority: string; trust: string };
  contentChecklist?: string[];
  schemaRecommendations?: { type: string; notes: string }[];
  // Page type (v4)
  pageType?: 'blog' | 'landing' | 'service' | 'location' | 'product' | 'pillar' | 'resource';
  // Reference URLs (v5) — competitor/inspiration URLs scraped for context
  referenceUrls?: string[];
  // Real SERP data (v5) — actual PAA questions and top results from Google
  realPeopleAlsoAsk?: string[];
  realTopResults?: { position: number; title: string; url: string }[];
  // Keyword pre-assignment (v6) — template/matrix keyword locking
  keywordLocked?: boolean;
  keywordSource?: 'manual' | 'semrush' | 'gsc' | 'matrix' | 'template';
  keywordValidation?: {
    volume: number;
    difficulty: number;
    cpc: number;
    validatedAt: string;
  };
  templateId?: string;
  // Title/Meta A/B variants (v7)
  titleVariants?: string[];
  metaDescVariants?: string[];
}

export interface PostSection {
  index: number;
  heading: string;
  content: string;         // HTML
  wordCount: number;
  targetWordCount: number;
  keywords: string[];
  status: 'pending' | 'generating' | 'done' | 'error';
  error?: string;
}

export interface ReviewChecklist {
  factual_accuracy: boolean;
  brand_voice: boolean;
  internal_links: boolean;
  no_hallucinations: boolean;
  meta_optimized: boolean;
  word_count_target: boolean;
}

export interface GeneratedPost {
  id: string;
  workspaceId: string;
  briefId: string;
  targetKeyword: string;
  title: string;
  metaDescription: string;
  introduction: string;    // HTML
  sections: PostSection[];
  conclusion: string;      // HTML
  seoTitle?: string;       // SEO-optimized title tag (50-60 chars)
  seoMetaDescription?: string; // SEO meta description (150-160 chars)
  totalWordCount: number;
  targetWordCount: number;
  status: 'generating' | 'draft' | 'review' | 'approved';
  unificationStatus?: 'pending' | 'success' | 'failed' | 'skipped';
  unificationNote?: string;
  reviewChecklist?: ReviewChecklist;
  // Webflow publish tracking
  webflowItemId?: string;
  webflowCollectionId?: string;
  publishedAt?: string;
  publishedSlug?: string;
  // Brand voice scoring (v2)
  voiceScore?: number;
  voiceFeedback?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContentRequestComment {
  id: string;
  author: 'client' | 'team';
  content: string;
  createdAt: string;
}

export interface ContentTopicRequest {
  id: string;
  workspaceId: string;
  topic: string;
  targetKeyword: string;
  intent: string;
  priority: string;
  rationale: string;
  status: 'pending_payment' | 'requested' | 'brief_generated' | 'client_review' | 'approved' | 'changes_requested' | 'in_progress' | 'delivered' | 'published' | 'declined';
  briefId?: string;
  clientNote?: string;
  internalNote?: string;
  declineReason?: string;
  clientFeedback?: string;
  source?: 'strategy' | 'client';
  serviceType?: 'brief_only' | 'full_post';
  pageType?: 'blog' | 'landing' | 'service' | 'location' | 'product' | 'pillar' | 'resource';
  upgradedAt?: string;
  deliveryUrl?: string;
  deliveryNotes?: string;
  targetPageId?: string;
  targetPageSlug?: string;
  comments?: ContentRequestComment[];
  requestedAt: string;
  updatedAt: string;
}

// ── Content Subscriptions (recurring monthly packages) ──────────

export type ContentSubPlan = 'content_starter' | 'content_growth' | 'content_scale';

export interface ContentSubscriptionPlanConfig {
  plan: ContentSubPlan;
  displayName: string;
  postsPerMonth: number;
  priceUsd: number;
  description: string;
}

export const CONTENT_SUB_PLANS: ContentSubscriptionPlanConfig[] = [
  { plan: 'content_starter', displayName: 'Starter Content', postsPerMonth: 2,  priceUsd: 500,  description: '2 SEO-optimized posts per month' },
  { plan: 'content_growth',  displayName: 'Growth Content',  postsPerMonth: 4,  priceUsd: 900,  description: '4 SEO-optimized posts per month' },
  { plan: 'content_scale',   displayName: 'Scale Content',   postsPerMonth: 8,  priceUsd: 1600, description: '8 SEO-optimized posts per month' },
];

export interface ContentSubscription {
  id: string;
  workspaceId: string;
  stripeSubscriptionId?: string;
  stripePriceId?: string;
  plan: ContentSubPlan;
  postsPerMonth: number;
  priceUsd: number;
  status: 'active' | 'paused' | 'cancelled' | 'past_due' | 'pending';
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  postsDeliveredThisPeriod: number;
  topicSource: 'strategy_gaps' | 'manual' | 'ai_recommended';
  preferredPageTypes?: string[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Content Templates (scalable content planning) ──────────────

export interface TemplateVariable {
  name: string;
  label: string;
  description?: string;
}

export interface TemplateSection {
  id: string;
  name: string;
  headingTemplate: string;
  guidance: string;
  wordCountTarget: number;
  order: number;
  cmsFieldSlug?: string;
}

export type ContentPageType =
  | 'blog' | 'landing' | 'service' | 'location' | 'product'
  | 'pillar' | 'resource' | 'provider-profile' | 'procedure-guide' | 'pricing-page';

export interface ContentTemplate {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  pageType: ContentPageType;
  variables: TemplateVariable[];
  sections: TemplateSection[];
  urlPattern: string;
  keywordPattern: string;
  titlePattern?: string;
  metaDescPattern?: string;
  cmsFieldMap?: Record<string, string>;
  toneAndStyle?: string;
  schemaTypes?: string[];  // e.g. ['BlogPosting', 'BreadcrumbList'] — auto-populated from pageType via PAGE_TYPE_SCHEMA_MAP
  createdAt: string;
  updatedAt: string;
}

// ── Content Matrix (bulk content planning grid) ─────────────────

export interface MatrixDimension {
  variableName: string;
  values: string[];
}

export type MatrixCellStatus =
  | 'planned'
  | 'keyword_validated'
  | 'brief_generated'
  | 'draft'
  | 'review'
  | 'approved'
  | 'published';

export interface KeywordCandidate {
  keyword: string;
  volume: number;
  difficulty: number;
  cpc: number;
  source: 'pattern' | 'semrush_related' | 'ai_suggested';
  isRecommended: boolean;
}

export interface StatusHistoryEntry {
  from: MatrixCellStatus;
  to: MatrixCellStatus;
  at: string;
}

export interface MatrixCell {
  id: string;
  variableValues: Record<string, string>;
  targetKeyword: string;
  customKeyword?: string;
  plannedUrl: string;
  briefId?: string;
  postId?: string;
  status: MatrixCellStatus;
  statusHistory?: StatusHistoryEntry[];
  keywordValidation?: {
    volume: number;
    difficulty: number;
    cpc: number;
    validatedAt: string;
  };
  keywordCandidates?: KeywordCandidate[];
  recommendedKeyword?: string;
  clientFlag?: string;
  clientFlaggedAt?: string;
  expectedSchemaTypes?: string[];  // Inherited from template's schemaTypes when cells are generated
}

export interface ContentMatrix {
  id: string;
  workspaceId: string;
  name: string;
  templateId: string;
  dimensions: MatrixDimension[];
  urlPattern: string;
  keywordPattern: string;
  cells: MatrixCell[];
  stats: {
    total: number;
    planned: number;
    briefGenerated: number;
    drafted: number;
    reviewed: number;
    published: number;
  };
  createdAt: string;
  updatedAt: string;
}
