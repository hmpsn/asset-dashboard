import { describe, it, expect } from 'vitest';
import { formatForPrompt } from '../server/workspace-intelligence.js';
import type {
  WorkspaceIntelligence,
  SeoContextSlice,
  InsightsSlice,
  LearningsSlice,
  ContentPipelineSlice,
  SiteHealthSlice,
  ClientSignalsSlice,
  OperationalSlice,
  PageProfileSlice,
} from '../shared/types/intelligence.js';

// ── Helpers ──────────────────────────────────────────────────────────────

function makeSeoContext(): SeoContextSlice {
  return {
    strategy: undefined,
    brandVoice: 'Professional and authoritative',
    businessContext: 'Enterprise SaaS analytics platform',
    personas: [
      { name: 'Marketing Maya', description: 'Experienced marketer focused on growth', id: 'p1', painPoints: [], goals: [], objections: [] },
      { name: 'Dev Dan', description: 'Technical decision maker', id: 'p2', painPoints: [], goals: [], objections: [] },
    ],
    knowledgeBase: 'Specializes in enterprise SEO analytics for Fortune 500 companies',
    rankTracking: { trackedKeywords: 150, avgPosition: 12.5, positionChanges: { improved: 30, declined: 10, stable: 110 } },
  };
}

function makeInsights(): InsightsSlice {
  return {
    all: [
      { id: 'i1', insightType: 'content_gap' as const, severity: 'critical' as const, impactScore: 95, pageId: '/blog/test', title: 'Missing content cluster', workspaceId: 'ws-1', status: 'active' as const, detectedAt: '2026-03-30', resolvedAt: null, data: {} },
      { id: 'i2', insightType: 'traffic_drop' as const, severity: 'warning' as const, impactScore: 70, pageId: '/pricing', title: 'Traffic decline', workspaceId: 'ws-1', status: 'active' as const, detectedAt: '2026-03-29', resolvedAt: null, data: {} },
    ],
    byType: {},
    bySeverity: { critical: 1, warning: 1, opportunity: 0, positive: 0 },
    topByImpact: [],
  };
}

function makeLearnings(): LearningsSlice {
  return {
    summary: { confidence: 'medium' as const, overall: { topActionTypes: [], totalWinRate: 0.55, recentTrend: 'improving' as const }, byDomain: {} } as LearningsSlice['summary'],
    confidence: 'medium',
    topActionTypes: [
      { type: 'content_refreshed', winRate: 0.7, count: 15 },
      { type: 'meta_update', winRate: 0.5, count: 8 },
    ],
    overallWinRate: 0.55,
    recentTrend: 'improving',
    playbooks: [],
    weCalledIt: [
      { actionId: 'a1', prediction: 'Meta update will boost CTR', outcome: 'strong_win', score: 'strong_win', pageUrl: '/blog/test', measuredAt: '2026-03-28' },
    ],
    roiAttribution: [
      { actionId: 'a2', pageUrl: '/pricing', actionType: 'content_refreshed', clicksBefore: 100, clicksAfter: 180, clickGain: 80, measuredAt: '2026-03-27' },
    ],
  };
}

function makeContentPipeline(): ContentPipelineSlice {
  return {
    briefs: { total: 5, byStatus: { draft: 2, ready: 3 } },
    posts: { total: 3, byStatus: { draft: 1, published: 2 } },
    matrices: { total: 1, cellsPlanned: 10, cellsPublished: 4 },
    requests: { pending: 2, inProgress: 1, delivered: 5 },
    workOrders: { active: 1 },
    coverageGaps: ['competitive analysis', 'pricing comparison'],
    seoEdits: { pending: 1, applied: 3, inReview: 0 },
    subscriptions: { active: 1, totalPages: 3 },
    decayAlerts: [{ pageUrl: '/blog/old-post', clickDrop: 45, detectedAt: '2026-03-25', hasRefreshBrief: false, isRepeatDecay: false }],
  };
}

function makeSiteHealth(): SiteHealthSlice {
  return {
    auditScore: 78,
    auditScoreDelta: 3,
    deadLinks: 2,
    redirectChains: 1,
    schemaErrors: 0,
    orphanPages: 3,
    cwvPassRate: { mobile: 0.85, desktop: 0.92 },
    anomalyCount: 2,
    anomalyTypes: ['traffic_drop'],
    seoChangeVelocity: 5,
  };
}

function makeClientSignals(): ClientSignalsSlice {
  return {
    keywordFeedback: { approved: ['seo tools'], rejected: ['cheap seo'], patterns: { approveRate: 0.5, topRejectionReasons: ['low volume'] } },
    contentGapVotes: [{ topic: 'AI in SEO', votes: 5 }],
    businessPriorities: ['Increase organic traffic', 'Brand awareness'],
    approvalPatterns: { approvalRate: 0.85, avgResponseTime: 48 },
    recentChatTopics: ['rankings', 'content calendar'],
    churnRisk: 'low',
    roi: { organicValue: 5000, growth: 12.5, period: 'monthly' },
    engagement: { lastLoginAt: '2026-03-30', loginFrequency: 'weekly', chatSessionCount: 15, portalUsage: null },
    compositeHealthScore: 75,
    feedbackItems: [
      { id: 'f1', type: 'feature_request', status: 'new', createdAt: '2026-03-28' },
      { id: 'f2', type: 'bug_report', status: 'resolved', createdAt: '2026-03-25' },
    ],
  };
}

function makeOperational(): OperationalSlice {
  return {
    recentActivity: [{ type: 'content', description: 'Brief created', timestamp: '2026-03-30T10:00:00Z' }],
    annotations: [{ date: '2026-03-30', label: 'Audit completed' }],
    pendingJobs: 1,
    approvalQueue: { pending: 2, oldestAge: 48 },
    recommendationQueue: { fixNow: 1, fixSoon: 3, fixLater: 5 },
    actionBacklog: { pendingMeasurement: 4, oldestAge: 30 },
    workOrders: { active: 1, pending: 0 },
    timeSaved: { totalMinutes: 120, byFeature: { 'content-brief': 60, 'seo-audit': 40, 'alt-text': 20 } },
    detectedPlaybooks: ['Internal Link Boost', 'Content Refresh'],
  };
}

function makePageProfile(): PageProfileSlice {
  return {
    pagePath: '/blog/test',
    primaryKeyword: 'seo analytics',
    searchIntent: 'informational',
    optimizationScore: 72,
    recommendations: ['Add internal links', 'Update meta description'],
    contentGaps: ['competitor comparison'],
    insights: [],
    actions: [],
    auditIssues: ['Missing alt text on 3 images'],
    schemaStatus: 'valid',
    linkHealth: { inbound: 5, outbound: 12, orphan: false },
    seoEdits: { currentTitle: 'SEO Analytics Guide', currentMeta: 'Learn about SEO analytics', lastEditedAt: '2026-03-28' },
    rankHistory: { current: 8, best: 5, trend: 'up' },
    contentStatus: 'published',
    cwvStatus: 'good',
  };
}

function makeFullIntelligence(): WorkspaceIntelligence {
  return {
    version: 1,
    workspaceId: 'ws-1',
    assembledAt: '2026-03-30T12:00:00Z',
    seoContext: makeSeoContext(),
    insights: makeInsights(),
    learnings: makeLearnings(),
    contentPipeline: makeContentPipeline(),
    siteHealth: makeSiteHealth(),
    clientSignals: makeClientSignals(),
    operational: makeOperational(),
    pageProfile: makePageProfile(),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('formatForPrompt', () => {
  describe('bug fixes — seoContext', () => {
    it('includes personas at all verbosity levels', () => {
      const intel = makeFullIntelligence();
      const compact = formatForPrompt(intel, { verbosity: 'compact' });
      const standard = formatForPrompt(intel, { verbosity: 'standard' });
      const detailed = formatForPrompt(intel, { verbosity: 'detailed' });

      expect(compact).toContain('Marketing Maya');
      expect(standard).toContain('Marketing Maya');
      expect(standard).toContain('Experienced marketer');
      expect(detailed).toContain('Marketing Maya');
      expect(detailed).toContain('Experienced marketer focused on growth');
    });

    it('includes knowledgeBase at standard verbosity', () => {
      const standard = formatForPrompt(makeFullIntelligence(), { verbosity: 'standard' });
      expect(standard).toContain('enterprise SEO analytics');
    });

    it('includes businessProfile at standard+ verbosity when present', () => {
      const intel = makeFullIntelligence();
      // Manually set businessProfile (not auto-populated from workspace yet — Phase 3B)
      intel.seoContext!.businessProfile = { industry: 'SaaS', goals: ['Grow organic traffic'], targetAudience: 'B2B marketing teams' };
      const standard = formatForPrompt(intel, { verbosity: 'standard' });
      expect(standard).toContain('SaaS');
    });

    it('includes rank tracking at standard+ verbosity', () => {
      const standard = formatForPrompt(makeFullIntelligence(), { verbosity: 'standard' });
      expect(standard).toContain('150 keywords');
    });
  });

  describe('bug fixes — learnings', () => {
    it('includes WeCalledIt entries at standard verbosity', () => {
      const standard = formatForPrompt(makeFullIntelligence(), { verbosity: 'standard' });
      expect(standard).toContain('strong_win');
    });

    it('includes ROI attribution at detailed verbosity', () => {
      const detailed = formatForPrompt(makeFullIntelligence(), { verbosity: 'detailed' });
      expect(detailed).toContain('+80 clicks');
    });

    it('omits ROI attribution at compact verbosity', () => {
      const compact = formatForPrompt(makeFullIntelligence(), { verbosity: 'compact' });
      expect(compact).not.toContain('+80 clicks');
    });
  });

  describe('new slice — contentPipeline', () => {
    it('shows brief and post counts at compact', () => {
      const output = formatForPrompt(makeFullIntelligence(), { verbosity: 'compact' });
      expect(output).toContain('Briefs: 5');
      expect(output).toContain('Posts: 3');
    });

    it('shows coverage gaps at standard', () => {
      const output = formatForPrompt(makeFullIntelligence(), { verbosity: 'standard' });
      expect(output).toContain('competitive analysis');
    });

    it('shows detailed breakdown at detailed', () => {
      const output = formatForPrompt(makeFullIntelligence(), { verbosity: 'detailed' });
      expect(output).toContain('draft: 2');
      expect(output).toContain('4/10 cells published');
    });
  });

  describe('new slice — siteHealth', () => {
    it('shows audit score at compact', () => {
      const output = formatForPrompt(makeFullIntelligence(), { verbosity: 'compact' });
      expect(output).toContain('Audit score: 78');
    });

    it('shows link details at standard', () => {
      const output = formatForPrompt(makeFullIntelligence(), { verbosity: 'standard' });
      expect(output).toContain('2 dead');
      expect(output).toContain('3 orphan');
    });

    it('shows CWV pass rate at detailed', () => {
      const output = formatForPrompt(makeFullIntelligence(), { verbosity: 'detailed' });
      expect(output).toContain('mobile 85%');
    });
  });

  describe('new slice — clientSignals', () => {
    it('shows churn risk at compact', () => {
      const output = formatForPrompt(makeFullIntelligence(), { verbosity: 'compact' });
      expect(output).toContain('Churn risk: low');
    });

    it('shows engagement at standard', () => {
      const output = formatForPrompt(makeFullIntelligence(), { verbosity: 'standard' });
      expect(output).toContain('weekly login frequency');
    });

    it('shows feedback items at detailed', () => {
      const output = formatForPrompt(makeFullIntelligence(), { verbosity: 'detailed' });
      expect(output).toContain('Feedback: 2 items');
      expect(output).toContain('1 open');
    });
  });

  describe('new slice — operational', () => {
    it('shows pending counts at compact', () => {
      const output = formatForPrompt(makeFullIntelligence(), { verbosity: 'compact' });
      expect(output).toContain('2 approvals');
      expect(output).toContain('9 recommendations');
    });

    it('shows recent activity at standard', () => {
      const output = formatForPrompt(makeFullIntelligence(), { verbosity: 'standard' });
      expect(output).toContain('Brief created');
    });

    it('shows time-saved by feature at detailed', () => {
      const output = formatForPrompt(makeFullIntelligence(), { verbosity: 'detailed' });
      expect(output).toContain('content-brief: 60 min');
    });
  });

  describe('new slice — pageProfile', () => {
    it('shows page path and keyword at compact', () => {
      const output = formatForPrompt(makeFullIntelligence(), { verbosity: 'compact' });
      expect(output).toContain('/blog/test');
      expect(output).toContain('seo analytics');
    });

    it('shows rank position at standard', () => {
      const output = formatForPrompt(makeFullIntelligence(), { verbosity: 'standard' });
      expect(output).toContain('Position: 8');
    });

    it('shows recommendations at detailed', () => {
      const output = formatForPrompt(makeFullIntelligence(), { verbosity: 'detailed' });
      expect(output).toContain('Add internal links');
      expect(output).toContain('Update meta description');
    });
  });

  describe('cold-start detection', () => {
    it('shows cold-start message when no meaningful data', () => {
      const empty: WorkspaceIntelligence = {
        version: 1,
        workspaceId: 'ws-empty',
        assembledAt: new Date().toISOString(),
        seoContext: {
          strategy: undefined,
          brandVoice: '',
          businessContext: '',
          personas: [],
          knowledgeBase: '',
        },
      };
      const output = formatForPrompt(empty);
      expect(output).toContain('newly onboarded');
    });
  });

  describe('section filtering', () => {
    it('only includes requested sections', () => {
      const output = formatForPrompt(makeFullIntelligence(), {
        sections: ['seoContext', 'siteHealth'],
        verbosity: 'standard',
      });
      expect(output).toContain('SEO Context');
      expect(output).toContain('Site Health');
      expect(output).not.toContain('Content Pipeline');
      expect(output).not.toContain('Client Signals');
    });

    it('includes all sections when no filter specified', () => {
      const output = formatForPrompt(makeFullIntelligence(), { verbosity: 'standard' });
      expect(output).toContain('SEO Context');
      expect(output).toContain('Active Insights');
      expect(output).toContain('Outcome Learnings');
      expect(output).toContain('Content Pipeline');
      expect(output).toContain('Site Health');
      expect(output).toContain('Client Signals');
      expect(output).toContain('Operational');
      expect(output).toContain('Page Profile');
    });
  });

  describe('edge cases', () => {
    it('handles missing optional slices gracefully', () => {
      const intel: WorkspaceIntelligence = {
        version: 1,
        workspaceId: 'ws-1',
        assembledAt: '2026-03-30T12:00:00Z',
        seoContext: makeSeoContext(),
        // all other slices undefined
      };
      const output = formatForPrompt(intel, { verbosity: 'detailed' });
      expect(output).toContain('SEO Context');
      expect(output).not.toContain('Content Pipeline');
      expect(output).not.toContain('Operational');
    });

    it('handles null audit score in siteHealth', () => {
      const intel = makeFullIntelligence();
      intel.siteHealth = { ...makeSiteHealth(), auditScore: null, auditScoreDelta: null };
      const output = formatForPrompt(intel, { verbosity: 'compact' });
      expect(output).toContain('Audit score: n/a');
    });

    it('handles null churnRisk in clientSignals', () => {
      const intel = makeFullIntelligence();
      intel.clientSignals = { ...makeClientSignals(), churnRisk: null };
      const output = formatForPrompt(intel, { verbosity: 'compact' });
      expect(output).toContain('Churn risk: unknown');
    });

    it('handles empty learnings (no summary, no actions)', () => {
      const intel = makeFullIntelligence();
      intel.learnings = {
        summary: null,
        confidence: null,
        topActionTypes: [],
        overallWinRate: 0,
        recentTrend: null,
        playbooks: [],
      };
      const output = formatForPrompt(intel, { verbosity: 'standard' });
      expect(output).not.toContain('Outcome Learnings');
    });

    it('does not emit bare Outcome Learnings header at compact when only weCalledIt/roiAttribution have data', () => {
      // Regression: guard was verbosity-blind — passed for weCalledIt data but those fields
      // only render at standard/detailed, producing an empty ## Outcome Learnings header at compact.
      const intel = makeFullIntelligence();
      intel.learnings = {
        summary: null,
        confidence: null,
        topActionTypes: [],
        overallWinRate: 0,
        recentTrend: null,
        playbooks: [],
        weCalledIt: [{ actionId: 'a1', prediction: 'rank top 3', outcome: 'win', score: 'strong_win', pageUrl: '/p', measuredAt: '2026-03-01' }],
        roiAttribution: [{ actionId: 'a2', actionType: 'content_refreshed', pageUrl: '/p', clickGain: 120, measuredAt: '2026-03-01' }],
      };
      const compact = formatForPrompt(intel, { verbosity: 'compact' });
      expect(compact).not.toContain('Outcome Learnings');
      // Same data at standard should still render the section
      const standard = formatForPrompt(intel, { verbosity: 'standard' });
      expect(standard).toContain('Outcome Learnings');
      expect(standard).toContain('rank top 3');
    });

    it('verbosity progression: detailed > standard > compact length', () => {
      const intel = makeFullIntelligence();
      const compact = formatForPrompt(intel, { verbosity: 'compact' });
      const standard = formatForPrompt(intel, { verbosity: 'standard' });
      const detailed = formatForPrompt(intel, { verbosity: 'detailed' });

      expect(detailed.length).toBeGreaterThan(standard.length);
      expect(standard.length).toBeGreaterThan(compact.length);
    });

    it('WeCalledIt caps at 3 for standard, 5 for detailed', () => {
      const intel = makeFullIntelligence();
      intel.learnings = {
        ...makeLearnings(),
        weCalledIt: Array.from({ length: 8 }, (_, i) => ({
          actionId: `a${i}`,
          prediction: `Prediction ${i}`,
          outcome: 'win',
          score: 'strong_win',
          pageUrl: `/page-${i}`,
          measuredAt: '2026-03-28',
        })),
      };

      const standard = formatForPrompt(intel, { verbosity: 'standard' });
      const detailed = formatForPrompt(intel, { verbosity: 'detailed' });

      // Count prediction lines
      const stdPredictions = (standard.match(/Prediction \d/g) ?? []).length;
      const detPredictions = (detailed.match(/Prediction \d/g) ?? []).length;

      expect(stdPredictions).toBe(3);
      expect(detPredictions).toBe(5);
    });

    it('handles siteHealth with no anomalies', () => {
      const intel = makeFullIntelligence();
      intel.siteHealth = { ...makeSiteHealth(), anomalyCount: 0, anomalyTypes: [] };
      const output = formatForPrompt(intel, { verbosity: 'standard' });
      expect(output).not.toContain('Critical issues');
      expect(output).not.toContain('Anomaly types');
    });

    it('handles operational with no time saved', () => {
      const intel = makeFullIntelligence();
      intel.operational = { ...makeOperational(), timeSaved: null };
      const output = formatForPrompt(intel, { verbosity: 'detailed' });
      expect(output).toContain('Operational');
      expect(output).not.toContain('Time saved');
    });

    it('handles pageProfile with null rank history', () => {
      const intel = makeFullIntelligence();
      intel.pageProfile = { ...makePageProfile(), rankHistory: { current: null, best: null, trend: 'stable' } };
      const output = formatForPrompt(intel, { verbosity: 'standard' });
      expect(output).toContain('Page Profile');
      expect(output).not.toContain('Position:');
    });
  });
});
