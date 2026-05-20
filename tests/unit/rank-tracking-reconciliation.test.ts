import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import {
  addTrackedKeyword,
  getRankHistory,
  getLatestRanks,
  getTrackedKeywords,
  storeRankSnapshot,
} from '../../server/rank-tracking.js';
import { reconcileStrategyRankTracking } from '../../server/rank-tracking-reconciliation.js';
import {
  TRACKED_KEYWORD_SOURCE,
  TRACKED_KEYWORD_STATUS,
} from '../../shared/types/rank-tracking.js';
import type { PageKeywordMap } from '../../shared/types/workspace.js';

let workspaceId = '';

beforeEach(() => {
  workspaceId = createWorkspace(`Rank Tracking Reconcile ${Date.now()}`).id;
});

afterEach(() => {
  if (workspaceId) deleteWorkspace(workspaceId);
  workspaceId = '';
});

function pageKeyword(overrides: Partial<PageKeywordMap>): PageKeywordMap {
  return {
    pagePath: '/services/default',
    pageTitle: 'Default Service',
    primaryKeyword: 'default service',
    secondaryKeywords: [],
    ...overrides,
  };
}

describe('reconcileStrategyRankTracking', () => {
  it('adds strategy site and page keywords with lifecycle metadata', () => {
    const generatedAt = '2026-05-19T10:00:00.000Z';
    addTrackedKeyword(workspaceId, 'already tracked');
    storeRankSnapshot(workspaceId, '2026-05-19', [
      { query: 'already tracked', position: 2, clicks: 10, impressions: 200, ctr: 0.05 },
      { query: 'Dentist Austin', position: 4, clicks: 9, impressions: 300, ctr: 0.03 },
    ]);

    const changeSet = reconcileStrategyRankTracking({
      workspaceId,
      generatedAt,
      keywordStrategy: {
        siteKeywords: ['dentist austin'],
        siteKeywordMetrics: [{ keyword: 'dentist austin', volume: 900, difficulty: 34 }],
        generatedAt,
      },
      pageMap: [
        pageKeyword({
          pagePath: '/services/cosmetic-dentistry',
          pageTitle: 'Cosmetic Dentistry',
          primaryKeyword: 'cosmetic dentistry austin',
          searchIntent: 'commercial',
          volume: 700,
          difficulty: 28,
          currentPosition: 12,
          clicks: 3,
          impressions: 450,
        }),
      ],
    });

    expect(changeSet.added.map(k => k.query).sort()).toEqual(['cosmetic dentistry austin', 'dentist austin']);
    const tracked = getTrackedKeywords(workspaceId);
    expect(tracked).toEqual(expect.arrayContaining([
      expect.objectContaining({
        query: 'dentist austin',
        source: TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD,
        status: TRACKED_KEYWORD_STATUS.ACTIVE,
        volume: 900,
        difficulty: 34,
        baselinePosition: 4,
        baselineClicks: 9,
        baselineImpressions: 300,
        lastStrategySeenAt: generatedAt,
      }),
      expect.objectContaining({
        query: 'cosmetic dentistry austin',
        source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY,
        pagePath: '/services/cosmetic-dentistry',
        pageTitle: 'Cosmetic Dentistry',
        intent: 'commercial',
        baselinePosition: 12,
        baselineClicks: 3,
        baselineImpressions: 450,
      }),
    ]));
  });

  it('retains, reassigns, replaces, deprecates, and manually preserves tracked keywords', () => {
    const previousRun = '2026-05-01T10:00:00.000Z';
    const generatedAt = '2026-05-19T10:00:00.000Z';
    addTrackedKeyword(workspaceId, 'retained keyword', {
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY,
      pagePath: '/old-retained',
      strategyGeneratedAt: previousRun,
      lastStrategySeenAt: previousRun,
    });
    addTrackedKeyword(workspaceId, 'reassigned keyword', {
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY,
      pagePath: '/old-page',
      strategyGeneratedAt: previousRun,
      lastStrategySeenAt: previousRun,
    });
    addTrackedKeyword(workspaceId, 'old page keyword', {
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY,
      pagePath: '/replace-me',
      strategyGeneratedAt: previousRun,
      lastStrategySeenAt: previousRun,
    });
    addTrackedKeyword(workspaceId, 'old site keyword', {
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD,
      strategyGeneratedAt: previousRun,
      lastStrategySeenAt: previousRun,
    });
    addTrackedKeyword(workspaceId, 'client requested keyword', {
      source: TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED,
    });
    addTrackedKeyword(workspaceId, 'pinned old strategy keyword', {
      pinned: true,
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY,
      pagePath: '/pinned-page',
    });

    const changeSet = reconcileStrategyRankTracking({
      workspaceId,
      generatedAt,
      keywordStrategy: {
        siteKeywords: ['retained keyword'],
        generatedAt,
      },
      pageMap: [
        pageKeyword({
          pagePath: '/new-page',
          pageTitle: 'New Page',
          primaryKeyword: 'reassigned keyword',
        }),
        pageKeyword({
          pagePath: '/replace-me',
          pageTitle: 'Replace Me',
          primaryKeyword: 'new page keyword',
        }),
      ],
    });

    expect(changeSet.retained.map(k => k.query)).toContain('retained keyword');
    expect(changeSet.reassigned.map(k => k.query)).toEqual(['reassigned keyword']);
    expect(changeSet.replaced.map(k => k.query)).toEqual(['old page keyword']);
    expect(changeSet.deprecated.map(k => k.query)).toEqual(['old site keyword']);
    expect(changeSet.manuallyPreserved.map(k => k.query)).toEqual(expect.arrayContaining([
      'client requested keyword',
      'pinned old strategy keyword',
    ]));

    const activeQueries = getTrackedKeywords(workspaceId).map(k => k.query);
    expect(activeQueries).toEqual(expect.arrayContaining([
      'retained keyword',
      'reassigned keyword',
      'new page keyword',
      'client requested keyword',
      'pinned old strategy keyword',
    ]));
    expect(activeQueries).not.toContain('old page keyword');
    expect(activeQueries).not.toContain('old site keyword');

    const byQuery = new Map(getTrackedKeywords(workspaceId, { includeInactive: true }).map(k => [k.query, k]));
    expect(byQuery.get('reassigned keyword')).toEqual(expect.objectContaining({
      status: TRACKED_KEYWORD_STATUS.ACTIVE,
      pagePath: '/new-page',
    }));
    expect(byQuery.get('old page keyword')).toEqual(expect.objectContaining({
      status: TRACKED_KEYWORD_STATUS.REPLACED,
      replacedBy: 'new page keyword',
      deprecatedAt: generatedAt,
    }));
    expect(byQuery.get('old site keyword')).toEqual(expect.objectContaining({
      status: TRACKED_KEYWORD_STATUS.DEPRECATED,
      deprecatedAt: generatedAt,
    }));
    expect(byQuery.get('client requested keyword')).toEqual(expect.objectContaining({
      status: TRACKED_KEYWORD_STATUS.ACTIVE,
      source: TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED,
    }));
    expect(byQuery.get('pinned old strategy keyword')).toEqual(expect.objectContaining({
      status: TRACKED_KEYWORD_STATUS.ACTIVE,
      pinned: true,
    }));
  });

  it('normalizes legacy tracked keyword rows and preserves active rank output metadata', () => {
    db.prepare(`
      INSERT INTO rank_tracking_config (workspace_id, tracked_keywords)
      VALUES (?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET tracked_keywords = excluded.tracked_keywords
    `).run(workspaceId, JSON.stringify([{ query: 'Legacy Keyword', addedAt: '2026-05-01T00:00:00.000Z' }]));

    expect(getTrackedKeywords(workspaceId)).toEqual([
      expect.objectContaining({
        query: 'legacy keyword',
        pinned: false,
        source: TRACKED_KEYWORD_SOURCE.UNKNOWN,
        status: TRACKED_KEYWORD_STATUS.ACTIVE,
      }),
    ]);

    addTrackedKeyword(workspaceId, 'legacy keyword', {
      pinned: true,
      source: TRACKED_KEYWORD_SOURCE.MANUAL,
      pagePath: '/legacy',
      pageTitle: 'Legacy',
    });
    storeRankSnapshot(workspaceId, '2026-05-18', [
      { query: 'legacy keyword', position: 8, clicks: 2, impressions: 100, ctr: 0.02 },
    ]);
    storeRankSnapshot(workspaceId, '2026-05-19', [
      { query: 'Legacy Keyword', position: 6, clicks: 4, impressions: 120, ctr: 0.033 },
    ]);

    expect(getLatestRanks(workspaceId)).toEqual([
      expect.objectContaining({
        query: 'legacy keyword',
        position: 6,
        change: 2,
        pinned: true,
        source: TRACKED_KEYWORD_SOURCE.MANUAL,
        pagePath: '/legacy',
      }),
    ]);
    expect(getRankHistory(workspaceId, ['Legacy Keyword'])).toEqual(expect.arrayContaining([
      expect.objectContaining({
        date: '2026-05-19',
        positions: { 'Legacy Keyword': 6 },
      }),
    ]));
  });

  it('preserves legacy unknown tracked keywords instead of retiring them after strategy drift', () => {
    const firstRun = '2026-05-19T10:00:00.000Z';
    const secondRun = '2026-05-20T10:00:00.000Z';
    db.prepare(`
      INSERT INTO rank_tracking_config (workspace_id, tracked_keywords)
      VALUES (?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET tracked_keywords = excluded.tracked_keywords
    `).run(workspaceId, JSON.stringify([{ query: 'Legacy Manual Keyword', addedAt: '2026-05-01T00:00:00.000Z' }]));

    reconcileStrategyRankTracking({
      workspaceId,
      generatedAt: firstRun,
      keywordStrategy: {
        siteKeywords: ['legacy manual keyword'],
        generatedAt: firstRun,
      },
      pageMap: [],
    });

    expect(getTrackedKeywords(workspaceId, { includeInactive: true })).toEqual([
      expect.objectContaining({
        query: 'legacy manual keyword',
        source: TRACKED_KEYWORD_SOURCE.UNKNOWN,
        status: TRACKED_KEYWORD_STATUS.ACTIVE,
      }),
    ]);

    const changeSet = reconcileStrategyRankTracking({
      workspaceId,
      generatedAt: secondRun,
      keywordStrategy: {
        siteKeywords: [],
        generatedAt: secondRun,
      },
      pageMap: [],
    });

    expect(changeSet.manuallyPreserved.map(k => k.query)).toContain('legacy manual keyword');
    expect(changeSet.deprecated.map(k => k.query)).not.toContain('legacy manual keyword');
    expect(getTrackedKeywords(workspaceId)).toEqual([
      expect.objectContaining({
        query: 'legacy manual keyword',
        source: TRACKED_KEYWORD_SOURCE.UNKNOWN,
        status: TRACKED_KEYWORD_STATUS.ACTIVE,
      }),
    ]);
  });

  it('does not downgrade active strategy-owned keywords on duplicate manual adds', () => {
    const generatedAt = '2026-05-19T10:00:00.000Z';
    addTrackedKeyword(workspaceId, 'strategy duplicate keyword', {
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY,
      pagePath: '/strategy-page',
      strategyGeneratedAt: generatedAt,
      lastStrategySeenAt: generatedAt,
    });

    addTrackedKeyword(workspaceId, 'Strategy Duplicate Keyword', {
      source: TRACKED_KEYWORD_SOURCE.MANUAL,
    });

    expect(getTrackedKeywords(workspaceId)).toEqual([
      expect.objectContaining({
        query: 'strategy duplicate keyword',
        source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY,
        pagePath: '/strategy-page',
        strategyGeneratedAt: generatedAt,
        pinned: false,
      }),
    ]);

    reconcileStrategyRankTracking({
      workspaceId,
      generatedAt: '2026-05-20T10:00:00.000Z',
      keywordStrategy: {
        siteKeywords: [],
        generatedAt: '2026-05-20T10:00:00.000Z',
      },
      pageMap: [],
    });

    expect(getTrackedKeywords(workspaceId)).toEqual([]);
    expect(getTrackedKeywords(workspaceId, { includeInactive: true })).toEqual([
      expect.objectContaining({
        query: 'strategy duplicate keyword',
        source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY,
        status: TRACKED_KEYWORD_STATUS.DEPRECATED,
      }),
    ]);
  });

  it('clears page ownership only when a strategy primary keyword becomes site-wide', () => {
    const firstRun = '2026-05-19T10:00:00.000Z';
    const secondRun = '2026-05-20T10:00:00.000Z';
    addTrackedKeyword(workspaceId, 'demoted keyword', {
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY,
      pagePath: '/old-page',
      pageTitle: 'Old Page',
      strategyGeneratedAt: firstRun,
      lastStrategySeenAt: firstRun,
    });

    reconcileStrategyRankTracking({
      workspaceId,
      generatedAt: secondRun,
      keywordStrategy: {
        siteKeywords: ['demoted keyword'],
        generatedAt: secondRun,
      },
      pageMap: [],
    });

    expect(getTrackedKeywords(workspaceId)).toEqual([
      expect.objectContaining({
        query: 'demoted keyword',
        source: TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD,
        lastStrategySeenAt: secondRun,
      }),
    ]);
    const demoted = getTrackedKeywords(workspaceId)[0];
    expect(demoted).not.toHaveProperty('pagePath');
    expect(demoted).not.toHaveProperty('pageTitle');
  });

  it('does not count already-retired strategy keywords as newly retired again', () => {
    const firstRun = '2026-05-19T10:00:00.000Z';
    const secondRun = '2026-05-20T10:00:00.000Z';
    const thirdRun = '2026-05-21T10:00:00.000Z';
    addTrackedKeyword(workspaceId, 'old strategy keyword', {
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD,
      strategyGeneratedAt: firstRun,
      lastStrategySeenAt: firstRun,
    });

    const retired = reconcileStrategyRankTracking({
      workspaceId,
      generatedAt: secondRun,
      keywordStrategy: {
        siteKeywords: [],
        generatedAt: secondRun,
      },
      pageMap: [],
    });

    expect(retired.deprecated.map(k => k.query)).toEqual(['old strategy keyword']);

    const noOp = reconcileStrategyRankTracking({
      workspaceId,
      generatedAt: thirdRun,
      keywordStrategy: {
        siteKeywords: [],
        generatedAt: thirdRun,
      },
      pageMap: [],
    });

    expect(noOp.deprecated).toEqual([]);
    expect(noOp.replaced).toEqual([]);
    expect(noOp.manuallyPreserved.map(k => k.query)).not.toContain('old strategy keyword');
    expect(getTrackedKeywords(workspaceId, { includeInactive: true })).toEqual([
      expect.objectContaining({
        query: 'old strategy keyword',
        status: TRACKED_KEYWORD_STATUS.DEPRECATED,
        deprecatedAt: secondRun,
        lastStrategySeenAt: secondRun,
      }),
    ]);
  });

  it('excludes deprecated strategy keywords from latest rank output', () => {
    addTrackedKeyword(workspaceId, 'old strategy keyword', {
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD,
      status: TRACKED_KEYWORD_STATUS.DEPRECATED,
    });
    storeRankSnapshot(workspaceId, '2026-05-19', [
      { query: 'old strategy keyword', position: 3, clicks: 5, impressions: 100, ctr: 0.05 },
      { query: 'untracked keyword', position: 4, clicks: 2, impressions: 60, ctr: 0.033 },
    ]);

    expect(getLatestRanks(workspaceId)).toEqual([]);
  });

  it('reactivates a retired keyword when it is added again', () => {
    addTrackedKeyword(workspaceId, 'revived keyword', {
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY,
      status: TRACKED_KEYWORD_STATUS.REPLACED,
      replacedBy: 'new keyword',
      deprecatedAt: '2026-05-18T10:00:00.000Z',
    });
    expect(getTrackedKeywords(workspaceId)).toEqual([]);

    addTrackedKeyword(workspaceId, 'Revived Keyword', {
      source: TRACKED_KEYWORD_SOURCE.MANUAL,
    });

    expect(getTrackedKeywords(workspaceId)).toEqual([
      expect.objectContaining({
        query: 'revived keyword',
        source: TRACKED_KEYWORD_SOURCE.MANUAL,
        status: TRACKED_KEYWORD_STATUS.ACTIVE,
      }),
    ]);
    const revived = getTrackedKeywords(workspaceId, { includeInactive: true })[0];
    expect(revived).not.toHaveProperty('replacedBy');
    expect(revived).not.toHaveProperty('deprecatedAt');
  });
});
