/**
 * Audit-resolution launch PR — Blocker 3: trust-ladder auto-send dark-launch (Lane E).
 *
 * The weekly Issue cron (runIssuePushForWorkspace) must keep ringing the operator doorbell, but with
 * the OFF-by-default child flag `strategy-trust-ladder-autosend` it must NOT auto-send any rec — even
 * when a quick_win archetype is fully earned+enabled. No rec flips to clientStatus 'sent' via the
 * cron; no `strategy_autosent` activity is written; no recommendation update is broadcast. With the
 * child flag ON (+ earned+enabled policy) auto-send still works (regression guard).
 *
 * Mirrors strategy-autosend-cron.test.ts: generateStrategyPov + broadcast are module-mocked,
 * activity-log is partially mocked to assert the doorbell vs autosent entries. The autosend store +
 * sendRecommendation + the mirror are REAL.
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
} from '../../server/recommendations.js';
import { runIssuePushForWorkspace } from '../../server/strategy-issue-cron.js';
import { broadcastToWorkspace } from '../../server/broadcast.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import db from '../../server/db/index.js';
import type { Recommendation, RecommendationSet, RecType } from '../../shared/types/recommendations.js';
import type { AutoSendEligibleArchetype } from '../../shared/types/strategy-autosend.js';

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
    clientStatus: 'curated', // active for the operator, ready to send
    lifecycle: 'active',
    createdAt: ts,
    updatedAt: ts,
  };
}

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
  return loadRecommendations(wsId)?.recommendations.find((r) => r.id === recId);
}

function clearWeekMarker(): void {
  db.prepare('UPDATE workspaces SET last_issue_pushed_week_of = NULL WHERE id = ?').run(wsId);
}

function autoSentActivityCalls(): unknown[][] {
  return addActivityMock.mock.calls.filter((c) => c[1] === 'strategy_autosent');
}
function pushedActivityCalls(): unknown[][] {
  return addActivityMock.mock.calls.filter((c) => c[1] === 'strategy_issue_pushed');
}

describe('Blocker 3 — trust-ladder auto-send is dark-launched behind strategy-trust-ladder-autosend', () => {
  beforeAll(() => {
    const seeded = seedWorkspace();
    wsId = seeded.workspaceId;
    wsCleanup = seeded.cleanup;
  });

  afterAll(() => {
    setWorkspaceFlagOverride('strategy-the-issue', wsId, null);
    setWorkspaceFlagOverride('strategy-trust-ladder-autosend', wsId, null);
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
    // Parent flag ON (the cron path is reachable); child auto-send flag default is OFF.
    setWorkspaceFlagOverride('strategy-the-issue', wsId, true);
    setWorkspaceFlagOverride('strategy-trust-ladder-autosend', wsId, null);
    generateStrategyPovMock.mockReset();
    generateStrategyPovMock.mockResolvedValue({ situation: 'ok' });
    addActivityMock.mockReset();
    vi.mocked(broadcastToWorkspace).mockClear();
  });

  it('with the child flag OFF (default): the cron rings the doorbell but auto-sends NOTHING', async () => {
    saveRecs([makeRec(wsId, 'qw-1', 'strategy')]); // 'strategy' → quick_win (eligible)
    seedPolicy('quick_win', 3, true); // earned + enabled — would auto-send IF the child flag were on

    const r = await runIssuePushForWorkspace(wsId);
    expect(r.status).toBe('pushed');

    // Doorbell activity rung — the visible bell is poll-derived, not pushed by a WS broadcast.
    expect(pushedActivityCalls()).toHaveLength(1);

    // NO auto-send: the rec stays curated (never flips to 'sent' via the cron); no autoSent stamp.
    const rec = reloadRec('qw-1');
    expect(rec?.clientStatus).toBe('curated');
    expect(rec?.autoSent).toBeUndefined();

    // No `strategy_autosent` activity row written.
    expect(autoSentActivityCalls()).toHaveLength(0);
    // No broadcast at all: the pushed-Issue bell is poll-derived, and the auto-send block never ran.
    expect(vi.mocked(broadcastToWorkspace)).not.toHaveBeenCalled();
  });

  it('regression: with the child flag ON + earned+enabled policy, auto-send still works', async () => {
    saveRecs([makeRec(wsId, 'qw-1', 'strategy')]);
    seedPolicy('quick_win', 3, true);
    setWorkspaceFlagOverride('strategy-trust-ladder-autosend', wsId, true);

    const r = await runIssuePushForWorkspace(wsId);
    expect(r.status).toBe('pushed');

    const rec = reloadRec('qw-1');
    expect(rec?.clientStatus).toBe('sent');
    expect(rec?.autoSent).toBe(true);
    expect(rec?.sentAt).toBeTruthy();

    // The operator-only autosent doorbell IS written when count > 0.
    const calls = autoSentActivityCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(wsId);
    expect(calls[0][4]).toEqual(expect.objectContaining({ count: 1 }));
  });
});
