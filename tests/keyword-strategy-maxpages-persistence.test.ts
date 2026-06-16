/**
 * Tests that maxPages round-trips through persistKeywordStrategy.
 *
 * Reuses the same setup pattern as
 * tests/unit/keyword-strategy-persistence-pure.test.ts:
 *   - createWorkspace / deleteWorkspace for ephemeral fixtures
 *   - setBroadcast(vi.fn(), vi.fn()) to stub the WS singleton
 *   - getWorkspace() to read back the persisted blob
 */

import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import { setBroadcast } from '../server/broadcast.js';
import { createWorkspace, deleteWorkspace, getWorkspace } from '../server/workspaces.js';
import { persistKeywordStrategy } from '../server/keyword-strategy-persistence.js';
import type { Workspace } from '../shared/types/workspace.js';
import type { PersistKeywordStrategyOptions } from '../server/keyword-strategy-persistence.js';
import type { StrategyOutput } from '../server/keyword-strategy-ai-synthesis.js';

const workspaceIdsToCleanup: string[] = [];

afterAll(() => {
  for (const id of workspaceIdsToCleanup) {
    deleteWorkspace(id);
  }
});

beforeEach(() => {
  setBroadcast(vi.fn(), vi.fn());
});

function makeWorkspace(label: string): Workspace {
  const ws = createWorkspace(`MaxPages Persist ${label} ${Date.now()}`);
  workspaceIdsToCleanup.push(ws.id);
  return ws;
}

function makeOptions(ws: Workspace, overrides: Partial<PersistKeywordStrategyOptions> = {}): PersistKeywordStrategyOptions {
  const strategy: StrategyOutput = {
    siteKeywords: ['test keyword'],
    opportunities: [],
    contentGaps: [],
    quickWins: [],
    pageMap: [],
    ...overrides.strategy,
  };

  return {
    ws,
    strategy,
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
    searchData: {
      deviceBreakdown: [],
      countryBreakdown: [],
      periodComparison: null,
      organicLandingPages: [],
      organicOverview: null,
    },
    ...overrides,
  };
}

describe('maxPages persistence', () => {
  it('writes maxPages into the keywordStrategy blob when provided', () => {
    const ws = makeWorkspace('WithMaxPages');
    const result = persistKeywordStrategy(makeOptions(ws, { maxPages: 150 }));

    // Assert on the returned object (function-output level)
    expect(result.keywordStrategy.maxPages).toBe(150);

    // Assert the value survives a DB read-back round-trip
    const reloaded = getWorkspace(ws.id);
    expect(reloaded?.keywordStrategy?.maxPages).toBe(150);
  });

  it('writes maxPages: 0 when the clamped value is 0 (no-cap sentinel)', () => {
    const ws = makeWorkspace('ZeroMaxPages');
    const result = persistKeywordStrategy(makeOptions(ws, { maxPages: 0 }));

    expect(result.keywordStrategy.maxPages).toBe(0);

    const reloaded = getWorkspace(ws.id);
    // 0 is falsy — assert with toBe not toBeTruthy so we distinguish 0 from undefined
    expect(reloaded?.keywordStrategy?.maxPages).toBe(0);
  });

  it('leaves maxPages undefined in the blob when the option is not supplied', () => {
    const ws = makeWorkspace('NoMaxPages');
    const result = persistKeywordStrategy(makeOptions(ws));

    expect(result.keywordStrategy.maxPages).toBeUndefined();

    const reloaded = getWorkspace(ws.id);
    expect(reloaded?.keywordStrategy?.maxPages).toBeUndefined();
  });

  it('updates maxPages correctly on a second persist call', () => {
    const ws = makeWorkspace('UpdatedMaxPages');

    persistKeywordStrategy(makeOptions(ws, { maxPages: 100 }));
    expect(getWorkspace(ws.id)?.keywordStrategy?.maxPages).toBe(100);

    // Reload workspace so the second call has fresh state (mirrors production usage)
    const wsV2 = getWorkspace(ws.id)!;
    persistKeywordStrategy(makeOptions(wsV2, { maxPages: 500 }));
    expect(getWorkspace(ws.id)?.keywordStrategy?.maxPages).toBe(500);
  });
});
