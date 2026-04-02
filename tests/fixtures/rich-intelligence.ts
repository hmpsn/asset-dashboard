// tests/fixtures/rich-intelligence.ts
import type {
  WorkspaceIntelligence,
  SeoContextSlice,
  InsightsSlice,
  LearningsSlice,
  PageProfileSlice,
  ContentPipelineSlice,
  SiteHealthSlice,
  ClientSignalsSlice,
  OperationalSlice,
} from '../../shared/types/intelligence.js';

export const RICH_SEO_CONTEXT: SeoContextSlice = {
  strategy: {
    siteKeywords: ['enterprise seo', 'analytics platform', 'seo tools', 'rank tracking', 'content optimization'],
    pageMap: [
      { pagePath: '/features', pageTitle: 'Enterprise SEO Platform | Features', primaryKeyword: 'enterprise seo', secondaryKeywords: ['seo analytics', 'seo platform'], searchIntent: 'commercial', currentPosition: 5, previousPosition: 8 },
      { pagePath: '/pricing', pageTitle: 'SEO Pricing Plans', primaryKeyword: 'seo pricing', secondaryKeywords: ['seo cost'], searchIntent: 'transactional', currentPosition: 12, previousPosition: 15 },
    ],
    opportunities: ['voice search optimization', 'featured snippets'],
    businessContext: 'Enterprise SEO analytics platform serving Fortune 500 companies',
    generatedAt: '2026-03-15T00:00:00Z',
  },
  brandVoice: 'Professional, data-driven, and authoritative. No fluff or filler content.',
  businessContext: 'Enterprise SEO analytics platform serving Fortune 500 companies',
  personas: [
    {
      id: 'p1',
      name: 'Marketing Director',
      description: 'Mid-level executive responsible for organic growth metrics',
      painPoints: ['Proving SEO ROI to C-suite', 'Managing multiple agency relationships'],
      goals: ['Increase organic traffic 30% YoY', 'Reduce dependency on paid channels'],
      objections: ['SEO takes too long to show results', 'Hard to attribute revenue to SEO'],
      preferredContentFormat: 'case studies and data reports',
      buyingStage: 'consideration',
    },
    {
      id: 'p2',
      name: 'SEO Manager',
      description: 'Hands-on practitioner running day-to-day SEO operations',
      painPoints: ['Manual keyword tracking across 500+ pages', 'Content decay detection'],
      goals: ['Automate rank monitoring', 'Catch content decay before traffic drops'],
      objections: ['Another tool to learn', 'Integration complexity with existing stack'],
      preferredContentFormat: 'how-to guides and technical docs',
      buyingStage: 'decision',
    },
  ],
  knowledgeBase: 'We specialize in enterprise SEO analytics with real-time rank tracking and AI-powered insights.',
  pageKeywords: {
    pagePath: '/features',
    pageTitle: 'Enterprise SEO Platform | Features',
    primaryKeyword: 'enterprise seo',
    secondaryKeywords: ['seo analytics', 'seo platform'],
    searchIntent: 'commercial',
    currentPosition: 5,
    previousPosition: 8,
  },
  businessProfile: {
    industry: 'SaaS / MarTech',
    goals: ['Increase enterprise market share', 'Launch APAC region'],
    targetAudience: 'VP Marketing and SEO Directors at companies with 500+ employees',
  },
  rankTracking: {
    trackedKeywords: 47,
    avgPosition: 14.3,
    positionChanges: { improved: 12, declined: 5, stable: 30 },
  },
  strategyHistory: {
    revisionsCount: 3,
    lastRevisedAt: '2026-03-10T00:00:00Z',
    trajectory: 'expanding',
  },
};

export const RICH_INSIGHTS: InsightsSlice = {
  all: [
    { id: 'ins-1', insightType: 'content_decay', severity: 'warning', impactScore: 8, pageId: '/blog/old-post', title: 'Content decay detected', description: 'Traffic down 35%' } as any,
    { id: 'ins-2', insightType: 'ranking_opportunity', severity: 'opportunity', impactScore: 6, pageId: '/services', title: 'Ranking opportunity', description: 'Page 2 keyword' } as any,
  ],
  byType: { content_decay: [{ id: 'ins-1' } as any] },
  bySeverity: { critical: 0, warning: 1, opportunity: 1, positive: 0 },
  topByImpact: [
    { id: 'ins-1', insightType: 'content_decay', severity: 'warning', impactScore: 8, pageId: '/blog/old-post' } as any,
  ],
};

export const RICH_LEARNINGS: LearningsSlice = {
  summary: {
    workspaceId: 'ws-rich',
    computedAt: '2026-03-30T00:00:00Z',
    confidence: 'high' as const,
    totalScoredActions: 25,
    content: {
      winRateByFormat: { long_form: 0.75, listicle: 0.45, case_study: 0.82 },
      avgDaysToPage1: 38,
      refreshRecoveryRate: 0.67,
      bestPerformingTopics: ['seo tips', 'rank tracking guides', 'content strategy'],
      optimalWordCount: { min: 1200, max: 2500 },
      voiceScoreCorrelation: 0.72,
    },
    strategy: {
      winRateByDifficultyRange: { '0-20': 0.85, '21-40': 0.65, '41-60': 0.35 },
      winRateByCheckpoint: {},
      bestIntentTypes: ['informational', 'commercial'],
      keywordVolumeSweetSpot: { min: 500, max: 8000 },
    },
    technical: {
      winRateByFixType: { meta_tag: 0.78, schema_markup: 0.62, internal_link: 0.55 },
      schemaTypesWithRichResults: ['FAQ', 'HowTo', 'Article'],
      avgHealthScoreImprovement: 12,
      internalLinkEffectiveness: 0.72,
    },
    overall: {
      totalWinRate: 0.62,
      strongWinRate: 0.28,
      topActionTypes: [
        { type: 'content_refreshed', winRate: 0.72, count: 10 },
        { type: 'meta_updated', winRate: 0.45, count: 8 },
        { type: 'internal_link_added', winRate: 0.55, count: 5 },
      ],
      recentTrend: 'improving' as const,
    },
  },
  confidence: 'high',
  topActionTypes: [
    { type: 'content_refreshed', winRate: 0.72, count: 10 },
    { type: 'meta_updated', winRate: 0.45, count: 8 },
    { type: 'internal_link_added', winRate: 0.55, count: 5 },
  ],
  overallWinRate: 0.62,
  recentTrend: 'improving',
  playbooks: [],
  weCalledIt: [
    { actionId: 'a1', prediction: 'Title change will boost CTR', outcome: 'CTR up 23%', score: 'win', pageUrl: '/blog/seo-tips', measuredAt: '2026-03-25T00:00:00Z' },
  ],
  roiAttribution: [
    { actionId: 'a2', pageUrl: '/services', actionType: 'content_refreshed', clicksBefore: 120, clicksAfter: 185, clickGain: 65, measuredAt: '2026-03-28T00:00:00Z' },
  ],
};

export const RICH_PAGE_PROFILE: PageProfileSlice = {
  pagePath: '/features',
  primaryKeyword: 'enterprise seo',
  searchIntent: 'commercial',
  optimizationScore: 78,
  recommendations: ['Add FAQ schema', 'Increase internal links to /pricing'],
  contentGaps: ['competitor comparison table', 'pricing transparency'],
  insights: [],
  actions: [],
  auditIssues: ['Missing H2 structure', 'OG image not set'],
  schemaStatus: 'warnings',
  linkHealth: { inbound: 15, outbound: 8, orphan: false },
  seoEdits: { currentTitle: 'Enterprise SEO Platform | Features', currentMeta: 'Discover our enterprise SEO features', lastEditedAt: '2026-03-20T00:00:00Z' },
  rankHistory: { current: 5, best: 3, trend: 'down' },
  contentStatus: 'published',
  cwvStatus: 'good',
};

export const RICH_CONTENT_PIPELINE: ContentPipelineSlice = {
  briefs: { total: 12, byStatus: { draft: 3, approved: 5, in_progress: 2, published: 2 } },
  posts: { total: 8, byStatus: { draft: 2, review: 3, published: 3 } },
  matrices: { total: 2, cellsPlanned: 24, cellsPublished: 10 },
  requests: { pending: 3, inProgress: 1, delivered: 5 },
  workOrders: { active: 2 },
  coverageGaps: ['voice search optimization', 'local seo strategy'],
  seoEdits: { pending: 4, applied: 12, inReview: 2 },
  subscriptions: { active: 2, totalPages: 8 },
  schemaDeployment: { planned: 10, deployed: 6, types: ['FAQ', 'Article', 'HowTo'] },
  cannibalizationWarnings: [
    { keyword: 'seo tools', pages: ['/features', '/blog/best-seo-tools'], severity: 'medium' },
  ],
  decayAlerts: [
    { pageUrl: '/blog/old-guide', clickDrop: 45, detectedAt: '2026-03-28T00:00:00Z', hasRefreshBrief: false, isRepeatDecay: false },
  ],
};

export const RICH_SITE_HEALTH: SiteHealthSlice = {
  auditScore: 82,
  auditScoreDelta: 3,
  deadLinks: 5,
  redirectChains: 2,
  schemaErrors: 3,
  orphanPages: 1,
  cwvPassRate: { mobile: 0.73, desktop: 0.91 },
  redirectDetails: [
    { url: '/old-page', target: '/new-page', chainDepth: 1, status: 301 },
    { url: '/legacy', target: '/old-page', chainDepth: 2, status: 301 },
  ],
  schemaValidation: { valid: 15, warnings: 4, errors: 3 },
  performanceSummary: { avgLcp: 2.1, avgFid: 45, avgCls: 0.08, score: 76 },
  anomalyCount: 2,
  anomalyTypes: ['traffic_spike', 'ranking_drop'],
  seoChangeVelocity: 14,
};

export const RICH_CLIENT_SIGNALS: ClientSignalsSlice = {
  keywordFeedback: {
    approved: ['enterprise seo', 'seo analytics'],
    rejected: ['cheap seo'],
    patterns: { approveRate: 0.8, topRejectionReasons: ['too broad', 'off-brand'] },
  },
  contentGapVotes: [
    { topic: 'AI in SEO', votes: 5 },
    { topic: 'Local SEO guide', votes: 3 },
  ],
  businessPriorities: ['Launch APAC market by Q3', 'Reduce CAC by 20%'],
  approvalPatterns: { approvalRate: 0.85, avgResponseTime: 48 },
  recentChatTopics: ['content decay', 'keyword cannibalization', 'schema markup'],
  churnRisk: 'low',
  churnSignals: [
    { type: 'declining_engagement', severity: 'low', detectedAt: '2026-03-25T00:00:00Z' },
  ],
  roi: { organicValue: 15000, growth: 12, period: '30d' },
  engagement: { lastLoginAt: '2026-03-30T00:00:00Z', loginFrequency: 'daily', chatSessionCount: 15, portalUsage: null },
  compositeHealthScore: 82,
  feedbackItems: [
    { id: 'f1', type: 'feature_request', status: 'new', createdAt: '2026-03-28T00:00:00Z' },
  ],
  serviceRequests: { pending: 1, total: 4 },
};

export const RICH_OPERATIONAL: OperationalSlice = {
  recentActivity: [
    { type: 'insight_resolved', description: 'Resolved content decay on /blog/old-guide', timestamp: '2026-03-30T10:00:00Z' },
    { type: 'brief_created', description: 'Created brief for voice search optimization', timestamp: '2026-03-30T09:00:00Z' },
    { type: 'approval_completed', description: 'Approved meta updates for /pricing', timestamp: '2026-03-29T16:00:00Z' },
  ],
  annotations: [
    { date: '2026-03-15', label: 'Core algorithm update', pageUrl: undefined },
  ],
  pendingJobs: 3,
  timeSaved: { totalMinutes: 240, byFeature: { 'auto-insights': 120, 'bulk-seo-edits': 80, 'content-briefs': 40 } },
  approvalQueue: { pending: 4, oldestAge: 72 },
  recommendationQueue: { fixNow: 2, fixSoon: 5, fixLater: 8 },
  actionBacklog: { pendingMeasurement: 6, oldestAge: 168 },
  detectedPlaybooks: ['content refresh after decay', 'meta optimization sprint'],
  workOrders: { active: 2, pending: 1 },
  insightAcceptanceRate: { totalShown: 50, confirmed: 35, dismissed: 10, rate: 0.7 },
};

export const RICH_INTELLIGENCE: WorkspaceIntelligence = {
  version: 1,
  workspaceId: 'ws-rich',
  assembledAt: '2026-03-30T12:00:00.000Z',
  seoContext: RICH_SEO_CONTEXT,
  insights: RICH_INSIGHTS,
  learnings: RICH_LEARNINGS,
  pageProfile: RICH_PAGE_PROFILE,
  contentPipeline: RICH_CONTENT_PIPELINE,
  siteHealth: RICH_SITE_HEALTH,
  clientSignals: RICH_CLIENT_SIGNALS,
  operational: RICH_OPERATIONAL,
};
