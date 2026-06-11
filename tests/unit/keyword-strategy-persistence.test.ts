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
const mockGetActionByWorkspaceAndSource = vi.fn<(workspaceId: string, sourceType: string, sourceId: string) => unknown>(() => null);
const mockBroadcastToWorkspace = vi.fn();
const mockAddActivity = vi.fn();
const mockNormalizePageUrl = vi.fn((p: string) => p);

// DB mock — transaction fn wraps and calls the callback. better-sqlite3's
// transaction object is itself callable AND exposes .immediate()/.deferred()/
// .exclusive() variants; the persistence code invokes .immediate() (BEGIN
// IMMEDIATE) to dodge the WAL SQLITE_BUSY_SNAPSHOT flake, so the mock must
// carry that method too.
const mockDbPrepare = vi.fn();
const mockRun = vi.fn(() => ({ changes: 0 }));
const mockTransaction = vi.fn((fn: (...args: unknown[]) => unknown) => {
  const txn = (...args: unknown[]) => fn(...args);
  txn.immediate = (...args: unknown[]) => fn(...args);
  txn.deferred = (...args: unknown[]) => fn(...args);
  txn.exclusive = (...args: unknown[]) => fn(...args);
  return txn;
});

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
  getActionByWorkspaceAndSource: mockGetActionByWorkspaceAndSource,
  STRATEGY_PAGE_KEYWORD_SOURCE_TYPE: 'strategy_page_keyword',
  strategyPageKeywordSourceId: (pagePath: string, primaryKeyword: string) =>
    `${pagePath.trim().toLowerCase()}::${primaryKeyword.trim().toLowerCase()}`,
}));
vi.mock('../../server/broadcast.js', () => ({ broadcastToWorkspace: mockBroadcastToWorkspace }));
vi.mock('../../server/ws-events.js', () => ({
  WS_EVENTS: { STRATEGY_UPDATED: 'strategy:updated' },
}));
vi.mock('../../server/activity-log.js', () => ({ addActivity: mockAddActivity }));
vi.mock('../../server/helpers.js', () => ({ normalizePageUrl: mockNormalizePageUrl }));
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
    // transaction mock: return a callable that also exposes .immediate()/
    // .deferred()/.exclusive() (matching better-sqlite3's Transaction object),
    // each executing fn immediately. The persistence code invokes .immediate().
    mockTransaction.mockImplementation((fn: (...args: unknown[]) => unknown) => {
      const txn = (...args: unknown[]) => fn(...args);
      txn.immediate = (...args: unknown[]) => fn(...args);
      txn.deferred = (...args: unknown[]) => fn(...args);
      txn.exclusive = (...args: unknown[]) => fn(...args);
      return txn;
    });
    mockDbPrepare.mockReturnValue({ run: mockRun });
    mockNormalizePageUrl.mockImplementation((p: string) => p);
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

  it('writes strategy_history snapshot using table-backed previous data (not stale JSON-only fields)', async () => {
    const { persistKeywordStrategy } = await import('../../server/keyword-strategy-persistence.js');

    const previousStrategy = {
      generatedAt: '2026-04-01T00:00:00.000Z',
      siteKeywords: ['old kw'],
      opportunities: ['old opportunity'],
      // These should be replaced by table-backed reads in history snapshot.
      contentGaps: [{ topic: 'stale', targetKeyword: 'stale', intent: 'informational', priority: 'low', rationale: 'stale' }],
      quickWins: [{ pagePath: '/stale', action: 'stale', estimatedImpact: 'low', rationale: 'stale' }],
      keywordGaps: [{ keyword: 'stale-gap' }],
      topicClusters: [{ topic: 'stale-cluster', keywords: [] }],
      cannibalization: [{ keyword: 'stale-cannibalization', pages: [] }],
    };

    const ws = makeWorkspace({ keywordStrategy: previousStrategy as unknown as KeywordStrategy });

    mockListPageKeywords.mockReturnValue([
      { pagePath: '/previous', pageTitle: 'Previous', primaryKeyword: 'old kw', secondaryKeywords: [] },
    ] as PageKeywordMap[]);
    mockListContentGaps.mockReturnValue([
      { topic: 'from table', targetKeyword: 'from table keyword', intent: 'informational', priority: 'high', rationale: 'table-backed' },
    ] as ContentGap[]);
    mockListQuickWins.mockReturnValue([
      { pagePath: '/from-table', action: 'refresh page', estimatedImpact: 'high', rationale: 'table-backed' },
    ] as QuickWin[]);
    mockListKeywordGaps.mockReturnValue([{ keyword: 'table-gap' }]);
    mockListTopicClusters.mockReturnValue([{ topic: 'table-cluster', keywords: [] }]);
    mockListCannibalizationIssues.mockReturnValue([{ keyword: 'table-cannibalization', pages: [] }]);

    const historyInsertRun = vi.fn(() => ({ changes: 1 }));
    mockDbPrepare.mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO strategy_history')) return { run: historyInsertRun };
      return { run: mockRun };
    });

    persistKeywordStrategy({
      ws,
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

    expect(historyInsertRun).toHaveBeenCalledTimes(1);
    const [historyWsId, strategyJson, pageMapJson, generatedAt] = historyInsertRun.mock.calls[0] as [string, string, string, string];
    expect(historyWsId).toBe('ws_persist');
    expect(generatedAt).toBe('2026-04-01T00:00:00.000Z');
    expect(JSON.parse(pageMapJson)).toEqual([
      { pagePath: '/previous', pageTitle: 'Previous', primaryKeyword: 'old kw', secondaryKeywords: [] },
    ]);

    const parsedStrategy = JSON.parse(strategyJson);
    expect(parsedStrategy.contentGaps).toEqual([
      { topic: 'from table', targetKeyword: 'from table keyword', intent: 'informational', priority: 'high', rationale: 'table-backed' },
    ]);
    expect(parsedStrategy.quickWins).toEqual([
      { pagePath: '/from-table', action: 'refresh page', estimatedImpact: 'high', rationale: 'table-backed' },
    ]);
    expect(parsedStrategy.keywordGaps).toEqual([{ keyword: 'table-gap' }]);
    expect(parsedStrategy.topicClusters).toEqual([{ topic: 'table-cluster', keywords: [] }]);
    expect(parsedStrategy.cannibalization).toEqual([{ keyword: 'table-cannibalization', pages: [] }]);
  });

  it('normalizes removedPagePaths before deleting page rows in incremental mode', async () => {
    const { persistKeywordStrategy } = await import('../../server/keyword-strategy-persistence.js');

    mockNormalizePageUrl.mockImplementation((p: string) => (p.startsWith('/') ? p : `/${p}`));
    const deletePageKeywordRun = vi.fn(() => ({ changes: 1 }));
    const deleteScoreHistoryRun = vi.fn(() => ({ changes: 1 }));
    mockDbPrepare.mockImplementation((sql: string) => {
      if (sql.includes('DELETE FROM page_keywords')) return { run: deletePageKeywordRun };
      if (sql.includes('DELETE FROM page_keyword_score_history')) return { run: deleteScoreHistoryRun };
      return { run: mockRun };
    });

    persistKeywordStrategy({
      ws: makeWorkspace(),
      strategy: makeStrategyOutput({
        pageMap: [
          { pagePath: '/services', pageTitle: 'Services', primaryKeyword: 'emergency plumber', secondaryKeywords: [] },
        ],
      }) as Parameters<typeof persistKeywordStrategy>[0]['strategy'],
      strategyMode: 'incremental',
      pagesToAnalyze: [],
      extraPagePaths: [],
      removedPagePaths: ['services', '/pricing'],
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

    expect(deletePageKeywordRun).toHaveBeenCalledWith('ws_persist', '/services');
    expect(deletePageKeywordRun).toHaveBeenCalledWith('ws_persist', '/pricing');
    expect(deleteScoreHistoryRun).toHaveBeenCalledWith('ws_persist', '/services');
    expect(deleteScoreHistoryRun).toHaveBeenCalledWith('ws_persist', '/pricing');
  });
});
