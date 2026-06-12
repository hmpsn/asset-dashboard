/**
 * Integration tests for the admin recommendations surface (D1).
 *
 * Covers:
 * (a) Client PATCH writes a rec_status_updated activity row
 * (b) Client DELETE writes a rec_dismissed activity row
 * (c) Admin GET /api/recommendations/:workspaceId — workspace-scoped, all statuses
 * (d) Admin PATCH .../undismiss — valid transition (dismissed → pending)
 * (e) Admin PATCH .../undismiss — invalid transition (pending → pending) is rejected
 *
 * Uses the inline server pattern (vi.mock + dynamic import of app) so the
 * broadcastToWorkspace mock is shared with the test assertions.
 *
 * Port: none (listens on port 0 for an ephemeral OS-assigned port).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// ─── Broadcast mock ──────────────────────────────────────────────────────────
const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: Record<string, unknown> }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(
    (workspaceId: string, event: string, payload: Record<string, unknown>) => {
      broadcastState.calls.push({ workspaceId, event, payload });
    },
  ),
}));

// ─── Imports (after mock registration) ───────────────────────────────────────
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { saveRecommendations } from '../../server/recommendations.js';
import { listActivity } from '../../server/activity-log.js';
import { createClientUser, deleteClientUser, signClientToken } from '../../server/client-users.js';
import { signAdminToken } from '../../server/middleware.js';
import db from '../../server/db/index.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import type { RecommendationSet } from '../../shared/types/recommendations.js';

// ─── Server bootstrap ─────────────────────────────────────────────────────────
let baseUrl = '';
let server: http.Server | undefined;
// Cached so the gated (APP_PASSWORD-set) server in D1(f) boots on the SAME module
// graph — same db instance, same broadcast mock. createApp() reads process.env
// .APP_PASSWORD at call time, so the gate is toggled purely via the env var, never
// vi.resetModules() (which would fork the db and orphan the seeded data).
let createAppFn: (() => import('express').Express) | undefined;

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  createAppFn = createApp;
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close(err => (err ? reject(err) : resolve()));
  });
  server = undefined;
}

function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, opts);
}

function patchJson(path: string, body: unknown, cookieHeader?: string): Promise<Response> {
  return api(path, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    body: JSON.stringify(body),
  });
}

function del(path: string, cookieHeader?: string): Promise<Response> {
  return api(path, {
    method: 'DELETE',
    ...(cookieHeader ? { headers: { Cookie: cookieHeader } } : {}),
  });
}

/** Format a client JWT as a cookie header value for the given workspace. */
function clientCookie(wsId: string, token: string): string {
  return `client_user_token_${wsId}=${token}`;
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────
/** A full OpportunityScore carrying the three admin/AI-only dollar fields
 *  (emvPerWeek / predictedEmv / roiPerEffortDay) so tests can assert that the
 *  admin GET exposes them and the public client GET strips them. */
function makeOpportunity(): RecommendationSet['recommendations'][0]['opportunity'] {
  return {
    value: 75,
    emvPerWeek: 420,
    predictedEmv: 5460,
    roiPerEffortDay: 84,
    confidence: 0.8,
    calibration: 1.0,
    groundedSpine: 'computed',
    components: [],
    calibrationVersion: 'v1',
    modelVersion: 'ov-1',
  };
}

function makeRecSet(
  wsId: string,
  recId: string,
  status: RecommendationSet['recommendations'][0]['status'] = 'pending',
  withOpportunity = false,
): RecommendationSet {
  return {
    workspaceId: wsId,
    generatedAt: new Date().toISOString(),
    recommendations: [
      {
        id: recId,
        workspaceId: wsId,
        priority: 'fix_now',
        type: 'metadata',
        actionType: 'manual',
        title: 'D1 test rec',
        description: 'Missing meta description on key pages',
        insight: 'Affects click-through rate',
        impact: 'high',
        effort: 'low',
        impactScore: 75,
        source: 'seo_audit',
        affectedPages: ['/about'],
        trafficAtRisk: 500,
        impressionsAtRisk: 3000,
        estimatedGain: '~100 clicks/month',
        status,
        ...(withOpportunity ? { opportunity: makeOpportunity() } : {}),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    summary: {
      fixNow: 1,
      fixSoon: 0,
      fixLater: 0,
      ongoing: 0,
      totalImpactScore: 75,
      trafficAtRisk: 500,
      estimatedRecoverableClicks: 100,
      estimatedRecoverableImpressions: 3000,
      topRecommendationId: recId,
    },
  };
}

// ─── Workspace + client user ───────────────────────────────────────────────
let wsId = '';
let clientToken = '';
let clientUserId = '';

beforeAll(async () => {
  await startTestServer();
  const ws = createWorkspace('D1 Admin Rec Surface Test WS');
  wsId = ws.id;
  // Create a client user to authenticate the client portal PATCH/DELETE
  const user = await createClientUser(
    `d1-test-${Date.now()}@example.com`,
    'TestPass!123',
    'D1 Test Client',
    wsId,
    'client_member',
  );
  clientUserId = user.id;
  clientToken = signClientToken(user);
}, 60_000);

beforeEach(() => {
  broadcastState.calls = [];
});

afterAll(async () => {
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM recommendation_sets WHERE workspace_id = ?').run(wsId);
  if (clientUserId) deleteClientUser(clientUserId, wsId);
  deleteWorkspace(wsId);
  await stopTestServer();
});

// ─── (a) Client PATCH logs rec_status_updated ──────────────────────────────
describe('D1(a) — client PATCH logs rec_status_updated activity', () => {
  const recId = `rec_d1a_${Date.now()}`;

  beforeAll(() => {
    saveRecommendations(makeRecSet(wsId, recId, 'pending'));
  });

  it('PATCH pending → in_progress writes rec_status_updated activity row and broadcasts', async () => {
    const res = await patchJson(
      `/api/public/recommendations/${wsId}/${recId}`,
      { status: 'in_progress' },
      clientCookie(wsId, clientToken),
    );
    expect(res.status).toBe(200);
    // Activity row
    const activities = listActivity(wsId, 50);
    const logged = activities.find(a => a.type === 'rec_status_updated');
    expect(logged).toBeDefined();
    expect(logged?.title).toContain('D1 test rec');
    // Broadcast
    const broadcast = broadcastState.calls.find(c => c.event === WS_EVENTS.RECOMMENDATIONS_UPDATED);
    expect(broadcast).toBeDefined();
    expect(broadcast?.payload.recId).toBe(recId);
  });
});

// ─── (b) Client DELETE logs rec_dismissed ─────────────────────────────────
describe('D1(b) — client DELETE logs rec_dismissed activity', () => {
  const recId = `rec_d1b_${Date.now()}`;

  beforeAll(() => {
    saveRecommendations(makeRecSet(wsId, recId, 'pending'));
  });

  it('DELETE writes rec_dismissed activity row', async () => {
    const res = await del(
      `/api/public/recommendations/${wsId}/${recId}`,
      clientCookie(wsId, clientToken),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
    const activities = listActivity(wsId, 50);
    const logged = activities.find(a => a.type === 'rec_dismissed');
    expect(logged).toBeDefined();
    expect(logged?.title).toContain('D1 test rec');
  });
});

// ─── (c) Admin GET — workspace-scoped, all statuses ──────────────────────────
describe('D1(c) — admin GET /api/recommendations/:workspaceId', () => {
  const recPendingId = `rec_d1c_p_${Date.now()}`;
  const recDismissedId = `rec_d1c_d_${Date.now()}`;

  beforeAll(() => {
    // Seed a set with one pending and one dismissed rec
    const set: RecommendationSet = {
      workspaceId: wsId,
      generatedAt: new Date().toISOString(),
      recommendations: [
        {
          id: recPendingId,
          workspaceId: wsId,
          priority: 'fix_now',
          type: 'metadata',
          actionType: 'manual',
          title: 'Admin pending rec',
          description: 'Desc',
          insight: 'Insight',
          impact: 'high',
          effort: 'low',
          impactScore: 70,
          source: 'seo_audit',
          affectedPages: ['/home'],
          trafficAtRisk: 200,
          impressionsAtRisk: 1000,
          estimatedGain: '~50 clicks/month',
          status: 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: recDismissedId,
          workspaceId: wsId,
          priority: 'fix_soon',
          type: 'content',
          actionType: 'manual',
          title: 'Admin dismissed rec',
          description: 'Desc',
          insight: 'Insight',
          impact: 'medium',
          effort: 'medium',
          impactScore: 50,
          source: 'seo_audit',
          affectedPages: ['/blog'],
          trafficAtRisk: 100,
          impressionsAtRisk: 500,
          estimatedGain: '~20 clicks/month',
          status: 'dismissed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      summary: {
        fixNow: 1,
        fixSoon: 1,
        fixLater: 0,
        ongoing: 0,
        totalImpactScore: 120,
        trafficAtRisk: 300,
        estimatedRecoverableClicks: 70,
        estimatedRecoverableImpressions: 1500,
        topRecommendationId: recPendingId,
      },
    };
    saveRecommendations(set);
  });

  it('returns 200 with the full set including dismissed recs', async () => {
    const res = await api(`/api/recommendations/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as RecommendationSet;
    expect(Array.isArray(body.recommendations)).toBe(true);
    const ids = body.recommendations.map(r => r.id);
    expect(ids).toContain(recPendingId);
    expect(ids).toContain(recDismissedId);
  });

  it('?status=dismissed filter returns only dismissed recs', async () => {
    const res = await api(`/api/recommendations/${wsId}?status=dismissed`);
    expect(res.status).toBe(200);
    const body = await res.json() as RecommendationSet;
    expect(body.recommendations.length).toBeGreaterThan(0); // length guard ensures non-empty before .every()
    expect(body.recommendations.every(r => r.status === 'dismissed')).toBe(true); // every-ok: guarded by length check above
    expect(body.recommendations.map(r => r.id)).toContain(recDismissedId);
  });

  it('workspace isolation: unknown workspace ID returns 404', async () => {
    const res = await api('/api/recommendations/ws_nonexistent_d1c');
    expect(res.status).toBe(404);
  });
});

// ─── (c2) EMV exposure: admin GET includes it, public client GET strips it ────
describe('D1(c2) — emvPerWeek is admin-only (present on admin GET, stripped on public GET)', () => {
  const recId = `rec_d1c2_${Date.now()}`;

  beforeAll(() => {
    // Seed a rec carrying a full OpportunityScore with the three admin/AI-only
    // dollar fields populated (emvPerWeek / predictedEmv / roiPerEffortDay).
    saveRecommendations(makeRecSet(wsId, recId, 'pending', true));
  });

  it('admin GET exposes emvPerWeek / predictedEmv / roiPerEffortDay', async () => {
    const res = await api(`/api/recommendations/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as RecommendationSet;
    const rec = body.recommendations.find(r => r.id === recId);
    expect(rec?.opportunity).toBeDefined();
    expect(rec?.opportunity?.emvPerWeek).toBe(420);
    expect(rec?.opportunity?.predictedEmv).toBe(5460);
    expect(rec?.opportunity?.roiPerEffortDay).toBe(84);
  });

  it('public client GET strips emvPerWeek / predictedEmv / roiPerEffortDay but keeps the rest of the OV', async () => {
    const res = await api(
      `/api/public/recommendations/${wsId}`,
      { headers: { Cookie: clientCookie(wsId, clientToken) } },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as RecommendationSet;
    const rec = body.recommendations.find(r => r.id === recId);
    expect(rec?.opportunity).toBeDefined();
    // The three admin/AI-only dollar fields must be absent.
    expect(rec?.opportunity).not.toHaveProperty('emvPerWeek');
    expect(rec?.opportunity).not.toHaveProperty('predictedEmv');
    expect(rec?.opportunity).not.toHaveProperty('roiPerEffortDay');
    // The rest of the OV breakdown is preserved for the client "why this is #1" card.
    expect(rec?.opportunity?.value).toBe(75);
    expect(rec?.opportunity?.confidence).toBe(0.8);
  });
});

// ─── (f) Auth boundary: with APP_PASSWORD SET, a client token must NOT pass ───
//   the admin gate. This is the C1 regression guard — a client-portal JWT (carries
//   clientUserId, not userId) shares JWT_SECRET with internal-user tokens, so
//   without the verifyToken userId guard it would pass the app.ts gate and leak EMV.
//   Runs on a DEDICATED server with APP_PASSWORD set (the main suite deletes it).
describe('D1(f) — admin GET rejects a client-portal token when APP_PASSWORD is set', () => {
  const recId = `rec_d1f_${Date.now()}`;
  let gatedBaseUrl = '';
  let gatedServer: http.Server | undefined;
  const savedAppPassword = process.env.APP_PASSWORD;

  beforeAll(async () => {
    saveRecommendations(makeRecSet(wsId, recId, 'pending', true));
    // Boot a second app instance WITH the gate enabled so the boundary is real.
    // Reuse the cached createApp from the same module graph (shared db + broadcast
    // mock); createApp reads APP_PASSWORD at call time, so just setting the env var
    // here turns the gate on for this instance only.
    process.env.APP_PASSWORD = 'test-admin-secret';
    const app = createAppFn!();
    gatedServer = http.createServer(app);
    await new Promise<void>(resolve => gatedServer!.listen(0, '127.0.0.1', resolve));
    const { port } = gatedServer.address() as AddressInfo;
    gatedBaseUrl = `http://127.0.0.1:${port}`;
  }, 60_000);

  afterAll(async () => {
    if (gatedServer) {
      await new Promise<void>((resolve, reject) => {
        gatedServer!.close(err => (err ? reject(err) : resolve()));
      });
    }
    if (savedAppPassword === undefined) delete process.env.APP_PASSWORD;
    else process.env.APP_PASSWORD = savedAppPassword;
  });

  it('rejects a client token sent via Authorization: Bearer (401, no EMV leak)', async () => {
    const res = await fetch(`${gatedBaseUrl}/api/recommendations/${wsId}`, {
      headers: { Authorization: `Bearer ${clientToken}` },
    });
    expect(res.status).toBe(401);
  });

  it('rejects a client token sent via the `token` cookie (401, no EMV leak)', async () => {
    const res = await fetch(`${gatedBaseUrl}/api/recommendations/${wsId}`, {
      headers: { Cookie: `token=${clientToken}` },
    });
    expect(res.status).toBe(401);
  });

  it('allows the request with a valid admin HMAC token (sanity: gate is actually on)', async () => {
    const res = await fetch(`${gatedBaseUrl}/api/recommendations/${wsId}`, {
      headers: { 'x-auth-token': signAdminToken() },
    });
    expect(res.status).toBe(200);
  });
});

// ─── (d) Admin un-dismiss — valid transition ──────────────────────────────────
describe('D1(d) — admin PATCH .../undismiss (dismissed → pending)', () => {
  const recId = `rec_d1d_${Date.now()}`;

  beforeAll(() => {
    saveRecommendations(makeRecSet(wsId, recId, 'dismissed'));
  });

  it('transitions dismissed → pending, returns updated rec, broadcasts, writes activity', async () => {
    const res = await patchJson(`/api/recommendations/${wsId}/${recId}/undismiss`, {});
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; id: string };
    expect(body.status).toBe('pending');
    expect(body.id).toBe(recId);
    // Broadcast
    const broadcast = broadcastState.calls.find(
      c => c.event === WS_EVENTS.RECOMMENDATIONS_UPDATED && c.payload.recId === recId,
    );
    expect(broadcast).toBeDefined();
    expect(broadcast?.payload.status).toBe('pending');
    // Activity row
    const activities = listActivity(wsId, 50);
    const logged = activities.find(
      a => a.type === 'rec_status_updated' && a.title?.includes('un-dismissed'),
    );
    expect(logged).toBeDefined();
  });
});

// ─── (e) Admin un-dismiss — invalid transition (not dismissed) ──────────────
describe('D1(e) — admin PATCH .../undismiss rejects invalid transition', () => {
  const recId = `rec_d1e_${Date.now()}`;

  beforeAll(() => {
    // Rec is pending, not dismissed — un-dismiss is an illegal no-op
    saveRecommendations(makeRecSet(wsId, recId, 'pending'));
  });

  it('returns 400 when the rec is not in dismissed state', async () => {
    const res = await patchJson(`/api/recommendations/${wsId}/${recId}/undismiss`, {});
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Invalid recommendation transition');
  });
});
