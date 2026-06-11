/**
 * A4 — Keyword-level outcome bridge (audit #15)
 *
 * 1. Hub lifecycle actions (TRACK / PROMOTE_EVIDENCE / ADD_TO_STRATEGY) record a
 *    tracked outcome action through B2's contract point
 *    (applyKeywordCommandCenterAction), reusing A3's strategy_page_keyword
 *    sourceType + strategyPageKeywordSourceId() key so re-applying the same
 *    action never duplicates.
 * 2. Keyword actions are scored against rank_snapshots (keyword-level position),
 *    not page-aggregate GSC.
 * 3. FM-2: missing or stale rank snapshots → `inconclusive`, never fabricated.
 * 4. Inherited A3-review fix: a search-metric action whose baseline lacks the
 *    PRIMARY metric scores `inconclusive` (never a loss vs phantom position 0),
 *    regardless of other baseline fields.
 * 5. Inherited A3-review fix: a permanently-unmeasurable strategy-level action
 *    (baseline {captured_at} only, no pageUrl, no targetKeyword) exits the
 *    measurement queue at its FIRST due checkpoint instead of emitting
 *    inconclusive at every checkpoint until day 90.
 * 6. The client trend card's actual read path:
 *    GET /api/public/rank-tracking/:id/history?limit=180&query=…
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { applyKeywordCommandCenterAction } from '../../server/keyword-command-center.js';
import { storeRankSnapshot } from '../../server/rank-tracking.js';
import {
  getActionByWorkspaceAndSource,
  getActionsByWorkspace,
  getOutcomesForAction,
  recordAction,
  STRATEGY_PAGE_KEYWORD_SOURCE_TYPE,
  strategyPageKeywordSourceId,
} from '../../server/outcome-tracking.js';
import {
  readKeywordRankSnapshot,
  recordKeywordTrackingAction,
} from '../../server/outcome-measurement-keywords.js';
import { measurePendingOutcomes } from '../../server/outcome-measurement.js';
import { setBroadcast } from '../../server/broadcast.js';
import db from '../../server/db/index.js';
import type { TrackedAction } from '../../shared/types/outcome-tracking.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api } = ctx;

const workspaceIdsToCleanup: string[] = [];

beforeAll(async () => {
  await ctx.startServer();
}, 60_000);

afterAll(async () => {
  for (const id of workspaceIdsToCleanup) deleteWorkspace(id);
  await ctx.stopServer();
});

beforeEach(() => {
  // Lifecycle actions + recordOutcome broadcast — the singleton must be set.
  setBroadcast(vi.fn(), vi.fn());
});

function makeWorkspace(label: string) {
  const ws = createWorkspace(`A4 Keyword Outcome Bridge ${label} ${Date.now()}`);
  workspaceIdsToCleanup.push(ws.id);
  return ws;
}

function isoDateDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function backdateAction(actionId: string, days: number): void {
  db.prepare('UPDATE tracked_actions SET created_at = ? WHERE id = ?') // txn-ok ws-scope-ok: test helper backdating a single action by its unique id
    .run(new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(), actionId);
}

function keywordActions(workspaceId: string): TrackedAction[] {
  return getActionsByWorkspace(workspaceId)
    .filter(a => a.sourceType === STRATEGY_PAGE_KEYWORD_SOURCE_TYPE);
}

describe('Hub lifecycle actions enter outcome tracking (B2 contract point)', () => {
  it('TRACK records a tracked action with A3 key shape and a rank-snapshot baseline', () => {
    const ws = makeWorkspace('track');
    storeRankSnapshot(ws.id, isoDateDaysAgo(1), [
      { query: 'emergency plumber austin', position: 18, clicks: 4, impressions: 220, ctr: 1.8 },
    ]);

    const result = applyKeywordCommandCenterAction(ws.id, {
      action: 'track',
      keyword: 'Emergency Plumber Austin',
    });
    expect(result.ok).toBe(true);

    const actions = keywordActions(ws.id);
    expect(actions).toHaveLength(1);
    const action = actions[0];
    expect(action.actionType).toBe('strategy_keyword_added');
    expect(action.sourceId).toBe(strategyPageKeywordSourceId('', 'Emergency Plumber Austin'));
    expect(action.targetKeyword).toBe('Emergency Plumber Austin');
    expect(action.attribution).toBe('platform_executed');
    expect(action.sourceFlag).toBe('live');
    // Baseline captured from the fresh rank snapshot — keyword-level position.
    expect(action.baselineSnapshot.position).toBe(18);
    expect(action.baselineConfidence).toBe('exact');
  });

  it('re-applying TRACK for the same keyword is idempotent (no duplicate action)', () => {
    const ws = makeWorkspace('idempotent');
    applyKeywordCommandCenterAction(ws.id, { action: 'track', keyword: 'best running shoes' });
    applyKeywordCommandCenterAction(ws.id, { action: 'track', keyword: 'Best Running Shoes' });
    expect(keywordActions(ws.id)).toHaveLength(1);
  });

  it('ADD_TO_STRATEGY records an action keyed by (pagePath, keyword) and survives a decline → re-add round trip without duplicating', () => {
    const ws = makeWorkspace('add-to-strategy');
    applyKeywordCommandCenterAction(ws.id, {
      action: 'add_to_strategy',
      keyword: 'water heater repair',
      pagePath: '/services/water-heater-repair',
    });

    const sourceId = strategyPageKeywordSourceId('/services/water-heater-repair', 'water heater repair');
    const action = getActionByWorkspaceAndSource(ws.id, STRATEGY_PAGE_KEYWORD_SOURCE_TYPE, sourceId);
    expect(action).toBeTruthy();
    expect(action!.pageUrl).toBe('/services/water-heater-repair');
    // No snapshot data → metrics-empty baseline, honestly flagged as estimated.
    expect(action!.baselineSnapshot.position).toBeUndefined();
    expect(action!.baselineConfidence).toBe('estimated');

    applyKeywordCommandCenterAction(ws.id, { action: 'decline', keyword: 'water heater repair', force: true });
    applyKeywordCommandCenterAction(ws.id, {
      action: 'add_to_strategy',
      keyword: 'water heater repair',
      pagePath: '/services/water-heater-repair',
    });
    expect(keywordActions(ws.id)).toHaveLength(1);
  });

  it('ADD_TO_STRATEGY without a pagePath stores no /planned/ pageUrl on the action', () => {
    const ws = makeWorkspace('planned');
    applyKeywordCommandCenterAction(ws.id, { action: 'add_to_strategy', keyword: 'tankless water heaters' });
    const actions = keywordActions(ws.id);
    expect(actions).toHaveLength(1);
    // The /planned/<slug> placeholder is not a live URL — nothing for the
    // page-level GSC machinery to fetch (mirrors A3's planned-page rule).
    expect(actions[0].pageUrl).toBeNull();
  });
});

describe('readKeywordRankSnapshot (rank-snapshot reader, FM-2)', () => {
  it('returns the freshest keyword-level position stamped with the snapshot date', () => {
    const ws = makeWorkspace('reader');
    storeRankSnapshot(ws.id, isoDateDaysAgo(5), [
      { query: 'kayak rentals', position: 22, clicks: 1, impressions: 80, ctr: 1.2 },
    ]);
    storeRankSnapshot(ws.id, isoDateDaysAgo(2), [
      { query: 'kayak rentals', position: 14, clicks: 3, impressions: 120, ctr: 2.5 },
    ]);
    const snapshot = readKeywordRankSnapshot(ws.id, 'kayak rentals');
    expect(snapshot).toBeTruthy();
    expect(snapshot!.position).toBe(14);
    expect(snapshot!.captured_at.slice(0, 10)).toBe(isoDateDaysAgo(2));
  });

  it('returns null when there is no snapshot for the keyword', () => {
    const ws = makeWorkspace('reader-missing');
    expect(readKeywordRankSnapshot(ws.id, 'unknown keyword')).toBeNull();
  });

  it('returns null when the newest reading is stale (>14 days)', () => {
    const ws = makeWorkspace('reader-stale');
    storeRankSnapshot(ws.id, isoDateDaysAgo(20), [
      { query: 'stale keyword', position: 9, clicks: 2, impressions: 100, ctr: 2.0 },
    ]);
    expect(readKeywordRankSnapshot(ws.id, 'stale keyword')).toBeNull();
  });
});

describe('keyword actions scored against rank_snapshots on schedule', () => {
  it('scores a real outcome when the keyword improved between baseline and a fresh snapshot', async () => {
    const ws = makeWorkspace('scored');
    // Baseline snapshot at track time: position 18.
    storeRankSnapshot(ws.id, isoDateDaysAgo(1), [
      { query: 'metal roofing cost', position: 18, clicks: 2, impressions: 150, ctr: 1.3 },
    ]);
    applyKeywordCommandCenterAction(ws.id, { action: 'track', keyword: 'metal roofing cost' });
    const action = keywordActions(ws.id)[0];
    expect(action.baselineSnapshot.position).toBe(18);

    // 31 days later the keyword ranks 9 — a 50% position improvement
    // (strategy_keyword_added strong_win threshold is 10%).
    backdateAction(action.id, 31);
    storeRankSnapshot(ws.id, isoDateDaysAgo(0), [
      { query: 'metal roofing cost', position: 9, clicks: 11, impressions: 300, ctr: 3.7 },
    ]);

    await measurePendingOutcomes();

    const outcomes = getOutcomesForAction(action.id);
    const day30 = outcomes.find(o => o.checkpointDays === 30);
    expect(day30).toBeTruthy();
    expect(day30!.score).toBe('strong_win');
    expect(day30!.deltaSummary.primary_metric).toBe('position');
    expect(day30!.deltaSummary.baseline_value).toBe(18);
    expect(day30!.deltaSummary.current_value).toBe(9);
    expect(day30!.deltaSummary.direction).toBe('improved');
  });

  it('FM-2: scores inconclusive when the rank snapshots disappear (never fabricated)', async () => {
    const ws = makeWorkspace('fm2-missing');
    storeRankSnapshot(ws.id, isoDateDaysAgo(1), [
      { query: 'gutter cleaning', position: 12, clicks: 5, impressions: 200, ctr: 2.5 },
    ]);
    applyKeywordCommandCenterAction(ws.id, { action: 'track', keyword: 'gutter cleaning' });
    const action = keywordActions(ws.id)[0];
    expect(action.baselineSnapshot.position).toBe(12);

    backdateAction(action.id, 31);
    db.prepare('DELETE FROM rank_snapshots WHERE workspace_id = ?').run(ws.id); // txn-ok: single-statement test cleanup

    await measurePendingOutcomes();

    const outcomes = getOutcomesForAction(action.id);
    expect(outcomes.length).toBeGreaterThan(0);
    for (const outcome of outcomes) {
      expect(outcome.score === 'inconclusive' || outcome.score === null).toBe(true);
    }
  });

  it('FM-2: a stale snapshot (>14 days old) is treated as missing → inconclusive', async () => {
    const ws = makeWorkspace('fm2-stale');
    storeRankSnapshot(ws.id, isoDateDaysAgo(1), [
      { query: 'fence installation', position: 15, clicks: 3, impressions: 180, ctr: 1.7 },
    ]);
    applyKeywordCommandCenterAction(ws.id, { action: 'track', keyword: 'fence installation' });
    const action = keywordActions(ws.id)[0];

    backdateAction(action.id, 31);
    // Age the only snapshot far past the freshness window.
    db.prepare('UPDATE rank_snapshots SET date = ? WHERE workspace_id = ?') // txn-ok: single-statement test setup, ws-scoped
      .run(isoDateDaysAgo(25), ws.id);

    await measurePendingOutcomes();

    const day30 = getOutcomesForAction(action.id).find(o => o.checkpointDays === 30);
    expect(day30).toBeTruthy();
    expect(day30!.score).toBe('inconclusive');
  });

  it('partial baseline (clicks present, position absent) scores inconclusive, NOT a loss', async () => {
    const ws = makeWorkspace('partial-baseline');
    // Record a keyword action whose baseline carries clicks/impressions but NO
    // position — pre-fix, computeDelta read the missing baseline position as 0
    // and a current position of 12 fabricated a "decline" → loss.
    const action = recordAction({ // recordAction-ok: ws.id is workspaceId
      workspaceId: ws.id,
      actionType: 'strategy_keyword_added',
      sourceType: STRATEGY_PAGE_KEYWORD_SOURCE_TYPE,
      sourceId: strategyPageKeywordSourceId('/services/landscaping', 'landscaping services'),
      pageUrl: '/services/landscaping',
      targetKeyword: 'landscaping services',
      baselineSnapshot: { captured_at: new Date().toISOString(), clicks: 40, impressions: 900 },
      attribution: 'platform_executed',
    });
    backdateAction(action.id, 31);
    storeRankSnapshot(ws.id, isoDateDaysAgo(0), [
      { query: 'landscaping services', position: 12, clicks: 30, impressions: 800, ctr: 3.8 },
    ]);

    await measurePendingOutcomes();

    const day30 = getOutcomesForAction(action.id).find(o => o.checkpointDays === 30);
    expect(day30).toBeTruthy();
    expect(day30!.score).toBe('inconclusive');
    expect(day30!.score).not.toBe('loss');
  });
});

describe('permanently-unmeasurable strategy-level actions exit the queue early', () => {
  it('records ONE inconclusive outcome at the first due checkpoint and marks the action complete', async () => {
    const ws = makeWorkspace('short-circuit');
    // Strategy-level action shape (A3): {captured_at}-only baseline, no pageUrl,
    // no targetKeyword — nothing can ever become measurable.
    const action = recordAction({ // recordAction-ok: ws.id is workspaceId
      workspaceId: ws.id,
      actionType: 'strategy_keyword_added',
      sourceType: 'strategy',
      sourceId: ws.id,
      pageUrl: null,
      targetKeyword: null,
      baselineSnapshot: { captured_at: new Date().toISOString() },
      attribution: 'platform_executed',
    });
    // 65 days old — checkpoints 7, 30 AND 60 are all due. Pre-fix this emitted
    // three inconclusive outcomes and stayed pending until day 90.
    backdateAction(action.id, 65);

    await measurePendingOutcomes();

    const outcomes = getOutcomesForAction(action.id);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].checkpointDays).toBe(7);
    expect(outcomes[0].score).toBe('inconclusive');
    const row = db.prepare('SELECT measurement_complete FROM tracked_actions WHERE id = ?') // txn-ok ws-scope-ok: test assertion by unique id
      .get(action.id) as { measurement_complete: number };
    expect(row.measurement_complete).toBe(1);
  });

  it('a measurable keyword action is NOT short-circuited', async () => {
    const ws = makeWorkspace('no-short-circuit');
    storeRankSnapshot(ws.id, isoDateDaysAgo(1), [
      { query: 'pool maintenance', position: 20, clicks: 1, impressions: 90, ctr: 1.1 },
    ]);
    const result = recordKeywordTrackingAction({ workspaceId: ws.id, keyword: 'pool maintenance' });
    expect(result).toBeTruthy();
    backdateAction(result!.id, 8);

    await measurePendingOutcomes();

    const row = db.prepare('SELECT measurement_complete FROM tracked_actions WHERE id = ?') // txn-ok ws-scope-ok: test assertion by unique id
      .get(result!.id) as { measurement_complete: number };
    expect(row.measurement_complete).toBe(0);
  });
});

describe('client trend card read path (public rank history, 180d)', () => {
  it('GET /api/public/rank-tracking/:id/history?limit=180&query=… returns the requested keyword series', async () => {
    const ws = makeWorkspace('public-read');
    storeRankSnapshot(ws.id, isoDateDaysAgo(2), [
      { query: 'requested keyword', position: 25, clicks: 0, impressions: 40, ctr: 0 },
      { query: 'other keyword', position: 5, clicks: 9, impressions: 400, ctr: 2.2 },
    ]);
    storeRankSnapshot(ws.id, isoDateDaysAgo(1), [
      { query: 'requested keyword', position: 19, clicks: 1, impressions: 70, ctr: 1.4 },
    ]);

    const res = await api(`/api/public/rank-tracking/${ws.id}/history?limit=180&query=${encodeURIComponent('requested keyword')}`);
    expect(res.status).toBe(200);
    const history = await res.json() as Array<{ date: string; positions: Record<string, number> }>;
    expect(history).toHaveLength(2);
    expect(history[0].positions['requested keyword']).toBe(25);
    expect(history[1].positions['requested keyword']).toBe(19);
    // Filtered to the requested keyword only.
    expect(history[0].positions['other keyword']).toBeUndefined();
  });
});
