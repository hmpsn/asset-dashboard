/**
 * A3 — Strategy outcome visibility (audit #14)
 *
 * 1. Strategy regeneration on a workspace that already recorded a strategy
 *    action must record a NEW action (the old once-ever guard suppressed every
 *    regen after the first, forever).
 * 2. Per-keyword outcome actions are recorded for net-new pageMap primaries
 *    (real pageUrl + targetKeyword → scoreable later), gated by a DB-backed
 *    idempotency key so re-running regeneration creates zero duplicates.
 * 3. Guard: recorded actions land in the legal initial state — pending
 *    measurement, typed ActionType/Attribution values. No status transition is
 *    introduced by this feature (recordAction INSERTs new rows only), so there
 *    is no validateTransition() call site to exercise.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, getWorkspace } from '../../server/workspaces.js';
import { persistKeywordStrategy } from '../../server/keyword-strategy-persistence.js';
import type { PersistKeywordStrategyOptions } from '../../server/keyword-strategy-persistence.js';
import {
  getActionsByWorkspaceAndType,
  STRATEGY_PAGE_KEYWORD_SOURCE_TYPE,
  strategyPageKeywordSourceId,
} from '../../server/outcome-tracking.js';
import { setBroadcast } from '../../server/broadcast.js';
import type { Workspace, PageKeywordMap } from '../../shared/types/workspace.js';
import type { StrategyOutput } from '../../server/keyword-strategy-ai-synthesis.js';

const ctx = createEphemeralTestContext(import.meta.url);

const workspaceIdsToCleanup: string[] = [];

beforeAll(async () => {
  await ctx.startServer();
}, 60_000);

afterAll(async () => {
  for (const id of workspaceIdsToCleanup) deleteWorkspace(id);
  await ctx.stopServer();
});

beforeEach(() => {
  // persistKeywordStrategy broadcasts after the write — the singleton must be set.
  setBroadcast(vi.fn(), vi.fn());
});

function makeWorkspace(label: string): Workspace {
  const ws = createWorkspace(`A3 Outcome Visibility ${label} ${Date.now()}`);
  workspaceIdsToCleanup.push(ws.id);
  return ws;
}

function makeOptions(
  ws: Workspace,
  pageMap: Partial<PageKeywordMap>[],
  overrides: Partial<PersistKeywordStrategyOptions> = {},
): PersistKeywordStrategyOptions {
  const strategy = {
    siteKeywords: ['emergency plumber'],
    opportunities: ['after-hours FAQ'],
    contentGaps: [],
    quickWins: [],
    pageMap,
  } as unknown as StrategyOutput;

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

function strategyLevelActions(workspaceId: string) {
  return getActionsByWorkspaceAndType(workspaceId, 'strategy_keyword_added')
    .filter((a) => a.sourceType === 'strategy');
}

function perKeywordActions(workspaceId: string) {
  return getActionsByWorkspaceAndType(workspaceId, 'strategy_keyword_added')
    .filter((a) => a.sourceType === STRATEGY_PAGE_KEYWORD_SOURCE_TYPE);
}

/** Re-read the workspace so the second persist sees the previous strategy blob. */
function freshWs(workspaceId: string): Workspace {
  const ws = getWorkspace(workspaceId);
  if (!ws) throw new Error(`workspace ${workspaceId} disappeared`);
  return ws;
}

describe('A3 — strategy-level action per regeneration (once-ever guard dropped)', () => {
  it('records a NEW strategy action on regeneration of a workspace that already has one', () => {
    const ws = makeWorkspace('regen');
    const pageMap = [
      { pagePath: '/services', pageTitle: 'Services', primaryKeyword: 'emergency plumber', secondaryKeywords: [] },
    ];

    persistKeywordStrategy(makeOptions(ws, pageMap));
    expect(strategyLevelActions(ws.id)).toHaveLength(1);

    // Regenerate — previously suppressed forever by the once-ever guard.
    persistKeywordStrategy(makeOptions(freshWs(ws.id), pageMap));
    expect(strategyLevelActions(ws.id)).toHaveLength(2);
  });
});

describe('A3 — per-keyword actions for net-new pageMap primaries', () => {
  it('records one action per net-new primary with real pageUrl + targetKeyword', () => {
    const ws = makeWorkspace('net-new');
    persistKeywordStrategy(makeOptions(ws, [
      { pagePath: '/services', pageTitle: 'Services', primaryKeyword: 'Emergency Plumber', secondaryKeywords: [] },
      { pagePath: '/about', pageTitle: 'About', primaryKeyword: 'about us', secondaryKeywords: [] },
    ]));

    const actions = perKeywordActions(ws.id);
    expect(actions).toHaveLength(2);

    const services = actions.find((a) => a.pageUrl === '/services');
    expect(services).toBeDefined();
    expect(services?.targetKeyword).toBe('Emergency Plumber');
    expect(services?.sourceId).toBe(strategyPageKeywordSourceId('/services', 'Emergency Plumber'));
  });

  it('idempotent re-run creates zero duplicates; a new page creates exactly one new action', () => {
    const ws = makeWorkspace('idempotent');
    const initialMap = [
      { pagePath: '/services', pageTitle: 'Services', primaryKeyword: 'emergency plumber', secondaryKeywords: [] },
    ];

    persistKeywordStrategy(makeOptions(ws, initialMap));
    expect(perKeywordActions(ws.id)).toHaveLength(1);

    // Identical regen → zero new per-keyword actions.
    persistKeywordStrategy(makeOptions(freshWs(ws.id), initialMap));
    expect(perKeywordActions(ws.id)).toHaveLength(1);

    // One net-new page → exactly one new action.
    persistKeywordStrategy(makeOptions(freshWs(ws.id), [
      ...initialMap,
      { pagePath: '/pricing', pageTitle: 'Pricing', primaryKeyword: 'plumber prices', secondaryKeywords: [] },
    ]));
    const actions = perKeywordActions(ws.id);
    expect(actions).toHaveLength(2);
    expect(actions.map((a) => a.pageUrl).sort()).toEqual(['/pricing', '/services']);
  });

  it('does not duplicate an action when a pair is removed then re-added (DB idempotency key)', () => {
    const ws = makeWorkspace('readd');
    const withServices = [
      { pagePath: '/services', pageTitle: 'Services', primaryKeyword: 'emergency plumber', secondaryKeywords: [] },
    ];
    const withoutServices = [
      { pagePath: '/about', pageTitle: 'About', primaryKeyword: 'about us', secondaryKeywords: [] },
    ];

    persistKeywordStrategy(makeOptions(ws, withServices));
    persistKeywordStrategy(makeOptions(freshWs(ws.id), withoutServices)); // /services removed (full replace)
    persistKeywordStrategy(makeOptions(freshWs(ws.id), withServices));    // /services re-added

    const services = perKeywordActions(ws.id).filter((a) => a.pageUrl === '/services');
    expect(services).toHaveLength(1);
  });

  it('skips /planned/ placeholder paths and entries without a primary keyword', () => {
    const ws = makeWorkspace('skips');
    persistKeywordStrategy(makeOptions(ws, [
      { pagePath: '/planned/water-heater-repair', pageTitle: 'Water Heater Repair', primaryKeyword: 'water heater repair', secondaryKeywords: [] },
      { pagePath: '/contact', pageTitle: 'Contact', primaryKeyword: '', secondaryKeywords: [] },
      { pagePath: '/services', pageTitle: 'Services', primaryKeyword: 'emergency plumber', secondaryKeywords: [] },
    ]));

    const actions = perKeywordActions(ws.id);
    expect(actions).toHaveLength(1);
    expect(actions[0].pageUrl).toBe('/services');
  });

  it('incremental mode records actions only for pages actually persisted in this run', () => {
    const ws = makeWorkspace('incremental');
    persistKeywordStrategy(makeOptions(ws, [
      { pagePath: '/services', pageTitle: 'Services', primaryKeyword: 'emergency plumber', secondaryKeywords: [] },
    ]));
    expect(perKeywordActions(ws.id)).toHaveLength(1);

    // Incremental run analyzing only /blog — /unrelated appears in the AI pageMap
    // output but was not analyzed, so it must not be persisted nor recorded.
    persistKeywordStrategy(makeOptions(freshWs(ws.id), [
      { pagePath: '/blog', pageTitle: 'Blog', primaryKeyword: 'plumbing tips', secondaryKeywords: [] },
      { pagePath: '/unrelated', pageTitle: 'Unrelated', primaryKeyword: 'unrelated keyword', secondaryKeywords: [] },
    ], {
      strategyMode: 'incremental',
      pagesToAnalyze: [{ path: '/blog', title: 'Blog', pageType: 'static' }] as PersistKeywordStrategyOptions['pagesToAnalyze'],
    }));

    const actions = perKeywordActions(ws.id);
    expect(actions.map((a) => a.pageUrl).sort()).toEqual(['/blog', '/services']);
  });
});

describe('A3 — guard: recorded actions land in the legal initial state', () => {
  it('per-keyword actions are pending, platform_executed, with a captured baseline', () => {
    const ws = makeWorkspace('guard');
    persistKeywordStrategy(makeOptions(ws, [
      {
        pagePath: '/services',
        pageTitle: 'Services',
        primaryKeyword: 'emergency plumber',
        secondaryKeywords: [],
        currentPosition: 12,
        clicks: 40,
        impressions: 900,
      },
    ]));

    const [action] = perKeywordActions(ws.id);
    expect(action.actionType).toBe('strategy_keyword_added');
    expect(action.attribution).toBe('platform_executed');
    expect(action.measurementComplete).toBe(false);
    expect(action.sourceFlag).toBe('live');
    expect(action.baselineSnapshot.captured_at).toBeTruthy();
    expect(action.baselineSnapshot.position).toBe(12);
    expect(action.baselineSnapshot.clicks).toBe(40);
    expect(action.baselineSnapshot.impressions).toBe(900);
    expect(action.baselineConfidence).toBe('exact');
  });

  it('strategyPageKeywordSourceId is deterministic and normalizing', () => {
    expect(strategyPageKeywordSourceId('/Services/', 'Emergency Plumber '))
      .toBe(strategyPageKeywordSourceId('/services', 'emergency plumber'));
    expect(strategyPageKeywordSourceId('https://example.com/services', 'emergency plumber'))
      .toBe(strategyPageKeywordSourceId('/services', 'emergency plumber'));
    expect(strategyPageKeywordSourceId('/services', 'emergency plumber'))
      .not.toBe(strategyPageKeywordSourceId('/services', 'pipe repair'));
  });
});
