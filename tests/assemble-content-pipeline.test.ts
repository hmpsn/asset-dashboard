// tests/assemble-content-pipeline.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../server/workspace-data.js', () => ({
  getContentPipelineSummary: vi.fn(() => ({
    briefs: { total: 5, byStatus: { draft: 2, ready: 3 } },
    posts: { total: 3, byStatus: { draft: 1, published: 2 } },
    matrices: { total: 1, cellsPlanned: 10, cellsPublished: 4 },
    requests: { pending: 2, inProgress: 1, delivered: 5 },
    workOrders: { active: 1 },
    seoEdits: { pending: 1, applied: 3, inReview: 0 },
  })),
  getPageCacheStats: vi.fn(() => ({ entries: 0, maxEntries: 100 })),
}));

vi.mock('../server/workspaces.js', () => ({
  getWorkspace: vi.fn(() => ({
    id: 'ws-1',
    keywordStrategy: { siteKeywords: [] },
  })),
}));

vi.mock('../server/content-brief.js', () => ({
  listBriefs: vi.fn(() => []),
}));

vi.mock('../server/content-subscriptions.js', () => ({
  listContentSubscriptions: vi.fn(() => [
    { id: 's1', status: 'active', postsPerMonth: 4, postsDeliveredThisPeriod: 1 },
  ]),
}));

vi.mock('../server/suggested-briefs-store.js', () => ({
  listSuggestedBriefs: vi.fn(() => [
    { id: 'sb1', status: 'pending' },
    { id: 'sb2', status: 'pending' },
    { id: 'sb3', status: 'accepted' },
  ]),
}));

// Mock modules that may not exist yet — they should not crash the assembler
vi.mock('../server/schema-store.js', () => ({
  getSchemaPlan: vi.fn(() => null),
}));
vi.mock('../server/schema-queue.js', () => ({
  listPendingSchemas: vi.fn(() => []),
}));
vi.mock('../server/content-matrices.js', () => ({
  listMatrices: vi.fn(() => []),
}));
vi.mock('../server/cannibalization-detection.js', () => ({
  detectMatrixCannibalization: vi.fn(() => ({ conflicts: [] })),
}));
vi.mock('../server/content-decay.js', () => ({
  loadDecayAnalysis: vi.fn(() => null),
}));

// Mock other imports the module needs
vi.mock('../server/seo-context.js', () => ({
  buildSeoContext: vi.fn(() => ({
    strategy: null,
    brandVoiceBlock: '',
    businessContext: '',
    knowledgeBlock: '',
  })),
}));
vi.mock('../server/feature-flags.js', () => ({
  isFeatureEnabled: vi.fn(() => false),
}));
vi.mock('../server/workspace-learnings.js', () => ({
  getWorkspaceLearnings: vi.fn(() => null),
}));
vi.mock('../server/outcome-playbooks.js', () => ({
  getPlaybooks: vi.fn(() => []),
}));
vi.mock('../server/analytics-insights-store.js', () => ({
  getInsights: vi.fn(() => []),
}));

describe('assembleContentPipeline', () => {
  beforeEach(async () => {
    // Invalidate the intelligence cache so each test starts fresh
    const { invalidateIntelligenceCache } = await import('../server/workspace-intelligence.js');
    invalidateIntelligenceCache('ws-1');
  });

  it('returns populated ContentPipelineSlice with expansion fields', async () => {
    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['contentPipeline'],
    });

    expect(result.contentPipeline).toBeDefined();
    const cp = result.contentPipeline!;
    expect(cp.briefs.total).toBe(5);

    // Expansion fields should be present
    expect(cp.subscriptions).toBeDefined();
    expect(cp.subscriptions?.active).toBe(1);
    expect(cp.suggestedBriefs).toBe(2); // 2 pending out of 3

    // Shape completeness
    expect(cp).toHaveProperty('briefs');
    expect(cp).toHaveProperty('posts');
    expect(cp).toHaveProperty('matrices');
    expect(cp).toHaveProperty('requests');
    expect(cp).toHaveProperty('workOrders');
    expect(cp).toHaveProperty('coverageGaps');
    expect(cp).toHaveProperty('seoEdits');
  });

  it('returns sensible defaults when optional sources return empty/null', async () => {
    const { listContentSubscriptions } = await import('../server/content-subscriptions.js');
    const { listSuggestedBriefs } = await import('../server/suggested-briefs-store.js');
    vi.mocked(listContentSubscriptions).mockReturnValueOnce([]);
    vi.mocked(listSuggestedBriefs).mockReturnValueOnce([]);

    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['contentPipeline'],
    });

    expect(result.contentPipeline).toBeDefined();
    const cp = result.contentPipeline!;
    expect(cp.briefs.total).toBe(5);
    expect(cp.subscriptions?.active ?? 0).toBe(0);
    expect(cp.suggestedBriefs).toBe(0);
  });

  it('survives when a data source throws', async () => {
    const { getContentPipelineSummary } = await import('../server/workspace-data.js');
    vi.mocked(getContentPipelineSummary).mockImplementationOnce(() => { throw new Error('Pipeline DB error'); });

    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', {
      slices: ['contentPipeline'],
    });

    expect(result).toBeDefined();
    expect(result.version).toBe(1);
  });
});
