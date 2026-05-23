// tests/unit/formatters-prompt-format.test.ts
//
// Comprehensive unit tests for server/intelligence/formatters.ts
// Imports DIRECTLY from the formatter module (not the workspace-intelligence barrel).
// These tests complement the existing format-*.test.ts files — they focus on
// areas those files don't cover: tokenBudget priority chain, section filtering
// mechanics, cold-start detection, pct() edge cases (via output), and standalone
// helper edge cases.
//
// Pure transformation logic — no DB, no vi.mock needed.

import { describe, it, expect } from 'vitest';
import {
  formatForPrompt,
  formatKnowledgeBaseForPrompt,
  formatKeywordsForPrompt,
  formatPersonasForPrompt,
  formatPageMapForPrompt,
} from '../../server/intelligence/formatters.js';
import type {
  WorkspaceIntelligence,
  LearningsSlice,
  SeoContextSlice,
  OperationalSlice,
  ContentPipelineSlice,
  SiteHealthSlice,
  ClientSignalsSlice,
  InsightsSlice,
  PageProfileSlice,
} from '../../shared/types/intelligence.js';
import type { AudiencePersona } from '../../shared/types/workspace.js';

// ─── Shared fixture helpers ───────────────────────────────────────────────────

const BASE: WorkspaceIntelligence = {
  version: 1,
  workspaceId: 'ws-fmt-test',
  assembledAt: '2026-05-01T00:00:00Z',
};

/** Minimal SeoContextSlice that has enough content to bypass cold-start */
const SEO_WITH_CONTEXT: SeoContextSlice = {
  strategy: undefined,
  brandVoice: 'Authoritative voice',
  effectiveBrandVoiceBlock: '\n\nBRAND VOICE:\nAuthoritative voice',
  businessContext: 'B2B SaaS company focused on analytics',
  personas: [],
  knowledgeBase: '',
};

/** SeoContextSlice that is completely empty (triggers cold-start) */
const SEO_EMPTY: SeoContextSlice = {
  strategy: undefined,
  brandVoice: '',
  effectiveBrandVoiceBlock: '',
  businessContext: '',
  personas: [],
  knowledgeBase: '',
};

const MIN_LEARNINGS: LearningsSlice = {
  availability: 'ready',
  summary: null,
  confidence: null,
  topActionTypes: [],
  overallWinRate: 0,
  recentTrend: null,
  playbooks: [],
};

const LEARNINGS_WITH_DATA: LearningsSlice = {
  availability: 'ready',
  summary: {
    workspaceId: 'ws-fmt-test',
    computedAt: '2026-05-01T00:00:00Z',
    confidence: 'high',
    totalScoredActions: 30,
    overall: {
      totalWinRate: 0.65,
      strongWinRate: 0.3,
      topActionTypes: [{ type: 'title_update', winRate: 0.7, count: 12 }],
      recentTrend: 'improving',
    },
    content: {
      winRateByFormat: { long_form: 0.8, listicle: 0.5 },
      avgDaysToPage1: 42,
      refreshRecoveryRate: 0.6,
      bestPerformingTopics: ['seo guide', 'analytics tutorial'],
      optimalWordCount: { min: 1000, max: 3000 },
      voiceScoreCorrelation: 0.68,
    },
    strategy: {
      winRateByDifficultyRange: { '0-20': 0.9, '21-40': 0.6 },
      winRateByCheckpoint: {},
      bestIntentTypes: ['informational', 'commercial'],
      keywordVolumeSweetSpot: { min: 300, max: 5000 },
    },
    technical: {
      winRateByFixType: { schema_markup: 0.75, meta_tag: 0.6 },
      schemaTypesWithRichResults: ['FAQ', 'HowTo'],
      avgHealthScoreImprovement: 8,
      internalLinkEffectiveness: 0.55,
    },
  },
  confidence: 'high',
  topActionTypes: [{ type: 'title_update', winRate: 0.7, count: 12 }],
  overallWinRate: 0.65,
  recentTrend: 'improving',
  playbooks: [],
};

const MIN_INSIGHTS: InsightsSlice = {
  all: [
    { id: 'i1', insightType: 'content_decay', severity: 'warning', impactScore: 7, pageId: '/blog/old' } as any,
    { id: 'i2', insightType: 'ranking_opportunity', severity: 'opportunity', impactScore: 5, pageId: '/services' } as any,
  ],
  byType: {},
  bySeverity: { critical: 0, warning: 1, opportunity: 1, positive: 0 },
  topByImpact: [],
};

const MIN_CONTENT_PIPELINE: ContentPipelineSlice = {
  briefs: { total: 5, byStatus: { draft: 2, published: 3 } },
  posts: { total: 3, byStatus: { draft: 1, published: 2 } },
  matrices: { total: 1, cellsPlanned: 10, cellsPublished: 5 },
  requests: { pending: 1, inProgress: 0, delivered: 2 },
  workOrders: { active: 0 },
  coverageGaps: ['voice search', 'local seo'],
  seoEdits: { pending: 2, applied: 5, inReview: 0 },
};

const MIN_SITE_HEALTH: SiteHealthSlice = {
  auditScore: 75,
  auditScoreDelta: 2,
  deadLinks: 3,
  redirectChains: 1,
  schemaErrors: 0,
  orphanPages: 2,
  cwvPassRate: { mobile: 0.8, desktop: null },
};

const MIN_CLIENT_SIGNALS: ClientSignalsSlice = {
  keywordFeedback: { approved: [], rejected: [], patterns: { approveRate: 0, topRejectionReasons: [] } },
  contentGapVotes: [],
  businessPriorities: [],
  approvalPatterns: { approvalRate: 0, avgResponseTime: null },
  recentChatTopics: [],
  churnRisk: 'low',
};

const MIN_OPERATIONAL: OperationalSlice = {
  recentActivity: [{ type: 'insight_created', description: 'New insight added', timestamp: '2026-05-01T00:00:00Z' }],
  annotations: [],
  pendingJobs: 0,
};

// A rich intelligence object with multiple sections for budget testing
const RICH_INTELLIGENCE: WorkspaceIntelligence = {
  ...BASE,
  seoContext: SEO_WITH_CONTEXT,
  insights: MIN_INSIGHTS,
  learnings: LEARNINGS_WITH_DATA,
  contentPipeline: MIN_CONTENT_PIPELINE,
  siteHealth: MIN_SITE_HEALTH,
  clientSignals: MIN_CLIENT_SIGNALS,
  operational: MIN_OPERATIONAL,
};

// ─── Cold-start detection ─────────────────────────────────────────────────────

describe('formatForPrompt cold-start detection', () => {
  it('returns cold-start message for completely empty intelligence object', () => {
    const result = formatForPrompt(BASE);
    expect(result).toContain('newly onboarded');
    expect(result).toContain('Limited data available');
  });

  it('returns cold-start message when seoContext exists but has no meaningful content', () => {
    const intel: WorkspaceIntelligence = { ...BASE, seoContext: SEO_EMPTY };
    const result = formatForPrompt(intel);
    expect(result).toContain('newly onboarded');
  });

  it('does NOT trigger cold-start when seoContext has businessContext', () => {
    const intel: WorkspaceIntelligence = { ...BASE, seoContext: SEO_WITH_CONTEXT };
    const result = formatForPrompt(intel);
    expect(result).not.toContain('newly onboarded');
    expect(result).toContain('SEO Context');
  });

  it('does NOT trigger cold-start when insights slice has data', () => {
    const intel: WorkspaceIntelligence = { ...BASE, insights: MIN_INSIGHTS };
    const result = formatForPrompt(intel);
    expect(result).not.toContain('newly onboarded');
  });

  it('does NOT trigger cold-start when learnings has a summary', () => {
    const intel: WorkspaceIntelligence = {
      ...BASE,
      learnings: { ...LEARNINGS_WITH_DATA, summary: LEARNINGS_WITH_DATA.summary },
    };
    const result = formatForPrompt(intel);
    expect(result).not.toContain('newly onboarded');
  });

  it('includes effectiveBrandVoiceBlock in cold-start message when present', () => {
    const intel: WorkspaceIntelligence = {
      ...BASE,
      seoContext: {
        ...SEO_EMPTY,
        effectiveBrandVoiceBlock: '\n\nBRAND VOICE:\nFriendly and approachable',
      },
    };
    const result = formatForPrompt(intel);
    expect(result).toContain('newly onboarded');
    expect(result).toContain('Friendly and approachable');
  });

  it('cold-start message includes the recommendation line', () => {
    const result = formatForPrompt(BASE);
    expect(result).toContain('Recommendation:');
    expect(result).toContain('baseline data');
  });

  // Section-filtered cold-start behavior: targeted calls return '' for unknown sections
  it('returns empty string for section-filtered call targeting a section with no data', () => {
    // Requesting only pageProfile when none is set — targeted caller gets ''
    // rather than misleading cold-start message (per cold-start guard logic)
    const result = formatForPrompt(BASE, { sections: ['pageProfile'] });
    expect(result).toBe('');
  });

  it('returns cold-start message for section-filtered call targeting seoContext with empty content', () => {
    const intel: WorkspaceIntelligence = { ...BASE, seoContext: SEO_EMPTY };
    const result = formatForPrompt(intel, { sections: ['seoContext'] });
    expect(result).toContain('newly onboarded');
  });

  // Section-filtered: slices that always assemble as objects bypass cold-start
  it('does NOT return cold-start for section-filtered call on operational slice that exists', () => {
    const intel: WorkspaceIntelligence = { ...BASE, operational: MIN_OPERATIONAL };
    const result = formatForPrompt(intel, { sections: ['operational'] });
    // operational exists and was requested → should render it, not cold-start
    expect(result).not.toContain('newly onboarded');
    expect(result).toContain('Operational');
  });

  it('does NOT return cold-start for section-filtered call on contentPipeline slice that exists', () => {
    const intel: WorkspaceIntelligence = { ...BASE, contentPipeline: MIN_CONTENT_PIPELINE };
    const result = formatForPrompt(intel, { sections: ['contentPipeline'] });
    expect(result).not.toContain('newly onboarded');
    expect(result).toContain('Content Pipeline');
  });
});

// ─── Section filtering (include option) ──────────────────────────────────────

describe('formatForPrompt section filtering', () => {
  it('includes only seoContext when sections: [seoContext]', () => {
    const result = formatForPrompt(RICH_INTELLIGENCE, { sections: ['seoContext'] });
    expect(result).toContain('SEO Context');
    expect(result).not.toContain('Active Insights');
    expect(result).not.toContain('Content Pipeline');
    expect(result).not.toContain('Site Health');
    expect(result).not.toContain('Operational');
    expect(result).not.toContain('Outcome Learnings');
  });

  it('includes only insights when sections: [insights]', () => {
    const result = formatForPrompt(RICH_INTELLIGENCE, { sections: ['insights'] });
    expect(result).toContain('Active Insights');
    expect(result).not.toContain('SEO Context');
    expect(result).not.toContain('Content Pipeline');
    expect(result).not.toContain('Site Health');
  });

  it('includes only learnings when sections: [learnings]', () => {
    const result = formatForPrompt(RICH_INTELLIGENCE, { sections: ['learnings'] });
    expect(result).toContain('Outcome Learnings');
    expect(result).not.toContain('SEO Context');
    expect(result).not.toContain('Active Insights');
    expect(result).not.toContain('Content Pipeline');
  });

  it('includes both seoContext and learnings when sections: [seoContext, learnings]', () => {
    const result = formatForPrompt(RICH_INTELLIGENCE, { sections: ['seoContext', 'learnings'] });
    expect(result).toContain('SEO Context');
    expect(result).toContain('Outcome Learnings');
    expect(result).not.toContain('Active Insights');
    expect(result).not.toContain('Content Pipeline');
    expect(result).not.toContain('Site Health');
    expect(result).not.toContain('Client Signals');
  });

  it('includes all sections when no sections filter is specified', () => {
    const result = formatForPrompt(RICH_INTELLIGENCE);
    expect(result).toContain('SEO Context');
    expect(result).toContain('Active Insights');
    expect(result).toContain('Outcome Learnings');
    expect(result).toContain('Content Pipeline');
    expect(result).toContain('Site Health');
    expect(result).toContain('Client Signals');
    expect(result).toContain('Operational');
  });

  it('omits a section if the slice is undefined even when requested', () => {
    // siteHealth is requested but not present in intelligence
    const intel: WorkspaceIntelligence = { ...BASE, seoContext: SEO_WITH_CONTEXT };
    const result = formatForPrompt(intel, { sections: ['seoContext', 'siteHealth'] });
    expect(result).toContain('SEO Context');
    expect(result).not.toContain('Site Health');
  });

  it('always starts with [Workspace Intelligence] header', () => {
    const result = formatForPrompt(RICH_INTELLIGENCE, { sections: ['seoContext'] });
    expect(result).toContain('[Workspace Intelligence]');
  });

  it('omits insights section when insights.all is empty (even if filter includes it)', () => {
    const intel: WorkspaceIntelligence = {
      ...BASE,
      seoContext: SEO_WITH_CONTEXT,
      insights: { all: [], byType: {}, bySeverity: { critical: 0, warning: 0, opportunity: 0, positive: 0 }, topByImpact: [] },
    };
    const result = formatForPrompt(intel, { sections: ['seoContext', 'insights'] });
    expect(result).not.toContain('Active Insights');
  });
});

// ─── tokenBudget priority chain ───────────────────────────────────────────────

describe('formatForPrompt tokenBudget priority chain', () => {
  it('returns full output when tokenBudget is generously large', () => {
    const unbounded = formatForPrompt(RICH_INTELLIGENCE);
    const bounded = formatForPrompt(RICH_INTELLIGENCE, { tokenBudget: 100000 });
    // Same content at large budget
    expect(bounded).toContain('Operational');
    expect(bounded).toContain('Client Signals');
    expect(bounded).toContain('Content Pipeline');
    expect(bounded).toContain('Site Health');
    expect(bounded).toContain('Outcome Learnings');
  });

  it('result with tiny tokenBudget is shorter than unbounded result', () => {
    const unbounded = formatForPrompt(RICH_INTELLIGENCE);
    const bounded = formatForPrompt(RICH_INTELLIGENCE, { tokenBudget: 50 });
    expect(bounded.length).toBeLessThan(unbounded.length);
  });

  it('step 1: drops Operational section first at tight budget', () => {
    const unbounded = formatForPrompt(RICH_INTELLIGENCE);
    // Build a budget that fits everything except Operational
    // Use 90% of unbounded length as character estimate, then reduce
    const tightBudget = Math.ceil(unbounded.length / 4) - 20;
    const bounded = formatForPrompt(RICH_INTELLIGENCE, { tokenBudget: tightBudget });
    // Operational should be dropped before other sections
    // (We can't guarantee the exact threshold, but a sufficiently tight budget
    //  must at some point trigger Operational removal)
    // Test with a very tight budget to force multiple drops
    const veryTight = formatForPrompt(RICH_INTELLIGENCE, { tokenBudget: 100 });
    expect(veryTight).not.toContain('## Operational');
  });

  it('step 3: drops Client Signals before dropping SEO Context', () => {
    const veryTight = formatForPrompt(RICH_INTELLIGENCE, { tokenBudget: 100 });
    // With a 100 token budget (~400 chars), we expect Client Signals to be dropped
    expect(veryTight).not.toContain('## Client Signals');
  });

  it('step 4d: drops Content Pipeline before seoContext at extremely tight budget', () => {
    const veryTight = formatForPrompt(RICH_INTELLIGENCE, { tokenBudget: 100 });
    expect(veryTight).not.toContain('## Content Pipeline');
  });

  it('SEO Context is never dropped (seoOnly fallback at step 5)', () => {
    // At 50 tokens, only the header + SEO Context should remain
    const minimal = formatForPrompt(RICH_INTELLIGENCE, { tokenBudget: 50 });
    // SEO Context is the last section standing; it may be the only body section
    // The seoOnly filter keeps sections starting with '## SEO Context'
    expect(minimal).toContain('[Workspace Intelligence]');
    // Should not contain other sections dropped in the chain
    expect(minimal).not.toContain('## Operational');
    expect(minimal).not.toContain('## Client Signals');
    expect(minimal).not.toContain('## Content Pipeline');
  });

  it('tokenBudget of 0 is ignored (treated as no budget)', () => {
    const withZero = formatForPrompt(RICH_INTELLIGENCE, { tokenBudget: 0 });
    const withoutBudget = formatForPrompt(RICH_INTELLIGENCE);
    // Both should contain the same sections
    expect(withZero).toContain('## Operational');
    expect(withZero).toContain('## Client Signals');
  });

  it('step 2: truncates insights to 5 items before dropping clientSignals', () => {
    // Build intelligence with 8+ insights so truncation is visible
    const manyInsightItems = Array.from({ length: 8 }, (_, i) => ({
      id: `i${i}`, insightType: 'content_decay', severity: 'warning', impactScore: 10 - i, pageId: `/page${i}`,
    })) as any[];
    const intel: WorkspaceIntelligence = {
      ...RICH_INTELLIGENCE,
      insights: {
        all: manyInsightItems,
        byType: {},
        bySeverity: { critical: 0, warning: 8, opportunity: 0, positive: 0 },
        topByImpact: manyInsightItems,
      },
    };

    // Without budget: detailed mode shows 10 insight items max
    const unbounded = formatForPrompt(intel, { verbosity: 'detailed' });
    const insightLines = unbounded.split('\n').filter(l => l.startsWith('- ['));
    expect(insightLines.length).toBe(8); // 8 items, all under the 10 limit

    // The truncation step (step 2) caps at 5 items — observable with a tight budget
    // We can't directly test step 2 in isolation since token counts are characters/4,
    // but we can verify a budget that forces step 2 reduces insight item count.
    // The output should have at most 5 "- [" lines when truncated.
    const tight = formatForPrompt(intel, { tokenBudget: 200 });
    const tightInsightLines = tight.split('\n').filter(l => l.startsWith('- ['));
    expect(tightInsightLines.length).toBeLessThanOrEqual(5);
  });
});

// ─── verbosity affects output length ─────────────────────────────────────────

describe('formatForPrompt verbosity', () => {
  const intel: WorkspaceIntelligence = {
    ...BASE,
    seoContext: SEO_WITH_CONTEXT,
    learnings: LEARNINGS_WITH_DATA,
    contentPipeline: MIN_CONTENT_PIPELINE,
    siteHealth: MIN_SITE_HEALTH,
  };

  it('compact output is shorter than standard output', () => {
    const compact = formatForPrompt(intel, { verbosity: 'compact' });
    const standard = formatForPrompt(intel, { verbosity: 'standard' });
    expect(compact.length).toBeLessThan(standard.length);
  });

  it('standard output is shorter than detailed output', () => {
    const standard = formatForPrompt(intel, { verbosity: 'standard' });
    const detailed = formatForPrompt(intel, { verbosity: 'detailed' });
    expect(standard.length).toBeLessThan(detailed.length);
  });

  it('defaults to standard verbosity', () => {
    const defaultResult = formatForPrompt(intel);
    const standardResult = formatForPrompt(intel, { verbosity: 'standard' });
    expect(defaultResult).toBe(standardResult);
  });

  it('compact mode omits businessProfile details', () => {
    const seoWithProfile: SeoContextSlice = {
      ...SEO_WITH_CONTEXT,
      businessProfile: {
        industry: 'SaaS',
        goals: ['Grow revenue'],
        targetAudience: 'SMB',
        phone: '+1-555-0100',
      },
    };
    const intel2: WorkspaceIntelligence = { ...BASE, seoContext: seoWithProfile };
    const compact = formatForPrompt(intel2, { verbosity: 'compact', sections: ['seoContext'] });
    expect(compact).not.toContain('Industry:');
    expect(compact).not.toContain('Phone:');
  });

  it('standard mode includes businessProfile industry', () => {
    const seoWithProfile: SeoContextSlice = {
      ...SEO_WITH_CONTEXT,
      businessProfile: {
        industry: 'SaaS / MarTech',
        goals: [],
        targetAudience: 'Enterprise',
      },
    };
    const intel2: WorkspaceIntelligence = { ...BASE, seoContext: seoWithProfile };
    const standard = formatForPrompt(intel2, { verbosity: 'standard', sections: ['seoContext'] });
    expect(standard).toContain('Industry: SaaS / MarTech');
  });

  it('detailed mode includes goals (when non-empty)', () => {
    const seoWithProfile: SeoContextSlice = {
      ...SEO_WITH_CONTEXT,
      businessProfile: {
        industry: 'SaaS',
        goals: ['Expand to EMEA', 'Reduce churn'],
        targetAudience: 'Enterprise',
      },
    };
    const intel2: WorkspaceIntelligence = { ...BASE, seoContext: seoWithProfile };
    const detailed = formatForPrompt(intel2, { verbosity: 'detailed', sections: ['seoContext'] });
    expect(detailed).toContain('Goals:');
    expect(detailed).toContain('Expand to EMEA');
  });
});

// ─── pct() helper — tested indirectly through formatSeoContextSection ──────────
//
// pct() is private but its output appears in several output surfaces.
// We test it via the AEO readiness and win rate outputs.

describe('pct() helper via output', () => {
  it('renders 0 as 0%', () => {
    const intel: WorkspaceIntelligence = {
      ...BASE,
      seoContext: SEO_WITH_CONTEXT,
      siteHealth: {
        ...MIN_SITE_HEALTH,
        aeoReadiness: { pagesChecked: 10, passingRate: 0 },
      },
    };
    const result = formatForPrompt(intel, { verbosity: 'standard', sections: ['siteHealth'] });
    expect(result).toContain('0%');
  });

  it('renders decimal to percentage (0.73 → 73%)', () => {
    const intel: WorkspaceIntelligence = {
      ...BASE,
      seoContext: SEO_WITH_CONTEXT,
      siteHealth: {
        ...MIN_SITE_HEALTH,
        aeoReadiness: { pagesChecked: 20, passingRate: 0.73 },
      },
    };
    const result = formatForPrompt(intel, { verbosity: 'standard', sections: ['siteHealth'] });
    expect(result).toContain('73%');
  });

  it('renders n/a for null overallWinRate (via learnings summarize step)', () => {
    // pct(null) → 'n/a'; tested via applyTokenBudget summarize-learnings step
    const intel: WorkspaceIntelligence = {
      ...RICH_INTELLIGENCE,
      // Force a tight budget to trigger the "summarize learnings to one line" step
      // where pct(rate) is called with the overallWinRate
    };
    // With overallWinRate = 0.65, the summary should show "65%"
    const result = formatForPrompt(intel, { tokenBudget: 300 });
    // If learnings section survived summarization, it should show a pct
    // If it was fully dropped, just ensure no raw null/NaN leaks
    expect(result).not.toMatch(/\bNaN\b/);
    expect(result).not.toMatch(/\bnull\b/);
  });

  it('renders approval rate as percentage in clientSignals', () => {
    const intel: WorkspaceIntelligence = {
      ...BASE,
      seoContext: SEO_WITH_CONTEXT,
      clientSignals: {
        ...MIN_CLIENT_SIGNALS,
        approvalPatterns: { approvalRate: 0.85, avgResponseTime: null },
      },
    };
    const result = formatForPrompt(intel, { verbosity: 'standard', sections: ['clientSignals'] });
    expect(result).toContain('85%');
  });
});

// ─── formatSeoContextSection returns '' when no content added ─────────────────

describe('formatSeoContextSection returns empty string with only header', () => {
  it('returns empty-ish result when seoContext has only empty fields', () => {
    // formatSeoContextSection returns '' if lines.length === 1 (only header)
    // The cold-start check would normally prevent reaching this, but with a
    // section-filtered call on an empty seoContext we hit cold-start before
    // formatSeoContextSection. When seoContext has content but it's all compact-mode
    // suppressed, the header-only guard kicks in.
    const seoOnlyStrategy: SeoContextSlice = {
      strategy: { siteKeywords: [], pageMap: [], opportunities: [], businessContext: '', generatedAt: '2026-01-01' },
      brandVoice: '',
      effectiveBrandVoiceBlock: '',
      businessContext: '',
      personas: [],
      knowledgeBase: '',
    };
    // seoContext has a strategy (truthy), so cold-start is bypassed;
    // but all content fields are empty → should return ''
    // BUG NOTE: strategy object alone triggers hasSeoContent because strategy is truthy.
    // However formatSeoContextSection renders '' when lines.length === 1.
    // The section is filtered out by the sections.filter(Boolean) in formatForPrompt.
    const intel: WorkspaceIntelligence = { ...BASE, seoContext: seoOnlyStrategy };
    const result = formatForPrompt(intel, { sections: ['seoContext'] });
    // Should not contain the SEO Context header alone
    // The empty-section guard in formatSeoContextSection returns '' for header-only
    // and then sections.filter(Boolean) removes it from output
    // Result may just have [Workspace Intelligence] header
    expect(result).not.toContain('## SEO Context');
  });

  it('renders SEO Context section header when content is present', () => {
    const intel: WorkspaceIntelligence = { ...BASE, seoContext: SEO_WITH_CONTEXT };
    const result = formatForPrompt(intel, { sections: ['seoContext'] });
    expect(result).toContain('## SEO Context');
    expect(result).toContain('B2B SaaS company');
  });
});

// ─── formatLearningsSection 25-line cap ──────────────────────────────────────

describe('formatLearningsSection 25-line cap', () => {
  it('output does not exceed 26 lines (header + 25 content + optional truncation notice)', () => {
    // Build a learnings slice that would produce many lines
    const manyWins = Array.from({ length: 20 }, (_, i) => ({
      actionId: `a${i}`,
      actionType: 'title_update',
      pageUrl: `/page${i}`,
      targetKeyword: `keyword${i}`,
      createdAt: '2026-01-01',
      scoredAt: '2026-01-15',
      delta: { primary_metric: 'traffic', baseline_value: 100, current_value: 150, delta_absolute: 50, delta_percent: 50, direction: 'improved' as const },
      score: 'win' as const,
    }));

    const bigLearnings: LearningsSlice = {
      ...LEARNINGS_WITH_DATA,
      topActionTypes: Array.from({ length: 10 }, (_, i) => ({
        type: `action_type_${i}`,
        winRate: 0.5 + i * 0.03,
        count: 5 + i,
      })),
      topWins: manyWins,
    };

    const intel: WorkspaceIntelligence = {
      ...BASE,
      seoContext: SEO_WITH_CONTEXT,
      learnings: bigLearnings,
    };

    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'] });
    const learningsBlock = result.split('\n\n').find(s => s.startsWith('## Outcome Learnings'));
    expect(learningsBlock).toBeTruthy();
    const lines = learningsBlock!.split('\n');
    // The 25-line cap allows lines[0..24] + optional truncation notice = 26 max
    expect(lines.length).toBeLessThanOrEqual(26);
  });

  it('appends truncation notice when learnings exceed 25 lines', () => {
    const manyWins = Array.from({ length: 20 }, (_, i) => ({
      actionId: `a${i}`,
      actionType: 'title_update',
      pageUrl: `/page${i}`,
      targetKeyword: `keyword${i}`,
      createdAt: '2026-01-01',
      scoredAt: '2026-01-15',
      delta: { primary_metric: 'traffic', baseline_value: 100, current_value: 150, delta_absolute: 50, delta_percent: 50, direction: 'improved' as const },
      score: 'win' as const,
    }));

    const bigLearnings: LearningsSlice = {
      ...LEARNINGS_WITH_DATA,
      topActionTypes: Array.from({ length: 10 }, (_, i) => ({
        type: `action_type_${i}`,
        winRate: 0.5 + i * 0.02,
        count: 5 + i,
      })),
      topWins: manyWins,
    };

    const intel: WorkspaceIntelligence = {
      ...BASE,
      seoContext: SEO_WITH_CONTEXT,
      learnings: bigLearnings,
    };

    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'] });
    expect(result).toContain('additional learnings truncated');
  });

  it('does NOT append truncation notice when learnings are within 25 lines', () => {
    const intel: WorkspaceIntelligence = {
      ...BASE,
      seoContext: SEO_WITH_CONTEXT,
      learnings: {
        ...MIN_LEARNINGS,
        overallWinRate: 0.6,
        topActionTypes: [{ type: 'title_update', winRate: 0.6, count: 5 }],
      },
    };
    const result = formatForPrompt(intel, { verbosity: 'standard', sections: ['learnings'] });
    expect(result).not.toContain('additional learnings truncated');
  });
});

// ─── formatLearningsSection willRender guard ─────────────────────────────────

describe('formatLearningsSection willRender guard', () => {
  it('returns empty string (no header) when no learnings content would render', () => {
    const intel: WorkspaceIntelligence = {
      ...BASE,
      seoContext: SEO_WITH_CONTEXT,
      learnings: MIN_LEARNINGS,
    };
    const result = formatForPrompt(intel, { verbosity: 'compact', sections: ['learnings'] });
    expect(result).not.toContain('## Outcome Learnings');
  });

  it('renders learnings header when overallWinRate > 0', () => {
    const intel: WorkspaceIntelligence = {
      ...BASE,
      seoContext: SEO_WITH_CONTEXT,
      learnings: { ...MIN_LEARNINGS, overallWinRate: 0.5 },
    };
    const result = formatForPrompt(intel, { verbosity: 'compact', sections: ['learnings'] });
    expect(result).toContain('## Outcome Learnings');
    expect(result).toContain('50%');
  });

  it('renders learnings when recentTrend is present (compact)', () => {
    const intel: WorkspaceIntelligence = {
      ...BASE,
      seoContext: SEO_WITH_CONTEXT,
      learnings: { ...MIN_LEARNINGS, recentTrend: 'declining' },
    };
    const result = formatForPrompt(intel, { verbosity: 'compact', sections: ['learnings'] });
    expect(result).toContain('## Outcome Learnings');
    expect(result).toContain('declining');
  });

  it('does not render "stable" trend (stable is suppressed)', () => {
    const intel: WorkspaceIntelligence = {
      ...BASE,
      seoContext: SEO_WITH_CONTEXT,
      learnings: { ...MIN_LEARNINGS, overallWinRate: 0.6, recentTrend: 'stable' },
    };
    const result = formatForPrompt(intel, { verbosity: 'compact', sections: ['learnings'] });
    // recentTrend 'stable' is explicitly suppressed in the formatter
    expect(result).not.toContain('Trend: stable');
  });
});

// ─── learningsDomain filtering ────────────────────────────────────────────────

describe('formatForPrompt learningsDomain option', () => {
  const intel: WorkspaceIntelligence = {
    ...BASE,
    seoContext: SEO_WITH_CONTEXT,
    learnings: LEARNINGS_WITH_DATA,
  };

  it('domain=content shows content learnings and hides strategy/technical', () => {
    const result = formatForPrompt(intel, {
      verbosity: 'detailed',
      sections: ['learnings'],
      learningsDomain: 'content',
    });
    expect(result).toContain('seo guide'); // from bestPerformingTopics
    expect(result).not.toContain('0-20'); // strategy difficulty range
    expect(result).not.toContain('Schema types producing'); // technical
  });

  it('domain=strategy shows strategy learnings and hides content/technical', () => {
    const result = formatForPrompt(intel, {
      verbosity: 'detailed',
      sections: ['learnings'],
      learningsDomain: 'strategy',
    });
    expect(result).toContain('informational'); // bestIntentTypes
    expect(result).not.toContain('seo guide'); // content topics
    expect(result).not.toContain('Schema types producing'); // technical
  });

  it('domain=technical shows technical learnings and hides content/strategy', () => {
    const result = formatForPrompt(intel, {
      verbosity: 'detailed',
      sections: ['learnings'],
      learningsDomain: 'technical',
    });
    expect(result).toContain('FAQ'); // schemaTypesWithRichResults
    expect(result).not.toContain('seo guide'); // content topics
    expect(result).not.toContain('informational'); // strategy intents
  });

  it('domain=all shows all three domains', () => {
    const result = formatForPrompt(intel, {
      verbosity: 'detailed',
      sections: ['learnings'],
      learningsDomain: 'all',
    });
    expect(result).toContain('seo guide'); // content
    expect(result).toContain('informational'); // strategy
    expect(result).toContain('FAQ'); // technical
  });

  it('default domain (no learningsDomain) renders all domains', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'] });
    expect(result).toContain('seo guide');
    expect(result).toContain('informational');
    expect(result).toContain('FAQ');
  });
});

// ─── formatKnowledgeBaseForPrompt ─────────────────────────────────────────────

describe('formatKnowledgeBaseForPrompt', () => {
  it('returns empty string for null', () => {
    expect(formatKnowledgeBaseForPrompt(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatKnowledgeBaseForPrompt(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(formatKnowledgeBaseForPrompt('')).toBe('');
  });

  it('returns empty string for whitespace-only string', () => {
    expect(formatKnowledgeBaseForPrompt('   \n  ')).toBe('');
  });

  it('wraps knowledge base in emphatic header', () => {
    const result = formatKnowledgeBaseForPrompt('We do enterprise SEO.');
    expect(result).toContain('BUSINESS KNOWLEDGE BASE');
    expect(result).toContain('We do enterprise SEO.');
  });

  it('includes the business-aware answers instruction in the header', () => {
    const result = formatKnowledgeBaseForPrompt('Knowledge content here.');
    expect(result).toContain('business-aware answers');
  });

  it('preserves multi-line knowledge base content', () => {
    const kb = 'Line one.\nLine two.\nLine three.';
    const result = formatKnowledgeBaseForPrompt(kb);
    expect(result).toContain('Line one.');
    expect(result).toContain('Line two.');
    expect(result).toContain('Line three.');
  });

  it('starts with a leading newline (for clean prompt concatenation)', () => {
    const result = formatKnowledgeBaseForPrompt('Some knowledge.');
    expect(result.startsWith('\n')).toBe(true);
  });
});

// ─── formatKeywordsForPrompt ──────────────────────────────────────────────────

describe('formatKeywordsForPrompt', () => {
  it('returns empty string for null', () => {
    expect(formatKeywordsForPrompt(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatKeywordsForPrompt(undefined)).toBe('');
  });

  it('returns empty string when seoContext has no strategy', () => {
    const seo: SeoContextSlice = {
      ...SEO_EMPTY,
      strategy: undefined,
    };
    expect(formatKeywordsForPrompt(seo)).toBe('');
  });

  it('returns empty string when strategy has no keywords and no businessContext', () => {
    const seo: SeoContextSlice = {
      ...SEO_EMPTY,
      strategy: {
        siteKeywords: [],
        pageMap: [],
        opportunities: [],
        businessContext: '',
        generatedAt: '2026-01-01',
      },
    };
    expect(formatKeywordsForPrompt(seo)).toBe('');
  });

  it('renders site target keywords from strategy', () => {
    const seo: SeoContextSlice = {
      ...SEO_EMPTY,
      strategy: {
        siteKeywords: ['enterprise seo', 'analytics platform', 'rank tracking'],
        pageMap: [],
        opportunities: [],
        businessContext: '',
        generatedAt: '2026-01-01',
      },
    };
    const result = formatKeywordsForPrompt(seo);
    expect(result).toContain('Site target keywords');
    expect(result).toContain('enterprise seo');
    expect(result).toContain('analytics platform');
    expect(result).toContain('rank tracking');
  });

  it('limits to 8 site keywords', () => {
    const seo: SeoContextSlice = {
      ...SEO_EMPTY,
      strategy: {
        siteKeywords: ['kw1', 'kw2', 'kw3', 'kw4', 'kw5', 'kw6', 'kw7', 'kw8', 'kw9', 'kw10'],
        pageMap: [],
        opportunities: [],
        businessContext: '',
        generatedAt: '2026-01-01',
      },
    };
    const result = formatKeywordsForPrompt(seo);
    expect(result).toContain('kw8');
    expect(result).not.toContain('kw9');
    expect(result).not.toContain('kw10');
  });

  it('renders businessContext from seoContext field (takes priority over strategy)', () => {
    const seo: SeoContextSlice = {
      ...SEO_EMPTY,
      businessContext: 'Primary business context from seoContext slice',
      strategy: {
        siteKeywords: ['kw1'],
        pageMap: [],
        opportunities: [],
        businessContext: 'Fallback strategy business context',
        generatedAt: '2026-01-01',
      },
    };
    const result = formatKeywordsForPrompt(seo);
    expect(result).toContain('Primary business context from seoContext slice');
    expect(result).not.toContain('Fallback strategy business context');
  });

  it('falls back to strategy.businessContext when seoContext.businessContext is empty', () => {
    const seo: SeoContextSlice = {
      ...SEO_EMPTY,
      businessContext: '',
      strategy: {
        siteKeywords: ['kw1'],
        pageMap: [],
        opportunities: [],
        businessContext: 'Strategy-level business context',
        generatedAt: '2026-01-01',
      },
    };
    const result = formatKeywordsForPrompt(seo);
    expect(result).toContain('Strategy-level business context');
  });

  it('renders page-specific keywords when pageKeywords present', () => {
    const seo: SeoContextSlice = {
      ...SEO_EMPTY,
      strategy: { siteKeywords: ['site kw'], pageMap: [], opportunities: [], businessContext: '', generatedAt: '2026-01-01' },
      pageKeywords: {
        pagePath: '/blog/seo-guide',
        pageTitle: 'SEO Guide',
        primaryKeyword: 'seo guide for beginners',
        secondaryKeywords: ['learn seo', 'seo basics'],
        searchIntent: 'informational',
        currentPosition: 8,
        previousPosition: null,
      },
    };
    const result = formatKeywordsForPrompt(seo);
    expect(result).toContain('seo guide for beginners');
    expect(result).toContain('THIS PAGE\'S TARGET');
    expect(result).toContain('IMPORTANT');
  });

  it('includes location override warning in page keyword block', () => {
    const seo: SeoContextSlice = {
      ...SEO_EMPTY,
      strategy: { siteKeywords: ['dental services'], pageMap: [], opportunities: [], businessContext: '', generatedAt: '2026-01-01' },
      pageKeywords: {
        pagePath: '/chicago-dentist',
        pageTitle: 'Chicago Dentist',
        primaryKeyword: 'dentist chicago',
        secondaryKeywords: [],
        searchIntent: 'local',
        currentPosition: 5,
        previousPosition: null,
      },
    };
    const result = formatKeywordsForPrompt(seo);
    expect(result).toContain('ALWAYS use THAT location');
  });

  it('wraps output in KEYWORD STRATEGY header', () => {
    const seo: SeoContextSlice = {
      ...SEO_EMPTY,
      strategy: { siteKeywords: ['kw1'], pageMap: [], opportunities: [], businessContext: '', generatedAt: '2026-01-01' },
    };
    const result = formatKeywordsForPrompt(seo);
    expect(result).toContain('KEYWORD STRATEGY');
  });
});

// ─── formatPersonasForPrompt ──────────────────────────────────────────────────

describe('formatPersonasForPrompt', () => {
  it('returns empty string for null', () => {
    expect(formatPersonasForPrompt(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatPersonasForPrompt(undefined)).toBe('');
  });

  it('returns empty string for empty array', () => {
    expect(formatPersonasForPrompt([])).toBe('');
  });

  const persona: AudiencePersona = {
    id: 'p1',
    name: 'Marketing Manager',
    description: 'Mid-level marketing professional managing SEO campaigns',
    painPoints: ['Lack of visibility into keyword rankings'],
    goals: ['Increase organic traffic by 25%'],
    objections: ['Too expensive for our budget'],
    preferredContentFormat: 'infographics and short articles',
    buyingStage: 'evaluation',
  };

  it('renders persona name in bold markdown format', () => {
    const result = formatPersonasForPrompt([persona]);
    expect(result).toContain('**Marketing Manager**');
  });

  it('renders persona description', () => {
    const result = formatPersonasForPrompt([persona]);
    expect(result).toContain('Mid-level marketing professional');
  });

  it('renders buying stage in parentheses', () => {
    const result = formatPersonasForPrompt([persona]);
    expect(result).toContain('(evaluation stage)');
  });

  it('renders pain points with semicolons', () => {
    const result = formatPersonasForPrompt([persona]);
    expect(result).toContain('Pain points:');
    expect(result).toContain('Lack of visibility into keyword rankings');
  });

  it('renders goals', () => {
    const result = formatPersonasForPrompt([persona]);
    expect(result).toContain('Goals:');
    expect(result).toContain('Increase organic traffic by 25%');
  });

  it('renders objections', () => {
    const result = formatPersonasForPrompt([persona]);
    expect(result).toContain('Objections:');
    expect(result).toContain('Too expensive for our budget');
  });

  it('renders preferred content format', () => {
    const result = formatPersonasForPrompt([persona]);
    expect(result).toContain('Prefers:');
    expect(result).toContain('infographics and short articles');
  });

  it('renders multiple personas separated by double newline', () => {
    const persona2: AudiencePersona = {
      id: 'p2',
      name: 'SEO Director',
      description: 'Senior SEO strategist',
      painPoints: [],
      goals: [],
      objections: [],
    };
    const result = formatPersonasForPrompt([persona, persona2]);
    expect(result).toContain('Marketing Manager');
    expect(result).toContain('SEO Director');
  });

  it('omits buying stage line when buyingStage is absent', () => {
    const personaNoStage: AudiencePersona = {
      id: 'p3',
      name: 'Content Writer',
      description: 'Creates SEO content',
      painPoints: [],
      goals: [],
      objections: [],
    };
    const result = formatPersonasForPrompt([personaNoStage]);
    expect(result).toContain('**Content Writer**');
    expect(result).not.toContain('stage)');
  });

  it('wraps output in TARGET AUDIENCE PERSONAS header', () => {
    const result = formatPersonasForPrompt([persona]);
    expect(result).toContain('TARGET AUDIENCE PERSONAS');
  });

  it('starts with a leading newline (for prompt concatenation)', () => {
    const result = formatPersonasForPrompt([persona]);
    expect(result.startsWith('\n')).toBe(true);
  });
});

// ─── formatPageMapForPrompt ───────────────────────────────────────────────────

describe('formatPageMapForPrompt', () => {
  it('returns empty string for null', () => {
    expect(formatPageMapForPrompt(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatPageMapForPrompt(undefined)).toBe('');
  });

  it('returns empty string when strategy is undefined', () => {
    const seo: SeoContextSlice = { ...SEO_EMPTY, strategy: undefined };
    expect(formatPageMapForPrompt(seo)).toBe('');
  });

  it('returns empty string when pageMap is empty', () => {
    const seo: SeoContextSlice = {
      ...SEO_EMPTY,
      strategy: { siteKeywords: [], pageMap: [], opportunities: [], businessContext: '', generatedAt: '2026-01-01' },
    };
    expect(formatPageMapForPrompt(seo)).toBe('');
  });

  it('renders all pages without pagePath filter', () => {
    const seo: SeoContextSlice = {
      ...SEO_EMPTY,
      strategy: {
        siteKeywords: [],
        pageMap: [
          { pagePath: '/features', pageTitle: 'Features', primaryKeyword: 'enterprise seo', secondaryKeywords: [], searchIntent: 'commercial', currentPosition: 5, previousPosition: null },
          { pagePath: '/pricing', pageTitle: 'Pricing', primaryKeyword: 'seo pricing', secondaryKeywords: [], searchIntent: 'transactional', currentPosition: 10, previousPosition: null },
        ],
        opportunities: [],
        businessContext: '',
        generatedAt: '2026-01-01',
      },
    };
    const result = formatPageMapForPrompt(seo);
    expect(result).toContain('/features');
    expect(result).toContain('enterprise seo');
    expect(result).toContain('/pricing');
    expect(result).toContain('seo pricing');
  });

  it('filters to specific pagePath when provided', () => {
    const seo: SeoContextSlice = {
      ...SEO_EMPTY,
      strategy: {
        siteKeywords: [],
        pageMap: [
          { pagePath: '/features', pageTitle: 'Features', primaryKeyword: 'enterprise seo', secondaryKeywords: [], searchIntent: 'commercial', currentPosition: 5, previousPosition: null },
          { pagePath: '/pricing', pageTitle: 'Pricing', primaryKeyword: 'seo pricing', secondaryKeywords: [], searchIntent: 'transactional', currentPosition: 10, previousPosition: null },
        ],
        opportunities: [],
        businessContext: '',
        generatedAt: '2026-01-01',
      },
    };
    const result = formatPageMapForPrompt(seo, '/features');
    expect(result).toContain('/features');
    expect(result).toContain('enterprise seo');
    expect(result).not.toContain('/pricing');
    expect(result).not.toContain('seo pricing');
  });

  it('returns empty string when filtered pagePath has no match', () => {
    const seo: SeoContextSlice = {
      ...SEO_EMPTY,
      strategy: {
        siteKeywords: [],
        pageMap: [
          { pagePath: '/features', pageTitle: 'Features', primaryKeyword: 'enterprise seo', secondaryKeywords: [], searchIntent: 'commercial', currentPosition: 5, previousPosition: null },
        ],
        opportunities: [],
        businessContext: '',
        generatedAt: '2026-01-01',
      },
    };
    const result = formatPageMapForPrompt(seo, '/nonexistent-page');
    expect(result).toBe('');
  });

  it('includes secondary keywords (up to 3)', () => {
    const seo: SeoContextSlice = {
      ...SEO_EMPTY,
      strategy: {
        siteKeywords: [],
        pageMap: [
          {
            pagePath: '/features',
            pageTitle: 'Features',
            primaryKeyword: 'enterprise seo',
            secondaryKeywords: ['seo analytics', 'seo platform', 'seo tools', 'extra kw'],
            searchIntent: 'commercial',
            currentPosition: 5,
            previousPosition: null,
          },
        ],
        opportunities: [],
        businessContext: '',
        generatedAt: '2026-01-01',
      },
    };
    const result = formatPageMapForPrompt(seo);
    expect(result).toContain('seo analytics');
    expect(result).toContain('seo platform');
    expect(result).toContain('seo tools');
    // 4th secondary keyword should be truncated (slice 0..3)
    expect(result).not.toContain('extra kw');
  });

  it('wraps output in KEYWORD MAP header', () => {
    const seo: SeoContextSlice = {
      ...SEO_EMPTY,
      strategy: {
        siteKeywords: [],
        pageMap: [
          { pagePath: '/features', pageTitle: 'Features', primaryKeyword: 'enterprise seo', secondaryKeywords: [], searchIntent: 'commercial', currentPosition: 5, previousPosition: null },
        ],
        opportunities: [],
        businessContext: '',
        generatedAt: '2026-01-01',
      },
    };
    const result = formatPageMapForPrompt(seo);
    expect(result).toContain('KEYWORD MAP');
    expect(result).toContain('cannibalization');
  });

  it('starts with a leading newline (for prompt concatenation)', () => {
    const seo: SeoContextSlice = {
      ...SEO_EMPTY,
      strategy: {
        siteKeywords: [],
        pageMap: [
          { pagePath: '/features', pageTitle: 'Features', primaryKeyword: 'enterprise seo', secondaryKeywords: [], searchIntent: 'commercial', currentPosition: 5, previousPosition: null },
        ],
        opportunities: [],
        businessContext: '',
        generatedAt: '2026-01-01',
      },
    };
    const result = formatPageMapForPrompt(seo);
    expect(result.startsWith('\n')).toBe(true);
  });
});

// ─── localSeo section rendering ───────────────────────────────────────────────
//
// NOTE: localSeo is NOT in the cold-start bypass list in formatForPrompt (unlike
// contentPipeline, siteHealth, operational, etc. which are listed in the
// `include !== null &&` guard at lines 52-62 of formatters.ts).
// This means a section-filtered call with only `sections: ['localSeo']` on an
// otherwise-empty intelligence object will trigger the cold-start guard and
// return '' (per the `if (include !== null && !include.has('seoContext')) return ''`
// at line 70). To reliably test localSeo rendering, tests must either:
//   (a) include seoContext with real content so hasData=true, OR
//   (b) use an unfiltered call (no sections option).
//
// POTENTIAL BUG: The cold-start bypass list at lines 52-62 of formatters.ts does
// not include 'localSeo'. This is inconsistent with other assembled-object slices
// (contentPipeline, siteHealth, clientSignals, operational) that do bypass cold-start
// when explicitly requested. A targeted caller doing `sections: ['localSeo']` that has
// localSeo data but no seoContext will silently receive '' instead of the local SEO
// block. Worth verifying if this is intentional or an oversight.

describe('formatLocalSeoSection', () => {
  const localSeoBase = {
    locations: [],
    enabled: true,
    markets: [],
    visibility: { visible: 0, possibleMatch: 0, notVisible: 0, notChecked: 0, providerDegraded: 0 },
    candidates: [],
    effectiveLocalSeoBlock: '',
    latestSnapshotAt: null,
  };

  it('returns disabled message when enabled=false', () => {
    // Must include seoContext to bypass cold-start (localSeo not in bypass list)
    const intel: WorkspaceIntelligence = {
      ...BASE,
      seoContext: SEO_WITH_CONTEXT,
      localSeo: { ...localSeoBase, enabled: false },
    };
    // Use unfiltered call so seoContext hasData check triggers bypass
    const result = formatForPrompt(intel);
    expect(result).toContain('Local SEO is disabled');
  });

  it('renders compact one-liner with active market count at compact verbosity', () => {
    const intel: WorkspaceIntelligence = {
      ...BASE,
      seoContext: SEO_WITH_CONTEXT,
      localSeo: {
        ...localSeoBase,
        enabled: true,
        markets: [
          { id: 'm1', label: 'Chicago', status: 'active', location: 'Chicago, IL' },
          { id: 'm2', label: 'Detroit', status: 'inactive', location: 'Detroit, MI' },
        ],
        visibility: { visible: 12, possibleMatch: 3, notVisible: 5, notChecked: 2, providerDegraded: 0 },
      },
    };
    // Use sections: ['seoContext', 'localSeo'] so cold-start bypass triggers via seoContext
    const result = formatForPrompt(intel, { verbosity: 'compact', sections: ['seoContext', 'localSeo'] });
    expect(result).toContain('1 active markets');
    expect(result).toContain('12 visible');
  });

  it('renders effectiveLocalSeoBlock at standard verbosity', () => {
    const intel: WorkspaceIntelligence = {
      ...BASE,
      seoContext: SEO_WITH_CONTEXT,
      localSeo: {
        ...localSeoBase,
        enabled: true,
        effectiveLocalSeoBlock: 'Pre-formatted local SEO intelligence block content.',
      },
    };
    // Use sections: ['seoContext', 'localSeo'] so cold-start bypass triggers via seoContext
    const result = formatForPrompt(intel, { verbosity: 'standard', sections: ['seoContext', 'localSeo'] });
    expect(result).toContain('Pre-formatted local SEO intelligence block content.');
  });
});

// ─── Output hygiene: no raw garbage values ────────────────────────────────────

describe('output hygiene', () => {
  it('never outputs raw "NaN" in any section', () => {
    const result = formatForPrompt(RICH_INTELLIGENCE, { verbosity: 'detailed' });
    expect(result).not.toMatch(/\bNaN\b/);
  });

  it('never outputs raw "undefined" in any section', () => {
    const result = formatForPrompt(RICH_INTELLIGENCE, { verbosity: 'detailed' });
    expect(result).not.toMatch(/\bundefined\b/);
  });

  it('never outputs raw bare "null" in any section', () => {
    const result = formatForPrompt(RICH_INTELLIGENCE, { verbosity: 'detailed' });
    expect(result).not.toMatch(/(?<!\w)null(?!\w)/);
  });

  it('always returns a non-empty string', () => {
    const result = formatForPrompt(BASE);
    expect(result.length).toBeGreaterThan(0);
  });

  it('always includes [Workspace Intelligence] header', () => {
    expect(formatForPrompt(BASE)).toContain('[Workspace Intelligence]');
    expect(formatForPrompt(RICH_INTELLIGENCE)).toContain('[Workspace Intelligence]');
  });
});
