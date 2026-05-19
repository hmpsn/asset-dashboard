import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CannibalizationConflict } from '../../server/cannibalization-detection.js';

const mockCallAI = vi.fn();
const mockGetKeywordMetrics = vi.fn();
const mockGetRelatedKeywords = vi.fn();
const mockBuildRecommendationGenerationContext = vi.fn();
const mockGetDeclinedKeywords = vi.fn();
const mockGetRequestedKeywords = vi.fn();
const mockCheckKeywordCannibalization = vi.fn<
  (workspaceId: string, keyword: string) => CannibalizationConflict[]
>();
const mockGetQueryPageData = vi.fn();
const mockGetWorkspace = vi.fn();

vi.mock('../../server/ai.js', () => ({
  callAI: mockCallAI,
}));

vi.mock('../../server/seo-data-provider.js', () => ({
  getConfiguredProvider: vi.fn(() => ({
    getKeywordMetrics: mockGetKeywordMetrics,
    getRelatedKeywords: mockGetRelatedKeywords,
  })),
}));

vi.mock('../../server/intelligence/generation-context-builders.js', () => ({
  buildRecommendationGenerationContext: mockBuildRecommendationGenerationContext,
}));

vi.mock('../../server/keyword-feedback.js', () => ({
  getDeclinedKeywords: mockGetDeclinedKeywords,
  getRequestedKeywords: mockGetRequestedKeywords,
}));

vi.mock('../../server/cannibalization-detection.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/cannibalization-detection.js')>();
  return {
    ...actual,
    checkKeywordCannibalization: mockCheckKeywordCannibalization,
  };
});

vi.mock('../../server/search-console.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/search-console.js')>();
  return {
    ...actual,
    getQueryPageData: mockGetQueryPageData,
  };
});

vi.mock('../../server/workspaces.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/workspaces.js')>();
  return {
    ...actual,
    getWorkspace: mockGetWorkspace,
  };
});

const baseContext = {
  intelligence: {
    version: 1 as const,
    workspaceId: 'ws_test',
    assembledAt: '2026-05-18T00:00:00.000Z',
    seoContext: {
      strategy: { siteKeywords: [], opportunities: [], generatedAt: '2026-05-18T00:00:00.000Z', pageMap: [] },
      brandVoice: '',
      effectiveBrandVoiceBlock: '',
      businessContext: 'Emergency plumbing company serving Austin homeowners.',
      personas: [],
      knowledgeBase: '',
    },
    learnings: {
      summary: {
        workspaceId: 'ws_test',
        computedAt: '2026-05-18T00:00:00.000Z',
        confidence: 'medium' as const,
        totalScoredActions: 10,
        content: null,
        strategy: {
          winRateByDifficultyRange: { '0-20': 0.4, '21-40': 0.65, '41-60': 0.35, '61-80': 0.2, '81-100': 0.1 },
          winRateByCheckpoint: {},
          bestIntentTypes: [],
          keywordVolumeSweetSpot: null,
        },
        technical: null,
        overall: {
          totalWinRate: 0.5,
          strongWinRate: 0.2,
          topActionTypes: [],
          recentTrend: 'stable' as const,
        },
      },
      confidence: 'medium' as const,
      topActionTypes: [],
      overallWinRate: 0.5,
      recentTrend: 'stable' as const,
      playbooks: [],
    },
    clientSignals: {
      keywordFeedback: {
        approved: [],
        rejected: [],
        patterns: { approveRate: 0.5, topRejectionReasons: ['too broad'] },
      },
      contentGapVotes: [],
      businessPriorities: ['Emergency plumbing services in Austin'],
      approvalPatterns: { approvalRate: 0.5, avgResponseTime: null },
      recentChatTopics: ['after-hours emergency plumbing'],
      churnRisk: null,
    },
  },
  slices: ['seoContext', 'learnings', 'clientSignals'] as const,
  promptContext: 'BUSINESS CONTEXT: Emergency plumbing company serving Austin homeowners.',
  learningsDomain: 'strategy' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetWorkspace.mockReturnValue({ id: 'ws_test', seoDataProvider: 'semrush' });
  mockGetKeywordMetrics.mockResolvedValue([
    { keyword: 'emergency plumber austin', volume: 300, difficulty: 42, cpc: 18 },
  ]);
  mockGetRelatedKeywords.mockResolvedValue([]);
  mockBuildRecommendationGenerationContext.mockResolvedValue(baseContext);
  mockGetDeclinedKeywords.mockReturnValue([]);
  mockGetRequestedKeywords.mockReturnValue([]);
  mockCheckKeywordCannibalization.mockReturnValue([]);
  mockGetQueryPageData.mockResolvedValue([]);
  mockCallAI.mockResolvedValue({ text: '["emergency plumber austin"]' });
});

describe('getKeywordRecommendations ranking behavior', () => {
  it('uses the smart AI path when explicitly enabled and meaningful context exists', async () => {
    mockGetRelatedKeywords.mockResolvedValue([
      { keyword: '24 hour plumber austin', volume: 180, difficulty: 30, cpc: 16 },
      { keyword: 'plumber', volume: 8000, difficulty: 72, cpc: 12 },
    ]);
    mockCallAI.mockResolvedValue({ text: '["24 hour plumber austin", "emergency plumber austin", "plumber"]' });

    const { getKeywordRecommendations } = await import('../../server/keyword-recommendations.js');
    const result = await getKeywordRecommendations('ws_test', 'emergency plumber austin', { useAI: true, includeReasoning: true });

    expect(mockBuildRecommendationGenerationContext).toHaveBeenCalledWith('ws_test', expect.objectContaining({
      slices: ['seoContext', 'learnings', 'clientSignals'],
      learningsDomain: 'strategy',
    }));
    expect(mockCallAI).toHaveBeenCalledTimes(1);
    expect(result.recommended).toBe('24 hour plumber austin');
    expect(result.reasoning?.recommendedReason).toBeTruthy();
  });

  it('prefers business-fit and requested keywords over generic high-volume terms when AI is disabled', async () => {
    mockGetRequestedKeywords.mockReturnValue(['24 hour plumber austin']);
    mockGetRelatedKeywords.mockResolvedValue([
      { keyword: 'plumber', volume: 10000, difficulty: 70, cpc: 14 },
      { keyword: '24 hour plumber austin', volume: 220, difficulty: 28, cpc: 16 },
    ]);

    const { getKeywordRecommendations } = await import('../../server/keyword-recommendations.js');
    const result = await getKeywordRecommendations('ws_test', 'emergency plumber austin', { useAI: false });

    expect(mockCallAI).not.toHaveBeenCalled();
    expect(result.recommended).toBe('24 hour plumber austin');
    expect(result.candidates[0]?.keyword).toBe('24 hour plumber austin');
  });

  it('preserves the legacy omitted-useAI contract by staying on deterministic scoring', async () => {
    mockGetRequestedKeywords.mockReturnValue(['24 hour plumber austin']);
    mockGetRelatedKeywords.mockResolvedValue([
      { keyword: 'plumber', volume: 10000, difficulty: 70, cpc: 14 },
      { keyword: '24 hour plumber austin', volume: 220, difficulty: 28, cpc: 16 },
    ]);

    const { getKeywordRecommendations } = await import('../../server/keyword-recommendations.js');
    const result = await getKeywordRecommendations('ws_test', 'emergency plumber austin');

    expect(mockCallAI).not.toHaveBeenCalled();
    expect(result.recommended).toBe('24 hour plumber austin');
  });

  it('suppresses previously declined keyword recommendations', async () => {
    mockGetDeclinedKeywords.mockReturnValue(['cheap plumber austin']);
    mockGetRelatedKeywords.mockResolvedValue([
      { keyword: 'cheap plumber austin', volume: 600, difficulty: 20, cpc: 2 },
      { keyword: 'best emergency plumber austin', volume: 140, difficulty: 35, cpc: 10 },
    ]);

    const { getKeywordRecommendations } = await import('../../server/keyword-recommendations.js');
    const result = await getKeywordRecommendations('ws_test', 'emergency plumber austin', { useAI: false });

    expect(result.candidates.some(candidate => candidate.keyword === 'cheap plumber austin')).toBe(false);
    expect(result.recommended).toBe('best emergency plumber austin');
  });

  it('down-ranks high-cannibalization conflicts behind cleaner alternatives', async () => {
    mockGetRelatedKeywords.mockResolvedValue([
      { keyword: 'emergency plumber austin', volume: 400, difficulty: 25, cpc: 12 },
      { keyword: '24 hour plumber austin', volume: 220, difficulty: 28, cpc: 16 },
    ]);
    mockCheckKeywordCannibalization.mockImplementation((_workspaceId, keyword) => {
      if (keyword === 'emergency plumber austin') {
        return [{
          keyword,
          sourceId: 'seed',
          conflictsWith: { type: 'existing_page', keyword: 'emergency plumber austin', identifier: '/services/emergency-plumber' },
          severity: 'high',
          reason: 'Exact keyword match with existing page',
        }];
      }
      return [];
    });

    const { getKeywordRecommendations } = await import('../../server/keyword-recommendations.js');
    const result = await getKeywordRecommendations('ws_test', 'emergency plumber austin', { useAI: false, includeReasoning: true });

    expect(result.recommended).toBe('24 hour plumber austin');
    expect(result.reasoning?.alternatives.some(alt => alt.keyword === 'emergency plumber austin')).toBe(true);
  });

  it('falls back to deterministic smart scoring when the AI path fails', async () => {
    mockGetRequestedKeywords.mockReturnValue(['24 hour plumber austin']);
    mockGetRelatedKeywords.mockResolvedValue([
      { keyword: 'plumber', volume: 10000, difficulty: 70, cpc: 14 },
      { keyword: '24 hour plumber austin', volume: 220, difficulty: 28, cpc: 16 },
    ]);
    mockCallAI.mockRejectedValue(new Error('model unavailable'));

    const { getKeywordRecommendations } = await import('../../server/keyword-recommendations.js');
    const result = await getKeywordRecommendations('ws_test', 'emergency plumber austin', { useAI: true });

    expect(mockCallAI).toHaveBeenCalledTimes(1);
    expect(result.recommended).toBe('24 hour plumber austin');
  });

  it('excludes the current cell from cannibalization penalties when requested by cell id', async () => {
    mockGetKeywordMetrics.mockResolvedValue([
      { keyword: 'emergency plumber austin', volume: 650, difficulty: 18, cpc: 18 },
    ]);
    mockGetRelatedKeywords.mockResolvedValue([
      { keyword: '24 hour plumber austin', volume: 220, difficulty: 28, cpc: 16 },
    ]);
    mockCheckKeywordCannibalization.mockImplementation((_workspaceId, keyword) => {
      if (keyword === 'emergency plumber austin') {
        return [{
          keyword,
          sourceId: 'check',
          conflictsWith: { type: 'other_matrix', keyword: 'emergency plumber austin', identifier: 'cell_self' },
          severity: 'high',
          reason: 'Exact keyword match with existing matrix cell',
        }];
      }
      return [];
    });

    const { getKeywordRecommendations } = await import('../../server/keyword-recommendations.js');
    const result = await getKeywordRecommendations('ws_test', 'emergency plumber austin', {
      useAI: false,
      excludeConflictIdentifiers: ['cell_self'],
    });

    expect(result.recommended).toBe('emergency plumber austin');
  });

  it('preserves the seed candidate when a duplicate related keyword appears later in the pool', async () => {
    mockGetKeywordMetrics.mockResolvedValue([]);
    mockGetRelatedKeywords.mockResolvedValue([
      { keyword: 'emergency plumber austin', volume: 0, difficulty: 60, cpc: 1 },
    ]);

    const { getKeywordRecommendations } = await import('../../server/keyword-recommendations.js');
    const result = await getKeywordRecommendations('ws_test', 'emergency plumber austin', { useAI: false });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      keyword: 'emergency plumber austin',
      source: 'pattern',
      isRecommended: true,
    });
  });
});
