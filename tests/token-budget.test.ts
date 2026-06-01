import { describe, it, expect } from 'vitest';
import { formatForPrompt } from '../server/workspace-intelligence.js';
import type {
  WorkspaceIntelligence,
  InsightsSlice,
} from '../shared/types/intelligence.js';
import type { AnalyticsInsight } from '../shared/types/analytics.js';

// ── Helpers ──────────────────────────────────────────────────────────────

function makeLargeIntelligence(): WorkspaceIntelligence {
  return {
    version: 1,
    workspaceId: 'ws-1',
    assembledAt: new Date().toISOString(),
    seoContext: {
      strategy: undefined,
      brandVoice: 'Professional and authoritative voice that conveys expertise in all digital marketing areas.',
      effectiveBrandVoiceBlock: '\n\nBRAND VOICE & STYLE (you MUST match this voice — do not deviate):\nProfessional and authoritative voice that conveys expertise in all digital marketing areas.',
      businessContext: 'Enterprise B2B SaaS company serving Fortune 500 marketing teams with comprehensive analytics.',
      personas: [
        { name: 'Marketing Maya', role: 'CMO', description: 'C-level executive focused on brand growth and market positioning' },
        { name: 'Analytics Adam', role: 'Data Analyst', description: 'Technical user who cares about accuracy and data quality' },
      ],
      knowledgeBase: 'Our company has been a leader in enterprise SEO analytics since 2018. We serve over 200 Fortune 500 companies and process billions of search data points monthly.',
    },
    insights: {
      all: Array.from({ length: 20 }, (_, i) => ({
        id: `i${i}`,
        insightType: 'content_gap' as const,
        severity: (i < 3 ? 'critical' : 'warning') as 'critical' | 'warning',
        impactScore: 90 - i * 3,
        pageId: `/page-${i}`,
        title: `Insight ${i}: Missing content for keyword cluster ${i}`,
        workspaceId: 'ws-1',
        status: 'active' as const,
        detectedAt: '2026-03-30',
        resolvedAt: null,
        data: {},
      } satisfies Partial<AnalyticsInsight> as AnalyticsInsight)),
      byType: {},
      bySeverity: { critical: 3, warning: 10, opportunity: 5, positive: 2 },
      topByImpact: [],
    },
    learnings: {
      summary: null,
      confidence: 'high',
      topActionTypes: [
        { type: 'content_refresh', winRate: 0.72, count: 25 },
        { type: 'schema_added', winRate: 0.65, count: 18 },
        { type: 'seo_fix', winRate: 0.58, count: 30 },
      ],
      overallWinRate: 0.62,
      recentTrend: 'improving',
      playbooks: [],
    },
    contentPipeline: {
      briefs: { total: 12, byStatus: { draft: 4, ready: 3, published: 5 } },
      posts: { total: 8, byStatus: { draft: 2, published: 6 } },
      matrices: { total: 2, cellsPlanned: 20, cellsPublished: 8 },
      requests: { pending: 3, inProgress: 2, delivered: 10 },
      workOrders: { active: 2 },
      coverageGaps: ['competitor analysis', 'pricing guides', 'case studies', 'tutorials', 'integrations'],
      seoEdits: { pending: 2, applied: 8, inReview: 1 },
    },
    siteHealth: {
      auditScore: 72,
      auditScoreDelta: -3,
      deadLinks: 5,
      redirectChains: 3,
      schemaErrors: 2,
      orphanPages: 7,
      cwvPassRate: { mobile: 0.65, desktop: 0.82 },
      anomalyCount: 4,
      anomalyTypes: ['traffic_drop', 'ranking_drop'],
      seoChangeVelocity: 12,
    },
    clientSignals: {
      keywordFeedback: { approved: ['seo tools', 'analytics'], rejected: ['cheap seo'], patterns: { approveRate: 0.67, topRejectionReasons: [] } },
      contentGapVotes: [{ topic: 'AI in SEO', votes: 5 }],
      businessPriorities: ['Organic traffic growth', 'Brand awareness'],
      approvalPatterns: { approvalRate: 0.78, avgResponseTime: 72 },
      recentChatTopics: ['rankings', 'content calendar', 'competitor analysis'],
      churnRisk: 'medium',
      compositeHealthScore: 65,
    },
    operational: {
      recentActivity: Array.from({ length: 10 }, (_, i) => ({
        type: 'content',
        description: `Activity ${i}: Created brief for keyword cluster ${i}`,
        timestamp: new Date().toISOString(),
      })),
      annotations: [],
      pendingJobs: 2,
      approvalQueue: { pending: 5, oldestAge: 72 },
      recommendationQueue: { fixNow: 3, fixSoon: 8, fixLater: 15 },
      actionBacklog: { pendingMeasurement: 12, oldestAge: 45 },
      workOrders: { active: 2, pending: 1 },
      timeSaved: { totalMinutes: 300, byFeature: { 'content-brief': 120, 'seo-audit': 80, 'alt-text': 50, 'schema': 30, 'rewrite': 20 } },
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('tokenBudget truncation', () => {
  it('returns full output when no budget specified', () => {
    const intel = makeLargeIntelligence();
    const output = formatForPrompt(intel, { verbosity: 'detailed' });
    expect(output).toContain('## Operational');
    expect(output).toContain('## Client Signals');
    expect(output).toContain('## Content Pipeline');
    expect(output).toContain('## Site Health');
  });

  it('returns full output when budget exceeds content size', () => {
    const intel = makeLargeIntelligence();
    const output = formatForPrompt(intel, { verbosity: 'detailed', tokenBudget: 100000 });
    expect(output).toContain('## Operational');
    expect(output).toContain('## Client Signals');
  });

  it('drops operational first when budget is tight', () => {
    const intel = makeLargeIntelligence();
    // Use a budget that's slightly under full output
    const full = formatForPrompt(intel, { verbosity: 'detailed' });
    const fullTokens = Math.ceil(full.length / 4);
    // Set budget to ~80% of full — should drop operational
    const output = formatForPrompt(intel, { verbosity: 'detailed', tokenBudget: Math.floor(fullTokens * 0.8) });
    expect(output).not.toContain('## Operational');
    expect(output).toContain('## SEO Context');
    expect(output).toContain('## Content Pipeline');
  });

  it('truncates insights to top 5 when further constrained', () => {
    const intel = makeLargeIntelligence();
    // First, get the output with just operational dropped (step 1 applied)
    const full = formatForPrompt(intel, { verbosity: 'detailed' });
    const fullTokens = Math.ceil(full.length / 4);
    // Step 1 drops operational; set budget to trigger step 2 (insight truncation)
    // Use a small enough budget that step 1 isn't sufficient
    const output = formatForPrompt(intel, { verbosity: 'detailed', tokenBudget: Math.floor(fullTokens * 0.6) });
    // Operational should be gone
    expect(output).not.toContain('## Operational');
    // Insights should be truncated to at most 5
    const insightLines = output.split('\n').filter(l => l.startsWith('- ['));
    expect(insightLines.length).toBeLessThanOrEqual(5);
  });

  it('drops clientSignals before seoContext', () => {
    const intel = makeLargeIntelligence();
    const output = formatForPrompt(intel, { verbosity: 'detailed', tokenBudget: 400 });
    expect(output).not.toContain('## Client Signals');
    expect(output).toContain('## SEO Context');
  });

  it('summarizes learnings to one line when very constrained', () => {
    const intel = makeLargeIntelligence();
    const output = formatForPrompt(intel, { verbosity: 'detailed', tokenBudget: 300 });
    // Should still have learnings but as a one-liner
    if (output.includes('Outcome Learnings')) {
      const learningsSection = output.split('## Outcome Learnings')[1]?.split('##')[0] ?? '';
      const learningsLines = learningsSection.trim().split('\n').filter(Boolean);
      // Summarized = just one line (Win rate: X%)
      expect(learningsLines.length).toBeLessThanOrEqual(2);
    }
  });

  it('never drops seoContext even with tiny budget', () => {
    const intel = makeLargeIntelligence();
    const output = formatForPrompt(intel, { verbosity: 'compact', tokenBudget: 50 });
    expect(output).toContain('## SEO Context');
  });

  it('preserves section order after truncation', () => {
    const intel = makeLargeIntelligence();
    const output = formatForPrompt(intel, { verbosity: 'detailed', tokenBudget: 600 });
    const seoIdx = output.indexOf('## SEO Context');
    const insightsIdx = output.indexOf('## Active Insights');
    // SEO Context should always come before insights
    if (insightsIdx !== -1) {
      expect(seoIdx).toBeLessThan(insightsIdx);
    }
    expect(seoIdx).toBeGreaterThan(-1);
  });
});

// ── FIX F: slice-filtered calls with no seoContext anchor must NOT drop the
//          requested slice (operational) first. The §20 "drop operational first /
//          collapse to seoContext only" chain is correct for the FULL prompt but
//          would silently delete the very slice the question selected for a
//          filtered call (e.g. admin-chat additional-slices block). ────────────
describe('tokenBudget truncation — slice-filtered calls without seoContext anchor', () => {
  // sections explicitly EXCLUDE seoContext — operational is a REQUESTED slice.
  const FILTERED_SECTIONS = ['operational', 'siteHealth', 'clientSignals'] as const;

  it('keeps ## Operational present at a tight budget when it is a requested slice (no seoContext)', () => {
    const intel = makeLargeIntelligence();
    // Confirm the unbudgeted filtered block actually exceeds the chosen budget so
    // the truncation path is genuinely exercised (non-vacuous).
    const full = formatForPrompt(intel, { verbosity: 'standard', sections: FILTERED_SECTIONS });
    const fullTokens = Math.ceil(full.length / 4);
    const budget = Math.floor(fullTokens * 0.5);
    expect(fullTokens).toBeGreaterThan(budget); // precondition: over budget

    const output = formatForPrompt(intel, {
      verbosity: 'standard',
      sections: FILTERED_SECTIONS,
      tokenBudget: budget,
    });

    // The requested slice MUST survive — it is the answer to the question.
    expect(output).toContain('## Operational');
    // And the output must actually respect the budget.
    expect(Math.ceil(output.length / 4)).toBeLessThanOrEqual(budget);
  });

  it('keeps all requested slices present at the admin-chat additional-slices budget (1500)', () => {
    const intel = makeLargeIntelligence();
    const output = formatForPrompt(intel, {
      verbosity: 'standard',
      sections: FILTERED_SECTIONS,
      tokenBudget: 1500,
    });
    expect(output).toContain('## Operational');
    expect(output).toContain('## Site Health');
    expect(output).toContain('## Client Signals');
  });

  it('still drops operational FIRST for the FULL prompt (seoContext anchor) — regression guard', () => {
    // The filtered-call fix must NOT change the full-prompt drop order.
    const intel = makeLargeIntelligence();
    const full = formatForPrompt(intel, { verbosity: 'detailed' });
    const fullTokens = Math.ceil(full.length / 4);
    const output = formatForPrompt(intel, { verbosity: 'detailed', tokenBudget: Math.floor(fullTokens * 0.8) });
    expect(output).not.toContain('## Operational');
    expect(output).toContain('## SEO Context');
  });
});
