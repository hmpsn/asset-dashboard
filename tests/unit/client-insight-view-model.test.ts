import { afterEach, describe, expect, it } from 'vitest';
import {
  buildClientIntelligenceView,
  clientIntelligenceSlicesForTier,
} from '../../server/client-insight-view-model.js';
import { buildClientNarrativeInsightsView } from '../../server/client-insight-narrative-view-model.js';
import {
  deleteInsightsForWorkspace,
  upsertInsight,
} from '../../server/analytics-insights-store.js';
import type { AnalyticsInsight } from '../../shared/types/analytics.js';
import type {
  ClientSignalsSlice,
  ContentPipelineSlice,
  InsightsSlice,
  LearningsSlice,
  SeoContextSlice,
  SiteHealthSlice,
  WeCalledItEntry,
  WorkspaceIntelligence,
} from '../../shared/types/intelligence.js';

const NARRATIVE_WS = 'ws-client-narrative-view';

afterEach(() => {
  deleteInsightsForWorkspace(NARRATIVE_WS);
});

function insight(overrides: Partial<AnalyticsInsight> = {}): AnalyticsInsight {
  return {
    id: overrides.id ?? 'insight-1',
    workspaceId: overrides.workspaceId ?? 'ws-client-view',
    pageId: overrides.pageId ?? null,
    insightType: overrides.insightType ?? 'page_health',
    severity: overrides.severity ?? 'warning',
    pageTitle: overrides.pageTitle,
    data: overrides.data ?? {},
    summary: overrides.summary,
    recommendation: overrides.recommendation,
    impactScore: overrides.impactScore ?? 50,
    createdAt: overrides.createdAt ?? '2026-06-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-06-01T00:00:00.000Z',
    resolvedAt: overrides.resolvedAt,
    resolutionNote: overrides.resolutionNote,
    domain: overrides.domain ?? 'search',
  };
}

function makeInsightsSlice(): InsightsSlice {
  const topByImpact = [
    insight({ id: 'client-1', insightType: 'page_health', severity: 'warning', pageTitle: 'Fix the services page', impactScore: 90 }),
    insight({ id: 'admin-1', insightType: 'strategy_alignment', severity: 'warning', pageTitle: 'Admin-only strategy alignment', impactScore: 85 }),
    insight({ id: 'positive-1', insightType: 'ranking_mover', severity: 'positive', pageTitle: 'Positive ranking move', impactScore: 80 }),
    insight({ id: 'client-2', insightType: 'content_decay', severity: 'opportunity', pageTitle: 'Refresh the old guide', impactScore: 70 }),
    insight({ id: 'client-3', insightType: 'audit_finding', severity: 'critical', pageTitle: undefined, impactScore: 60 }),
    insight({ id: 'client-4', insightType: 'ctr_opportunity', severity: 'warning', pageTitle: 'Improve CTR', impactScore: 50 }),
  ];
  return {
    all: topByImpact,
    byType: {},
    countsByType: {},
    countsByTypeBySeverity: {
      page_health: { critical: 1, warning: 2, opportunity: 3, positive: 99 },
      content_decay: { critical: 0, warning: 0, opportunity: 4, positive: 0 },
      strategy_alignment: { critical: 10, warning: 10, opportunity: 10, positive: 10 },
    },
    bySeverity: { critical: 11, warning: 12, opportunity: 17, positive: 109 },
    topByImpact,
  };
}

function makePipelineSlice(overrides: Partial<ContentPipelineSlice> = {}): ContentPipelineSlice {
  return {
    briefs: { total: 6, byStatus: { draft: 1, ai_generated: 2, in_review: 1, published: 2 } },
    posts: { total: 5, byStatus: { draft: 1, in_review: 1, scheduled: 1, published: 2 } },
    matrices: { total: 0, cellsPlanned: 0, cellsPublished: 0 },
    requests: { pending: 0, inProgress: 0, delivered: 0 },
    workOrders: { active: 0 },
    coverageGaps: [],
    seoEdits: { pending: 1, applied: 2, inReview: 3 },
    copyPipeline: {
      totalSections: 7,
      approvedSections: 4,
      clientReviewSections: 2,
      rejectedSections: 1,
      draftSections: 0,
      approvalRate: 4 / 7,
      latestUpdatedAt: '2026-06-01T00:00:00.000Z',
    },
    decayAlerts: Array.from({ length: 12 }, (_, idx) => ({
      pageUrl: `/page-${idx}`,
      clickDrop: idx + 1,
      detectedAt: '2026-06-01T00:00:00.000Z',
      hasRefreshBrief: idx % 2 === 0,
    })),
    ...overrides,
  };
}

function makeLearningsSlice(overrides: Partial<LearningsSlice> = {}): LearningsSlice {
  return {
    availability: 'ready',
    summary: null,
    confidence: null,
    topActionTypes: [{ type: 'title_update', winRate: 0.8, count: 5 }],
    overallWinRate: 0.62,
    recentTrend: null,
    playbooks: [],
    weCalledIt: [
      {
        actionId: 'action-1',
        prediction: 'Title update will lift traffic',
        outcome: 'Traffic improved after the title update',
        score: 'strong_win',
        pageUrl: '/services',
        measuredAt: '2026-06-01T00:00:00.000Z',
      },
    ] satisfies WeCalledItEntry[],
    ...overrides,
  };
}

function makeSeoContextSlice(): SeoContextSlice {
  return {
    strategy: undefined,
    brandVoice: '',
    effectiveBrandVoiceBlock: '',
    businessContext: '',
    personas: [],
    knowledgeBase: '',
    rankTracking: {
      trackedKeywords: 12,
      avgPosition: 8.4,
      positionChanges: { improved: 3, declined: 1, unchanged: 8 },
    },
    serpFeatures: {
      featuredSnippets: 2,
      peopleAlsoAsk: 3,
      videoCarousel: 1,
      aiOverview: 4,
      localPack: true,
    },
  } as SeoContextSlice;
}

function makeClientSignalsSlice(overrides: Partial<ClientSignalsSlice> = {}): ClientSignalsSlice {
  return {
    keywordFeedback: {
      approved: ['seo agency', 'local seo', 'technical seo', 'content strategy'],
      rejected: ['cheap backlinks', 'keyword stuffing', 'expired domains', 'spam links'],
      patterns: { approveRate: 0.5, topRejectionReasons: ['Off-brand', 'Too spammy', 'Wrong market', 'Duplicate'] },
    },
    contentGapVotes: [],
    businessPriorities: [],
    effectiveBusinessPriorities: [],
    approvalPatterns: { approvalRate: 0, avgResponseTime: null },
    recentChatTopics: [],
    churnRisk: 'high',
    compositeHealthScore: 81,
    compositeHealthBreakdown: {
      rows: [{ id: 'roi', label: 'ROI', score: 81, weight: 100, description: 'Measured outcomes' }],
    },
    ...overrides,
  };
}

function makeSiteHealthSlice(): SiteHealthSlice {
  return {
    auditScore: 87,
    auditScoreDelta: 4,
    deadLinks: 2,
    redirectChains: 1,
    schemaErrors: 0,
    orphanPages: 3,
    cwvPassRate: { mobile: 0.75, desktop: 0.95 },
  };
}

function makeIntel(overrides: Partial<WorkspaceIntelligence> = {}): WorkspaceIntelligence {
  return {
    version: 1,
    workspaceId: 'ws-client-view',
    assembledAt: '2026-06-26T00:00:00.000Z',
    insights: makeInsightsSlice(),
    contentPipeline: makePipelineSlice(),
    learnings: makeLearningsSlice(),
    seoContext: makeSeoContextSlice(),
    clientSignals: makeClientSignalsSlice(),
    siteHealth: makeSiteHealthSlice(),
    ...overrides,
  };
}

describe('clientIntelligenceSlicesForTier', () => {
  it('requests only free-tier public slices for free workspaces', () => {
    expect(clientIntelligenceSlicesForTier('free')).toEqual(['insights', 'contentPipeline']);
  });

  it('adds growth slices without premium siteHealth', () => {
    expect(clientIntelligenceSlicesForTier('growth')).toEqual([
      'insights',
      'contentPipeline',
      'learnings',
      'seoContext',
      'clientSignals',
    ]);
  });

  it('adds siteHealth only for premium workspaces', () => {
    expect(clientIntelligenceSlicesForTier('premium')).toEqual([
      'insights',
      'contentPipeline',
      'learnings',
      'seoContext',
      'clientSignals',
      'siteHealth',
    ]);
  });
});

describe('buildClientNarrativeInsightsView', () => {
  it('filters client-excluded and low-impact insights, then sorts by impact score', () => {
    deleteInsightsForWorkspace(NARRATIVE_WS);

    upsertInsight({
      workspaceId: NARRATIVE_WS,
      pageId: 'page-high',
      insightType: 'page_health',
      data: {
        score: 42,
        trend: 'declining',
        clicks: 100,
        impressions: 1000,
        position: 8,
        ctr: 10,
        pageviews: 80,
        bounceRate: 0.4,
        avgEngagementTime: 75,
      },
      severity: 'warning',
      pageTitle: 'Services Page',
      impactScore: 72,
      domain: 'technical',
    });
    upsertInsight({
      workspaceId: NARRATIVE_WS,
      pageId: 'page-low',
      insightType: 'page_health',
      data: {
        score: 92,
        trend: 'stable',
        clicks: 10,
        impressions: 100,
        position: 2,
        ctr: 10,
        pageviews: 15,
        bounceRate: 0.2,
        avgEngagementTime: 120,
      },
      severity: 'positive',
      pageTitle: 'Low Impact Page',
      impactScore: 19,
      domain: 'technical',
    });
    upsertInsight({
      workspaceId: NARRATIVE_WS,
      pageId: null,
      insightType: 'strategy_alignment',
      data: {
        alignedCount: 1,
        misalignedCount: 9,
        untrackedCount: 2,
        summary: 'Admin-only alignment note',
      },
      severity: 'warning',
      pageTitle: 'Strategy Alignment',
      impactScore: 99,
      domain: 'cross',
    });
    upsertInsight({
      workspaceId: NARRATIVE_WS,
      pageId: 'page-decay',
      insightType: 'content_decay',
      data: {
        baselineClicks: 200,
        currentClicks: 120,
        deltaPercent: -40,
        baselinePeriod: 'previous',
        currentPeriod: 'current',
      },
      severity: 'critical',
      pageTitle: 'Evergreen Guide',
      impactScore: 88,
      domain: 'content',
    });

    const view = buildClientNarrativeInsightsView(NARRATIVE_WS);

    expect(view.map(i => i.type)).toEqual(['content_decay', 'page_health']);
    expect(view.map(i => i.impactScore)).toEqual([88, 72]);
    expect(view[0]).toMatchObject({
      headline: 'We noticed a traffic change on Evergreen Guide',
      domain: 'content',
    });
    expect(JSON.stringify(view)).not.toContain('Admin-only alignment note');
    expect(JSON.stringify(view)).not.toContain('Low Impact Page');
  });
});

describe('buildClientIntelligenceView', () => {
  it('keeps free tier response limited to all-tier keys', () => {
    const view = buildClientIntelligenceView(makeIntel(), 'free');

    expect(view).toMatchObject({
      workspaceId: 'ws-client-view',
      assembledAt: '2026-06-26T00:00:00.000Z',
      tier: 'free',
    });
    expect(view.pipelineStatus).toEqual({
      briefs: { total: 6, inProgress: 4 },
      posts: { total: 5, inProgress: 3 },
      pendingApprovals: 3,
    });
    expect('learningHighlights' in view).toBe(false);
    expect('keywordFeedbackSummary' in view).toBe(false);
    expect('siteHealthSummary' in view).toBe(false);
    expect(JSON.stringify(view)).not.toContain('churnRisk');
  });

  it('uses pre-cap severity counts while scrubbing admin-only and positive insights', () => {
    const view = buildClientIntelligenceView(makeIntel(), 'free');

    expect(view.insightsSummary).toEqual({
      total: 10,
      highPriority: 3,
      mediumPriority: 7,
      topInsights: [
        { title: 'Fix the services page', type: 'page_health' },
        { title: 'Refresh the old guide', type: 'content_decay' },
        { title: 'audit_finding', type: 'audit_finding' },
      ],
    });
  });

  it('adds growth-only fields without premium site health', () => {
    const view = buildClientIntelligenceView(makeIntel(), 'growth');

    expect(view.learningHighlights).toEqual({
      overallWinRate: 0.62,
      topActionType: 'title_update',
      recentWins: 1,
    });
    expect(view.rankTrackingSummary).toEqual({
      trackedKeywords: 12,
      avgPosition: 8.4,
      positionChanges: { improved: 3, declined: 1, unchanged: 8 },
    });
    expect(view.serpOpportunities).toBe(11);
    expect(view.compositeHealthScore).toBe(81);
    expect(view.copyPipelineStatus).toEqual({
      totalSections: 7,
      approvedSections: 4,
      inReviewSections: 2,
      approvalRate: 4 / 7,
    });
    expect(view.weCalledIt).toEqual([
      {
        actionId: 'action-1',
        prediction: 'Title update will lift traffic',
        outcome: 'Traffic improved after the title update',
        score: 'strong_win',
        pageUrl: '/services',
        measuredAt: '2026-06-01T00:00:00.000Z',
      },
    ]);
    expect('siteHealthSummary' in view).toBe(false);
  });

  it('caps keyword feedback samples and rejection reasons for client display', () => {
    const view = buildClientIntelligenceView(makeIntel(), 'growth');

    expect(view.keywordFeedbackSummary).toEqual({
      approvedCount: 4,
      rejectedCount: 4,
      approveRate: 0.5,
      approvedSamples: ['seo agency', 'local seo', 'technical seo'],
      rejectedSamples: ['cheap backlinks', 'keyword stuffing', 'expired domains'],
      rejectionReasons: ['Off-brand', 'Too spammy', 'Wrong market'],
    });
  });

  it('adds premium site health and caps content decay alerts', () => {
    const view = buildClientIntelligenceView(makeIntel(), 'premium');

    expect(view.siteHealthSummary).toEqual({
      auditScore: 87,
      auditScoreDelta: 4,
      cwvPassRatePct: 85,
      deadLinks: 2,
    });
    expect(view.contentDecayAlerts).toHaveLength(10);
    expect(view.contentDecayAlerts?.[0]).toEqual({
      pageUrl: '/page-0',
      clickDrop: 1,
      detectedAt: '2026-06-01T00:00:00.000Z',
      hasRefreshBrief: true,
    });
  });

  it('returns null growth summaries when source slices are unavailable or not ready', () => {
    const view = buildClientIntelligenceView(makeIntel({
      learnings: makeLearningsSlice({ availability: 'no_data', weCalledIt: undefined }),
      seoContext: undefined,
      clientSignals: makeClientSignalsSlice({
        keywordFeedback: {
          approved: [],
          rejected: [],
          patterns: { approveRate: 0, topRejectionReasons: [] },
        },
        compositeHealthScore: null,
        compositeHealthBreakdown: null,
      }),
      contentPipeline: makePipelineSlice({ copyPipeline: undefined }),
    }), 'growth');

    expect(view.learningHighlights).toBeNull();
    expect(view.weCalledIt).toEqual([]);
    expect(view.rankTrackingSummary).toBeNull();
    expect(view.serpOpportunities).toBeNull();
    expect(view.keywordFeedbackSummary).toBeNull();
    expect(view.copyPipelineStatus).toBeNull();
  });
});
