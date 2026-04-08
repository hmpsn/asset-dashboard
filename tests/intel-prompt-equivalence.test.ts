import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Static mocks (hoisted before module resolution) ──────────────────────────

vi.mock('../server/seo-context.js', () => ({
  buildSeoContext: vi.fn(() => ({
    strategy: {
      siteKeywords: ['enterprise seo', 'analytics platform', 'seo tools'],
      pageMap: [{ pagePath: '/features', primaryKeyword: 'enterprise seo', secondaryKeywords: ['seo analytics'] }],
      opportunities: [],
      businessContext: 'Enterprise SEO analytics platform serving Fortune 500 companies',
      generatedAt: new Date().toISOString(),
    },
    brandVoiceBlock: '\n\nBRAND VOICE & STYLE (you MUST match this voice — do not deviate):\nProfessional, data-driven, and authoritative. No fluff.',
    businessContext: 'Enterprise SEO analytics platform serving Fortune 500 companies',
    knowledgeBlock: '\n\nBUSINESS KNOWLEDGE BASE:\nWe specialize in enterprise SEO analytics with real-time rank tracking and AI-powered insights.',
    personasBlock: '',
    keywordBlock: '',
    fullContext: '',
  })),
  getRawBrandVoice: vi.fn(() => 'Professional, data-driven, and authoritative. No fluff.'),
  getRawKnowledge: vi.fn(() => 'We specialize in enterprise SEO analytics with real-time rank tracking and AI-powered insights.'),
  clearSeoContextCache: vi.fn(),
}));

vi.mock('../server/feature-flags.js', () => ({ isFeatureEnabled: vi.fn(() => false) }));

vi.mock('../server/workspaces.js', () => ({
  getWorkspace: vi.fn(() => ({ id: 'ws-equiv', personas: [], webflowSiteId: null })),
  listWorkspaces: vi.fn(() => []),
}));

vi.mock('../server/workspace-learnings.js', () => ({ getWorkspaceLearnings: vi.fn(() => null) }));

vi.mock('../server/outcome-playbooks.js', () => ({ getPlaybooks: vi.fn(() => []) }));

vi.mock('../server/workspace-data.js', () => ({
  getContentPipelineSummary: vi.fn(() => ({
    briefs: { total: 0, byStatus: {} }, posts: { total: 0, byStatus: {} },
    matrices: { total: 0, cellsPlanned: 0, cellsPublished: 0 },
    requests: { pending: 0, inProgress: 0, delivered: 0 },
    workOrders: { active: 0 }, seoEdits: { pending: 0, applied: 0, inReview: 0 },
  })),
  getPageCacheStats: vi.fn(() => ({ entries: 0, maxEntries: 100 })),
}));

vi.mock('../server/db/index.js', () => {
  const prepare = vi.fn(() => ({ all: vi.fn(() => []), get: vi.fn(() => undefined), run: vi.fn() }));
  return { default: { prepare } };
});

// Dynamic-import mocks used inside workspace-intelligence assemblers
vi.mock('../server/page-keywords.js', () => ({
  listPageKeywords: vi.fn(() => []),
  getPageKeyword: vi.fn(() => undefined),
}));

vi.mock('../server/rank-tracking.js', () => ({
  getTrackedKeywords: vi.fn(() => []),
  getLatestRanks: vi.fn(() => []),
}));

vi.mock('../server/outcome-tracking.js', () => ({
  getActionsByPage: vi.fn(() => []),
  getOutcomesForAction: vi.fn(() => []),
  getPendingActions: vi.fn(() => []),
  getActionsByWorkspace: vi.fn(() => []),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const WS_ID = 'ws-equiv';

async function invalidateCache() {
  const { invalidateIntelligenceCache } = await import('../server/workspace-intelligence.js');
  invalidateIntelligenceCache(WS_ID);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildIntelPrompt behavioral equivalence', () => {
  beforeEach(async () => {
    await invalidateCache();
  });

  // 1. Brand voice flows through
  it('seoContext slice includes brand voice content from buildSeoContext', async () => {
    const { buildIntelPrompt } = await import('../server/workspace-intelligence.js');
    const result = await buildIntelPrompt(WS_ID, ['seoContext']);
    expect(result).toContain('Professional, data-driven, and authoritative');
    // Emphatic header must be present
    expect(result).toContain('BRAND VOICE');
  });

  // 2. Business context flows through
  it('seoContext slice includes business context', async () => {
    const { buildIntelPrompt } = await import('../server/workspace-intelligence.js');
    const result = await buildIntelPrompt(WS_ID, ['seoContext']);
    expect(result).toContain('Fortune 500');
  });

  // 3. Knowledge base flows through
  it('seoContext slice includes knowledge base content', async () => {
    const { buildIntelPrompt } = await import('../server/workspace-intelligence.js');
    const result = await buildIntelPrompt(WS_ID, ['seoContext']);
    expect(result).toContain('real-time rank tracking');
    // Knowledge base emphatic header must be present
    expect(result).toContain('BUSINESS KNOWLEDGE BASE');
  });

  // 4. Site keywords flow through
  it('seoContext slice includes site keywords', async () => {
    // formatSeoContextSection renders "Site target keywords: [names]" — not just a count.
    // Verify the strategy object with 3 siteKeywords flows through correctly.
    const { buildIntelPrompt, buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');

    // Raw assembly — confirm siteKeywords array is present with expected values
    const intel = await buildWorkspaceIntelligence(WS_ID, { slices: ['seoContext'] });
    expect(intel.seoContext?.strategy?.siteKeywords).toContain('enterprise seo');

    // Formatted output at detailed verbosity — confirm keyword names render (not just count)
    await invalidateCache();
    const detailedResult = await buildIntelPrompt(WS_ID, ['seoContext'], { verbosity: 'detailed' });
    expect(detailedResult).toContain('Site target keywords:');
    expect(detailedResult).toContain('enterprise seo');
  });

  // 5. Learnings slice safely returns empty/no-op when feature flag is off
  it('learnings slice produces no-op output when outcome-ai-injection flag is disabled', async () => {
    const featureFlags = await import('../server/feature-flags.js');
    vi.mocked(featureFlags.isFeatureEnabled).mockReturnValue(false);

    const { buildIntelPrompt } = await import('../server/workspace-intelligence.js');
    // Should not crash; result is a string (may be cold-start message or seoContext only)
    const result = await buildIntelPrompt(WS_ID, ['learnings']);
    expect(typeof result).toBe('string');
    // The learnings section must not appear — empty learnings slice produces no section
    expect(result).not.toContain('## Outcome Learnings');
  });

  // 6. Learnings slice returns content when feature flag is on
  it('learnings slice includes learnings content when outcome-ai-injection is enabled', async () => {
    const featureFlags = await import('../server/feature-flags.js');
    vi.mocked(featureFlags.isFeatureEnabled).mockImplementation(
      (flag: string) => flag === 'outcome-ai-injection',
    );

    const workspaceLearnings = await import('../server/workspace-learnings.js');
    vi.mocked(workspaceLearnings.getWorkspaceLearnings).mockReturnValue({
      workspaceId: WS_ID,
      computedAt: new Date().toISOString(),
      confidence: 'high' as const,
      totalScoredActions: 12,
      content: null,
      strategy: null,
      technical: null,
      overall: {
        totalWinRate: 0.75,
        strongWinRate: 0.5,
        topActionTypes: [{ type: 'title_optimization', winRate: 0.8, count: 5 }],
        recentTrend: 'improving' as const,
      },
    });

    await invalidateCache();

    const { buildIntelPrompt } = await import('../server/workspace-intelligence.js');
    const result = await buildIntelPrompt(WS_ID, ['seoContext', 'learnings']);
    expect(result).toContain('## Outcome Learnings');
    // Win rate: 75%
    expect(result).toContain('75%');
  });

  // 7. slices parameter controls what's included
  it('requesting only seoContext excludes learnings section', async () => {
    const featureFlags = await import('../server/feature-flags.js');
    vi.mocked(featureFlags.isFeatureEnabled).mockImplementation(
      (flag: string) => flag === 'outcome-ai-injection',
    );

    await invalidateCache();

    const { buildIntelPrompt } = await import('../server/workspace-intelligence.js');
    const result = await buildIntelPrompt(WS_ID, ['seoContext']);
    expect(result).not.toContain('## Outcome Learnings');
    // Also should not contain "Win Rate" text from learnings
    expect(result).not.toContain('win rate');
  });

  // 8. Cold-start detection — empty workspace returns fallback message, not crash
  it('returns cold-start message for workspace with no data', async () => {
    const seoContext = await import('../server/seo-context.js');
    vi.mocked(seoContext.buildSeoContext).mockReturnValueOnce({
      strategy: null,
      brandVoiceBlock: '',
      businessContext: '',
      knowledgeBlock: '',
      personasBlock: '',
      keywordBlock: '',
      fullContext: '',
    } as ReturnType<typeof seoContext.buildSeoContext>);
    vi.mocked(seoContext.getRawBrandVoice).mockReturnValueOnce('');
    vi.mocked(seoContext.getRawKnowledge).mockReturnValueOnce('');

    await invalidateCache();

    const { buildIntelPrompt } = await import('../server/workspace-intelligence.js');
    // Must not throw and must return a non-empty string
    const result = await buildIntelPrompt(WS_ID, ['seoContext']);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    // Cold-start message must be present
    expect(result).toContain('newly onboarded');
  });

  // 9. buildIntelPrompt vs separate calls produce identical output
  it('buildIntelPrompt produces identical output to separate buildWorkspaceIntelligence + formatForPrompt', async () => {
    // Ensure standard mock state for determinism
    const featureFlags = await import('../server/feature-flags.js');
    vi.mocked(featureFlags.isFeatureEnabled).mockReturnValue(false);

    await invalidateCache();

    const { buildIntelPrompt, buildWorkspaceIntelligence, formatForPrompt, invalidateIntelligenceCache } =
      await import('../server/workspace-intelligence.js');

    const slices = ['seoContext'] as const;

    // Call buildIntelPrompt (the convenience wrapper)
    const combinedResult = await buildIntelPrompt(WS_ID, [...slices]);

    // Invalidate cache so the separate call assembles fresh (same inputs → same output)
    invalidateIntelligenceCache(WS_ID);

    // Call the two-step path manually
    const intel = await buildWorkspaceIntelligence(WS_ID, { slices: [...slices] });
    const manualResult = formatForPrompt(intel, { sections: [...slices] });

    expect(combinedResult).toBe(manualResult);
  });
});
