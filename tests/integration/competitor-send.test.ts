/**
 * Phase 4 Lane C — competitor send integration test.
 *
 * Asserts the two-axis invariant for `competitor` RecType:
 *   1. PATCH /api/recommendations/:ws/:recId/send sets clientStatus='sent'
 *      on a competitor rec and does NOT write RecStatus (the trust-critical graft).
 *   2. GET /api/public/recommendations/:ws returns the sent competitor rec in the
 *      public payload and does NOT leak admin-only lifecycle fields (clientStatus,
 *      sentAt, etc.) per the existing allow-list.
 *
 * Also verifies that the `competitor` entry is present in REC_POLICY_REGISTRY with
 * the expected policy shape (sendChannel: 'rec', cascadeOnStrike: false).
 *
 * Uses the inline in-process server pattern (createApp + http.createServer on port 0)
 * so the test-process DB and the server share the same SQLite instance — no cross-process
 * DB coordination needed (mirrors admin-recommendations-surface.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// ── Broadcast mock (prevents 500 from missing WebSocket server) ────
vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import {
  saveRecommendations,
  loadRecommendations,
  computeRecommendationSummary,
} from '../../server/recommendations.js';
import { REC_POLICY_REGISTRY } from '../../server/recommendation-lifecycle.js';
import { signAdminToken } from '../../server/middleware.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';

// ─── In-process server setup ──────────────────────────────────────────────────

let baseUrl = '';
let server: http.Server | undefined;
let wsId = '';
let adminToken = '';

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD; // disable HMAC gate — admin routes are open
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
  adminToken = signAdminToken();
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

function patchJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function postJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function adminGetPublic(path: string): Promise<Response> {
  return api(path, {
    headers: { 'x-auth-token': adminToken },
  });
}

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeCompetitorRec(overrides: Partial<Recommendation> = {}): Recommendation {
  const now = new Date().toISOString();
  return {
    id: 'comp-rec-1',
    workspaceId: wsId,
    priority: 'fix_soon',
    type: 'competitor',
    title: 'Target "emergency plumber riverside" (competitor gap)',
    description: 'rivalplumbing.com ranks #2 for this keyword — you have no presence.',
    insight: 'This keyword drives 1,800 visits/mo to your competitor and you rank nowhere for it.',
    impact: 'high',
    effort: 'medium',
    impactScore: 72,
    source: 'competitive-intel',
    affectedPages: [],
    trafficAtRisk: 0,
    impressionsAtRisk: 0,
    estimatedGain: '+~400 clicks/mo if you rank top-5',
    actionType: 'manual',
    status: 'pending',
    targetKeyword: 'emergency plumber riverside',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function seedRecs(recs: Recommendation[]): void {
  const set: RecommendationSet = {
    workspaceId: wsId,
    generatedAt: new Date().toISOString(),
    recommendations: recs,
    summary: computeRecommendationSummary(recs),
  };
  saveRecommendations(set);
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await startTestServer();
  wsId = createWorkspace('Competitor Send Integration Test').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await stopTestServer();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('competitor RecType — policy registry', () => {
  it('competitor is registered in REC_POLICY_REGISTRY with correct policy', () => {
    const policy = REC_POLICY_REGISTRY.competitor;
    expect(policy).toBeDefined();
    expect(policy?.sendChannel).toBe('rec');
    expect(policy?.cascadeOnStrike).toBe(false);
    expect(policy?.monetizable).toBe(false);
  });
});

describe('PATCH /api/recommendations/:ws/:recId/send — competitor rec', () => {
  it('sets clientStatus=sent and does NOT touch RecStatus (trust-critical graft)', async () => {
    seedRecs([makeCompetitorRec({ id: 'comp-send-1' })]);

    const res = await patchJson(`/api/recommendations/${wsId}/comp-send-1/send`, {});
    expect(res.status).toBe(200);

    const updated = loadRecommendations(wsId)!.recommendations.find(r => r.id === 'comp-send-1')!;
    // Two-axis invariant: clientStatus → sent, RecStatus must stay 'pending'
    expect(updated.clientStatus).toBe('sent');
    expect(updated.sentAt).toBeTruthy();
    expect(updated.status).toBe('pending'); // RecStatus untouched — the trust-critical graft
  });

  it('returns 400 on an already-terminal clientStatus (approved) — InvalidTransitionError', async () => {
    seedRecs([makeCompetitorRec({ id: 'comp-send-2', clientStatus: 'approved' })]);

    const res = await patchJson(`/api/recommendations/${wsId}/comp-send-2/send`, {});
    // InvalidTransitionError surfaces as 400 (see recommendation-lifecycle route handler)
    expect(res.status).toBe(400);
  });
});

describe('GET /api/public/recommendations/:ws — competitor rec visible after send', () => {
  it('returns the sent competitor rec on the public route', async () => {
    seedRecs([makeCompetitorRec({ id: 'comp-pub-1', clientStatus: 'sent', sentAt: new Date().toISOString() })]);

    // Admin token bypasses the portal auth gate (requireClientPortalAuth line 210)
    const res = await adminGetPublic(`/api/public/recommendations/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as RecommendationSet;
    const found = body.recommendations.find(r => r.id === 'comp-pub-1');
    expect(found).toBeDefined();
    expect(found?.type).toBe('competitor');
  });

  it('does NOT leak admin-only lifecycle fields (clientStatus, sentAt, lifecycle) on the public route', async () => {
    seedRecs([makeCompetitorRec({
      id: 'comp-pub-leak',
      clientStatus: 'sent',
      sentAt: new Date().toISOString(),
      lifecycle: 'active',
    })]);

    const res = await adminGetPublic(`/api/public/recommendations/${wsId}`);
    expect(res.status).toBe(200);
    const raw = await res.text();
    // Allow-list: these admin-axis fields must NEVER appear in the public payload
    expect(raw).not.toContain('sentAt');
    expect(raw).not.toContain('"lifecycle"');
    const body = JSON.parse(raw) as RecommendationSet;
    const found = body.recommendations.find(r => r.id === 'comp-pub-leak');
    expect(found).toBeDefined();
    expect((found as Record<string, unknown>).clientStatus).toBeUndefined();
    expect((found as Record<string, unknown>).sentAt).toBeUndefined();
    expect((found as Record<string, unknown>).lifecycle).toBeUndefined();
  });
});

describe('POST /api/recommendations/:ws/competitor-rec → send (mint→send round-trip)', () => {
  it('mints a competitor rec (no pre-seeded rec), is idempotent, then sends it', async () => {
    // Clean slate — no pre-seeded recs (the whole point: NOTHING else mints a competitor rec).
    seedRecs([]);
    const keyword = 'emergency electrician downtown';

    // (a) Mint — no rec exists yet.
    const mintRes = await postJson(`/api/recommendations/${wsId}/competitor-rec`, {
      keyword,
      competitorDomain: 'rivalsparks.com',
    });
    expect(mintRes.status).toBe(200);
    const minted = await mintRes.json() as Recommendation;
    expect(minted.type).toBe('competitor');
    expect(minted.targetKeyword).toBe(keyword);
    expect(minted.status).toBe('pending');
    expect(minted.clientStatus).toBe('system');
    // The minted rec must satisfy recommendationSchema → it round-trips through load (not dropped).
    const afterMint = loadRecommendations(wsId)!.recommendations.filter(r => r.type === 'competitor');
    expect(afterMint).toHaveLength(1);
    expect(afterMint[0].id).toBe(minted.id);

    // Idempotent: a second mint for the same keyword returns the SAME rec — no dup.
    const mint2Res = await postJson(`/api/recommendations/${wsId}/competitor-rec`, {
      keyword,
      competitorDomain: 'rivalsparks.com',
    });
    expect(mint2Res.status).toBe(200);
    const minted2 = await mint2Res.json() as Recommendation;
    expect(minted2.id).toBe(minted.id);
    const afterMint2 = loadRecommendations(wsId)!.recommendations.filter(r => r.type === 'competitor');
    expect(afterMint2).toHaveLength(1);

    // (b) Send the minted rec → clientStatus:'sent', RecStatus untouched (trust-critical graft).
    const sendRes = await patchJson(`/api/recommendations/${wsId}/${minted.id}/send`, {});
    expect(sendRes.status).toBe(200);
    const sent = loadRecommendations(wsId)!.recommendations.find(r => r.id === minted.id)!;
    expect(sent.clientStatus).toBe('sent');
    expect(sent.sentAt).toBeTruthy();
    expect(sent.status).toBe('pending'); // RecStatus unchanged

    // (c) It appears on the public read path.
    const pubRes = await adminGetPublic(`/api/public/recommendations/${wsId}`);
    expect(pubRes.status).toBe(200);
    const pubBody = await pubRes.json() as RecommendationSet;
    const pubFound = pubBody.recommendations.find(r => r.id === minted.id);
    expect(pubFound).toBeDefined();
    expect(pubFound?.type).toBe('competitor');
    expect(pubFound?.targetKeyword).toBe(keyword);
  });
});
