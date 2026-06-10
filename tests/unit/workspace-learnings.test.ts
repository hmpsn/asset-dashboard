/**
 * Unit tests for server/workspace-learnings.ts — pure formatting and prompt functions.
 */
import { describe, it, expect, vi } from 'vitest';

// Mock the logger
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock DB-dependent imports
vi.mock('../../server/db/index.js', () => ({
  default: {
    prepare: vi.fn(() => ({
      get: vi.fn(),
      all: vi.fn(() => []),
      run: vi.fn(),
    })),
  },
}));

vi.mock('../../server/db/stmt-cache.js', () => ({
  createStmtCache: (factory: () => unknown) => factory,
}));

vi.mock('../../server/outcome-tracking.js', () => ({
  getActionsByWorkspace: vi.fn(() => []),
  getOutcomesForAction: vi.fn(() => []),
}));

vi.mock('../../server/db/outcome-mappers.js', () => ({
  rowToWorkspaceLearnings: vi.fn(() => null),
}));

import { formatLearningsForPrompt } from '../../server/workspace-learnings.js';
import type {
  WorkspaceLearnings,
  ContentLearnings,
  StrategyLearnings,
  OverallLearnings,
} from '../../shared/types/outcome-tracking.js';

// --- Helpers ---

function makeOverall(overrides: Partial<OverallLearnings> = {}): OverallLearnings {
  return {
    totalWinRate: 0.62,
    strongWinRate: 0.28,
    topActionTypes: [
      { type: 'content_published', winRate: 0.75, count: 10 },
      { type: 'meta_updated', winRate: 0.60, count: 8 },
    ],
    recentTrend: 'stable',
    ...overrides,
  };
}

function makeContentLearnings(overrides: Partial<ContentLearnings> = {}): ContentLearnings {
  return {
    winRateByFormat: { content_published: 0.75, brief_created: 0.55 },
    avgDaysToPage1: 38,
    bestPerformingTopics: ['seo tips', 'content strategy', 'keyword research'],
    optimalWordCount: null,
    refreshRecoveryRate: 0.65,
    voiceScoreCorrelation: null,
    ...overrides,
  };
}

function makeStrategyLearnings(overrides: Partial<StrategyLearnings> = {}): StrategyLearnings {
  return {
    winRateByDifficultyRange: { '0-20': 0.8, '21-40': 0.6, '41-60': 0.45 },
    winRateByCheckpoint: { '30d': 0.7, '60d': 0.8 },
    bestIntentTypes: ['informational', 'transactional'],
    keywordVolumeSweetSpot: { min: 500, max: 8000 },
    ...overrides,
  };
}

function makeLearnings(overrides: Partial<WorkspaceLearnings> = {}): WorkspaceLearnings {
  return {
    workspaceId: 'ws-test',
    computedAt: '2026-03-01T00:00:00Z',
    confidence: 'medium',
    totalScoredActions: 25,
    content: makeContentLearnings(),
    strategy: makeStrategyLearnings(),
    technical: null,
    overall: makeOverall(),
    ...overrides,
  };
}

// --- formatLearningsForPrompt ---

describe('formatLearningsForPrompt', () => {
  it('returns empty string for low confidence', () => {
    const learnings = makeLearnings({ confidence: 'low' });
    const result = formatLearningsForPrompt(learnings, 'all');
    expect(result).toBe('');
  });

  it('returns non-empty string for medium confidence', () => {
    const learnings = makeLearnings({ confidence: 'medium' });
    const result = formatLearningsForPrompt(learnings, 'all');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns non-empty string for high confidence', () => {
    const learnings = makeLearnings({ confidence: 'high' });
    const result = formatLearningsForPrompt(learnings, 'all');
    expect(result.length).toBeGreaterThan(0);
  });

  it('includes overall win rate in output', () => {
    const learnings = makeLearnings({
      confidence: 'medium',
      overall: makeOverall({ totalWinRate: 0.62, strongWinRate: 0.28 }),
    });
    const result = formatLearningsForPrompt(learnings, 'all');
    expect(result).toContain('62%');
    expect(result).toContain('28%');
  });

  it('includes WORKSPACE LEARNINGS header with action count and confidence', () => {
    const learnings = makeLearnings({ confidence: 'medium', totalScoredActions: 25 });
    const result = formatLearningsForPrompt(learnings, 'all');
    expect(result).toContain('25');
    expect(result).toContain('medium');
  });

  it('includes content-domain specific content for domain=content', () => {
    const learnings = makeLearnings({
      confidence: 'medium',
      content: makeContentLearnings({
        avgDaysToPage1: 38,
        bestPerformingTopics: ['seo tips', 'content strategy'],
      }),
    });
    const result = formatLearningsForPrompt(learnings, 'content');
    expect(result).toContain('38');
  });

  it('includes best performing topics for content domain', () => {
    const learnings = makeLearnings({
      confidence: 'medium',
      content: makeContentLearnings({
        bestPerformingTopics: ['seo tips', 'content strategy', 'link building'],
      }),
    });
    const result = formatLearningsForPrompt(learnings, 'content');
    expect(result).toContain('seo tips');
  });

  it('includes content format win rate comparison for domain=content', () => {
    const learnings = makeLearnings({
      confidence: 'medium',
      content: makeContentLearnings({
        winRateByFormat: { content_published: 0.75, brief_created: 0.45 },
      }),
    });
    const result = formatLearningsForPrompt(learnings, 'content');
    // Format comparison line includes both format names
    expect(result).toContain('75%');
    expect(result).toContain('45%');
  });

  it('includes strategy-domain specific content for domain=strategy', () => {
    const learnings = makeLearnings({
      confidence: 'medium',
      strategy: makeStrategyLearnings({
        keywordVolumeSweetSpot: { min: 500, max: 8000 },
        bestIntentTypes: ['informational', 'transactional'],
      }),
    });
    const result = formatLearningsForPrompt(learnings, 'strategy');
    expect(result).toContain('500');
    expect(result).toContain('8000');
  });

  it('includes best intent types for strategy domain', () => {
    const learnings = makeLearnings({
      confidence: 'high',
      strategy: makeStrategyLearnings({
        bestIntentTypes: ['informational', 'transactional'],
      }),
    });
    const result = formatLearningsForPrompt(learnings, 'strategy');
    expect(result).toContain('informational');
  });

  it('includes difficulty range win rate for strategy domain', () => {
    const learnings = makeLearnings({
      confidence: 'high',
      strategy: makeStrategyLearnings({
        winRateByDifficultyRange: { '0-20': 0.85 },
      }),
    });
    const result = formatLearningsForPrompt(learnings, 'strategy');
    expect(result).toContain('0-20');
    expect(result).toContain('85%');
  });

  it('does not include content lines when domain=strategy with null content', () => {
    const learnings = makeLearnings({
      confidence: 'medium',
      content: null,
      strategy: makeStrategyLearnings(),
    });
    const result = formatLearningsForPrompt(learnings, 'strategy');
    // Should not contain content-specific phrases
    expect(result).not.toContain('page 1');
  });

  it('does not include strategy lines when domain=content with null strategy', () => {
    const learnings = makeLearnings({
      confidence: 'medium',
      content: makeContentLearnings(),
      strategy: null,
    });
    const result = formatLearningsForPrompt(learnings, 'content');
    expect(result).not.toContain('keyword impressions range');
  });

  it('does not exceed ~20 lines of output', () => {
    const learnings = makeLearnings({ confidence: 'high' });
    const result = formatLearningsForPrompt(learnings, 'all');
    const lineCount = result.split('\n').length;
    expect(lineCount).toBeLessThanOrEqual(20);
  });

  it('includes trending signal when trend is not stable', () => {
    const learnings = makeLearnings({
      confidence: 'medium',
      overall: makeOverall({ recentTrend: 'improving' }),
    });
    const result = formatLearningsForPrompt(learnings, 'all');
    expect(result).toContain('improving');
  });

  it('does not include trend line when trend is stable', () => {
    const learnings = makeLearnings({
      confidence: 'medium',
      overall: makeOverall({ recentTrend: 'stable' }),
    });
    const result = formatLearningsForPrompt(learnings, 'all');
    expect(result).not.toContain('Recent trend');
  });

  it('includes top action types when available', () => {
    const learnings = makeLearnings({
      confidence: 'medium',
      overall: makeOverall({
        topActionTypes: [
          { type: 'content_published', winRate: 0.75, count: 10 },
          { type: 'meta_updated', winRate: 0.60, count: 8 },
          { type: 'schema_deployed', winRate: 0.55, count: 6 },
        ],
      }),
    });
    const result = formatLearningsForPrompt(learnings, 'all');
    expect(result).toContain('content published');
  });
});

describe('getWorkspaceLearnings cache integrity', () => {
  async function loadModuleForCacheTests() {
    vi.resetModules();

    const getCached = vi.fn();
    const upsertRun = vi.fn();
    const allWorkspaceIds = vi.fn(() => []);

    const dbPrepare = vi.fn((sql: string) => {
      if (sql.includes('SELECT * FROM workspace_learnings')) {
        return { get: getCached };
      }
      if (sql.includes('INSERT OR REPLACE INTO workspace_learnings')) {
        return { run: upsertRun };
      }
      if (sql.includes('SELECT DISTINCT workspace_id FROM tracked_actions')) {
        return { all: allWorkspaceIds };
      }
      throw new Error(`Unexpected SQL in test: ${sql.slice(0, 60)}`);
    });

    const getActionsByWorkspace = vi.fn(() => []);
    const getOutcomesForAction = vi.fn(() => []);
    const rowToWorkspaceLearnings = vi.fn();

    vi.doMock('../../server/logger.js', () => ({
      createLogger: () => ({
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
      }),
    }));

    vi.doMock('../../server/db/index.js', () => ({
      default: { prepare: dbPrepare },
    }));

    vi.doMock('../../server/db/stmt-cache.js', () => ({
      createStmtCache: (factory: () => unknown) => {
        let cached: unknown;
        return () => {
          if (!cached) cached = factory();
          return cached;
        };
      },
    }));

    vi.doMock('../../server/outcome-tracking.js', () => ({
      getActionsByWorkspace,
      getOutcomesForAction,
    }));

    vi.doMock('../../server/db/outcome-mappers.js', () => ({
      rowToWorkspaceLearnings,
    }));

    vi.doMock('../../server/broadcast.js', () => ({
      broadcastToWorkspace: vi.fn(),
    }));

    vi.doMock('../../server/ws-events.js', () => ({
      WS_EVENTS: { OUTCOME_LEARNINGS_UPDATED: 'outcome-learnings:updated' },
    }));

    const mod = await import('../../server/workspace-learnings.js');
    return {
      mod,
      mocks: {
        getCached,
        upsertRun,
        getActionsByWorkspace,
        getOutcomesForAction,
        rowToWorkspaceLearnings,
      },
    };
  }

  it('returns fresh cached learnings without recompute when mapper succeeds', async () => {
    const { mod, mocks } = await loadModuleForCacheTests();
    const nowIso = new Date().toISOString();
    // C1: a trustworthy cached blob carries the current logicVersion stamp; a missing
    // stamp would be treated as cache-invalid and force a recompute.
    const cachedRow = {
      id: 'row-1',
      workspace_id: 'ws-1',
      learnings: JSON.stringify({ logicVersion: mod.LEARNINGS_LOGIC_VERSION, confidence: 'high' }),
      computed_at: nowIso,
    };
    const mapped = makeLearnings({ workspaceId: 'ws-1', computedAt: nowIso, confidence: 'high' });

    mocks.getCached.mockReturnValue(cachedRow);
    mocks.rowToWorkspaceLearnings.mockReturnValue(mapped);

    const result = mod.getWorkspaceLearnings('ws-1');

    expect(result).toEqual(mapped);
    expect(mocks.getActionsByWorkspace).not.toHaveBeenCalled();
    expect(mocks.upsertRun).not.toHaveBeenCalled();
  });

  it('recomputes when fresh cached row fails to map, instead of silent null return (regression)', async () => {
    const { mod, mocks } = await loadModuleForCacheTests();
    const nowIso = new Date().toISOString();
    // C1: current-version stamp so the row is trusted; the mapper still fails (corrupt
    // payload), and on an empty recompute the trustworthy row is re-served (stale-cache
    // for a transient data gap, NOT the resurrection of an unversioned pre-fix blob).
    const cachedLearningsJson = JSON.stringify({ logicVersion: mod.LEARNINGS_LOGIC_VERSION, broken: true });
    const cachedRow = {
      id: 'row-bad',
      workspace_id: 'ws-2',
      learnings: cachedLearningsJson,
      computed_at: nowIso,
    };
    const staleFallback = makeLearnings({
      workspaceId: 'ws-2',
      computedAt: '2026-01-01T00:00:00.000Z',
      confidence: 'medium',
      totalScoredActions: 18,
    });

    mocks.getCached.mockReturnValue(cachedRow);
    mocks.rowToWorkspaceLearnings
      .mockReturnValueOnce(null) // fresh read parse fails
      .mockReturnValueOnce(staleFallback); // stale fallback after recompute finds no new data
    mocks.getActionsByWorkspace.mockReturnValue([]);

    const result = mod.getWorkspaceLearnings('ws-2');

    expect(result).toEqual(staleFallback);
    expect(mocks.getActionsByWorkspace).toHaveBeenCalledWith('ws-2');
    expect(mocks.upsertRun).toHaveBeenCalledTimes(1);
    expect(mocks.upsertRun).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'row-bad',
        workspace_id: 'ws-2',
        learnings: cachedLearningsJson,
      }),
    );
  });

  it('touches stale cache timestamp and returns stale learnings when recompute has zero scored actions', async () => {
    const { mod, mocks } = await loadModuleForCacheTests();
    const oldIso = '2025-01-01T00:00:00.000Z';
    // C1: current-version stamp so this is a trustworthy historical blob. A recompute
    // that finds zero scored actions is a transient data gap, so the row is re-served
    // (timestamp touched) rather than discarded — only UNVERSIONED/old-version blobs are
    // treated as corrupt and replaced with the honest empty aggregate.
    const cachedLearningsJson = JSON.stringify({ logicVersion: mod.LEARNINGS_LOGIC_VERSION, confidence: 'medium', totalScoredActions: 12 });
    const cachedRow = {
      id: 'row-stale',
      workspace_id: 'ws-3',
      learnings: cachedLearningsJson,
      computed_at: oldIso,
    };
    const staleMapped = makeLearnings({
      workspaceId: 'ws-3',
      computedAt: oldIso,
      confidence: 'medium',
      totalScoredActions: 12,
    });

    mocks.getCached.mockReturnValue(cachedRow);
    mocks.rowToWorkspaceLearnings.mockReturnValue(staleMapped);
    mocks.getActionsByWorkspace.mockReturnValue([]);

    const result = mod.getWorkspaceLearnings('ws-3');

    expect(result).toEqual(staleMapped);
    expect(mocks.upsertRun).toHaveBeenCalledTimes(1);
    expect(mocks.upsertRun.mock.calls[0]?.[0]).toMatchObject({
      id: 'row-stale',
      workspace_id: 'ws-3',
      learnings: cachedLearningsJson,
    });
    expect(typeof mocks.upsertRun.mock.calls[0]?.[0]?.computed_at).toBe('string');
  });
});
