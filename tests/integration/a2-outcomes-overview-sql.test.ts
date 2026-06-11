/**
 * A2 — Outcomes overview aggregate SQL parity test (audit #10)
 *
 * Verifies that the refactored GET /api/outcomes/overview endpoint (which uses
 * aggregate SQL readers instead of per-action loops) returns byte-identical JSON
 * to the documented expected values across two divergent workspaces:
 *
 * Workspace A: 3 actions, 2 wins (all platform_executed), 1 scored outside 30d window
 * Workspace B: 4 actions including 1 not_acted_on win, 1 inconclusive, 1 pending
 *
 * Key parity assertions:
 * - winRate includes not_acted_on in denominator/numerator (matches computeScorecard loop)
 * - scoredLast30d counts ANY outcome measured within 30d (including inconclusive)
 * - topWin excludes not_acted_on (per A1 — getTopWinsForWorkspace filters them)
 * - workspace isolation: ws_a values don't bleed into ws_b
 *
 * Port: 13906 (range 13906–13909)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import db from '../../server/db/index.js';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { recordAction, recordOutcome } from '../../server/outcome-tracking.js';

process.env.FEATURE_OUTCOME_TRACKING = 'true';

// port-ok: 13906 next free after 13905 (see tests/meta-port-uniqueness.test.ts)
const ctx = createTestContext(13906);
const { api } = ctx;

let wsA = '';
let wsB = '';

// Timestamps for fixture outcomes
const NOW = new Date().toISOString();
const FIVE_DAYS_AGO = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
const THIRTY_FIVE_DAYS_AGO = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
const TWO_DAYS_AGO = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
const THREE_DAYS_AGO = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

const BASELINE = {
  captured_at: '2026-01-01T00:00:00Z',
  position: 20,
  clicks: 5,
  impressions: 200,
};
const DELTA = {
  primary_metric: 'position' as const,
  baseline_value: 20,
  current_value: 2,
  delta_absolute: -18,
  delta_percent: -90,
  direction: 'improved' as const,
};

/**
 * Seeds a tracked action + outcome with explicit measured_at timestamp.
 * We write the outcome row directly to DB so we can control measured_at
 * (recordOutcome always uses new Date() which we can't control in tests).
 */
function seedActionWithOutcome(
  workspaceId: string,
  attribution: string,
  score: string | null,
  measuredAt: string | null,
  idx: number,
): string {
  const action = recordAction({
    workspaceId,
    actionType: 'content_published',
    sourceType: 'post',
    sourceId: `a2-parity-${workspaceId}-${idx}`,
    pageUrl: `/page-${workspaceId}-${idx}`,
    targetKeyword: `kw-a2-${idx}`,
    baselineSnapshot: BASELINE,
    attribution: attribution as Parameters<typeof recordAction>[0]['attribution'],
    sourceFlag: 'live',
    baselineConfidence: 'exact',
  });

  if (score !== null && measuredAt !== null) {
    // Write outcome row directly so we control measured_at
    const outcomeId = `a2-outcome-${workspaceId}-${idx}`;
    db.prepare(`
      INSERT OR REPLACE INTO action_outcomes
        (id, action_id, checkpoint_days, metrics_snapshot, score, early_signal,
         delta_summary, competitor_context, measured_at, attributed_value, value_basis)
      VALUES
        (?, ?, 30, ?, ?, NULL, ?, '{}', ?, NULL, NULL)
    `).run(
      outcomeId,
      action.id,
      JSON.stringify({ captured_at: measuredAt, position: 2, clicks: 80 }),
      score,
      JSON.stringify(DELTA),
      measuredAt,
    );
  }

  return action.id;
}

beforeAll(async () => {
  await ctx.startServer();

  wsA = createWorkspace('A2 Parity Workspace A').id;
  wsB = createWorkspace('A2 Parity Workspace B').id;

  // ── Workspace A: 3 actions ────────────────────────────────────────────────
  // action1: platform_executed, win scored 5 days ago (within 30d)
  seedActionWithOutcome(wsA, 'platform_executed', 'win', FIVE_DAYS_AGO, 1);
  // action2: platform_executed, strong_win scored 35 days ago (outside 30d window)
  seedActionWithOutcome(wsA, 'platform_executed', 'strong_win', THIRTY_FIVE_DAYS_AGO, 2);
  // action3: platform_executed, no outcome (pending)
  seedActionWithOutcome(wsA, 'platform_executed', null, null, 3);

  // ── Workspace B: 4 actions ────────────────────────────────────────────────
  // action4: not_acted_on + win (within 30d) — included in winRate but NOT in topWin
  seedActionWithOutcome(wsB, 'not_acted_on', 'win', THREE_DAYS_AGO, 4);
  // action5: platform_executed + loss (within 30d)
  seedActionWithOutcome(wsB, 'platform_executed', 'loss', FIVE_DAYS_AGO, 5);
  // action6: platform_executed + inconclusive (within 30d)
  // inconclusive is NOT scored (excluded from totalScored/winRate)
  // but IS counted in scoredLast30d (any outcome within 30d)
  seedActionWithOutcome(wsB, 'platform_executed', 'inconclusive', TWO_DAYS_AGO, 6);
  // action7: platform_executed, no outcome (pending)
  seedActionWithOutcome(wsB, 'platform_executed', null, null, 7);
}, 60_000);

afterAll(async () => {
  // Clean up outcomes then actions for both workspaces
  for (const ws of [wsA, wsB]) {
    db.prepare('DELETE FROM action_outcomes WHERE action_id IN (SELECT id FROM tracked_actions WHERE workspace_id = ?)').run(ws);
    db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(ws);
    deleteWorkspace(ws);
  }
  await ctx.stopServer();
});

// ── GET /api/outcomes/overview parity assertions ───────────────────────────

describe('GET /api/outcomes/overview — A2 aggregate SQL parity', () => {
  it('returns 200 with array', async () => {
    const res = await api('/api/outcomes/overview');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  describe('Workspace A — 3 actions, 2 wins (platform_executed)', () => {
    it('workspace A appears in the overview', async () => {
      const res = await api('/api/outcomes/overview');
      const body = await res.json() as Array<Record<string, unknown>>;
      const entry = body.find(e => e.workspaceId === wsA);
      expect(entry).toBeDefined();
    });

    it('winRate = 1.0 (2 wins out of 2 scored)', async () => {
      const res = await api('/api/outcomes/overview');
      const body = await res.json() as Array<Record<string, unknown>>;
      const entry = body.find(e => e.workspaceId === wsA);
      expect(entry).toBeDefined();
      // Both action1 (win) and action2 (strong_win) are scored → 2/2 = 1.0
      expect(entry!.winRate).toBe(1);
    });

    it('activeActions = 3 (all actions have measurement_complete=0; 30d outcomes do not mark complete)', async () => {
      // getWorkspaceCounts counts all measurement_complete=0 rows as "active".
      // recordOutcome at checkpoint_days=30 does NOT set measurement_complete=1 (only 90d does).
      // So all 3 actions in ws_a remain measurement_complete=0 → activeActions=3.
      const res = await api('/api/outcomes/overview');
      const body = await res.json() as Array<Record<string, unknown>>;
      const entry = body.find(e => e.workspaceId === wsA);
      expect(entry).toBeDefined();
      expect(entry!.activeActions).toBe(3);
    });

    it('scoredLast30d = 1 (only action1 measured within 30d; action2 is 35d ago)', async () => {
      const res = await api('/api/outcomes/overview');
      const body = await res.json() as Array<Record<string, unknown>>;
      const entry = body.find(e => e.workspaceId === wsA);
      expect(entry).toBeDefined();
      expect(entry!.scoredLast30d).toBe(1);
    });

    it('topWin is non-null (has executed win actions)', async () => {
      const res = await api('/api/outcomes/overview');
      const body = await res.json() as Array<Record<string, unknown>>;
      const entry = body.find(e => e.workspaceId === wsA);
      expect(entry).toBeDefined();
      expect(entry!.topWin).not.toBeNull();
    });

    it('attentionNeeded is false (2 pending < 10, trend is not declining)', async () => {
      // With only 3 actions total, recentScored < 3 so trend stays 'stable'
      const res = await api('/api/outcomes/overview');
      const body = await res.json() as Array<Record<string, unknown>>;
      const entry = body.find(e => e.workspaceId === wsA);
      expect(entry).toBeDefined();
      expect(entry!.attentionNeeded).toBe(false);
    });
  });

  describe('Workspace B — 4 actions, 1 not_acted_on win, 1 inconclusive, 1 pending', () => {
    it('workspace B appears in the overview', async () => {
      const res = await api('/api/outcomes/overview');
      const body = await res.json() as Array<Record<string, unknown>>;
      const entry = body.find(e => e.workspaceId === wsB);
      expect(entry).toBeDefined();
    });

    it('winRate = 0.5 (1 win [not_acted_on] + 1 loss = 2 scored, 1 win) — not_acted_on included in computeScorecard', async () => {
      // computeScorecard (the loop version) does NOT filter not_acted_on.
      // action4(not_acted_on/win) + action5(platform_executed/loss) = 2 scored, 1 win → winRate=0.5
      // action6(inconclusive) + action7(pending) are NOT counted in totalScored
      const res = await api('/api/outcomes/overview');
      const body = await res.json() as Array<Record<string, unknown>>;
      const entry = body.find(e => e.workspaceId === wsB);
      expect(entry).toBeDefined();
      expect(entry!.winRate).toBe(0.5);
    });

    it('activeActions = 4 (all actions have measurement_complete=0; 30d outcomes do not mark complete)', async () => {
      // Same as ws_a: 30-day outcomes do not set measurement_complete=1.
      // All 4 actions in ws_b remain measurement_complete=0 → activeActions=4.
      const res = await api('/api/outcomes/overview');
      const body = await res.json() as Array<Record<string, unknown>>;
      const entry = body.find(e => e.workspaceId === wsB);
      expect(entry).toBeDefined();
      expect(entry!.activeActions).toBe(4);
    });

    it('scoredLast30d = 3 (action4+action5+action6 all have outcomes within 30d)', async () => {
      // scoredLast30d counts ANY action with outcomes.some(o => o.measuredAt >= 30d)
      // action4(win/3d), action5(loss/5d), action6(inconclusive/2d) = 3
      const res = await api('/api/outcomes/overview');
      const body = await res.json() as Array<Record<string, unknown>>;
      const entry = body.find(e => e.workspaceId === wsB);
      expect(entry).toBeDefined();
      expect(entry!.scoredLast30d).toBe(3);
    });

    it('topWin is null — the only win action is not_acted_on (A1 exclusion via getTopWinsForWorkspace)', async () => {
      // getTopWinsForWorkspace filters not_acted_on (A1 change).
      // action4 is the only win but attribution=not_acted_on → excluded.
      // action5 is a loss (not a win). → topWin must be null.
      const res = await api('/api/outcomes/overview');
      const body = await res.json() as Array<Record<string, unknown>>;
      const entry = body.find(e => e.workspaceId === wsB);
      expect(entry).toBeDefined();
      expect(entry!.topWin).toBeNull();
    });

    it('has the required WorkspaceOutcomeOverview shape fields', async () => {
      const res = await api('/api/outcomes/overview');
      const body = await res.json() as Array<Record<string, unknown>>;
      const entry = body.find(e => e.workspaceId === wsB);
      expect(entry).toBeDefined();
      expect(typeof entry!.workspaceName).toBe('string');
      expect(typeof entry!.winRate).toBe('number');
      expect(typeof entry!.activeActions).toBe('number');
      expect(typeof entry!.scoredLast30d).toBe('number');
      expect(typeof entry!.attentionNeeded).toBe('boolean');
      expect(['improving', 'stable', 'declining']).toContain(entry!.trend);
    });
  });

  describe('Workspace isolation', () => {
    it('wsA and wsB values do not bleed into each other', async () => {
      const res = await api('/api/outcomes/overview');
      const body = await res.json() as Array<Record<string, unknown>>;
      const entryA = body.find(e => e.workspaceId === wsA);
      const entryB = body.find(e => e.workspaceId === wsB);
      expect(entryA).toBeDefined();
      expect(entryB).toBeDefined();
      // ws_a has 3 total actions, ws_b has 4
      // Their activeActions differ (3 vs 4 — all actions are measurement_complete=0 with 30d outcomes)
      // We verify the winRates are independently computed
      expect(entryA!.winRate).toBe(1);   // ws_a: 2/2
      expect(entryB!.winRate).toBe(0.5); // ws_b: 1/2
      // And scoredLast30d are different
      expect(entryA!.scoredLast30d).toBe(1);
      expect(entryB!.scoredLast30d).toBe(3);
    });
  });
});
