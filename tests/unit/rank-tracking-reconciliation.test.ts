import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import {
  addTrackedKeyword,
  getRankHistory,
  getLatestRanks,
  getTrackedKeywords,
  storeRankSnapshot,
} from '../../server/rank-tracking.js';
import { reconcileStrategyRankTracking } from '../../server/rank-tracking-reconciliation.js';
import { replaceAllSiteKeywordMetrics } from '../../server/site-keyword-metrics.js';
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
  it('dedupes tracked keywords with canonical punctuation and spacing variants', () => {
    addTrackedKeyword(workspaceId, 'Emergency Dentist - Near-Me');
    addTrackedKeyword(workspaceId, ' emergency dentist near me ');

    const tracked = getTrackedKeywords(workspaceId, { includeInactive: true });

    expect(tracked).toEqual([
      expect.objectContaining({
        query: 'Emergency Dentist - Near-Me',
        status: TRACKED_KEYWORD_STATUS.ACTIVE,
      }),
    ]);
  });

  it('adds strategy site and page keywords with lifecycle metadata', () => {
    const generatedAt = '2026-05-19T10:00:00.000Z';
    addTrackedKeyword(workspaceId, 'already tracked');
    storeRankSnapshot(workspaceId, '2026-05-19', [
      { query: 'already tracked', position: 2, clicks: 10, impressions: 200, ctr: 0.05 },
      { query: 'Dentist Austin', position: 4, clicks: 9, impressions: 300, ctr: 0.03 },
    ]);

    // siteKeywordMetrics is table-only post-strip — the reconcile join reads it
    // from the site_keyword_metrics table, not off the keywordStrategy Pick.
    replaceAllSiteKeywordMetrics(workspaceId, [{ keyword: 'dentist austin', volume: 900, difficulty: 34 }]);
    const changeSet = reconcileStrategyRankTracking({
      workspaceId,
      generatedAt,
      keywordStrategy: {
        siteKeywords: ['dentist austin'],
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

  it('matches strategy targets and latest ranks across canonical keyword variants', () => {
    const generatedAt = '2026-05-20T11:00:00.000Z';
    addTrackedKeyword(workspaceId, 'Emergency Dentist - Near-Me', {
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY,
      pagePath: '/services/emergency-dentist',
    });
    storeRankSnapshot(workspaceId, '2026-05-20', [
      { query: 'emergency dentist near me', position: 3, clicks: 7, impressions: 180, ctr: 0.038 },
    ]);

    const changeSet = reconcileStrategyRankTracking({
      workspaceId,
      generatedAt,
      keywordStrategy: {
        siteKeywords: [],
        generatedAt,
      },
      pageMap: [
        pageKeyword({
          pagePath: '/services/emergency-dentist',
          pageTitle: 'Emergency Dentist',
          primaryKeyword: 'Emergency Dentist Near Me',
        }),
      ],
    });

    expect(changeSet.retained.map(keyword => keyword.query)).toEqual(['Emergency Dentist - Near-Me']);
    expect(changeSet.added).toEqual([]);
    expect(getTrackedKeywords(workspaceId)).toEqual([
      expect.objectContaining({
        query: 'Emergency Dentist - Near-Me',
        baselinePosition: 3,
        baselineClicks: 7,
        baselineImpressions: 180,
      }),
    ]);
  });

  it('retains, reassigns, replaces, deprecates, and manually preserves tracked keywords', () => {
    const previousRun = '2026-05-01T10:00:00.000Z';
    const generatedAt = '2026-05-19T10:00:00.000Z';
    // Wave 3d-ii: genuine strategy-owned rows seed strategyOwned:true explicitly
    // (reconcile is the real-world writer of it; here we stand in for a prior
    // reconcile so the deprecation/reassign/replace assertions stay meaningful).
    addTrackedKeyword(workspaceId, 'retained keyword', {
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY,
      strategyOwned: true,
      pagePath: '/old-retained',
      strategyGeneratedAt: previousRun,
      lastStrategySeenAt: previousRun,
    });
    addTrackedKeyword(workspaceId, 'reassigned keyword', {
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY,
      strategyOwned: true,
      pagePath: '/old-page',
      strategyGeneratedAt: previousRun,
      lastStrategySeenAt: previousRun,
    });
    addTrackedKeyword(workspaceId, 'old page keyword', {
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY,
      strategyOwned: true,
      pagePath: '/replace-me',
      strategyGeneratedAt: previousRun,
      lastStrategySeenAt: previousRun,
    });
    addTrackedKeyword(workspaceId, 'old site keyword', {
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD,
      strategyOwned: true,
      strategyGeneratedAt: previousRun,
      lastStrategySeenAt: previousRun,
    });
    addTrackedKeyword(workspaceId, 'client requested keyword', {
      source: TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED,
    });
    addTrackedKeyword(workspaceId, 'pinned old strategy keyword', {
      pinned: true,
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY,
      strategyOwned: true,
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


  it('retires strategy-owned noisy keywords after sanitizer removes them from the refreshed strategy', () => {
    const firstRun = '2026-05-19T10:00:00.000Z';
    const secondRun = '2026-05-20T10:00:00.000Z';
    addTrackedKeyword(workspaceId, 'paper tiger', {
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY,
      strategyOwned: true,
      pagePath: '/platform',
      strategyGeneratedAt: firstRun,
      lastStrategySeenAt: firstRun,
    });
    addTrackedKeyword(workspaceId, 'client requested keyword', {
      source: TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED,
    });

    const changeSet = reconcileStrategyRankTracking({
      workspaceId,
      generatedAt: secondRun,
      keywordStrategy: {
        siteKeywords: ['keyword intelligence platform'],
        generatedAt: secondRun,
      },
      pageMap: [
        pageKeyword({
          pagePath: '/platform',
          pageTitle: 'Platform',
          primaryKeyword: 'keyword intelligence platform',
        }),
      ],
    });

    expect(changeSet.replaced.map(k => k.query)).toEqual(['paper tiger']);
    expect(changeSet.manuallyPreserved.map(k => k.query)).toContain('client requested keyword');
    expect(getTrackedKeywords(workspaceId).map(k => k.query)).toEqual(expect.arrayContaining([
      'keyword intelligence platform',
      'client requested keyword',
    ]));
    expect(getTrackedKeywords(workspaceId).map(k => k.query)).not.toContain('paper tiger');
    expect(getTrackedKeywords(workspaceId, { includeInactive: true })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        query: 'paper tiger',
        status: TRACKED_KEYWORD_STATUS.REPLACED,
        replacedBy: 'keyword intelligence platform',
        deprecatedAt: secondRun,
      }),
    ]));
  });

  it('normalizes legacy tracked keyword rows and preserves active rank output metadata', () => {
    // Wave 3c-iii-b: the row table is the SOLE store — seed via the table writer
    // (a legacy UNKNOWN-source keyword) instead of a raw blob INSERT (the blob is no
    // longer read).
    addTrackedKeyword(workspaceId, 'Legacy Keyword', {
      source: TRACKED_KEYWORD_SOURCE.UNKNOWN,
    });

    expect(getTrackedKeywords(workspaceId)).toEqual([
      expect.objectContaining({
        query: 'Legacy Keyword',
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
        query: 'Legacy Keyword',
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

  it('preserves a legacy unknown keyword that is NOT a current strategy target (reconcile never owned it)', () => {
    // Wave 3d-ii: ownership is established ONLY by reconcile, and ONLY for keywords
    // that match a current target. A legacy UNKNOWN keyword that is NOT a target is
    // never marked strategyOwned, so it is manually preserved across drift — the
    // conservative default (strategy_owned NULL is never auto-deprecated).
    const firstRun = '2026-05-19T10:00:00.000Z';
    const secondRun = '2026-05-20T10:00:00.000Z';
    // Wave 3c-iii-b: seed the legacy UNKNOWN keyword via the table writer (the blob
    // is no longer a store). UNKNOWN source + no strategyOwned = the realistic
    // "ownership unknown, not a strategy target" case this test exercises.
    addTrackedKeyword(workspaceId, 'Legacy Manual Keyword', {
      source: TRACKED_KEYWORD_SOURCE.UNKNOWN,
    });

    // First reconcile: the legacy keyword is NOT among the targets, so reconcile
    // leaves it untouched (manually preserved) and never establishes ownership.
    const firstChange = reconcileStrategyRankTracking({
      workspaceId,
      generatedAt: firstRun,
      keywordStrategy: {
        siteKeywords: ['some other site keyword'],
        generatedAt: firstRun,
      },
      pageMap: [],
    });
    expect(firstChange.manuallyPreserved.map(k => k.query)).toContain('Legacy Manual Keyword');

    expect(getTrackedKeywords(workspaceId, { includeInactive: true })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        query: 'Legacy Manual Keyword',
        source: TRACKED_KEYWORD_SOURCE.UNKNOWN,
        status: TRACKED_KEYWORD_STATUS.ACTIVE,
      }),
    ]));

    // Second reconcile with a different target set: still never a target, still
    // manually preserved, never deprecated.
    const changeSet = reconcileStrategyRankTracking({
      workspaceId,
      generatedAt: secondRun,
      keywordStrategy: {
        siteKeywords: [],
        generatedAt: secondRun,
      },
      pageMap: [],
    });

    expect(changeSet.manuallyPreserved.map(k => k.query)).toContain('Legacy Manual Keyword');
    expect(changeSet.deprecated.map(k => k.query)).not.toContain('Legacy Manual Keyword');
    expect(getTrackedKeywords(workspaceId)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        query: 'Legacy Manual Keyword',
        source: TRACKED_KEYWORD_SOURCE.UNKNOWN,
        status: TRACKED_KEYWORD_STATUS.ACTIVE,
      }),
    ]));
  });

  it('OWNS a legacy unknown keyword once it matches a current strategy target, then deprecates it on drift', () => {
    // Wave 3d-ii reconcile-sets-it: a legacy UNKNOWN keyword that IS a declared
    // current site-keyword target is a genuine strategy target — reconcile adopts
    // the strategy source and establishes ownership (strategyOwned=true). When it
    // later drifts off the targets, reconcile (the now-owner) deprecates it. This
    // is the intended decoupled-ownership behavior, NOT the old source-conflation.
    const firstRun = '2026-05-19T10:00:00.000Z';
    const secondRun = '2026-05-20T10:00:00.000Z';
    // Wave 3c-iii-b: seed the legacy UNKNOWN keyword via the table writer (the blob
    // is no longer a store). The display form differs in case from the strategy
    // target ('adopted keyword') to exercise the canonical-variant match below.
    addTrackedKeyword(workspaceId, 'Adopted Keyword', {
      source: TRACKED_KEYWORD_SOURCE.UNKNOWN,
    });

    reconcileStrategyRankTracking({
      workspaceId,
      generatedAt: firstRun,
      keywordStrategy: { siteKeywords: ['adopted keyword'], generatedAt: firstRun },
      pageMap: [],
    });

    // Adopted the strategy source (existing was UNKNOWN) and is now active.
    expect(getTrackedKeywords(workspaceId)).toEqual([
      expect.objectContaining({
        query: 'Adopted Keyword',
        source: TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD,
        status: TRACKED_KEYWORD_STATUS.ACTIVE,
      }),
    ]);

    const changeSet = reconcileStrategyRankTracking({
      workspaceId,
      generatedAt: secondRun,
      keywordStrategy: { siteKeywords: [], generatedAt: secondRun },
      pageMap: [],
    });

    expect(changeSet.deprecated.map(k => k.query)).toContain('Adopted Keyword');
    expect(getTrackedKeywords(workspaceId, { includeInactive: true })).toEqual([
      expect.objectContaining({
        query: 'Adopted Keyword',
        status: TRACKED_KEYWORD_STATUS.DEPRECATED,
        deprecatedAt: secondRun,
      }),
    ]);
  });

  it('does not downgrade active strategy-owned keywords on duplicate manual adds', () => {
    const generatedAt = '2026-05-19T10:00:00.000Z';
    addTrackedKeyword(workspaceId, 'strategy duplicate keyword', {
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY,
      strategyOwned: true,
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

  it('clears page ownership when a strategy primary keyword becomes site-wide (source no longer laundered)', () => {
    const firstRun = '2026-05-19T10:00:00.000Z';
    const secondRun = '2026-05-20T10:00:00.000Z';
    addTrackedKeyword(workspaceId, 'demoted keyword', {
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY,
      strategyOwned: true,
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

    // Wave 3d-ii: page ownership (pagePath/pageTitle) is STILL cleared when the
    // incoming target is a site keyword — that is driven by the TARGET source, not
    // the keyword's own. But mergeTarget no longer OVERWRITES the keyword's existing
    // source enum (de-laundering), so it stays STRATEGY_PRIMARY. Ownership is carried
    // by strategyOwned, which the merge keeps true.
    expect(getTrackedKeywords(workspaceId)).toEqual([
      expect.objectContaining({
        query: 'demoted keyword',
        source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY,
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
      strategyOwned: true,
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
