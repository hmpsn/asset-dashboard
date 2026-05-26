import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock dependencies (hoisted before any imports below) ──────────────────────

vi.mock('../../server/activity-log.js', () => ({ addActivity: vi.fn() }));
vi.mock('../../server/broadcast.js', () => ({ broadcastToWorkspace: vi.fn() }));
vi.mock('../../server/bridge-infrastructure.js', () => ({
  invalidateSubCachePrefix: vi.fn(),
  debouncedStrategyInvalidate: vi.fn(),
  debouncedPageAnalysisInvalidate: vi.fn(),
}));
vi.mock('../../server/rank-tracking-reconciliation.js', () => ({
  hasStrategyOwnedTrackedKeywords: vi.fn(() => false),
  reconcileStrategyRankTracking: vi.fn(() => ({})),
  summarizeStrategyRankTrackingChangeSet: vi.fn(() => ({
    added: 0, reassigned: 0, deprecated: 0, replaced: 0, retained: 0,
  })),
}));
vi.mock('../../server/llms-txt-generator.js', () => ({
  queueLlmsTxtRegeneration: vi.fn(),
}));
vi.mock('../../server/recommendations.js', () => ({
  generateRecommendations: vi.fn(async () => undefined),
}));
vi.mock('../../server/workspace-intelligence.js', () => ({
  invalidateIntelligenceCache: vi.fn(),
}));
vi.mock('../../server/ws-events.js', () => ({
  WS_EVENTS: { RANK_TRACKING_UPDATED: 'rank_tracking:updated', STRATEGY_UPDATED: 'strategy:updated' },
}));
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
}));

// ── Import mocked modules for assertions ──────────────────────────────────────
import * as activityLog from '../../server/activity-log.js';
import * as broadcastMod from '../../server/broadcast.js';
import * as rankTracking from '../../server/rank-tracking-reconciliation.js';
import * as llmsTxt from '../../server/llms-txt-generator.js';
import * as recs from '../../server/recommendations.js';

// ── Import the module under test ──────────────────────────────────────────────
import {
  workspaceHasStrategyOwnedRankTracking,
  seedKeywordStrategyTrackedKeywords,
  queueKeywordStrategyPostUpdateFollowOns,
} from '../../server/keyword-strategy-follow-ons.js';

// ── Shared fixture ────────────────────────────────────────────────────────────

const baseKeywordStrategy = {
  siteKeywords: ['emergency plumber austin'],
  siteKeywordMetrics: [] as { keyword: string; volume: number; difficulty: number }[],
  generatedAt: '2026-05-20T00:00:00.000Z',
  opportunities: [] as string[],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('workspaceHasStrategyOwnedRankTracking', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('delegates to hasStrategyOwnedTrackedKeywords and returns its result when true', () => {
    vi.mocked(rankTracking.hasStrategyOwnedTrackedKeywords).mockReturnValue(true);
    expect(workspaceHasStrategyOwnedRankTracking('ws_abc')).toBe(true);
    expect(rankTracking.hasStrategyOwnedTrackedKeywords).toHaveBeenCalledWith('ws_abc');
  });

  it('returns false when no strategy-owned tracked keywords exist', () => {
    vi.mocked(rankTracking.hasStrategyOwnedTrackedKeywords).mockReturnValue(false);
    expect(workspaceHasStrategyOwnedRankTracking('ws_none')).toBe(false);
  });
});

describe('seedKeywordStrategyTrackedKeywords', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: structural changes happened (added=2, deprecated=1, retained=3)
    vi.mocked(rankTracking.summarizeStrategyRankTrackingChangeSet).mockReturnValue({
      added: 2, reassigned: 0, deprecated: 1, replaced: 0, retained: 3,
    });
  });

  it('calls reconcileStrategyRankTracking with the expected shape', () => {
    seedKeywordStrategyTrackedKeywords({
      workspaceId: 'ws_seed',
      workspaceName: 'Austin Plumbing Co',
      keywordStrategy: baseKeywordStrategy,
      pageMap: [],
    });
    expect(rankTracking.reconcileStrategyRankTracking).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws_seed',
        keywordStrategy: baseKeywordStrategy,
        pageMap: [],
        generatedAt: baseKeywordStrategy.generatedAt,
      }),
    );
  });

  it('broadcasts RANK_TRACKING_UPDATED when structural changes occurred', () => {
    seedKeywordStrategyTrackedKeywords({
      workspaceId: 'ws_seed',
      workspaceName: 'Austin Plumbing Co',
      keywordStrategy: baseKeywordStrategy,
      pageMap: [],
    });
    expect(broadcastMod.broadcastToWorkspace).toHaveBeenCalledWith(
      'ws_seed',
      'rank_tracking:updated',
      expect.objectContaining({ source: 'keyword_strategy' }),
    );
  });

  it('adds activity log entry when structural changes occurred', () => {
    seedKeywordStrategyTrackedKeywords({
      workspaceId: 'ws_seed',
      workspaceName: 'Austin Plumbing Co',
      keywordStrategy: baseKeywordStrategy,
      pageMap: [],
    });
    expect(activityLog.addActivity).toHaveBeenCalledWith(
      'ws_seed',
      'rank_tracking_updated',
      expect.any(String),
      expect.any(String),
      expect.any(Object),
    );
  });

  it('skips broadcast and activity when no structural changes and no retained keywords', () => {
    vi.mocked(rankTracking.summarizeStrategyRankTrackingChangeSet).mockReturnValue({
      added: 0, reassigned: 0, deprecated: 0, replaced: 0, retained: 0,
    });
    seedKeywordStrategyTrackedKeywords({
      workspaceId: 'ws_noop',
      workspaceName: 'Noop Workspace',
      keywordStrategy: baseKeywordStrategy,
      pageMap: [],
    });
    expect(broadcastMod.broadcastToWorkspace).not.toHaveBeenCalled();
    expect(activityLog.addActivity).not.toHaveBeenCalled();
  });

  it('does not throw when reconciliation throws — logs a warning instead', () => {
    vi.mocked(rankTracking.reconcileStrategyRankTracking).mockImplementation(() => {
      throw new Error('DB error');
    });
    expect(() =>
      seedKeywordStrategyTrackedKeywords({
        workspaceId: 'ws_err',
        workspaceName: 'Error WS',
        keywordStrategy: baseKeywordStrategy,
        pageMap: [],
      }),
    ).not.toThrow();
  });
});

describe('queueKeywordStrategyPostUpdateFollowOns', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('calls queueLlmsTxtRegeneration with the workspace id and reason', () => {
    queueKeywordStrategyPostUpdateFollowOns({ workspaceId: 'ws_foo' });
    expect(llmsTxt.queueLlmsTxtRegeneration).toHaveBeenCalledWith('ws_foo', 'keyword_strategy_updated');
  });

  it('does not call generateRecommendations synchronously (delayed via setTimeout)', () => {
    // Use a unique workspaceId to avoid the recsInFlight dedup guard from prior tests
    queueKeywordStrategyPostUpdateFollowOns({ workspaceId: 'ws_unique_followon_test_wave25' });
    // generateRecommendations is behind a 30s setTimeout — NOT called synchronously
    expect(recs.generateRecommendations).not.toHaveBeenCalled();
  });
});
