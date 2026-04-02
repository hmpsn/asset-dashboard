// tests/contract/old-vs-new-output.test.ts
//
// CONTRACT TEST: Every piece of information in the old path's output
// must appear in the new path's output. If this test fails, data was
// lost in the migration.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { seoContextMock } from '../fixtures/seo-context-mock.js';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('../../server/seo-context.js', () => seoContextMock());

vi.mock('../../server/feature-flags.js', () => ({ isFeatureEnabled: vi.fn(() => false) }));

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: vi.fn(() => ({
    id: 'ws-contract',
    brandVoice: 'Professional, data-driven, and authoritative. No fluff.',
    knowledgeBase: 'We specialize in enterprise SEO analytics with real-time rank tracking.',
    personas: [
      {
        id: 'p1', name: 'Marketing Director',
        description: 'Mid-level executive responsible for organic growth',
        painPoints: ['Proving SEO ROI to C-suite', 'Managing multiple agencies'],
        goals: ['Increase organic traffic 30% YoY'],
        objections: ['SEO takes too long to show results'],
        preferredContentFormat: 'case studies',
        buyingStage: 'consideration',
      },
    ],
    keywordStrategy: {
      siteKeywords: ['enterprise seo', 'analytics platform', 'seo tools'],
      pageMap: [{ pagePath: '/features', primaryKeyword: 'enterprise seo', secondaryKeywords: ['seo analytics'], searchIntent: 'commercial' }],
      opportunities: [],
      businessContext: 'Enterprise SEO analytics platform serving Fortune 500 companies',
      generatedAt: '2026-01-01T00:00:00Z',
    },
    webflowSiteId: null,
    intelligenceProfile: null,
  })),
  listWorkspaces: vi.fn(() => []),
}));

vi.mock('../../server/workspace-learnings.js', () => ({
  getWorkspaceLearnings: vi.fn(() => ({
    workspaceId: 'ws-contract',
    computedAt: '2026-01-01T00:00:00Z',
    confidence: 'high',
    totalScoredActions: 25,
    content: {
      winRateByFormat: { long_form: 0.75, listicle: 0.45 },
      avgDaysToPage1: 38,
      refreshRecoveryRate: 0.67,
      bestPerformingTopics: ['seo tips', 'rank tracking'],
      voiceScoreCorrelation: 0.85,
    },
    strategy: {
      winRateByDifficultyRange: { '0-20': 0.85, '21-40': 0.65 },
      winRateByCheckpoint: {},
      bestIntentTypes: ['informational', 'commercial'],
      keywordVolumeSweetSpot: { min: 500, max: 8000 },
    },
    technical: {
      winRateByFixType: { meta_tag: 0.78 },
      schemaTypesWithRichResults: ['FAQ', 'HowTo'],
      avgHealthScoreImprovement: 12,
      internalLinkEffectiveness: 0.72,
    },
    overall: {
      totalWinRate: 0.62,
      strongWinRate: 0.28,
      topActionTypes: [
        { type: 'content_refreshed', winRate: 0.72, count: 10 },
      ],
      recentTrend: 'improving',
    },
  })),
  formatLearningsForPrompt: vi.fn(),
}));

vi.mock('../../server/outcome-playbooks.js', () => ({ getPlaybooks: vi.fn(() => []) }));
vi.mock('../../server/workspace-data.js', () => ({
  getContentPipelineSummary: vi.fn(() => ({
    briefs: { total: 0, byStatus: {} }, posts: { total: 0, byStatus: {} },
    matrices: { total: 0, cellsPlanned: 0, cellsPublished: 0 },
    requests: { pending: 0, inProgress: 0, delivered: 0 },
    workOrders: { active: 0 }, seoEdits: { pending: 0, applied: 0, inReview: 0 },
  })),
  getPageCacheStats: vi.fn(() => ({ entries: 0, maxEntries: 100 })),
}));
vi.mock('../../server/db/index.js', () => {
  const prepare = vi.fn(() => ({ all: vi.fn(() => []), get: vi.fn(() => undefined), run: vi.fn() }));
  return { default: { prepare } };
});
vi.mock('../../server/page-keywords.js', () => ({
  listPageKeywords: vi.fn(() => []),
  getPageKeyword: vi.fn(() => undefined),
}));
vi.mock('../../server/rank-tracking.js', () => ({
  getTrackedKeywords: vi.fn(() => []),
  getLatestRanks: vi.fn(() => []),
}));
vi.mock('../../server/outcome-tracking.js', () => ({
  getActionsByPage: vi.fn(() => []),
  getOutcomesForAction: vi.fn(() => []),
  getPendingActions: vi.fn(() => []),
  getActionsByWorkspace: vi.fn(() => []),
}));

const WS_ID = 'ws-contract';

async function invalidateCache() {
  const { invalidateIntelligenceCache } = await import('../../server/workspace-intelligence.js');
  invalidateIntelligenceCache(WS_ID);
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('OLD path vs NEW path — data preservation contracts', () => {
  beforeEach(async () => {
    await invalidateCache();
  });

  it('seoContext: brand voice text preserved', async () => {
    const { buildWorkspaceIntelligence, formatForPrompt } = await import('../../server/workspace-intelligence.js');
    const intel = await buildWorkspaceIntelligence(WS_ID, { slices: ['seoContext'] });
    const newOutput = formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] });
    expect(newOutput).toContain('Professional, data-driven, and authoritative');
  });

  it('seoContext: business context preserved', async () => {
    const { buildWorkspaceIntelligence, formatForPrompt } = await import('../../server/workspace-intelligence.js');
    const intel = await buildWorkspaceIntelligence(WS_ID, { slices: ['seoContext'] });
    const newOutput = formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] });
    expect(newOutput).toContain('Fortune 500');
  });

  it('seoContext: knowledge base text preserved', async () => {
    const { buildWorkspaceIntelligence, formatForPrompt } = await import('../../server/workspace-intelligence.js');
    const intel = await buildWorkspaceIntelligence(WS_ID, { slices: ['seoContext'] });
    const newOutput = formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] });
    // seo-context-mock's getRawKnowledge returns this text
    expect(newOutput).toContain('enterprise SEO analytics');
  });

  it('seoContext: site keyword NAMES preserved (not just count)', async () => {
    const { buildWorkspaceIntelligence, formatForPrompt } = await import('../../server/workspace-intelligence.js');
    const intel = await buildWorkspaceIntelligence(WS_ID, { slices: ['seoContext'] });
    const newOutput = formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] });
    expect(newOutput).toContain('enterprise seo');
    expect(newOutput).toContain('analytics platform');
    expect(newOutput).not.toMatch(/\d+ site keywords/);
  });

  it('seoContext: persona PAIN POINTS preserved (not just names)', async () => {
    const { buildWorkspaceIntelligence, formatForPrompt } = await import('../../server/workspace-intelligence.js');
    const intel = await buildWorkspaceIntelligence(WS_ID, { slices: ['seoContext'] });
    const newOutput = formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] });
    expect(newOutput).toContain('Proving SEO ROI to C-suite');
    expect(newOutput).toContain('Managing multiple agencies');
  });

  it('seoContext: persona GOALS preserved', async () => {
    const { buildWorkspaceIntelligence, formatForPrompt } = await import('../../server/workspace-intelligence.js');
    const intel = await buildWorkspaceIntelligence(WS_ID, { slices: ['seoContext'] });
    const newOutput = formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] });
    expect(newOutput).toContain('Increase organic traffic 30% YoY');
  });

  it('seoContext: persona OBJECTIONS preserved', async () => {
    const { buildWorkspaceIntelligence, formatForPrompt } = await import('../../server/workspace-intelligence.js');
    const intel = await buildWorkspaceIntelligence(WS_ID, { slices: ['seoContext'] });
    const newOutput = formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] });
    expect(newOutput).toContain('SEO takes too long');
  });

  it('seoContext: persona buying stage preserved', async () => {
    const { buildWorkspaceIntelligence, formatForPrompt } = await import('../../server/workspace-intelligence.js');
    const intel = await buildWorkspaceIntelligence(WS_ID, { slices: ['seoContext'] });
    const newOutput = formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] });
    expect(newOutput).toContain('consideration');
  });

  it('seoContext: persona preferred content format preserved', async () => {
    const { buildWorkspaceIntelligence, formatForPrompt } = await import('../../server/workspace-intelligence.js');
    const intel = await buildWorkspaceIntelligence(WS_ID, { slices: ['seoContext'] });
    const newOutput = formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] });
    expect(newOutput).toContain('case studies');
  });

  // ── Learnings contract ─────────────────────────────────────────────

  it('learnings: overall win rate preserved', async () => {
    const featureFlags = await import('../../server/feature-flags.js');
    vi.mocked(featureFlags.isFeatureEnabled).mockImplementation(
      (flag: string) => flag === 'outcome-ai-injection',
    );
    await invalidateCache();
    const { buildWorkspaceIntelligence, formatForPrompt } = await import('../../server/workspace-intelligence.js');
    const intel = await buildWorkspaceIntelligence(WS_ID, { slices: ['learnings'] });
    const newOutput = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'] });
    expect(newOutput).toContain('62%');
    expect(newOutput).toContain('28%'); // strong wins
  });

  it('learnings: totalScoredActions count preserved', async () => {
    const featureFlags = await import('../../server/feature-flags.js');
    vi.mocked(featureFlags.isFeatureEnabled).mockImplementation(
      (flag: string) => flag === 'outcome-ai-injection',
    );
    await invalidateCache();
    const { buildWorkspaceIntelligence, formatForPrompt } = await import('../../server/workspace-intelligence.js');
    const intel = await buildWorkspaceIntelligence(WS_ID, { slices: ['learnings'] });
    const newOutput = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'] });
    expect(newOutput).toContain('25');
  });

  it('learnings: content domain details preserved', async () => {
    const featureFlags = await import('../../server/feature-flags.js');
    vi.mocked(featureFlags.isFeatureEnabled).mockImplementation(
      (flag: string) => flag === 'outcome-ai-injection',
    );
    await invalidateCache();
    const { buildWorkspaceIntelligence, formatForPrompt } = await import('../../server/workspace-intelligence.js');
    const intel = await buildWorkspaceIntelligence(WS_ID, { slices: ['learnings'] });
    const newOutput = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'] });
    expect(newOutput).toContain('38');
    expect(newOutput).toContain('seo tips');
    expect(newOutput).toContain('67%');
  });

  it('learnings: strategy domain details preserved', async () => {
    const featureFlags = await import('../../server/feature-flags.js');
    vi.mocked(featureFlags.isFeatureEnabled).mockImplementation(
      (flag: string) => flag === 'outcome-ai-injection',
    );
    await invalidateCache();
    const { buildWorkspaceIntelligence, formatForPrompt } = await import('../../server/workspace-intelligence.js');
    const intel = await buildWorkspaceIntelligence(WS_ID, { slices: ['learnings'] });
    const newOutput = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'] });
    expect(newOutput).toContain('0-20');
    expect(newOutput).toContain('informational');
    expect(newOutput).toContain('500');
  });

  it('learnings: technical domain details preserved', async () => {
    const featureFlags = await import('../../server/feature-flags.js');
    vi.mocked(featureFlags.isFeatureEnabled).mockImplementation(
      (flag: string) => flag === 'outcome-ai-injection',
    );
    await invalidateCache();
    const { buildWorkspaceIntelligence, formatForPrompt } = await import('../../server/workspace-intelligence.js');
    const intel = await buildWorkspaceIntelligence(WS_ID, { slices: ['learnings'] });
    const newOutput = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'] });
    expect(newOutput).toContain('FAQ');
    expect(newOutput).toContain('HowTo');
    expect(newOutput).toContain('72%');
  });

  // ── Domain filtering contract ──────────────────────────────────────

  it('learnings domain=content: ONLY content details, NOT strategy or technical', async () => {
    const featureFlags = await import('../../server/feature-flags.js');
    vi.mocked(featureFlags.isFeatureEnabled).mockImplementation(
      (flag: string) => flag === 'outcome-ai-injection',
    );
    await invalidateCache();
    const { buildWorkspaceIntelligence, formatForPrompt } = await import('../../server/workspace-intelligence.js');
    const intel = await buildWorkspaceIntelligence(WS_ID, { slices: ['learnings'], learningsDomain: 'content' });
    const newOutput = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'], learningsDomain: 'content' });
    expect(newOutput).toContain('seo tips');
    expect(newOutput).not.toContain('Best intent types');
    expect(newOutput).not.toContain('informational');
    expect(newOutput).not.toContain('Schema types producing');
  });

  it('learnings domain=strategy: ONLY strategy details, NOT content or technical', async () => {
    const featureFlags = await import('../../server/feature-flags.js');
    vi.mocked(featureFlags.isFeatureEnabled).mockImplementation(
      (flag: string) => flag === 'outcome-ai-injection',
    );
    await invalidateCache();
    const { buildWorkspaceIntelligence, formatForPrompt } = await import('../../server/workspace-intelligence.js');
    const intel = await buildWorkspaceIntelligence(WS_ID, { slices: ['learnings'], learningsDomain: 'strategy' });
    const newOutput = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'], learningsDomain: 'strategy' });
    expect(newOutput).toContain('informational');
    expect(newOutput).not.toContain('seo tips');
    expect(newOutput).not.toContain('page 1');
    expect(newOutput).not.toContain('Schema types producing');
  });

  // ── Standalone helper parity ───────────────────────────────────────

  it('formatPersonasForPrompt matches old buildPersonasContext output structure', async () => {
    const { formatPersonasForPrompt } = await import('../../server/workspace-intelligence.js');
    const { getWorkspace } = await import('../../server/workspaces.js');
    const ws = getWorkspace(WS_ID);
    const result = formatPersonasForPrompt(ws?.personas);
    expect(result).toContain('TARGET AUDIENCE PERSONAS');
    expect(result).toContain('Marketing Director');
    expect(result).toContain('consideration');
    expect(result).toContain('Proving SEO ROI to C-suite');
    expect(result).toContain('Increase organic traffic 30% YoY');
    expect(result).toContain('SEO takes too long');
    expect(result).toContain('case studies');
  });

  it('formatBrandVoiceForPrompt matches old brandVoiceBlock header', async () => {
    const { formatBrandVoiceForPrompt } = await import('../../server/workspace-intelligence.js');
    const result = formatBrandVoiceForPrompt('Professional, data-driven, and authoritative.');
    expect(result).toContain('BRAND VOICE & STYLE');
    expect(result).toContain('MUST match');
    expect(result).toContain('Professional, data-driven, and authoritative.');
  });

  it('formatKnowledgeBaseForPrompt matches old knowledgeBlock header', async () => {
    const { formatKnowledgeBaseForPrompt } = await import('../../server/workspace-intelligence.js');
    const result = formatKnowledgeBaseForPrompt('We specialize in enterprise SEO.');
    expect(result).toContain('BUSINESS KNOWLEDGE BASE');
    expect(result).toContain('We specialize in enterprise SEO.');
  });

  // ── No garbage in output ───────────────────────────────────────────

  it('no NaN, undefined, or null literals in detailed output', async () => {
    const { buildWorkspaceIntelligence, formatForPrompt } = await import('../../server/workspace-intelligence.js');
    const intel = await buildWorkspaceIntelligence(WS_ID, { slices: ['seoContext', 'learnings'] });
    const newOutput = formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext', 'learnings'] });
    expect(newOutput).not.toMatch(/\bNaN\b/);
    expect(newOutput).not.toMatch(/\bundefined\b/);
    expect(newOutput).not.toMatch(/(?<!\w)null(?!\w)/);
  });
});
