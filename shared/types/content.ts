// ── Content domain types ────────────────────────────────────────

import type { OutcomeReadback } from './outcome-tracking.js';

export const CONTENT_GENERATION_STYLES = ['standard', 'concise', 'hybrid'] as const;
export type ContentGenerationStyle = typeof CONTENT_GENERATION_STYLES[number];
export const DEFAULT_CONTENT_GENERATION_STYLE: ContentGenerationStyle = 'standard';
export const CONTENT_GENERATION_STYLE_LABELS: Record<ContentGenerationStyle, string> = {
  standard: 'Standard',
  concise: 'Concise',
  hybrid: 'Hybrid',
};
export const CONTENT_GENERATION_STYLE_OPTIONS = CONTENT_GENERATION_STYLES.map(value => ({
  value,
  label: CONTENT_GENERATION_STYLE_LABELS[value],
}));

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
  keywordSource?: 'manual' | 'semrush' | 'dataforseo' | 'gsc' | 'matrix' | 'template';
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
  // Content generation style selector (v8)
  generationStyle?: ContentGenerationStyle;
  // Scraped source evidence (C4 / v9) — persisted SERP + reference source text
  sourceEvidence?: BriefSourceEvidence;
  // W2.5 lineage: set to the new brief's id when this brief is superseded by a regeneration
  supersededBy?: string;
}

export interface BriefTemplateCrossrefSection {
  id: string;
  name: string;
  headingTemplate: string;
  guidance: string;
  wordCountTarget: number;
  order: number;
}

export interface BriefTemplateCrossrefMatch {
  keyword: string;
  matrixId: string;
  matrixName: string;
  cellId: string;
  matchedKeyword: string;
  matchedSource: 'target' | 'custom';
  templateId: string;
  templateName: string;
  pageType: BriefPageType | null;
  sections: BriefTemplateCrossrefSection[];
  toneAndStyle?: string;
  titlePattern?: string;
  metaDescPattern?: string;
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

export const REVIEW_CHECKLIST_KEYS = [
  'factual_accuracy',
  'brand_voice',
  'internal_links',
  'no_hallucinations',
  'meta_optimized',
  'word_count_target',
] as const;

export type ReviewChecklistKey = typeof REVIEW_CHECKLIST_KEYS[number];

export const PROVENANCE_SENSITIVE_REVIEW_KEYS = [
  'factual_accuracy',
  'no_hallucinations',
] as const satisfies readonly ReviewChecklistKey[];

export interface AIReviewResult {
  pass: boolean;
  reason: string;
  humanReviewRequired?: boolean;
  claimsToVerify?: string[];
  claimEvidence?: ContentReviewClaimEvidence[];
}

export type AIReviewMap = Record<ReviewChecklistKey, AIReviewResult>;

export type ContentReviewEvidenceSourceKind =
  | 'reference_url'
  | 'serp_top_result'
  | 'paa'
  | 'manual_unknown';

export interface ContentReviewEvidenceCandidate {
  kind: ContentReviewEvidenceSourceKind;
  label: string;
  url?: string;
  position?: number;
  confidence?: 'strong' | 'possible';
  matchReason?: string;
}

export interface ContentReviewClaimEvidence {
  claim: string;
  sourceCandidates: ContentReviewEvidenceCandidate[];
}

export interface ContentReviewEvidence {
  referenceUrls?: string[];
  peopleAlsoAsk: string[];
  topResults: { position: number; title: string; url: string }[];
  note: string;
}

export interface AIReviewResponse {
  review: AIReviewMap;
  evidence?: ContentReviewEvidence;
}

/**
 * Persisted result of an AI review run (C4, audit #16).
 * Stored on `content_posts.ai_review` so verdicts survive editor close.
 * The stored map is always the post-provenance-marking map: provenance-sensitive
 * keys (`factual_accuracy`, `no_hallucinations`) are persisted with `pass: false`
 * + `humanReviewRequired: true` — never raw AI passes.
 */
export interface StoredAIReview {
  review: AIReviewMap;
  /** Evidence snapshot shown alongside verdicts; absent when the brief had no saved sources. */
  evidence?: ContentReviewEvidence;
  /** ISO timestamp of the review run. */
  reviewedAt: string;
  /** Model that produced the verdicts (when reported by the dispatcher). */
  model?: string;
}

/**
 * One scraped source page persisted for evidence grounding (C4, audit #16).
 * Field-for-field mirror of the server `ScrapedPage` shape produced by C1's
 * `collectBriefEnrichment` (server/content-brief-scrape-enrichment.ts) — do not
 * diverge; the enrichment helper's exported interface is the contract.
 */
export interface BriefScrapedSource {
  url: string;
  title: string;
  metaDescription: string;
  headings: { level: number; text: string }[];
  /** Plain-text excerpt — the scraper truncates to ~3000 chars before this is stored. */
  bodyText: string;
  wordCount: number;
  fetchedAt: string;
}

/**
 * Scraped SERP/reference source text persisted on the brief (C4, audit #16).
 * Stored on `content_briefs.source_evidence`. Enables the real-text evidence
 * ledger (#27). Admin-internal — stripped from public client brief responses.
 */
export interface BriefSourceEvidence {
  /** Scraped reference URL content (admin-supplied competitor/inspiration URLs). */
  scrapedReferences?: BriefScrapedSource[];
  /** Real SERP organic results including snippet text (previously dropped at the generateBrief boundary). */
  serpResults?: { position: number; title: string; url: string; snippet: string }[];
  /** When the SERP was fetched. */
  serpFetchedAt?: string;
  /** Scraped own-site style example pages (GA4 top performers). */
  styleExamples?: BriefScrapedSource[];
  /** ISO timestamp the evidence pack was captured. */
  capturedAt: string;
}

/**
 * Lightweight post summary used in admin list views (RequestList, ContentBriefs).
 * Full shape lives in GeneratedPost; this is the summary projection returned by
 * useAdminPostsList and threaded down to request-level UI.
 */
export interface PostSummary {
  id: string;
  briefId: string;
  targetKeyword: string;
  title: string;
  totalWordCount: number;
  status: string;
  generationStyle?: ContentGenerationStyle;
  createdAt: string;
  updatedAt: string;
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
  status: 'generating' | 'draft' | 'review' | 'approved' | 'error';
  unificationStatus?: 'pending' | 'success' | 'failed' | 'skipped';
  unificationNote?: string;
  reviewChecklist?: ReviewChecklist;
  /** Persisted AI review verdicts (C4) — survives editor close. Admin-internal; stripped from public post responses. */
  aiReview?: StoredAIReview;
  // Webflow publish tracking
  webflowItemId?: string;
  webflowCollectionId?: string;
  publishedAt?: string;
  publishedSlug?: string;
  /**
   * W6.6: admin-set planned/scheduled publish date (ISO string) for the
   * forward-planning Content Calendar. Distinct from publishedAt (the actual
   * publish outcome): this is the *intent*. Unscheduled drafts have it absent.
   * Admin-internal — NOT serialized on public post responses.
   */
  plannedPublishAt?: string;
  // Brand voice scoring (v2)
  voiceScore?: number;
  voiceFeedback?: string;
  // Content generation style used for this generated post
  generationStyle?: ContentGenerationStyle;
  /**
   * W5.1: read-back outcome verdict for this post's tracked action — the latest
   * conclusive measurement (90-day clicks/position delta + verdict). Enriched at
   * the list-route boundary (GET /api/content-posts/:workspaceId) by joining the
   * post's targetKeyword to its scored outcome. Absent for unpublished posts or
   * posts with no scored action yet. NOT persisted on the post row — purely a
   * read-side decoration. Positions are honest (lower=better); trust `direction`.
   */
  outcome?: OutcomeReadback;
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
  status: 'pending_payment' | 'requested' | 'brief_generated' | 'client_review' | 'approved' | 'changes_requested' | 'in_progress' | 'post_review' | 'delivered' | 'published' | 'declined';
  briefId?: string;
  postId?: string;
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
  /** Originating recommendation id for requests created via client "Act on this".
   *  Absent on operator-created or legacy requests.
   *  @see StrategyCardContext for the accompanying context blob. */
  recommendationId?: string;
  /** Strategy card context captured at act-on time (rationale, volume, difficulty,
   *  trendDirection, serpFeatures, intent, priority, etc.).
   *  Parsed from the `strategy_card_context` JSON column via parseJsonSafe.
   *  Absent when no strategy context was available at request creation. */
  strategyCardContext?: StrategyCardContext;
  comments?: ContentRequestComment[];
  requestedAt: string;
  updatedAt: string;
}

export interface ContentPerformanceGscMetrics {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface ContentPerformanceGa4Metrics {
  sessions: number;
  users: number;
  bounceRate: number;
  avgEngagementTime: number;
  conversions: number;
}

export type ContentPerformanceSource = 'request' | 'matrix';
export type ContentPerformanceTrendAvailability =
  | 'available'
  | 'insufficient_data'
  | 'gsc_not_configured'
  | 'page_unmapped'
  | 'provider_unavailable'
  | 'source_unsupported';
export type ContentTermCoverageStatus = 'strong' | 'partial' | 'weak' | 'unavailable';

export interface ContentPerformanceTrendPoint {
  date: string;
  clicks: number;
  impressions: number;
  /** Already a percentage. */
  ctr: number;
  position: number;
}

export interface ContentPerformanceTrendResponse {
  availability: ContentPerformanceTrendAvailability;
  reason?: string;
  trend: ContentPerformanceTrendPoint[];
}

export interface ContentPerformanceSummary {
  piecesTracked: number;
  piecesPublished: number;
  piecesDelivered: number;
  totalClicks: number;
  totalImpressions: number;
  totalSessions: number;
  averagePosition: number | null;
  measuredOutcomes: number;
  wins: number;
  /** Positive means ranking positions improved; null means no position-based readback exists. */
  averagePositionGain: number | null;
}

export interface ContentTermCoverageGrade {
  status: ContentTermCoverageStatus;
  /** Already a percentage (e.g., 71 for 71%). Do NOT multiply by 100. */
  coveragePct: number | null;
  requiredCount: number;
  matchedCount: number;
  missingCount: number;
  missingTerms: string[];
  reason?: string;
}

export interface ContentPerformanceJoinback {
  briefId?: string;
  postId?: string;
  briefTitle?: string;
  briefTargetKeyword?: string;
  postTitle?: string;
  hasSourceEvidence: boolean;
  evidenceSourceCounts: {
    scrapedReferences: number;
    serpResults: number;
    styleExamples: number;
    peopleAlsoAsk: number;
  };
}

export interface ContentPerformanceItem {
  /** Stable identity across request-backed and matrix-backed published work. */
  itemId: string;
  requestId: string;
  topic: string;
  targetKeyword: string;
  targetPageSlug?: string;
  pageType?: string;
  status: string;
  publishedAt?: string;
  daysSincePublish: number;
  gsc: ContentPerformanceGscMetrics | null;
  ga4: ContentPerformanceGa4Metrics | null;
  source: ContentPerformanceSource;
  coverage: ContentTermCoverageGrade;
  joinback?: ContentPerformanceJoinback;
  /**
   * SB-006 (UI-rebuild W1.2) — server-computed win/early/flat verdict for this item's tracked
   * action, REUSING the existing OutcomeReadback (score + direction). Wired at the read boundary
   * by joining source-id (`post::<id>`) then targetKeyword to the scored read-back — the exact
   * pattern already proven for GeneratedPost.outcome (server/content-posts-db.ts enrichPostsWithOutcomes).
   * NOT a new enum and NOT persisted; absent when no scored action exists yet (honest absence).
   * The client maps OutcomeScore → its win/early/flat label; the server never composes prose (AD-002).
   */
  outcome?: OutcomeReadback;
}

export interface ContentPerformanceResponse {
  summary: ContentPerformanceSummary;
  items: ContentPerformanceItem[];
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
  narrativeRole?: string;   // StoryBrand or custom narrative role
  brandNote?: string;        // one-line brand purpose
  seoNote?: string;          // one-line SEO purpose
}

export type ContentPageType =
  | 'blog' | 'landing' | 'service' | 'location' | 'product'
  | 'pillar' | 'resource' | 'provider-profile' | 'procedure-guide' | 'pricing-page'
  | 'homepage' | 'about' | 'contact' | 'faq' | 'testimonials' | 'custom';

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
  | 'flagged'
  | 'approved'
  | 'published';

export interface KeywordCandidate {
  keyword: string;
  volume: number;
  difficulty: number;
  cpc: number;
  source: 'pattern' | 'semrush_related' | 'ai_suggested' | 'gsc';
  isRecommended: boolean;
  authorityAssessment?: {
    posture: 'authority_unknown' | 'within_current_authority_range' | 'requires_authority_building';
    note: string;
    referringDomains?: number;
  };
}

export interface KeywordRecommendationReasoningAlternative {
  keyword: string;
  reasons: string[];
}

export interface KeywordRecommendationReasoning {
  recommendedReason: string;
  alternatives: KeywordRecommendationReasoningAlternative[];
}

export interface KeywordRecommendationOptions {
  useAI?: boolean;
  maxCandidates?: number;
  includeReasoning?: boolean;
}

export interface KeywordRecommendationResult {
  seedKeyword: string;
  candidates: KeywordCandidate[];
  recommended: string | null;
  message?: string;
  reasoning?: KeywordRecommendationReasoning;
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

// ── Brief generation planning types ─────────────────────────────

/** Journey stage derived from search intent for page-type prompt tuning. */
export type BriefJourneyStage = 'awareness' | 'consideration' | 'decision';

/** Page types supported by the brief generation engine. */
export const BRIEF_PAGE_TYPES = [
  'blog',
  'landing',
  'service',
  'location',
  'pillar',
  'product',
  'resource',
] as const;
export type BriefPageType = typeof BRIEF_PAGE_TYPES[number];

/**
 * Strategy card metadata threaded from a content request into generateBrief().
 * Captures all context visible on a recommendation card so the brief
 * reflects strategic reasoning, not just the keyword.
 */
export interface StrategyCardContext {
  rationale?: string;
  volume?: number;
  difficulty?: number;
  trendDirection?: 'rising' | 'declining' | 'stable';
  /** e.g. ['featured_snippet', 'people_also_ask'] */
  serpFeatures?: string[];
  competitorProof?: string;
  impressions?: number;
  /** Search intent from the strategy gap (informational / commercial / transactional). */
  intent?: string;
  /** Priority from the strategy gap (high / medium / low). */
  priority?: string;
  /** Journey stage derived from intent — set by the route layer, not the client. */
  journeyStage?: BriefJourneyStage;
}

/**
 * Tone + structure configuration per page type.
 * PAGE_TYPE_CONFIGS in server/content-brief.ts maps BriefPageType → PageTypeBriefConfig.
 */
export interface PageTypeBriefConfig {
  /** Prose description of the recommended tone (injected into prompt). */
  tone: string;
  /** Recommended outline structure summary (injected into prompt). */
  structure: string;
  /** Schema.org types recommended for this page type, e.g. ['Article', 'BreadcrumbList']. */
  schemaTypes: string[];
  /** Target word count for this page type. */
  wordCountTarget: number;
  /** Word count range string shown in prompt, e.g. "1400–2200". */
  wordCountRange: string;
  /** Average words per section (used in per-section wordCount prompt values). */
  avgSectionWords: number;
  /** Recommended number of H2 sections, e.g. "6–8". */
  sectionRange: string;
  /** Full content style guidance injected into the prompt. */
  contentStyle: string;
  /** Full page-type instruction block injected verbatim into the generateBrief() prompt. */
  prompt: string;
}

export interface AiFixResult {
  field: 'introduction' | 'section' | 'conclusion' | 'meta' | 'post';
  sectionIndex?: number;
  originalText: string;
  suggestedText: string;
  explanation: string;
}

export const AI_FEEDBACK_TARGETS = ['section', 'post', 'meta'] as const;
export type AiFeedbackTarget = typeof AI_FEEDBACK_TARGETS[number];

export interface AiFixChecklistRequest {
  mode?: 'checklist';
  issueKey: IssueKey;
  reason: string;
}

export interface AiFixFeedbackRequest {
  mode: 'feedback';
  target: AiFeedbackTarget;
  feedback: string;
  sectionIndex?: number;
}

export type AiFixRequest = AiFixChecklistRequest | AiFixFeedbackRequest;

export const ISSUE_KEYS = ['factual_accuracy', 'brand_voice', 'internal_links', 'no_hallucinations', 'meta_optimized', 'word_count_target'] as const;
export type IssueKey = typeof ISSUE_KEYS[number];
