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
import type { AnalyticsInsight } from '../shared/types/analytics.js';

// ── Helpers ──────────────────────────────────────────────────────────────

function baseIntel(overrides?: Partial<WorkspaceIntelligence>): WorkspaceIntelligence {
  return {
    version: 1,
    workspaceId: 'ws-test',
    assembledAt: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

function mockInsight(overrides: Partial<AnalyticsInsight>): AnalyticsInsight {
  return {
    id: 'ins-1',
    workspaceId: 'ws-test',
    pageId: null,
    insightType: 'page_health',
    data: {},
    severity: 'warning',
    computedAt: '2026-04-01T00:00:00Z',
    impactScore: 50,
    ...overrides,
  } satisfies Partial<AnalyticsInsight> as AnalyticsInsight;
}

function makeSeoContext(): SeoContextSlice {
  return {
    strategy: undefined,
    brandVoice: 'Bold and data-driven',
    effectiveBrandVoiceBlock: '\n\nBRAND VOICE & STYLE (you MUST match this voice — do not deviate):\nBold and data-driven',
    businessContext: 'B2B SaaS analytics company',
    personas: [
      { id: 'p1', name: 'Marketing Maya', description: 'Growth marketer', painPoints: ['attribution'], goals: ['ROI'], objections: [] },
    ],
    knowledgeBase: 'Enterprise SEO platform',
  };
}

function makeInsights(): InsightsSlice {
  return {
    all: [
      mockInsight({ id: 'i1', insightType: 'content_decay', severity: 'critical', impactScore: 90 }),
      mockInsight({ id: 'i2', insightType: 'ranking_opportunity', severity: 'opportunity', impactScore: 70 }),
    ],
    byType: {},
    bySeverity: { critical: 1, warning: 0, opportunity: 1, positive: 0 },
    topByImpact: [],
  };
}

function makeLearnings(): LearningsSlice {
  return {
    summary: null,
    confidence: 'medium',
    topActionTypes: [{ type: 'content_refreshed', winRate: 0.6, count: 10 }],
    overallWinRate: 0.6,
    recentTrend: 'improving',
    playbooks: [],
  };
}

function makePageProfile(): PageProfileSlice {
  return {
    pagePath: '/blog/test',
    primaryKeyword: 'test keyword',
    searchIntent: 'informational',
    optimizationScore: 72,
    recommendations: ['Add schema markup'],
    contentGaps: ['missing FAQ section'],
    insights: [],
    actions: [],
    auditIssues: [],
    optimizationIssues: ['Keyword density low'],
    primaryKeywordPresence: { inTitle: true, inMeta: false, inContent: true, inSlug: true },
    competitorKeywords: ['competitor kw'],
    topicCluster: 'SEO',
    estimatedDifficulty: 'medium',
    schemaStatus: 'none',
    linkHealth: { inbound: 5, outbound: 3, orphan: false },
    seoEdits: { currentTitle: 'Test Page', currentMeta: 'A test page', lastEditedAt: null },
    rankHistory: { current: 15, best: 10, trend: 'up' },
    contentStatus: null,
    cwvStatus: 'good',
  };
}

function makeContentPipeline(): ContentPipelineSlice {
  return {
    briefs: { total: 5, byStatus: { draft: 3, published: 2 } },
    posts: { total: 3, byStatus: { draft: 1, published: 2 } },
    matrices: { total: 1, cellsPlanned: 10, cellsPublished: 4 },
    requests: { pending: 2, inProgress: 1, delivered: 3 },
    workOrders: { active: 1 },
    coverageGaps: ['competitor analysis'],
    seoEdits: { pending: 3, applied: 7, inReview: 2 },
  };
}

function makeSiteHealth(): SiteHealthSlice {
  return {
    auditScore: 85,
    auditScoreDelta: 3,
    deadLinks: 2,
    redirectChains: 1,
    schemaErrors: 0,
    orphanPages: 3,
    cwvPassRate: { mobile: 0.7, desktop: 0.9 },
  };
}

function makeClientSignals(): ClientSignalsSlice {
  return {
    keywordFeedback: { approved: ['seo tools'], rejected: ['cheap seo'], patterns: { approveRate: 0.8, topRejectionReasons: ['off-brand'] } },
    contentGapVotes: [{ topic: 'AI SEO', votes: 5 }],
    businessPriorities: ['organic growth'],
    approvalPatterns: { approvalRate: 0.75, avgResponseTime: 48 },
    recentChatTopics: ['content strategy'],
    churnRisk: 'low',
  };
}

function makeOperational(): OperationalSlice {
  return {
    recentActivity: [{ type: 'audit', description: 'Ran site audit', timestamp: '2026-04-01T00:00:00Z' }],
    annotations: [{ date: '2026-03-28', label: 'Algorithm update' }],
    pendingJobs: 0,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('formatForPrompt covers all 8 slices', () => {
  it('output contains all 8 section headers', () => {
    const intel = baseIntel({
      seoContext: makeSeoContext(),
      insights: makeInsights(),
      learnings: makeLearnings(),
      pageProfile: makePageProfile(),
      contentPipeline: makeContentPipeline(),
      siteHealth: makeSiteHealth(),
      clientSignals: makeClientSignals(),
      operational: makeOperational(),
    });

    const output = formatForPrompt(intel, { verbosity: 'detailed' });

    const expectedHeaders = [
      '## SEO Context',
      '## Active Insights',
      '## Outcome Learnings',
      '## Page Profile',
      '## Content Pipeline',
      '## Site Health',
      '## Client Signals',
      '## Operational',
    ];

    for (const header of expectedHeaders) {
      expect(output).toContain(header);
    }
  });
});

describe('type completeness', () => {
  it('minimal WorkspaceIntelligence has all 8 slices undefined', () => {
    const minimal: WorkspaceIntelligence = {
      version: 1,
      workspaceId: 'ws-minimal',
      assembledAt: '2026-04-01T00:00:00Z',
    };

    expect(minimal.seoContext).toBeUndefined();
    expect(minimal.insights).toBeUndefined();
    expect(minimal.learnings).toBeUndefined();
    expect(minimal.pageProfile).toBeUndefined();
    expect(minimal.contentPipeline).toBeUndefined();
    expect(minimal.siteHealth).toBeUndefined();
    expect(minimal.clientSignals).toBeUndefined();
    expect(minimal.operational).toBeUndefined();
  });
});

describe('personas bug fix regression', () => {
  it('personas appear in compact output', () => {
    const intel = baseIntel({
      seoContext: makeSeoContext(),
    });

    const output = formatForPrompt(intel, { verbosity: 'compact' });

    expect(output).toContain('Marketing Maya');
  });
});

describe('tokenBudget preserves seoContext', () => {
  it('seoContext content survives with tight tokenBudget', () => {
    const intel = baseIntel({
      seoContext: makeSeoContext(),
      operational: makeOperational(),
      clientSignals: makeClientSignals(),
    });

    const output = formatForPrompt(intel, { tokenBudget: 50 });

    // seoContext is never dropped per §20 priority chain
    expect(output).toContain('## SEO Context');
    expect(output).toContain('Bold and data-driven');
  });
});

describe('section filtering works with tokenBudget', () => {
  it('both section filter and tokenBudget constraints apply', () => {
    const intel = baseIntel({
      seoContext: makeSeoContext(),
      insights: makeInsights(),
      learnings: makeLearnings(),
      contentPipeline: makeContentPipeline(),
      siteHealth: makeSiteHealth(),
      clientSignals: makeClientSignals(),
      operational: makeOperational(),
    });

    // Only request seoContext and insights, with a generous budget
    const output = formatForPrompt(intel, {
      sections: ['seoContext', 'insights'],
      tokenBudget: 5000,
    });

    // Requested sections present
    expect(output).toContain('## SEO Context');
    expect(output).toContain('## Active Insights');

    // Filtered-out sections absent
    expect(output).not.toContain('## Outcome Learnings');
    expect(output).not.toContain('## Content Pipeline');
    expect(output).not.toContain('## Site Health');
    expect(output).not.toContain('## Client Signals');
    expect(output).not.toContain('## Operational');
  });
});
