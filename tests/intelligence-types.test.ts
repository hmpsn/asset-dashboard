// tests/intelligence-types.test.ts
import { describe, it, expect } from 'vitest';
import type {
  WorkspaceIntelligence,
  SeoContextSlice,
  ContentPipelineSlice,
  SiteHealthSlice,
  PageProfileSlice,
  ClientSignalsSlice,
  OperationalSlice,
  LearningsSlice,
  BusinessProfile,
  BacklinkProfile,
  SerpFeatures,
  CompositeHealthScore,
  EngagementMetrics,
  ChurnSignalSummary,
  WeCalledItEntry,
  ROIAttribution,
} from '../shared/types/intelligence.js';

describe('Intelligence types', () => {
  it('WorkspaceIntelligence has version 1', () => {
    const intel: WorkspaceIntelligence = {
      version: 1,
      workspaceId: 'ws-1',
      assembledAt: new Date().toISOString(),
    };
    expect(intel.version).toBe(1);
  });

  it('SeoContextSlice supports new fields', () => {
    const ctx: SeoContextSlice = {
      strategy: undefined,
      brandVoice: 'Professional',
      businessContext: 'SaaS',
      personas: [],
      knowledgeBase: '',
      businessProfile: { industry: 'Tech', goals: ['Growth'], targetAudience: 'B2B' },
      backlinkProfile: { totalBacklinks: 500, referringDomains: 100, trend: 'growing' },
      serpFeatures: { featuredSnippets: 3, peopleAlsoAsk: 5, localPack: true },
      rankTracking: { trackedKeywords: 10, avgPosition: 15.2, positionChanges: { improved: 3, declined: 1, stable: 6 } },
      keywordRecommendations: [],
      strategyHistory: { revisionsCount: 3, lastRevisedAt: '2026-03-15' },
    };
    expect(ctx.businessProfile?.industry).toBe('Tech');
  });

  it('ContentPipelineSlice supports subscriptions and schema fields', () => {
    const pipeline: ContentPipelineSlice = {
      briefs: { total: 5, byStatus: { draft: 2, ready: 3 } },
      posts: { total: 3, byStatus: { draft: 1, published: 2 } },
      matrices: { total: 1, cellsPlanned: 10, cellsPublished: 4 },
      requests: { pending: 2, inProgress: 1, delivered: 5 },
      workOrders: { active: 1 },
      coverageGaps: ['keyword-a'],
      seoEdits: { pending: 1, applied: 3, inReview: 0 },
      subscriptions: { active: 1, totalPages: 8 },
      schemaDeployment: { planned: 5, deployed: 2, types: ['Article', 'FAQ'] },
      rewritePlaybook: { patterns: ['title refresh'], lastUsedAt: null },
      cannibalizationWarnings: [],
      decayAlerts: [],
      suggestedBriefs: 4,
    };
    expect(pipeline.subscriptions?.active).toBe(1);
    expect(pipeline.rewritePlaybook?.patterns.length).toBeGreaterThan(0);
  });

  it('SiteHealthSlice supports expanded fields', () => {
    const health: SiteHealthSlice = {
      auditScore: 85,
      auditScoreDelta: 3,
      deadLinks: 2,
      redirectChains: 1,
      schemaErrors: 0,
      orphanPages: 3,
      cwvPassRate: { mobile: 0.8, desktop: 0.95 },
      redirectDetails: [],
      aeoReadiness: { pagesChecked: 10, passingRate: 0.7 },
      schemaValidation: { valid: 8, warnings: 1, errors: 1 },
      performanceSummary: null,
      anomalyCount: 2,
      anomalyTypes: ['traffic_drop', 'ranking_drop'],
      seoChangeVelocity: 5,
    };
    expect(health.aeoReadiness?.pagesChecked).toBe(10);
  });

  it('ClientSignalsSlice supports expanded fields', () => {
    const signals: ClientSignalsSlice = {
      keywordFeedback: { approved: ['kw1'], rejected: ['kw2'], patterns: { approveRate: 0.8, topRejectionReasons: ['low volume'] } },
      contentGapVotes: [{ topic: 'AI', votes: 3 }],
      businessPriorities: ['Growth'],
      approvalPatterns: { approvalRate: 0.85, avgResponseTime: 48 },
      recentChatTopics: ['rankings'],
      churnRisk: 'low',
      churnSignals: [{ type: 'no_login', severity: 'low', detectedAt: '2026-03-28' }],
      roi: { organicValue: 5000, growth: 12.5, period: 'monthly' },
      engagement: { loginFrequency: 'weekly', chatSessionCount: 10, lastLoginAt: null, portalUsage: null },
      compositeHealthScore: 72,
      feedbackItems: [],
      serviceRequests: { pending: 0, total: 2 },
    };
    expect(signals.engagement?.loginFrequency).toBe('weekly');
  });

  it('OperationalSlice supports expanded fields', () => {
    const ops: OperationalSlice = {
      recentActivity: [],
      annotations: [],
      pendingJobs: 0,
      timeSaved: null,
      approvalQueue: { pending: 2, oldestAge: 48 },
      recommendationQueue: { fixNow: 1, fixSoon: 3, fixLater: 5 },
      actionBacklog: { pendingMeasurement: 4, oldestAge: 30 },
      detectedPlaybooks: ['content_refresh_after_decay'],
      workOrders: { active: 1, pending: 2 },
      insightAcceptanceRate: null,
    };
    expect(ops.recommendationQueue?.fixNow).toBe(1);
  });

  it('LearningsSlice supports ROI and WeCalledIt', () => {
    const learnings: LearningsSlice = {
      summary: null,
      confidence: null,
      topActionTypes: [],
      overallWinRate: 0,
      recentTrend: null,
      playbooks: [],
      roiAttribution: [],
      weCalledIt: [],
    };
    expect(learnings.roiAttribution).toEqual([]);
  });

  it('CompositeHealthScore uses 40/30/30 formula', () => {
    const score: CompositeHealthScore = {
      score: 72,
      components: {
        churn: { score: 80, weight: 0.4 },
        roi: { score: 65, weight: 0.3 },
        engagement: { score: 68, weight: 0.3 },
      },
      computedAt: new Date().toISOString(),
    };
    expect(score.components.churn.weight).toBe(0.4);
  });
});
