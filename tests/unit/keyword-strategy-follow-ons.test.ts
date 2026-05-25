import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageKeywordMap } from '../../shared/types/workspace.js';

// ── Mock dependencies (hoisted before any imports below) ──────────────────────

vi.mock('../../server/rank-tracking.js', () => ({ addTrackedKeyword: vi.fn() }));
vi.mock('../../server/llms-txt-generator.js', () => ({ queueLlmsTxtRegeneration: vi.fn() }));
vi.mock('../../server/recommendations.js', () => ({
  generateRecommendations: vi.fn(async () => undefined),
}));
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
}));

// ── Import mocked modules for assertions ──────────────────────────────────────
import * as rankTracking from '../../server/rank-tracking.js';
import * as llmsTxt from '../../server/llms-txt-generator.js';
import * as recs from '../../server/recommendations.js';

// ── Import the module under test ──────────────────────────────────────────────
import {
  collectKeywordStrategySeedKeywords,
  seedKeywordStrategyTrackedKeywords,
  queueKeywordStrategyPostUpdateFollowOns,
} from '../../server/keyword-strategy-follow-ons.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function pageMap(overrides: Partial<PageKeywordMap> = {}): PageKeywordMap {
  return {
    pagePath: '/example',
    pageTitle: 'Example',
    primaryKeyword: 'example keyword',
    secondaryKeywords: [],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('collectKeywordStrategySeedKeywords', () => {
  it('returns normalized, deduplicated keywords from siteKeywords', () => {
    const result = collectKeywordStrategySeedKeywords(
      { siteKeywords: ['Emergency Plumber', 'emergency plumber', '  pipe repair  ', 'PIPE REPAIR'] },
      [],
    );
    expect(result).toEqual(['emergency plumber', 'pipe repair']);
  });

  it('includes normalized page primary keywords from the pageMap', () => {
    const result = collectKeywordStrategySeedKeywords(
      { siteKeywords: [] },
      [pageMap({ primaryKeyword: 'SEO Audit' }), pageMap({ primaryKeyword: 'seo audit' })],
    );
    expect(result).toEqual(['seo audit']);
  });

  it('merges siteKeywords and pageMap keywords, deduplicating across both', () => {
    const result = collectKeywordStrategySeedKeywords(
      { siteKeywords: ['Technical SEO', 'content strategy'] },
      [pageMap({ primaryKeyword: ' Local SEO ' }), pageMap({ primaryKeyword: 'CONTENT STRATEGY' })],
    );
    expect(result).toEqual(['technical seo', 'content strategy', 'local seo']);
  });

  it('filters out empty strings from siteKeywords', () => {
    const result = collectKeywordStrategySeedKeywords(
      { siteKeywords: ['', '  ', 'valid keyword'] },
      [],
    );
    expect(result).toEqual(['valid keyword']);
  });

  it('filters out empty primaryKeyword values from pageMap', () => {
    const result = collectKeywordStrategySeedKeywords(
      { siteKeywords: [] },
      [pageMap({ primaryKeyword: '' }), pageMap({ primaryKeyword: 'real keyword' })],
    );
    expect(result).toEqual(['real keyword']);
  });

  it('returns empty array when both inputs are empty', () => {
    expect(collectKeywordStrategySeedKeywords({ siteKeywords: [] }, [])).toEqual([]);
  });
});

describe('seedKeywordStrategyTrackedKeywords', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('calls addTrackedKeyword for each unique seed keyword', () => {
    seedKeywordStrategyTrackedKeywords({
      workspaceId: 'ws_seed',
      workspaceName: 'Austin Plumbing Co',
      keywordStrategy: { siteKeywords: ['emergency plumber', 'pipe repair'] },
      pageMap: [pageMap({ primaryKeyword: 'drain cleaning' })],
    });
    expect(rankTracking.addTrackedKeyword).toHaveBeenCalledTimes(3);
    expect(rankTracking.addTrackedKeyword).toHaveBeenCalledWith('ws_seed', 'emergency plumber');
    expect(rankTracking.addTrackedKeyword).toHaveBeenCalledWith('ws_seed', 'pipe repair');
    expect(rankTracking.addTrackedKeyword).toHaveBeenCalledWith('ws_seed', 'drain cleaning');
  });

  it('does not throw when addTrackedKeyword throws — logs a warning instead', () => {
    vi.mocked(rankTracking.addTrackedKeyword).mockImplementation(() => {
      throw new Error('DB error');
    });
    expect(() =>
      seedKeywordStrategyTrackedKeywords({
        workspaceId: 'ws_err',
        workspaceName: 'Error WS',
        keywordStrategy: { siteKeywords: ['kw'] },
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

  it('calls generateRecommendations synchronously (no setTimeout in this version)', () => {
    // In this worktree's version, generateRecommendations is called immediately
    // (no setTimeout delay), unless the workspace is already in-flight
    queueKeywordStrategyPostUpdateFollowOns({ workspaceId: 'ws_unique_qkspfof_new' });
    expect(recs.generateRecommendations).toHaveBeenCalledWith('ws_unique_qkspfof_new');
  });

  it('deduplicates concurrent calls for the same workspace (recsInFlight guard)', () => {
    // First call queues it; second call for the same workspace is a no-op
    queueKeywordStrategyPostUpdateFollowOns({ workspaceId: 'ws_dedup_test' });
    queueKeywordStrategyPostUpdateFollowOns({ workspaceId: 'ws_dedup_test' });
    expect(recs.generateRecommendations).toHaveBeenCalledTimes(1);
  });
});
