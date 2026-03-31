// tests/unit/workspace-intelligence.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all subsystem dependencies
vi.mock('../../server/seo-context.js', () => ({
  buildSeoContext: vi.fn(),
}));
vi.mock('../../server/analytics-insights-store.js', () => ({
  getInsights: vi.fn(),
}));
vi.mock('../../server/workspace-learnings.js', () => ({
  getWorkspaceLearnings: vi.fn(),
}));
vi.mock('../../server/outcome-playbooks.js', () => ({
  getPlaybooks: vi.fn().mockReturnValue([]),
}));
vi.mock('../../server/outcome-tracking.js', () => ({
  getActionsByPage: vi.fn(),
  getOutcomesForAction: vi.fn(),
}));
vi.mock('../../server/feature-flags.js', () => ({
  isFeatureEnabled: vi.fn().mockReturnValue(true),
}));
vi.mock('../../server/intelligence-cache.js', () => {
  class MockLRUCache {
    get = vi.fn().mockReturnValue(null);
    set = vi.fn();
    deleteByPrefix = vi.fn().mockReturnValue(0);
    stats = vi.fn().mockReturnValue({ entries: 0, maxEntries: 200 });
  }
  return {
    LRUCache: MockLRUCache,
    singleFlight: vi.fn().mockImplementation((_key: string, fn: () => Promise<unknown>) => fn()),
  };
});

import { buildWorkspaceIntelligence } from '../../server/workspace-intelligence.js';
import { buildSeoContext } from '../../server/seo-context.js';
import { getInsights } from '../../server/analytics-insights-store.js';
import { getWorkspaceLearnings } from '../../server/workspace-learnings.js';

const mockBuildSeoContext = vi.mocked(buildSeoContext);
const mockGetInsights = vi.mocked(getInsights);
const mockGetLearnings = vi.mocked(getWorkspaceLearnings);

describe('buildWorkspaceIntelligence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildSeoContext.mockReturnValue({
      strategy: undefined,
      brandVoiceBlock: 'Test brand voice',
      businessContext: 'Test context',
      personasBlock: '',
      knowledgeBlock: '',
      keywordBlock: '',
      fullContext: '',
    } as any);
    mockGetInsights.mockReturnValue([]);
    mockGetLearnings.mockReturnValue(null);
  });

  it('returns a valid WorkspaceIntelligence object with version and timestamp', async () => {
    const result = await buildWorkspaceIntelligence('ws-1');
    expect(result.version).toBe(1);
    expect(result.workspaceId).toBe('ws-1');
    expect(result.assembledAt).toBeDefined();
    expect(new Date(result.assembledAt).getTime()).not.toBeNaN();
  });

  it('assembles only requested slices', async () => {
    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['seoContext'] });
    expect(result.seoContext).toBeDefined();
    expect(result.insights).toBeUndefined();
    expect(result.learnings).toBeUndefined();
  });

  it('assembles all slices when none specified', async () => {
    const result = await buildWorkspaceIntelligence('ws-1');
    expect(result.seoContext).toBeDefined();
    expect(result.insights).toBeDefined();
  });

  it('gracefully handles subsystem failure — returns partial data', async () => {
    mockBuildSeoContext.mockImplementation(() => { throw new Error('SEO context failed'); });
    mockGetInsights.mockReturnValue([
      { id: '1', insightType: 'content_decay', severity: 'warning', impactScore: 5 },
    ] as any);

    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['seoContext', 'insights'] });
    expect(result.seoContext).toBeUndefined();
    expect(result.insights).toBeDefined();
    expect(result.insights!.all).toHaveLength(1);
  });

  it('caps insights at 100 by impact score', async () => {
    const manyInsights = Array.from({ length: 150 }, (_, i) => ({
      id: `insight-${i}`,
      insightType: 'content_decay',
      severity: 'warning',
      impactScore: i,
    }));
    mockGetInsights.mockReturnValue(manyInsights as any);

    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['insights'] });
    expect(result.insights!.all.length).toBeLessThanOrEqual(100);
    expect(result.insights!.all[0].impactScore).toBe(149);
  });
});
