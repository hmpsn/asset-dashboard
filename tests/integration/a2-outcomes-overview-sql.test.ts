/**
 * A2 — Outcomes overview aggregate SQL parity test (audit #10)
 *
 * Verifies that the refactored GET /api/outcomes/overview endpoint (which uses
 * aggregate SQL readers instead of per-action loops) returns byte-identical JSON
 * to the documented expected values across four divergent workspaces:
 *
 * Workspace A: 3 actions, 2 wins (all platform_executed), 1 scored outside 30d window
 * Workspace B: 4 actions including 1 not_acted_on win, 1 inconclusive, 1 pending
 * Workspace C (I3/C1): 1 action with win@day30 + neutral@day90 — latest checkpoint is
 *   non-win, so winRate must be 0 (not 1.0 as the pre-fix ANY-checkpoint SQL returned)
 * Workspace D (I3/C2): 1 pending action with 2 outcomes — activeActions must be 1
 *   (not 2 as the pre-fix SUM fan-out SQL returned)
 *
 * Key parity assertions:
 * - winRate uses LATEST qualifying checkpoint per action (matches computeScorecard loop)
 * - winRate includes not_acted_on in denominator/numerator (matches computeScorecard loop)
 * - scoredLast30d counts ANY outcome measured within 30d (including inconclusive)
 * - topWin excludes not_acted_on (per A1 — getTopWinsForWorkspace filters them)
 * - workspace isolation: ws_a values don't bleed into ws_b
 * - pending_count counts each action once regardless of outcome fan-out
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
let wsC = ''; // I3/C1: multi-checkpoint win→neutral — winRate must use latest checkpoint
let wsD = ''; // I3/C2: pending action with 2 outcomes — activeActions must not fan-out

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

/**
 * I3/C1 fixture helper: seeds one action and inserts TWO outcomes at different
 * checkpoints. The first is a win at day 30; the second is a neutral 'loss' at
 * day 90 (latest qualifying checkpoint). computeScorecard() takes
 * latestScored[latestScored.length-1], so the action is NOT a win — winRate must be 0.
 * The pre-fix SQL (ANY-checkpoint) returned total_wins=1 (winRate=1.0) — wrong.
 */
function seedActionWithMultiCheckpointOutcomes(workspaceId: string, idx: number): string {
  const action = recordAction({
    workspaceId,
    actionType: 'content_published',
    sourceType: 'post',
    sourceId: `a2-multi-ckpt-${workspaceId}-${idx}`,
    pageUrl: `/page-multi-${workspaceId}-${idx}`,
    targetKeyword: `kw-a2-multi-${idx}`,
    baselineSnapshot: BASELINE,
    attribution: 'platform_executed',
    sourceFlag: 'live',
    baselineConfidence: 'exact',
  });

  // First outcome: win at day 30
  db.prepare(`
    INSERT OR REPLACE INTO action_outcomes
      (id, action_id, checkpoint_days, metrics_snapshot, score, early_signal,
       delta_summary, competitor_context, measured_at, attributed_value, value_basis)
    VALUES (?, ?, 30, ?, 'win', NULL, ?, '{}', ?, NULL, NULL)
  `).run(
    `a2-ckpt30-${workspaceId}-${idx}`,
    action.id,
    JSON.stringify({ captured_at: FIVE_DAYS_AGO, position: 5, clicks: 50 }),
    JSON.stringify(DELTA),
    FIVE_DAYS_AGO,
  );

  // Second outcome: loss at day 90 (later checkpoint — this is the LATEST scored)
  // This makes the action NOT a win when using latest-checkpoint semantics.
  db.prepare(`
    INSERT OR REPLACE INTO action_outcomes
      (id, action_id, checkpoint_days, metrics_snapshot, score, early_signal,
       delta_summary, competitor_context, measured_at, attributed_value, value_basis)
    VALUES (?, ?, 90, ?, 'loss', NULL, ?, '{}', ?, NULL, NULL)
  `).run(
    `a2-ckpt90-${workspaceId}-${idx}`,
    action.id,
    JSON.stringify({ captured_at: TWO_DAYS_AGO, position: 18, clicks: 6 }),
    JSON.stringify({ ...DELTA, direction: 'declined' }),
    TWO_DAYS_AGO,
  );

  return action.id;
}

/**
 * I3/C2 fixture helper: seeds one pending action (measurement_complete=0) and inserts
 * TWO outcome rows for it (day 30 and day 60 — neither marks complete, only day 90 does).
 * activeActions must be 1 (not 2). The pre-fix SUM() fan-out returned 2 — wrong.
 */
function seedPendingActionWithTwoOutcomes(workspaceId: string, idx: number): string {
  const action = recordAction({
    workspaceId,
    actionType: 'content_published',
    sourceType: 'post',
    sourceId: `a2-pending-fanout-${workspaceId}-${idx}`,
    pageUrl: `/page-pending-${workspaceId}-${idx}`,
    targetKeyword: `kw-a2-pending-${idx}`,
    baselineSnapshot: BASELINE,
    attribution: 'platform_executed',
    sourceFlag: 'live',
    baselineConfidence: 'exact',
  });

  // Day-30 outcome (does NOT set measurement_complete=1 — only day 90 does)
  db.prepare(`
    INSERT OR REPLACE INTO action_outcomes
      (id, action_id, checkpoint_days, metrics_snapshot, score, early_signal,
       delta_summary, competitor_context, measured_at, attributed_value, value_basis)
    VALUES (?, ?, 30, ?, 'neutral', NULL, ?, '{}', ?, NULL, NULL)
  `).run(
    `a2-pending-ckpt30-${workspaceId}-${idx}`,
    action.id,
    JSON.stringify({ captured_at: FIVE_DAYS_AGO, position: 15, clicks: 30 }),
    JSON.stringify(DELTA),
    FIVE_DAYS_AGO,
  );

  // Day-60 outcome (also does NOT set measurement_complete=1)
  db.prepare(`
    INSERT OR REPLACE INTO action_outcomes
      (id, action_id, checkpoint_days, metrics_snapshot, score, early_signal,
       delta_summary, competitor_context, measured_at, attributed_value, value_basis)
    VALUES (?, ?, 60, ?, 'neutral', NULL, ?, '{}', ?, NULL, NULL)
  `).run(
    `a2-pending-ckpt60-${workspaceId}-${idx}`,
    action.id,
    JSON.stringify({ captured_at: TWO_DAYS_AGO, position: 12, clicks: 45 }),
    JSON.stringify(DELTA),
    TWO_DAYS_AGO,
  );

  // Confirm action is still pending (measurement_complete=0) — day 90 would have set it
  const row = db.prepare('SELECT measurement_complete FROM tracked_actions WHERE id = ?').get(action.id) as { measurement_complete: number } | undefined;
  if (row?.measurement_complete !== 0) {
    throw new Error(`I3/C2 fixture: expected measurement_complete=0 for action ${action.id}`);
  }

  return action.id;
}

beforeAll(async () => {
  await ctx.startServer();

  wsA = createWorkspace('A2 Parity Workspace A').id;
  wsB = createWorkspace('A2 Parity Workspace B').id;
  wsC = createWorkspace('A2 Parity Workspace C — multi-checkpoint').id;
  wsD = createWorkspace('A2 Parity Workspace D — pending fan-out').id;

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

  // ── Workspace C (I3/C1): 1 action, win@30 then loss@90 ────────────────────
  // Latest qualifying checkpoint is loss → action is NOT a win.
  // Pre-fix SQL returned total_wins=1 (ANY-checkpoint). Fixed SQL must return 0.
  seedActionWithMultiCheckpointOutcomes(wsC, 1);

  // ── Workspace D (I3/C2): 1 pending action with 2 outcomes ──────────────────
  // measurement_complete=0, outcomes at day 30 and day 60.
  // Pre-fix SUM() fan-out returned pending_count=2. Fixed COUNT(DISTINCT) must return 1.
  seedPendingActionWithTwoOutcomes(wsD, 1);
}, 60_000);

afterAll(async () => {
  // Clean up outcomes then actions for all workspaces
  for (const ws of [wsA, wsB, wsC, wsD]) {
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

  // ── I3/C1 — latest-checkpoint semantics for total_wins ────────────────────
  //
  // Reproduces the exact bug from code review finding C1:
  // An action with win@day30 + loss@day90 should NOT count as a win.
  // computeScorecard() uses latestScored[latestScored.length-1] → loss (day90).
  // Pre-fix ANY-checkpoint SQL yielded total_wins=1 (winRate=1.0) — wrong.
  // Post-fix MAX(checkpoint_days) subquery yields total_wins=0 (winRate=0) — correct.
  describe('Workspace C — I3/C1: multi-checkpoint win→loss, winRate uses latest checkpoint', () => {
    it('workspace C appears in the overview', async () => {
      const res = await api('/api/outcomes/overview');
      const body = await res.json() as Array<Record<string, unknown>>;
      const entry = body.find(e => e.workspaceId === wsC);
      expect(entry).toBeDefined();
    });

    it('winRate = 0 — action has win@day30 but loss@day90; latest checkpoint is loss (not a win)', async () => {
      // The pre-fix SQL (ANY checkpoint) returned winRate=1.0 for this action.
      // The fixed SQL (MAX checkpoint subquery) must return winRate=0.
      // This assertion FAILS against pre-fix SQL and PASSES after C1 fix.
      const res = await api('/api/outcomes/overview');
      const body = await res.json() as Array<Record<string, unknown>>;
      const entry = body.find(e => e.workspaceId === wsC);
      expect(entry).toBeDefined();
      expect(entry!.winRate).toBe(0);
    });

    it('activeActions = 1 (measurement_complete=0; day90 outcome sets complete, but fixture has none)', async () => {
      // The action has day30+day90 outcomes. day90 recordOutcome() DOES set measurement_complete=1
      // — but we wrote these directly to DB without going through recordOutcome(), so the
      // mark-complete side-effect did NOT run. The action is still pending.
      // Verify activeActions reflects the actual DB state, not the checkpoint logic.
      const actionRow = db.prepare('SELECT measurement_complete FROM tracked_actions WHERE workspace_id = ?').get(wsC) as { measurement_complete: number } | undefined;
      // If the action IS complete (measurement_complete=1) in our fixture, activeActions=0.
      // If NOT complete (=0), activeActions=1. We seeded via raw INSERT, so it's 0.
      expect(actionRow?.measurement_complete).toBe(0);

      const res = await api('/api/outcomes/overview');
      const body = await res.json() as Array<Record<string, unknown>>;
      const entry = body.find(e => e.workspaceId === wsC);
      expect(entry).toBeDefined();
      expect(entry!.activeActions).toBe(1);
    });
  });

  // ── I3/C2 — pending_count fan-out when action has multiple outcomes ─────────
  //
  // Reproduces the exact bug from code review finding C2:
  // A pending action (measurement_complete=0) with 2 outcome rows (day30 + day60)
  // contributed 2 to the SUM() pre-fix SQL (one per join row).
  // Post-fix COUNT(DISTINCT ta.id) collapses them back to 1.
  describe('Workspace D — I3/C2: pending action with 2 outcomes, activeActions counts it ONCE', () => {
    it('workspace D appears in the overview', async () => {
      const res = await api('/api/outcomes/overview');
      const body = await res.json() as Array<Record<string, unknown>>;
      const entry = body.find(e => e.workspaceId === wsD);
      expect(entry).toBeDefined();
    });

    it('activeActions = 1 — pending action with day30+day60 outcomes is counted once, not twice', async () => {
      // The pre-fix SUM(CASE WHEN measurement_complete=0 THEN 1 ELSE 0 END) fanned out:
      // 1 action × 2 outcome rows = SUM returned 2 (activeActions=2) — wrong.
      // The fixed COUNT(DISTINCT CASE WHEN measurement_complete=0 THEN ta.id END) returns 1.
      // This assertion FAILS against pre-fix SQL and PASSES after C2 fix.
      const res = await api('/api/outcomes/overview');
      const body = await res.json() as Array<Record<string, unknown>>;
      const entry = body.find(e => e.workspaceId === wsD);
      expect(entry).toBeDefined();
      expect(entry!.activeActions).toBe(1);
    });
  });
});
