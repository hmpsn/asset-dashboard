/**
 * Integration tests for the trust-ladder AUTO-SEND hook in the weekly Issue cron
 * (The Issue, Phase 4). After pushing the Issue (Phase 3) the cron auto-sends the ACTIVE recs of
 * every earned + enabled + eligible archetype via the single-writer sendRecommendation +
 * mirrorRecommendationToDeliverable, marks each sent rec autoSent:true, and writes an operator-only
 * `strategy_autosent` activity entry when count > 0.
 *
 * These exercise runIssuePushForWorkspace directly (no HTTP) and assert:
 *   - an EARNED+ENABLED quick_win policy → its active quick_win rec is auto-sent (clientStatus→sent,
 *     autoSent=true) on push;
 *   - a NOT-earned (or earned-but-DISABLED) policy → the rec stays active (no auto-send);
 *   - an INELIGIBLE archetype (authority_bet/content) is NEVER auto-sent even if a row exists;
 *   - the `strategy_autosent` activity entry is written when count > 0 (and NOT when count = 0);
 *   - striking an auto-sent rec removes it from the curated (client-visible) set.
 *
 * generateStrategyPov is module-mocked (no live AI). broadcast is mocked. activity-log is partially
 * mocked so we can assert the doorbell + autosent entries without real WS/DB writes. The autosend
 * store + sendRecommendation + the mirror are REAL — this is the genuine end-to-end auto-send path.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// ── Mocks (before any module that imports these transitively) ────────────────

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
}));

const generateStrategyPovMock = vi.fn();
vi.mock('../../server/strategy-pov-generator.js', () => ({
  generateStrategyPov: (...args: unknown[]) => generateStrategyPovMock(...args),
  POV_UNCHANGED: 'POV_UNCHANGED',
}));

const addActivityMock = vi.fn();
vi.mock('../../server/activity-log.js', async () => {
  const actual = await vi.importActual<typeof import('../../server/activity-log.js')>(
    '../../server/activity-log.js',
  );
  return { ...actual, addActivity: (...args: unknown[]) => addActivityMock(...args) };
});

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import {
  saveRecommendations,
  loadRecommendations,
  computeRecommendationSummary,
  isActiveRec,
  isCuratedForClient,
} from '../../server/recommendations.js';
import { strikeRecommendation } from '../../server/recommendation-lifecycle.js';
import { runIssuePushForWorkspace } from '../../server/strategy-issue-cron.js';
import { broadcastToWorkspace } from '../../server/broadcast.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import db from '../../server/db/index.js';
import type { Recommendation, RecommendationSet, RecType } from '../../shared/types/recommendations.js';
import type { AutoSendEligibleArchetype } from '../../shared/types/strategy-autosend.js';

/** Read a policy row's streak counter directly (proves the credit chokepoint fired). */
function policyCycles(archetype: string): number | undefined {
  const row = db
    .prepare('SELECT consecutive_cycles FROM strategy_autosend_policy WHERE workspace_id = ? AND archetype = ?')
    .get(wsId, archetype) as { consecutive_cycles: number } | undefined;
  return row?.consecutive_cycles;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

let wsId = '';
let wsCleanup: () => void;

function makeRec(workspaceId: string, recId: string, type: RecType): Recommendation {
  const ts = new Date().toISOString();
  return {
    id: recId,
    workspaceId,
    priority: 'fix_now',
    type,
    title: `Rec ${recId}`,
    description: 'desc',
    insight: 'why this matters to the client',
    impact: 'high',
    effort: 'low',
    impactScore: 60,
    source: 'audit:test',
    affectedPages: ['/blog/example'],
    trafficAtRisk: 10,
    impressionsAtRisk: 500,
    estimatedGain: 'Capture meaningful organic demand',
    actionType: 'manual',
    status: 'pending',
    clientStatus: 'curated', // active for the operator (isActiveRec → true), ready to send
    lifecycle: 'active',
    createdAt: ts,
    updatedAt: ts,
  };
}

/** Save a rec set for the workspace. */
function saveRecs(recs: Recommendation[]): void {
  const set: RecommendationSet = {
    workspaceId: wsId,
    generatedAt: new Date().toISOString(),
    recommendations: recs,
    summary: computeRecommendationSummary(recs),
  };
  saveRecommendations(set);
}

/** Directly seed an autosend policy row (bypassing the earn ladder). */
function seedPolicy(archetype: AutoSendEligibleArchetype, cycles: number, enabled: boolean): void {
  db.prepare(
    `INSERT INTO strategy_autosend_policy
       (workspace_id, archetype, enabled, consecutive_cycles, last_credited_week, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, archetype) DO UPDATE SET
       enabled = excluded.enabled,
       consecutive_cycles = excluded.consecutive_cycles,
       updated_at = excluded.updated_at`,
  ).run(wsId, archetype, enabled ? 1 : 0, cycles, null, new Date().toISOString());
}

function reloadRec(recId: string): Recommendation | undefined {
  return loadRecommendations(wsId)?.recommendations.find(r => r.id === recId);
}

function clearWeekMarker(): void {
  db.prepare('UPDATE workspaces SET last_issue_pushed_week_of = NULL WHERE id = ?').run(wsId);
}

function autoSentActivityCalls(): unknown[][] {
  return addActivityMock.mock.calls.filter(c => c[1] === 'strategy_autosent');
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe('strategy-autosend-cron — auto-send on weekly push (The Issue, Phase 4)', () => {
  beforeAll(() => {
    const seeded = seedWorkspace();
    wsId = seeded.workspaceId;
    wsCleanup = seeded.cleanup;
  });

  afterAll(() => {
    setWorkspaceFlagOverride('strategy-the-issue', wsId, null);
    db.prepare('DELETE FROM strategy_autosend_policy WHERE workspace_id = ?').run(wsId);
    db.prepare('DELETE FROM recommendation_sets WHERE workspace_id = ?').run(wsId);
    db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(wsId);
    wsCleanup();
  });

  beforeEach(() => {
    db.prepare('DELETE FROM recommendation_sets WHERE workspace_id = ?').run(wsId);
    db.prepare('DELETE FROM strategy_autosend_policy WHERE workspace_id = ?').run(wsId);
    db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(wsId);
    clearWeekMarker();
    setWorkspaceFlagOverride('strategy-the-issue', wsId, true);
    generateStrategyPovMock.mockReset();
    generateStrategyPovMock.mockResolvedValue({ situation: 'ok' });
    addActivityMock.mockReset();
    vi.mocked(broadcastToWorkspace).mockClear();
  });

  it('auto-sends the active quick_win rec for an EARNED + ENABLED policy (clientStatus→sent, autoSent=true)', async () => {
    saveRecs([makeRec(wsId, 'qw-1', 'strategy')]); // 'strategy' → quick_win
    seedPolicy('quick_win', 3, true); // earned + enabled

    const r = await runIssuePushForWorkspace(wsId);
    expect(r.status).toBe('pushed');

    const rec = reloadRec('qw-1');
    expect(rec?.clientStatus).toBe('sent');
    expect(rec?.autoSent).toBe(true);
    expect(rec?.sentAt).toBeTruthy();
    // A sent rec is no longer in the operator-active set, and IS in the client-curated set.
    expect(isActiveRec(rec!)).toBe(false);
    expect(isCuratedForClient(rec!)).toBe(true);

    // The credit chokepoint fired during the auto-send: seeded at 3 (earned) with a null
    // last_credited_week, this week's credit is non-contiguous-but-latched → 4. Proves the
    // sendRecommendation→creditArchetypeCycleOnSend wiring runs on the cron path (not just manual).
    expect(policyCycles('quick_win')).toBe(4);

    // The cron broadcasts RECOMMENDATIONS_UPDATED so the admin views refresh after the auto-send.
    expect(
      vi.mocked(broadcastToWorkspace).mock.calls.some((c) => c[1] === WS_EVENTS.RECOMMENDATIONS_UPDATED),
    ).toBe(true);
  });

  it('writes the operator-only strategy_autosent activity entry when count > 0', async () => {
    saveRecs([makeRec(wsId, 'qw-1', 'strategy')]);
    seedPolicy('quick_win', 3, true);

    await runIssuePushForWorkspace(wsId);

    const calls = autoSentActivityCalls();
    expect(calls).toHaveLength(1);
    // addActivity(workspaceId, type, title, description?, metadata?) — metadata carries weekOf+count.
    expect(calls[0][0]).toBe(wsId);
    expect(calls[0][4]).toEqual(expect.objectContaining({ count: 1 }));
  });

  it('does NOT auto-send when the policy is earned but DISABLED (rec stays active)', async () => {
    saveRecs([makeRec(wsId, 'qw-1', 'strategy')]);
    seedPolicy('quick_win', 3, false); // earned but the operator hasn't flipped it on

    await runIssuePushForWorkspace(wsId);

    const rec = reloadRec('qw-1');
    expect(rec?.clientStatus).toBe('curated'); // untouched
    expect(rec?.autoSent).toBeUndefined();
    expect(isActiveRec(rec!)).toBe(true);
    expect(autoSentActivityCalls()).toHaveLength(0);
  });

  it('does NOT auto-send when the policy is enabled but NOT earned (cycles < threshold)', async () => {
    saveRecs([makeRec(wsId, 'qw-1', 'strategy')]);
    seedPolicy('quick_win', 2, true); // enabled but not earned — must still be gated

    await runIssuePushForWorkspace(wsId);

    const rec = reloadRec('qw-1');
    expect(rec?.clientStatus).toBe('curated');
    expect(rec?.autoSent).toBeUndefined();
    expect(autoSentActivityCalls()).toHaveLength(0);
  });

  it('NEVER auto-sends an ineligible archetype — directly seeding an earned+enabled authority_bet row is excluded by the archetype gate', async () => {
    // A content rec maps to authority_bet (ineligible). Force a maximal (earned + enabled) policy row
    // for authority_bet directly via raw SQL (the typed seedPolicy/store would reject it) — this
    // proves getEarnedEnabledArchetypes filters by the ELIGIBLE-archetype gate, not merely by the
    // absence of an eligible rec.
    saveRecs([makeRec(wsId, 'content-1', 'content')]); // content → authority_bet (ineligible)
    db.prepare(
      `INSERT INTO strategy_autosend_policy
         (workspace_id, archetype, enabled, consecutive_cycles, last_credited_week, updated_at)
       VALUES (?, 'authority_bet', 1, 5, NULL, ?)
       ON CONFLICT(workspace_id, archetype) DO UPDATE SET enabled = 1, consecutive_cycles = 5`,
    ).run(wsId, new Date().toISOString());

    await runIssuePushForWorkspace(wsId);

    const rec = reloadRec('content-1');
    expect(rec?.clientStatus).toBe('curated'); // the ineligible-archetype rec is untouched
    expect(rec?.autoSent).toBeUndefined();
    // The earned+enabled authority_bet row is NOT in getEarnedEnabledArchetypes → no auto-send.
    expect(autoSentActivityCalls()).toHaveLength(0);
  });

  it('striking an auto-sent rec removes it from the client-curated set (the recall affordance)', async () => {
    saveRecs([makeRec(wsId, 'qw-1', 'strategy')]);
    seedPolicy('quick_win', 3, true);

    await runIssuePushForWorkspace(wsId);
    const sent = reloadRec('qw-1');
    expect(isCuratedForClient(sent!)).toBe(true);

    // Operator recalls the auto-sent move by striking it.
    strikeRecommendation(wsId, 'qw-1');
    const struck = reloadRec('qw-1');
    expect(struck?.lifecycle).toBe('struck');
    expect(isCuratedForClient(struck!)).toBe(false); // struck leaves the client's curated projection
  });

  it('only auto-sends ACTIVE recs — an already-sent rec is not re-sent (idempotent within the week)', async () => {
    const rec = makeRec(wsId, 'qw-1', 'strategy');
    rec.clientStatus = 'sent'; // already sent — no longer isActiveRec
    rec.sentAt = new Date().toISOString();
    saveRecs([rec]);
    seedPolicy('quick_win', 3, true);

    await runIssuePushForWorkspace(wsId);

    const reloaded = reloadRec('qw-1');
    expect(reloaded?.autoSent).toBeUndefined(); // never auto-sent (it was already sent manually)
    expect(autoSentActivityCalls()).toHaveLength(0);
  });
});
