import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../server/feature-flags.js', () => ({
  isFeatureEnabled: vi.fn(() => true),
}));

vi.mock('../server/workspace-learnings.js', () => ({
  getWorkspaceLearnings: vi.fn(() => ({
    confidence: 'medium',
    overall: {
      topActionTypes: [{ type: 'content_refresh', winRate: 0.6, count: 10 }],
      totalWinRate: 0.55,
      recentTrend: 'improving',
    },
  })),
}));

vi.mock('../server/outcome-playbooks.js', () => ({
  getPlaybooks: vi.fn(() => []),
}));

vi.mock('../server/roi-attribution.js', () => ({
  getROIAttributionsRaw: vi.fn(() => [
    { id: 'roi-1', pageUrl: '/blog/seo', actionType: 'content_refresh', clicksBefore: 10, clicksAfter: 25, clickGain: 15, measuredAt: '2026-03-28' },
  ]),
}));

vi.mock('../server/outcome-tracking.js', () => ({
  getActionsByWorkspace: vi.fn(() => [
    { id: 'a1', actionType: 'content_refresh', pageUrl: '/blog/seo', workspaceId: 'ws-1' },
  ]),
  getOutcomesForAction: vi.fn(() => [
    { actionId: 'a1', score: 'strong_win', measuredAt: '2026-03-30' },
  ]),
  getPendingActions: vi.fn(() => []),
}));

// Mock other assembler dependencies to prevent import errors
vi.mock('../server/seo-context.js', () => ({
  buildSeoContext: vi.fn(() => ({ strategy: null, brandVoiceBlock: '', businessContext: '', knowledgeBlock: '' })),
}));
vi.mock('../server/workspaces.js', () => ({
  getWorkspace: vi.fn(() => ({ id: 'ws-1', personas: [] })),
}));
vi.mock('../server/analytics-insights-store.js', () => ({
  getInsights: vi.fn(() => []),
}));
vi.mock('../server/workspace-data.js', () => ({
  getContentPipelineSummary: vi.fn(() => ({
    briefs: { total: 0, byStatus: {} }, posts: { total: 0, byStatus: {} },
    matrices: { total: 0, cellsPlanned: 0, cellsPublished: 0 },
    requests: { pending: 0, inProgress: 0, delivered: 0 },
    workOrders: { active: 0 }, seoEdits: { pending: 0, applied: 0, inReview: 0 },
  })),
  getPageCacheStats: vi.fn(() => ({ entries: 0, maxEntries: 100 })),
}));
vi.mock('../server/content-brief.js', () => ({ listBriefs: vi.fn(() => []) }));
vi.mock('../server/db/index.js', () => {
  const prepare = vi.fn(() => ({ all: vi.fn(() => []), get: vi.fn(() => undefined), run: vi.fn() }));
  return { default: { prepare } };
});

describe('assembleLearnings enrichment', () => {
  beforeEach(async () => {
    const { invalidateIntelligenceCache } = await import('../server/workspace-intelligence.js');
    invalidateIntelligenceCache('ws-1');
  });

  it('includes ROI attribution data', async () => {
    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['learnings'] });

    expect(result.learnings).toBeDefined();
    expect(result.learnings!.roiAttribution).toBeDefined();
    expect(result.learnings!.roiAttribution!.length).toBe(1);
    expect(result.learnings!.roiAttribution![0].clickGain).toBe(15);
  });

  it('includes weCalledIt entries for strong_win outcomes', async () => {
    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['learnings'] });

    expect(result.learnings!.weCalledIt).toBeDefined();
    expect(result.learnings!.weCalledIt!.length).toBe(1);
    expect(result.learnings!.weCalledIt![0].score).toBe('strong_win');
  });

  it('preserves base learnings fields', async () => {
    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['learnings'] });

    expect(result.learnings!.confidence).toBe('medium');
    expect(result.learnings!.overallWinRate).toBe(0.55);
    expect(result.learnings!.recentTrend).toBe('improving');
  });
});
