/**
 * Integration test for the bulk lifecycle endpoint POST /api/recommendations/:workspaceId/bulk
 * (Strategy v3 P3, S.13/S.14). In-process server pattern (port 0, APP_PASSWORD unset) with a
 * broadcast mock so the post-txn broadcast is a no-op the assertions can also inspect.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: unknown }>,
}));
vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: unknown) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

// FIX 2 — spy on the doorbell email so we can assert the bulk Send fires it ONCE for the whole
// batch (never one-per-rec). email.js is imported broadly across the server, so we spread the REAL
// module (importActual) and override ONLY notifyClientCuratedRecsSent — a partial mock would leave
// every other email export undefined and break createApp() boot.
const emailState = vi.hoisted(() => ({
  curatedRecsSent: [] as Array<{ workspaceId: string; recCount: number }>,
}));
vi.mock('../../server/email.js', async () => {
  const actual = await vi.importActual<typeof import('../../server/email.js')>('../../server/email.js');
  return {
    ...actual,
    notifyClientCuratedRecsSent: vi.fn((opts: { workspaceId: string; recCount: number }) => {
      emailState.curatedRecsSent.push({ workspaceId: opts.workspaceId, recCount: opts.recCount });
    }),
  };
});

import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { saveRecommendations, loadRecommendations } from '../../server/recommendations.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import db from '../../server/db/index.js';
import type { Recommendation } from '../../shared/types/recommendations.js';

let baseUrl = '';
let server: http.Server | undefined;
let wsId = '';
let wsIdB = '';

function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const EMPTY_SUMMARY = {
  fixNow: 0, fixSoon: 0, fixLater: 0, ongoing: 0, totalImpactScore: 0, trafficAtRisk: 0,
  totalOpportunityValue: 0, actionableOpportunityValue: 0, topRecommendationId: null,
};

const mk = (
  wid: string,
  id: string,
  at: string,
  clientStatus: Recommendation['clientStatus'] = 'system',
): Recommendation => ({
  id, workspaceId: wid, type: 'content_refresh', title: id, description: 'd', insight: 'i',
  impact: 'low', effort: 'low', impactScore: 10, priority: 'fix_later', actionType: 'manual',
  trafficAtRisk: 0, impressionsAtRisk: 0, estimatedGain: '', affectedPages: [], source: 't',
  clientStatus, lifecycle: 'active', status: 'pending', createdAt: at, updatedAt: at,
} as unknown as Recommendation);

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  server = http.createServer(createApp());
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  const ws = createWorkspace('Bulk WS');
  wsId = ws.id;
  // clientEmail is REQUIRED for the bulk-Send doorbell email path (route guards on ws.clientEmail).
  updateWorkspace(wsId, { clientEmail: 'client@example.com' });
  const at = new Date().toISOString();
  saveRecommendations({
    workspaceId: wsId, generatedAt: at,
    recommendations: [mk(wsId, 'r1', at), mk(wsId, 'r2', at), mk(wsId, 'r3', at)],
    summary: EMPTY_SUMMARY,
  });

  // Workspace B — used by the cross-workspace safety test (its rec must never be touched by an
  // A-scoped bulk call). Seed one curated rec so a (rejected) cross-ws Send would be a real edge.
  const wsB = createWorkspace('Bulk WS B');
  wsIdB = wsB.id;
  saveRecommendations({
    workspaceId: wsIdB, generatedAt: at,
    recommendations: [mk(wsIdB, 'b1', at, 'curated')],
    summary: EMPTY_SUMMARY,
  });
}, 60_000);

afterAll(async () => {
  for (const id of [wsId, wsIdB]) {
    db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(id);
    db.prepare('DELETE FROM recommendation_sets WHERE workspace_id = ?').run(id);
    db.prepare('DELETE FROM rec_discussion WHERE workspace_id = ?').run(id);
    deleteWorkspace(id);
  }
  if (server) await new Promise<void>((resolve, reject) => server!.close(err => (err ? reject(err) : resolve())));
});

describe('POST /api/recommendations/:workspaceId/bulk', () => {
  it('bulk-throttles N recs in one transaction', async () => {
    const res = await postJson(`/api/recommendations/${wsId}/bulk`, {
      recIds: ['r1', 'r2'], action: 'throttle', throttleDays: 30,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ modified: 2 });
    const set = loadRecommendations(wsId)!;
    expect(set.recommendations.find(r => r.id === 'r1')!.lifecycle).toBe('throttled');
    expect(set.recommendations.find(r => r.id === 'r3')!.lifecycle).toBe('active');
    // One broadcast after the txn (not per-rec).
    const bcs = broadcastState.calls.filter(
      c => c.workspaceId === wsId && c.event === WS_EVENTS.RECOMMENDATIONS_UPDATED,
    );
    expect(bcs.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects a bulk strike without confirmStrike (arm-then-confirm)', async () => {
    const res = await postJson(`/api/recommendations/${wsId}/bulk`, {
      recIds: ['r3'], action: 'strike',
    });
    expect(res.status).toBe(400);
    // r3 must remain active — the guard must reject before any mutation.
    expect(loadRecommendations(wsId)!.recommendations.find(r => r.id === 'r3')!.lifecycle).toBe('active');
  });

  it('rejects a throttle without throttleDays', async () => {
    const res = await postJson(`/api/recommendations/${wsId}/bulk`, {
      recIds: ['r3'], action: 'throttle',
    });
    expect(res.status).toBe(400);
  });

  it('strikes N recs when confirmStrike is set', async () => {
    const res = await postJson(`/api/recommendations/${wsId}/bulk`, {
      recIds: ['r3'], action: 'strike', confirmStrike: true,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ modified: 1 });
    expect(loadRecommendations(wsId)!.recommendations.find(r => r.id === 'r3')!.lifecycle).toBe('struck');
  });

  // FIX 2 — bulk Send fires the curated_recs_sent doorbell email ONCE for the whole batch.
  it('fires the doorbell email exactly once for a multi-rec Send (recCount = batch size)', async () => {
    // Seed two fresh curated recs (system→sent is a legal edge) to send together.
    const at = new Date().toISOString();
    saveRecommendations({
      workspaceId: wsId, generatedAt: at,
      recommendations: [mk(wsId, 's1', at, 'curated'), mk(wsId, 's2', at, 'curated')],
      summary: EMPTY_SUMMARY,
    });
    emailState.curatedRecsSent.length = 0;

    const res = await postJson(`/api/recommendations/${wsId}/bulk`, {
      recIds: ['s1', 's2'], action: 'send',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ modified: 2 });

    // ONE email for the whole batch, never one-per-rec, with recCount = number mutated.
    const sentForWs = emailState.curatedRecsSent.filter(e => e.workspaceId === wsId);
    expect(sentForWs).toHaveLength(1);
    expect(sentForWs[0].recCount).toBe(2);
  });

  // FIX 3a — cross-workspace safety: an A-scoped bulk call may not mutate a rec that lives in B.
  it('does not touch a rec from another workspace (cross-workspace safety)', async () => {
    const beforeB = loadRecommendations(wsIdB)!.recommendations.find(r => r.id === 'b1')!.clientStatus;
    const res = await postJson(`/api/recommendations/${wsId}/bulk`, {
      recIds: ['b1'], action: 'send',
    });
    expect(res.status).toBe(200);
    // b1 is not in workspace A's set → it is silently skipped (single-writer returns null), so
    // modified is 0 and workspace B's rec is unchanged.
    expect(await res.json()).toMatchObject({ modified: 0 });
    const afterB = loadRecommendations(wsIdB)!.recommendations.find(r => r.id === 'b1')!.clientStatus;
    expect(afterB).toBe(beforeB);
  });

  // FIX 3b — partial-write skip: one legal rec commits, one rec in a terminal state for the action
  // throws InvalidTransitionError and is excluded from `modified` WITHOUT rolling back the batch.
  it('commits the legal rec and skips an illegal one without rolling back the batch', async () => {
    const at = new Date().toISOString();
    saveRecommendations({
      workspaceId: wsId, generatedAt: at,
      recommendations: [
        mk(wsId, 'p_ok', at, 'curated'),       // curated → sent is legal
        mk(wsId, 'p_bad', at, 'approved'),     // approved has NO outbound 'sent' edge → throws + skipped
      ],
      summary: EMPTY_SUMMARY,
    });

    const res = await postJson(`/api/recommendations/${wsId}/bulk`, {
      recIds: ['p_ok', 'p_bad'], action: 'send',
    });
    expect(res.status).toBe(200);
    // Only the legal rec counts; the illegal one is swallowed (InvalidTransitionError), not a rollback.
    expect(await res.json()).toMatchObject({ modified: 1 });

    const set = loadRecommendations(wsId)!;
    expect(set.recommendations.find(r => r.id === 'p_ok')!.clientStatus).toBe('sent');
    // The illegal rec is untouched — its terminal clientStatus is preserved.
    expect(set.recommendations.find(r => r.id === 'p_bad')!.clientStatus).toBe('approved');
  });
});
