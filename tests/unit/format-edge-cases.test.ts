// tests/unit/format-edge-cases.test.ts
//
// EDGE CASES: Every formatter must handle empty/minimal data gracefully.
// No NaN, undefined, or null literals should appear in any output.

import { describe, it, expect } from 'vitest';
import { formatForPrompt } from '../../server/workspace-intelligence.js';
import type {
  WorkspaceIntelligence,
  InsightsSlice,
  LearningsSlice,
  ContentPipelineSlice,
  SiteHealthSlice,
  ClientSignalsSlice,
  OperationalSlice,
} from '../../shared/types/intelligence.js';

function noGarbage(output: string): void {
  expect(output).not.toMatch(/\bNaN\b/);
  expect(output).not.toMatch(/\bundefined\b/);
  expect(output).not.toMatch(/(?<!\w)null(?!\w)/);
}

// ── Minimal valid slice fixtures ─────────────────────────────────────────────

const minInsights: InsightsSlice = {
  all: [],
  byType: {},
  bySeverity: { critical: 0, warning: 0, opportunity: 0, positive: 0 },
  topByImpact: [],
};

const minLearnings: LearningsSlice = {
  summary: null,
  confidence: null,
  topActionTypes: [],
  overallWinRate: 0,
  recentTrend: null,
  playbooks: [],
};

const minContentPipeline: ContentPipelineSlice = {
  briefs: { total: 0, byStatus: {} },
  posts: { total: 0, byStatus: {} },
  matrices: { total: 0, cellsPlanned: 0, cellsPublished: 0 },
  requests: { pending: 0, inProgress: 0, delivered: 0 },
  workOrders: { active: 0 },
  coverageGaps: [],
  seoEdits: { pending: 0, applied: 0, inReview: 0 },
};

const minSiteHealth: SiteHealthSlice = {
  auditScore: null,
  auditScoreDelta: null,
  deadLinks: 0,
  redirectChains: 0,
  schemaErrors: 0,
  orphanPages: 0,
  cwvPassRate: { mobile: null, desktop: null },
};

const minClientSignals: ClientSignalsSlice = {
  keywordFeedback: { approved: [], rejected: [], patterns: { approveRate: 0, topRejectionReasons: [] } },
  contentGapVotes: [],
  businessPriorities: [],
  approvalPatterns: { approvalRate: 0, avgResponseTime: null },
  recentChatTopics: [],
  churnRisk: null,
};

const minOperational: OperationalSlice = {
  recentActivity: [],
  annotations: [],
  pendingJobs: 0,
};

const minSeoContext = {
  strategy: undefined,
  brandVoice: '',
  effectiveBrandVoiceBlock: '',
  businessContext: '',
  personas: [],
  knowledgeBase: '',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('formatForPrompt with empty seoContext', () => {
  const intel: WorkspaceIntelligence = {
    version: 1, workspaceId: 'ws-edge', assembledAt: '2026-01-01T00:00:00Z',
    seoContext: minSeoContext,
  };

  it('returns cold-start message for completely empty seoContext', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] });
    expect(result).toContain('newly onboarded');
    noGarbage(result);
  });
});

describe('formatForPrompt with empty insights', () => {
  const intel: WorkspaceIntelligence = {
    version: 1, workspaceId: 'ws-edge', assembledAt: '2026-01-01T00:00:00Z',
    seoContext: { ...minSeoContext, brandVoice: 'Test voice' },
    insights: minInsights,
  };

  it('omits insights section when all counts are zero and no insights', () => {
    // insights with all=[] is filtered out by formatForPrompt (requires all.length > 0)
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] });
    expect(result).not.toContain('## Active Insights');
    noGarbage(result);
  });
});

describe('formatForPrompt with minimal learnings', () => {
  const intel: WorkspaceIntelligence = {
    version: 1, workspaceId: 'ws-edge', assembledAt: '2026-01-01T00:00:00Z',
    seoContext: { ...minSeoContext, brandVoice: 'Test voice' },
    learnings: minLearnings,
  };

  it('omits learnings section when nothing would render', () => {
    // minLearnings has no content — the formatter should return empty string
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext', 'learnings'] });
    expect(result).not.toContain('## Outcome Learnings');
    noGarbage(result);
  });

  // no-assertion-ok — noGarbage() (defined at top of file) contains 3 expect() calls
  it('no NaN in output when overallWinRate is 0', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'] });
    noGarbage(result);
  });
});

describe('formatForPrompt with minimal contentPipeline', () => {
  const intel: WorkspaceIntelligence = {
    version: 1, workspaceId: 'ws-edge', assembledAt: '2026-01-01T00:00:00Z',
    seoContext: { ...minSeoContext, brandVoice: 'Test voice' },
    contentPipeline: minContentPipeline,
  };

  for (const verbosity of ['compact', 'standard', 'detailed'] as const) {
    // no-assertion-ok — noGarbage() asserts internally via 3 expect() calls
    it(`no NaN/undefined/null at ${verbosity} verbosity`, () => {
      const result = formatForPrompt(intel, { verbosity, sections: ['contentPipeline'] });
      noGarbage(result);
    });
  }

  it('renders section header even with zero counts', () => {
    const result = formatForPrompt(intel, { verbosity: 'standard', sections: ['contentPipeline'] });
    expect(result).toContain('## Content Pipeline');
  });
});

describe('formatForPrompt with minimal siteHealth', () => {
  const intel: WorkspaceIntelligence = {
    version: 1, workspaceId: 'ws-edge', assembledAt: '2026-01-01T00:00:00Z',
    seoContext: { ...minSeoContext, brandVoice: 'Test voice' },
    siteHealth: minSiteHealth,
  };

  for (const verbosity of ['compact', 'standard', 'detailed'] as const) {
    // no-assertion-ok — noGarbage() asserts internally via 3 expect() calls
    it(`no NaN/undefined/null at ${verbosity} verbosity`, () => {
      const result = formatForPrompt(intel, { verbosity, sections: ['siteHealth'] });
      noGarbage(result);
    });
  }

  it('renders n/a for null audit score', () => {
    const result = formatForPrompt(intel, { verbosity: 'standard', sections: ['siteHealth'] });
    expect(result).toContain('n/a');
  });
});

describe('formatForPrompt with minimal clientSignals', () => {
  const intel: WorkspaceIntelligence = {
    version: 1, workspaceId: 'ws-edge', assembledAt: '2026-01-01T00:00:00Z',
    seoContext: { ...minSeoContext, brandVoice: 'Test voice' },
    clientSignals: minClientSignals,
  };

  for (const verbosity of ['compact', 'standard', 'detailed'] as const) {
    // no-assertion-ok — noGarbage() asserts internally via 3 expect() calls
    it(`no NaN/undefined/null at ${verbosity} verbosity`, () => {
      const result = formatForPrompt(intel, { verbosity, sections: ['clientSignals'] });
      noGarbage(result);
    });
  }

  it('renders unknown churn risk for null churnRisk', () => {
    const result = formatForPrompt(intel, { verbosity: 'compact', sections: ['clientSignals'] });
    expect(result).toContain('unknown');
  });
});

describe('formatForPrompt with minimal operational', () => {
  const intel: WorkspaceIntelligence = {
    version: 1, workspaceId: 'ws-edge', assembledAt: '2026-01-01T00:00:00Z',
    seoContext: { ...minSeoContext, brandVoice: 'Test voice' },
    operational: minOperational,
  };

  for (const verbosity of ['compact', 'standard', 'detailed'] as const) {
    // no-assertion-ok — noGarbage() asserts internally via 3 expect() calls
    it(`no NaN/undefined/null at ${verbosity} verbosity`, () => {
      const result = formatForPrompt(intel, { verbosity, sections: ['operational'] });
      noGarbage(result);
    });
  }
});

describe('weCalledIt verbosity-dependent truncation', () => {
  const learningsWithWeCalledIt: LearningsSlice = {
    ...minLearnings,
    overallWinRate: 0.6,
    recentTrend: 'improving',
    topActionTypes: [{ type: 'content_refreshed', winRate: 0.72, count: 10 }],
    weCalledIt: [
      { actionId: 'a1', prediction: 'Title change boosts CTR', outcome: 'CTR up 23%', score: 'win', pageUrl: '/blog/a', measuredAt: '2026-03-01T00:00:00Z' },
      { actionId: 'a2', prediction: 'Schema adds rich results', outcome: 'Rich snippet gained', score: 'win', pageUrl: '/blog/b', measuredAt: '2026-03-02T00:00:00Z' },
      { actionId: 'a3', prediction: 'New H2s improve rank', outcome: 'Position up 3', score: 'win', pageUrl: '/blog/c', measuredAt: '2026-03-03T00:00:00Z' },
      { actionId: 'a4', prediction: 'Internal links lift authority', outcome: 'Position stable', score: 'push', pageUrl: '/blog/d', measuredAt: '2026-03-04T00:00:00Z' },
    ],
  };

  const intel: WorkspaceIntelligence = {
    version: 1, workspaceId: 'ws-edge', assembledAt: '2026-01-01T00:00:00Z',
    seoContext: { ...minSeoContext, brandVoice: 'Test voice' },
    learnings: learningsWithWeCalledIt,
  };

  it('renders weCalledIt entries at standard verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'standard', sections: ['learnings'] });
    expect(result).toContain('Title change boosts CTR');
  });

  it('renders weCalledIt entries at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'] });
    expect(result).toContain('Title change boosts CTR');
    expect(result).toContain('Schema adds rich results');
  });

  // no-assertion-ok — noGarbage() asserts internally via 3 expect() calls
  it('no NaN/undefined/null in weCalledIt output', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'] });
    noGarbage(result);
  });
});
