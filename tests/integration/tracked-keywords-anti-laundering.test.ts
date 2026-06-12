/**
 * Integration tests — Wave 3d-ii: DECOUPLE strategy-ownership from the source enum.
 *
 * THE BUG (fixed here): a client approving a page_map / topic_cluster keyword used
 * to be LAUNDERED into a STRATEGY_* source. reconcile then read ownership off the
 * source enum, saw "strategy-owned", and — because the client keyword was not a
 * current strategy target — FORCE-DEPRECATED it on the next reconcile. Client data
 * was silently destroyed on every reconcile.
 *
 * THE FIX: ownership is now carried by a decoupled `strategyOwned` flag (table
 * column `strategy_owned`, three-state 0/1/NULL) of which reconcile is the SOLE
 * writer of =1. de-laundering keeps page_map/topic_cluster approvals as
 * CLIENT_REQUESTED (protected). reconcile auto-deprecation fires ONLY on
 * strategyOwned===true && unprotected.
 *
 * Coverage:
 *  (A) ANTI-LAUNDERING — approve a page_map-origin AND a topic_cluster-origin
 *      client keyword (approved, not pinned), run a reconcile whose targets EXCLUDE
 *      them → both stay ACTIVE, source===CLIENT_REQUESTED (not STRATEGY_*),
 *      strategyOwned falsy.
 *  (B) strategyOwned ROUND-TRIP + reconcile-sets-it — add a keyword without
 *      strategyOwned → reconcile where it IS a target → strategyOwned===true
 *      persisted → reconcile where it is removed → deprecated.
 *  (C) IN_STRATEGY count stable across the inference retire — a genuine strategy
 *      keyword counts toward IN_STRATEGY; a de-laundered client keyword does not
 *      inflate it.
 *
 * In-process domain test (no HTTP): createEphemeralTestContext only bootstraps an isolated
 * DATA_DIR; the assertions drive the real domain functions against the same DB
 * (the better-sqlite3 singleton uses DATA_DIR/dashboard.db). Mirrors
 * tracked-keywords-concurrency.test.ts.
 *
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));
const ctx = createEphemeralTestContext(import.meta.url);

let workspaceId = '';

beforeAll(async () => {
  await ctx.startServer();
}, 40_000);

afterAll(async () => {
  await ctx.stopServer();
});

beforeEach(async () => {
  const { createWorkspace } = await import('../../server/workspaces.js');
  workspaceId = createWorkspace(`AntiLaunder ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).id;
});

describe('Wave 3d-ii anti-laundering: client page_map/topic_cluster approvals survive reconcile', () => {
  it('keeps page_map + topic_cluster client approvals ACTIVE, CLIENT_REQUESTED, not strategy-owned, across an excluding reconcile', async () => {
    const { saveKeywordFeedback } = await import('../../server/keyword-feedback.js');
    const { reconcileStrategyRankTracking } = await import('../../server/rank-tracking-reconciliation.js');
    const { listTrackedKeywordRows } = await import('../../server/tracked-keywords-store.js');
    const { getTrackedKeywords } = await import('../../server/rank-tracking.js');
    const { TRACKED_KEYWORD_SOURCE, TRACKED_KEYWORD_STATUS } = await import('../../shared/types/rank-tracking.js');
    const { keywordComparisonKey } = await import('../../shared/keyword-normalization.js');

    const pageMapKeyword = 'whitening client request';
    const topicClusterKeyword = 'veneers client request';

    // Client approves both — via the page_map and topic_cluster surfaces (the ones
    // that used to be laundered into STRATEGY_*).
    saveKeywordFeedback({ workspaceId, keyword: pageMapKeyword, status: 'approved', source: 'page_map' });
    saveKeywordFeedback({ workspaceId, keyword: topicClusterKeyword, status: 'approved', source: 'topic_cluster' });

    // Pre-condition: stored as CLIENT_REQUESTED (de-laundered), not STRATEGY_*.
    const afterApprove = new Map(
      listTrackedKeywordRows(workspaceId).map(k => [keywordComparisonKey(k.query), k]),
    );
    const pmRow = afterApprove.get(keywordComparisonKey(pageMapKeyword));
    const tcRow = afterApprove.get(keywordComparisonKey(topicClusterKeyword));
    expect(pmRow?.source).toBe(TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED);
    expect(tcRow?.source).toBe(TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED);
    expect(pmRow?.pinned).toBe(false);
    expect(tcRow?.pinned).toBe(false);
    // Ownership unknown — never strategy-owned by approval.
    expect(pmRow?.strategyOwned).toBeFalsy();
    expect(tcRow?.strategyOwned).toBeFalsy();

    // Run a reconcile whose targets EXCLUDE both client keywords entirely.
    const generatedAt = '2026-06-04T10:00:00.000Z';
    reconcileStrategyRankTracking({
      workspaceId,
      generatedAt,
      keywordStrategy: { siteKeywords: ['something else entirely'], generatedAt },
      pageMap: [
        {
          pagePath: '/services/implants',
          pageTitle: 'Dental Implants',
          primaryKeyword: 'dental implants unrelated',
          secondaryKeywords: [],
        },
      ],
    });

    // BOTH client keywords MUST survive: active, still CLIENT_REQUESTED, never
    // strategy-owned. This is the data-destruction regression the PR fixes.
    const after = new Map(
      listTrackedKeywordRows(workspaceId).map(k => [keywordComparisonKey(k.query), k]),
    );
    const pmAfter = after.get(keywordComparisonKey(pageMapKeyword));
    const tcAfter = after.get(keywordComparisonKey(topicClusterKeyword));

    for (const row of [pmAfter, tcAfter]) {
      expect(row).toBeDefined();
      expect(row!.status).toBe(TRACKED_KEYWORD_STATUS.ACTIVE);
      expect(row!.source).toBe(TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED);
      expect(row!.source).not.toBe(TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY);
      expect(row!.source).not.toBe(TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD);
      expect(row!.strategyOwned).toBeFalsy();
    }

    // And they remain visible in the active public read.
    const activeQueries = getTrackedKeywords(workspaceId).map(k => keywordComparisonKey(k.query));
    expect(activeQueries).toContain(keywordComparisonKey(pageMapKeyword));
    expect(activeQueries).toContain(keywordComparisonKey(topicClusterKeyword));
  });
});

describe('Wave 3d-ii strategyOwned round-trip + reconcile-sets-it', () => {
  it('reconcile establishes strategyOwned=true for a genuine target and deprecates it on drift', async () => {
    const { addTrackedKeyword, getTrackedKeywords } = await import('../../server/rank-tracking.js');
    const { reconcileStrategyRankTracking } = await import('../../server/rank-tracking-reconciliation.js');
    const { listTrackedKeywordRows } = await import('../../server/tracked-keywords-store.js');
    const { TRACKED_KEYWORD_SOURCE, TRACKED_KEYWORD_STATUS } = await import('../../shared/types/rank-tracking.js');
    const { keywordComparisonKey } = await import('../../shared/keyword-normalization.js');

    const keyword = 'reconcile owned keyword';

    // Wave 3c-iii-b: seed via the TABLE writer (the blob is no longer a store). Add
    // WITHOUT strategyOwned, as an un-provenanced (UNKNOWN-source) tracked keyword —
    // the realistic "ownership unknown, not protected" case (a plain manual add would
    // default to MANUAL source, which is hard-protected and intentionally never owned).
    // The first reconcile's RMW reads the FULL ROW from the table, adopts the strategy
    // source, sets strategyOwned=true, and re-persists the table.
    addTrackedKeyword(workspaceId, keyword, { source: TRACKED_KEYWORD_SOURCE.UNKNOWN });
    const seeded = getTrackedKeywords(workspaceId, { includeInactive: true }).find(
      k => keywordComparisonKey(k.query) === keywordComparisonKey(keyword),
    );
    expect(seeded).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(seeded!, 'strategyOwned')).toBe(false);

    // Reconcile where it IS a target → strategyOwned===true is PERSISTED to the table.
    const firstRun = '2026-06-04T10:00:00.000Z';
    reconcileStrategyRankTracking({
      workspaceId,
      generatedAt: firstRun,
      keywordStrategy: { siteKeywords: [keyword], generatedAt: firstRun },
      pageMap: [],
    });
    const owned = listTrackedKeywordRows(workspaceId).find(
      k => keywordComparisonKey(k.query) === keywordComparisonKey(keyword),
    );
    expect(owned!.strategyOwned).toBe(true);
    expect(owned!.status).toBe(TRACKED_KEYWORD_STATUS.ACTIVE);

    // Reconcile where it is REMOVED → reconcile (now the owner) deprecates it.
    const secondRun = '2026-06-05T10:00:00.000Z';
    const changeSet = reconcileStrategyRankTracking({
      workspaceId,
      generatedAt: secondRun,
      keywordStrategy: { siteKeywords: [], generatedAt: secondRun },
      pageMap: [],
    });
    expect(changeSet.deprecated.map(k => keywordComparisonKey(k.query)))
      .toContain(keywordComparisonKey(keyword));

    const deprecated = listTrackedKeywordRows(workspaceId).find(
      k => keywordComparisonKey(k.query) === keywordComparisonKey(keyword),
    );
    expect(deprecated!.status).toBe(TRACKED_KEYWORD_STATUS.DEPRECATED);
    expect(deprecated!.deprecatedAt).toBe(secondRun);
    // Still strategy-owned (it WAS reconcile's, now retired) — ownership is sticky.
    expect(deprecated!.strategyOwned).toBe(true);

    // strategyOwned is TABLE-ONLY: the public/stripped read must NOT carry it.
    const publicRows = getTrackedKeywords(workspaceId, { includeInactive: true });
    for (const row of publicRows) {
      expect(Object.prototype.hasOwnProperty.call(row, 'strategyOwned')).toBe(false);
    }
  });
});

describe('Wave 3d-ii IN_STRATEGY count stable across the inference retire', () => {
  it('counts a reconcile-owned strategy keyword as In Strategy via strategyOwned (not the source enum)', async () => {
    const { reconcileStrategyRankTracking } = await import('../../server/rank-tracking-reconciliation.js');
    const { buildKeywordCommandCenterSummary, buildKeywordCommandCenterRows, trackedKeywordMatchesFilter } =
      await import('../../server/keyword-command-center.js');
    const { listTrackedKeywordRows } = await import('../../server/tracked-keywords-store.js');
    const { KEYWORD_COMMAND_CENTER_FILTERS } = await import('../../shared/types/keyword-command-center.js');
    const { keywordComparisonKey } = await import('../../shared/keyword-normalization.js');

    const strategyKeyword = 'genuine strategy site keyword';

    // Establish a genuine strategy-owned keyword via reconcile (sets strategyOwned=true).
    const generatedAt = '2026-06-04T10:00:00.000Z';
    reconcileStrategyRankTracking({
      workspaceId,
      generatedAt,
      keywordStrategy: { siteKeywords: [strategyKeyword], generatedAt },
      pageMap: [],
    });

    const ownedRow = listTrackedKeywordRows(workspaceId).find(
      k => keywordComparisonKey(k.query) === keywordComparisonKey(strategyKeyword),
    );
    expect(ownedRow?.strategyOwned).toBe(true);
    // The filter now keys on strategyOwned (decoupled from source). The table-bearing
    // row matches IN_STRATEGY; this is the classification path KCC uses post-retire.
    expect(trackedKeywordMatchesFilter(ownedRow!, KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY)).toBe(true);

    // The summary count (built without the retired read-time inference) still counts
    // the strategy keyword as In Strategy — proving the retire did not regress the count.
    const summary = await buildKeywordCommandCenterSummary(workspaceId, { includeLocalSeo: false });
    expect(summary).not.toBeNull();
    expect(summary!.counts.inStrategy).toBeGreaterThanOrEqual(1);

    // And the rows table classifies it IN_STRATEGY too (lifecycleStatus reads strategyOwned).
    const rows = await buildKeywordCommandCenterRows(
      workspaceId,
      { filter: KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY },
      { includeLocalSeo: false },
    );
    expect(rows).not.toBeNull();
    expect(rows!.rows.some(r => keywordComparisonKey(r.keyword) === keywordComparisonKey(strategyKeyword))).toBe(true);
  });
});
