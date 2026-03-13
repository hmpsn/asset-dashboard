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
