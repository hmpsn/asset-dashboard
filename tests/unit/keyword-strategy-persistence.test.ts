import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace, KeywordStrategy, PageKeywordMap, ContentGap, QuickWin } from '../../shared/types/workspace.js';

// ── Mock all server dependencies ───────────────────────────────────────────────

const mockInvalidateIntelligenceCache = vi.fn();
const mockDebouncedStrategyInvalidate = vi.fn();
const mockDebouncedPageAnalysisInvalidate = vi.fn();
const mockInvalidateSubCachePrefix = vi.fn();
const mockUpdateWorkspace = vi.fn();
const mockUpsertAndCleanPageKeywords = vi.fn();
const mockUpsertPageKeywordsBatch = vi.fn();
const mockListPageKeywords = vi.fn<(id: string) => PageKeywordMap[]>(() => []);
const mockListContentGaps = vi.fn<(id: string) => ContentGap[]>(() => []);
const mockReplaceAllContentGaps = vi.fn();
const mockListQuickWins = vi.fn<(id: string) => QuickWin[]>(() => []);
const mockReplaceAllQuickWins = vi.fn();
const mockListKeywordGaps = vi.fn(() => []);
const mockReplaceAllKeywordGaps = vi.fn();
const mockListTopicClusters = vi.fn(() => []);
const mockReplaceAllTopicClusters = vi.fn();
const mockListCannibalizationIssues = vi.fn(() => []);
const mockReplaceAllCannibalizationIssues = vi.fn();
const mockRecordAction = vi.fn();
const mockGetActionBySource = vi.fn<(sourceType: string, workspaceId: string) => unknown>(() => null);
const mockBroadcastToWorkspace = vi.fn();
const mockAddActivity = vi.fn();
const mockNormalizePath = vi.fn((p: string) => p);

// DB mock — transaction fn wraps and calls the callback
const mockDbPrepare = vi.fn();
const mockRun = vi.fn(() => ({ changes: 0 }));
const mockTransaction = vi.fn((fn: () => void) => fn);

vi.mock('../../server/workspace-intelligence.js', () => ({
  invalidateIntelligenceCache: mockInvalidateIntelligenceCache,
}));
vi.mock('../../server/bridge-infrastructure.js', () => ({
  debouncedStrategyInvalidate: mockDebouncedStrategyInvalidate,
  debouncedPageAnalysisInvalidate: mockDebouncedPageAnalysisInvalidate,
  invalidateSubCachePrefix: mockInvalidateSubCachePrefix,
}));
vi.mock('../../server/workspaces.js', () => ({
  updateWorkspace: mockUpdateWorkspace,
}));
vi.mock('../../server/page-keywords.js', () => ({
  upsertAndCleanPageKeywords: mockUpsertAndCleanPageKeywords,
  upsertPageKeywordsBatch: mockUpsertPageKeywordsBatch,
  listPageKeywords: mockListPageKeywords,
}));
vi.mock('../../server/content-gaps.js', () => ({
  listContentGaps: mockListContentGaps,
  replaceAllContentGaps: mockReplaceAllContentGaps,
}));
vi.mock('../../server/quick-wins.js', () => ({
  listQuickWins: mockListQuickWins,
  replaceAllQuickWins: mockReplaceAllQuickWins,
}));
vi.mock('../../server/keyword-gaps.js', () => ({
  listKeywordGaps: mockListKeywordGaps,
  replaceAllKeywordGaps: mockReplaceAllKeywordGaps,
}));
vi.mock('../../server/topic-clusters.js', () => ({
  listTopicClusters: mockListTopicClusters,
  replaceAllTopicClusters: mockReplaceAllTopicClusters,
}));
vi.mock('../../server/cannibalization-issues.js', () => ({
  listCannibalizationIssues: mockListCannibalizationIssues,
  replaceAllCannibalizationIssues: mockReplaceAllCannibalizationIssues,
}));
vi.mock('../../server/db/index.js', () => ({
  default: {
    prepare: mockDbPrepare.mockReturnValue({ run: mockRun }),
    transaction: mockTransaction,
  },
}));
vi.mock('../../server/outcome-tracking.js', () => ({
  recordAction: mockRecordAction,
  getActionBySource: mockGetActionBySource,
}));
vi.mock('../../server/broadcast.js', () => ({ broadcastToWorkspace: mockBroadcastToWorkspace }));
vi.mock('../../server/ws-events.js', () => ({
  WS_EVENTS: { STRATEGY_UPDATED: 'strategy:updated' },
}));
vi.mock('../../server/activity-log.js', () => ({ addActivity: mockAddActivity }));
vi.mock('../../server/helpers.js', () => ({ normalizePath: mockNormalizePath }));
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws_persist',
    name: 'Austin Plumbing Co',
    webflowSiteId: 'site_abc',
    createdAt: '2026-01-01T00:00:00.000Z',
    keywordStrategy: undefined,
    ...overrides,
  } as unknown as Workspace;
}

function makeStrategyOutput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    siteKeywords: ['emergency plumber', 'pipe repair austin'],
    opportunities: ['FAQ for after-hours service'],
    pageMap: [
      {
        pagePath: '/services',
        pageTitle: 'Services',
        primaryKeyword: 'emergency plumber',
        secondaryKeywords: ['pipe repair'],
        searchIntent: 'commercial',
      },
    ],
    contentGaps: [
      {
        topic: 'How to stop a burst pipe',
        targetKeyword: 'burst pipe repair',
        intent: 'informational',
        priority: 'high',
        rationale: 'High search volume, no existing page',
      },
    ],
    quickWins: [],
    keywordGaps: [],
    topicClusters: [],
    cannibalization: [],
    ...overrides,
  };
}

function makeSearchData() {
  return {
    deviceBreakdown: [],
    countryBreakdown: [],
    periodComparison: null,
    organicLandingPages: [],
    organicOverview: null,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('persistKeywordStrategy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // transaction mock: execute fn immediately and return it
    mockTransaction.mockImplementation((fn: () => void) => fn);
    mockDbPrepare.mockReturnValue({ run: mockRun });
    mockNormalizePath.mockImplementation((p: string) => p);
  });

  it('calls updateWorkspace with the assembled keywordStrategy', async () => {
    const { persistKeywordStrategy } = await import('../../server/keyword-strategy-persistence.js');
    const ws = makeWorkspace();
    const strategy = makeStrategyOutput();

    persistKeywordStrategy({
      ws,
      strategy: strategy as Parameters<typeof persistKeywordStrategy>[0]['strategy'],
      strategyMode: 'full',
      pagesToAnalyze: [],
      siteKeywordMetrics: [],
      keywordGaps: [],
      competitorKeywordData: [],
      topicClusters: [],
      cannibalization: [],
      questionKeywords: [],
      businessContext: 'Local plumbing',
      seoDataMode: 'full',
      seoDataStatus: { mode: 'full', status: 'available' },
      searchData: makeSearchData(),
    });

    expect(mockUpdateWorkspace).toHaveBeenCalledWith(
      'ws_persist',
      expect.objectContaining({
        keywordStrategy: expect.objectContaining({ siteKeywords: ['emergency plumber', 'pipe repair austin'] }),
      }),
    );
  });

  it('broadcasts STRATEGY_UPDATED after persisting', async () => {
    const { persistKeywordStrategy } = await import('../../server/keyword-strategy-persistence.js');
    const ws = makeWorkspace();
    const strategy = makeStrategyOutput();

    persistKeywordStrategy({
      ws,
      strategy: strategy as Parameters<typeof persistKeywordStrategy>[0]['strategy'],
      strategyMode: 'full',
      pagesToAnalyze: [],
      siteKeywordMetrics: [],
      keywordGaps: [],
      competitorKeywordData: [],
      topicClusters: [],
      cannibalization: [],
      questionKeywords: [],
      businessContext: '',
      seoDataMode: 'none',
      seoDataStatus: { mode: 'none', status: 'disabled' },
      searchData: makeSearchData(),
    });

    expect(mockBroadcastToWorkspace).toHaveBeenCalledWith(
      'ws_persist',
      'strategy:updated',
      expect.objectContaining({ pageCount: 1 }),
    );
  });

  it('calls upsertAndCleanPageKeywords when strategyMode is full', async () => {
    const { persistKeywordStrategy } = await import('../../server/keyword-strategy-persistence.js');
    const ws = makeWorkspace();
    const strategy = makeStrategyOutput();

    persistKeywordStrategy({
      ws,
      strategy: strategy as Parameters<typeof persistKeywordStrategy>[0]['strategy'],
      strategyMode: 'full',
      pagesToAnalyze: [],
      siteKeywordMetrics: [],
      keywordGaps: [],
      competitorKeywordData: [],
      topicClusters: [],
      cannibalization: [],
      questionKeywords: [],
      businessContext: '',
      seoDataMode: 'full',
      seoDataStatus: { mode: 'full', status: 'available' },
      searchData: makeSearchData(),
    });

    expect(mockUpsertAndCleanPageKeywords).toHaveBeenCalledWith(
      'ws_persist',
      expect.arrayContaining([expect.objectContaining({ pagePath: '/services' })]),
    );
    expect(mockUpsertPageKeywordsBatch).not.toHaveBeenCalled();
  });

  it('calls upsertPageKeywordsBatch (not upsertAndClean) when strategyMode is incremental', async () => {
    const { persistKeywordStrategy } = await import('../../server/keyword-strategy-persistence.js');
    const ws = makeWorkspace();
    const strategy = makeStrategyOutput();

    persistKeywordStrategy({
      ws,
      strategy: strategy as Parameters<typeof persistKeywordStrategy>[0]['strategy'],
      strategyMode: 'incremental',
      pagesToAnalyze: [{ path: '/services', title: 'Services', pageType: 'static' }] as Parameters<typeof persistKeywordStrategy>[0]['pagesToAnalyze'],
      siteKeywordMetrics: [],
      keywordGaps: [],
      competitorKeywordData: [],
      topicClusters: [],
      cannibalization: [],
      questionKeywords: [],
      businessContext: '',
      seoDataMode: 'quick',
      seoDataStatus: { mode: 'quick', status: 'available' },
      searchData: makeSearchData(),
    });

    expect(mockUpsertPageKeywordsBatch).toHaveBeenCalled();
    expect(mockUpsertAndCleanPageKeywords).not.toHaveBeenCalled();
  });

  it('returns keywordStrategy and pageMap', async () => {
    const { persistKeywordStrategy } = await import('../../server/keyword-strategy-persistence.js');
    const ws = makeWorkspace();
    const strategy = makeStrategyOutput();

    const result = persistKeywordStrategy({
      ws,
      strategy: strategy as Parameters<typeof persistKeywordStrategy>[0]['strategy'],
      strategyMode: 'full',
      pagesToAnalyze: [],
      siteKeywordMetrics: [],
      keywordGaps: [],
      competitorKeywordData: [],
      topicClusters: [],
      cannibalization: [],
      questionKeywords: [],
      businessContext: 'Local plumbing',
      seoDataMode: 'full',
      seoDataStatus: { mode: 'full', status: 'available' },
      searchData: makeSearchData(),
    });

    expect(result.keywordStrategy.siteKeywords).toEqual(['emergency plumber', 'pipe repair austin']);
    expect(result.pageMap).toHaveLength(1);
    expect(result.pageMap[0].pagePath).toBe('/services');
  });

  it('strips pageMap/contentGaps/quickWins from the workspace JSON blob', async () => {
    const { persistKeywordStrategy } = await import('../../server/keyword-strategy-persistence.js');
    const ws = makeWorkspace();
    const strategy = makeStrategyOutput();

    persistKeywordStrategy({
      ws,
      strategy: strategy as Parameters<typeof persistKeywordStrategy>[0]['strategy'],
      strategyMode: 'full',
      pagesToAnalyze: [],
      siteKeywordMetrics: [],
      keywordGaps: [],
      competitorKeywordData: [],
      topicClusters: [],
      cannibalization: [],
      questionKeywords: [],
      businessContext: '',
      seoDataMode: 'full',
      seoDataStatus: { mode: 'full', status: 'available' },
      searchData: makeSearchData(),
    });

    // The second arg to updateWorkspace is the delta — pageMap must NOT appear inside it
    const [, delta] = mockUpdateWorkspace.mock.calls[0] as [string, Partial<KeywordStrategy> & Record<string, unknown>];
    const kwStrat = (delta as { keywordStrategy: Record<string, unknown> }).keywordStrategy;
    expect(kwStrat).not.toHaveProperty('pageMap');
    expect(kwStrat).not.toHaveProperty('contentGaps');
    expect(kwStrat).not.toHaveProperty('quickWins');
  });

  it('slices competitorKeywordData to max 150 entries', async () => {
    const { persistKeywordStrategy } = await import('../../server/keyword-strategy-persistence.js');
    const ws = makeWorkspace();
    const manyCompetitorKeywords = Array.from({ length: 200 }, (_, i) => ({
      keyword: `kw ${i}`,
      volume: 100,
      difficulty: 20,
      domain: 'competitor.com',
      position: i + 1,
    }));

    persistKeywordStrategy({
      ws,
      strategy: makeStrategyOutput() as Parameters<typeof persistKeywordStrategy>[0]['strategy'],
      strategyMode: 'full',
      pagesToAnalyze: [],
      siteKeywordMetrics: [],
      keywordGaps: [],
      competitorKeywordData: manyCompetitorKeywords,
      topicClusters: [],
      cannibalization: [],
      questionKeywords: [],
      businessContext: '',
      seoDataMode: 'full',
      seoDataStatus: { mode: 'full', status: 'available' },
      searchData: makeSearchData(),
    });

    const [, delta] = mockUpdateWorkspace.mock.calls[0] as [string, { keywordStrategy: Record<string, unknown> }];
    const stored = delta.keywordStrategy as { competitorKeywordData?: unknown[] };
    expect(stored.competitorKeywordData).toHaveLength(150);
  });

  it('adds an activity log entry for strategy generation', async () => {
    const { persistKeywordStrategy } = await import('../../server/keyword-strategy-persistence.js');

    persistKeywordStrategy({
      ws: makeWorkspace(),
      strategy: makeStrategyOutput() as Parameters<typeof persistKeywordStrategy>[0]['strategy'],
      strategyMode: 'full',
      pagesToAnalyze: [],
      siteKeywordMetrics: [],
      keywordGaps: [],
      competitorKeywordData: [],
      topicClusters: [],
      cannibalization: [],
      questionKeywords: [],
      businessContext: '',
      seoDataMode: 'full',
      seoDataStatus: { mode: 'full', status: 'available' },
      searchData: makeSearchData(),
    });

    expect(mockAddActivity).toHaveBeenCalledWith(
      'ws_persist',
      'strategy_generated',
      expect.any(String),
      expect.any(String),
    );
  });
});
