import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../server/seo-context.js', () => ({
  buildSeoContext: vi.fn(() => ({
    strategy: { siteKeywords: [] },
    brandVoiceBlock: 'Professional',
    businessContext: 'SaaS company',
    knowledgeBlock: 'Domain knowledge',
  })),
}));

vi.mock('../server/workspaces.js', () => ({
  getWorkspace: vi.fn(() => ({
    id: 'ws-1',
    siteId: 'site-1',
    personas: [{ name: 'Dev', role: 'Developer' }],
    businessProfile: { industry: 'Tech', goals: ['Growth'], targetAudience: 'B2B' },
  })),
}));

vi.mock('../server/rank-tracking.js', () => ({
  getTrackedKeywords: vi.fn(() => [
    { query: 'seo tools', position: 5 },
    { query: 'keyword research', position: 15 },
  ]),
  getLatestRanks: vi.fn(() => [
    { query: 'seo tools', position: 5, change: -2 },
    { query: 'keyword research', position: 15, change: 3 },
  ]),
}));

// Mock DB for strategy_history query
vi.mock('../server/db/index.js', () => {
  const prepare = vi.fn(() => ({
    all: vi.fn(() => []),
    get: vi.fn(() => undefined),
    run: vi.fn(),
  }));
  return { default: { prepare } };
});

// Mock all other required dependencies
vi.mock('../server/feature-flags.js', () => ({ isFeatureEnabled: vi.fn(() => false) }));
vi.mock('../server/workspace-learnings.js', () => ({ getWorkspaceLearnings: vi.fn(() => null) }));
vi.mock('../server/outcome-playbooks.js', () => ({ getPlaybooks: vi.fn(() => []) }));
vi.mock('../server/analytics-insights-store.js', () => ({ getInsights: vi.fn(() => []) }));
vi.mock('../server/workspace-data.js', () => ({
  getContentPipelineSummary: vi.fn(() => ({ briefs: { total: 0, byStatus: {} }, posts: { total: 0, byStatus: {} }, matrices: { total: 0, cellsPlanned: 0, cellsPublished: 0 }, requests: { pending: 0, inProgress: 0, delivered: 0 }, workOrders: { active: 0 }, seoEdits: { pending: 0, applied: 0, inReview: 0 } })),
  getPageCacheStats: vi.fn(() => ({ entries: 0, maxEntries: 100 })),
}));
vi.mock('../server/content-brief.js', () => ({ listBriefs: vi.fn(() => []) }));

describe('assembleSeoContext enrichment', () => {
  beforeEach(async () => {
    const { invalidateIntelligenceCache } = await import('../server/workspace-intelligence.js');
    invalidateIntelligenceCache('ws-1');
  });

  it('includes rank tracking data', async () => {
    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['seoContext'] });

    expect(result.seoContext).toBeDefined();
    expect(result.seoContext!.rankTracking).toBeDefined();
    expect(result.seoContext!.rankTracking!.trackedKeywords).toBe(2);
    expect(result.seoContext!.rankTracking!.positionChanges.improved).toBe(1); // change -2
    expect(result.seoContext!.rankTracking!.positionChanges.declined).toBe(1); // change 3
  });

  it('businessProfile is undefined when intelligenceProfile is absent', async () => {
    // Workspace.businessProfile has contact info (phone/email/address), not industry/goals.
    // The intelligence BusinessProfile type requires intelligenceProfile on the workspace.
    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['seoContext'] });

    expect(result.seoContext!.businessProfile).toBeUndefined();
  });

  it('businessProfile is populated from intelligenceProfile when present', async () => {
    // Mock a workspace with intelligenceProfile data
    const { getWorkspace: originalGetWorkspace } = await import('../server/workspaces.js');
    vi.mocked(originalGetWorkspace).mockReturnValueOnce({
      id: 'ws-1',
      siteId: 'site-1',
      personas: [{ name: 'Dev', role: 'Developer' }],
      businessProfile: { industry: 'Tech', goals: ['Growth'], targetAudience: 'B2B' },
      intelligenceProfile: {
        industry: 'SaaS',
        goals: ['Market Expansion', 'Brand Awareness'],
        targetAudience: 'Enterprise CTO',
      },
    });

    const { buildWorkspaceIntelligence, invalidateIntelligenceCache } = await import('../server/workspace-intelligence.js');
    invalidateIntelligenceCache('ws-1');
    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['seoContext'] });

    expect(result.seoContext!.businessProfile).toBeDefined();
    expect(result.seoContext!.businessProfile!.industry).toBe('SaaS');
    expect(result.seoContext!.businessProfile!.goals).toEqual(['Market Expansion', 'Brand Awareness']);
    expect(result.seoContext!.businessProfile!.targetAudience).toBe('Enterprise CTO');
  });

  it('preserves base seoContext fields', async () => {
    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['seoContext'] });

    expect(result.seoContext!.brandVoice).toBe('Professional');
    expect(result.seoContext!.businessContext).toBe('SaaS company');
    expect(result.seoContext!.personas).toHaveLength(1);
  });
});
