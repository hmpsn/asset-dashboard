/**
 * Strategy send-path public-read invariant.
 *
 * Asserts the two-axis invariant (Strategy v3 spec §6.1 + §6.2):
 *   - After sendRecommendation() sets clientStatus = 'sent', the rec is persisted with
 *     that client-facing axis value.
 *   - RecStatus (the internal admin triage axis: pending/in_progress/completed/dismissed)
 *     is NOT modified by sendRecommendation — send NEVER writes RecStatus.
 *   - GET /api/public/recommendations/:ws does NOT leak clientStatus to the client (the
 *     allow-list in stripEmvFromPublicRecs intentionally excludes it — client visibility
 *     is managed by the curated overview, not by the raw clientStatus field).
 *   - The admin GET /api/recommendations/:ws DOES include clientStatus so the admin UI
 *     can reflect the curated state.
 *
 * Uses inline server (createApp() + listen(0)) for speed (no child-process overhead) and
 * injects the broadcast mock before the module graph resolves.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { randomUUID, createHmac } from 'crypto';

// ─── Broadcast mock (vi.hoisted so it is ready before any module import) ──────
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
import {
  saveRecommendations,
  loadRecommendations,
  computeRecommendationSummary,
} from '../../server/recommendations.js';
import { sendRecommendation } from '../../server/recommendation-lifecycle.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';

// ─── Server bootstrap ─────────────────────────────────────────────────────────
let baseUrl = '';
let server: http.Server | undefined;
// Admin HMAC token — passes requireClientPortalAuth (admin bypass) and requireWorkspaceAccess.
// Uses the same SESSION_SECRET that createTestContext uses so the token is valid.
const SESSION_SECRET = process.env.SESSION_SECRET ?? 'asset-dashboard-test-session-secret';
const adminAuthToken = createHmac('sha256', SESSION_SECRET).update('admin').digest('hex');

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  process.env.SESSION_SECRET = SESSION_SECRET;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

/** Fetch with the admin HMAC token injected (passes requireClientPortalAuth + requireWorkspaceAccess). */
function authFetch(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...opts,
    headers: {
      ...(opts?.headers as Record<string, string> ?? {}),
      'x-auth-token': adminAuthToken,
    },
  });
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close(err => (err ? reject(err) : resolve()));
  });
  server = undefined;
}

beforeAll(async () => {
  await startTestServer();
}, 30_000);

afterAll(async () => {
  await stopTestServer();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRec(overrides: Partial<Recommendation> = {}): Recommendation {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    workspaceId: '',       // set by caller
    priority: 'fix_soon',
    type: 'content',
    title: 'Add service page for target keyword',
    description: 'A dedicated service page would capture commercial-intent traffic.',
    insight: 'Competitor ranks #2 for this keyword; our site has no targeting page.',
    impact: 'high',
    effort: 'medium',
    impactScore: 72,
    source: 'keyword_strategy',
    affectedPages: ['/services'],
    trafficAtRisk: 0,
    impressionsAtRisk: 0,
    estimatedGain: '+~340 clicks/mo',
    actionType: 'content_creation',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function seedRecSet(workspaceId: string, recs: Recommendation[]): RecommendationSet {
  const set: RecommendationSet = {
    workspaceId,
    generatedAt: new Date().toISOString(),
    recommendations: recs.map(r => ({ ...r, workspaceId })),
    summary: computeRecommendationSummary(recs),
  };
  saveRecommendations(set);
  return set;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('sendRecommendation — two-axis invariant', () => {
  it('sets clientStatus = "sent" without modifying RecStatus', () => {
    const ws = createWorkspace(`Send Path ${Date.now()}`);
    const rec = makeRec({ status: 'pending' });
    seedRecSet(ws.id, [rec]);

    // Call the domain function directly (not an HTTP round-trip).
    const sent = sendRecommendation(ws.id, rec.id);
    expect(sent, 'sendRecommendation should return the mutated rec').not.toBeNull();
    expect(sent!.clientStatus).toBe('sent');   // client-facing axis: updated
    expect(sent!.status).toBe('pending');      // admin triage axis: UNCHANGED

    deleteWorkspace(ws.id);
  });

  it('sentAt is stamped when clientStatus transitions to "sent"', () => {
    const ws = createWorkspace(`SentAt ${Date.now()}`);
    const rec = makeRec({ status: 'in_progress' });
    seedRecSet(ws.id, [rec]);

    const before = new Date().toISOString();
    const sent = sendRecommendation(ws.id, rec.id);
    const after = new Date().toISOString();

    expect(sent!.sentAt).toBeDefined();
    expect(sent!.sentAt! >= before).toBe(true);
    expect(sent!.sentAt! <= after).toBe(true);
    // RecStatus still in_progress — send never touches it.
    expect(sent!.status).toBe('in_progress');

    deleteWorkspace(ws.id);
  });

  it('loadRecommendations persists clientStatus = "sent" after sendRecommendation', () => {
    const ws = createWorkspace(`Persist ClientStatus ${Date.now()}`);
    const rec = makeRec({ status: 'pending' });
    seedRecSet(ws.id, [rec]);

    sendRecommendation(ws.id, rec.id);

    const reloaded = loadRecommendations(ws.id);
    expect(reloaded).not.toBeNull();
    const reloadedRec = reloaded!.recommendations.find(r => r.id === rec.id);
    expect(reloadedRec?.clientStatus).toBe('sent');
    expect(reloadedRec?.status).toBe('pending'); // RecStatus persisted unchanged

    deleteWorkspace(ws.id);
  });
});

describe('GET /api/public/recommendations/:ws — clientStatus is NOT leaked', () => {
  it('public read does NOT include clientStatus even after sendRecommendation', async () => {
    const ws = createWorkspace(`Public Leak ${Date.now()}`);
    const rec = makeRec({ status: 'pending' });
    seedRecSet(ws.id, [rec]);

    // Send the rec via domain function.
    sendRecommendation(ws.id, rec.id);

    // Read via the public endpoint (admin HMAC token bypasses requireClientPortalAuth for admin reads).
    const res = await authFetch(`/api/public/recommendations/${ws.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as RecommendationSet;

    const publicRec = body.recommendations.find(r => r.id === rec.id);
    expect(publicRec, 'sent rec should appear in the public set').toBeDefined();

    // The two-axis invariant: clientStatus must NOT be present on the public response.
    // stripEmvFromPublicRecs uses an allow-list that intentionally excludes clientStatus.
    expect((publicRec as Record<string, unknown>)['clientStatus']).toBeUndefined();

    deleteWorkspace(ws.id);
  });

  it('public read RecStatus is the internal triage axis (not overwritten by send)', async () => {
    const ws = createWorkspace(`Public RecStatus ${Date.now()}`);
    const rec = makeRec({ status: 'in_progress' });
    seedRecSet(ws.id, [rec]);

    sendRecommendation(ws.id, rec.id);

    const res = await authFetch(`/api/public/recommendations/${ws.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as RecommendationSet;

    const publicRec = body.recommendations.find(r => r.id === rec.id);
    expect(publicRec?.status).toBe('in_progress'); // RecStatus unchanged by send

    deleteWorkspace(ws.id);
  });
});

describe('GET /api/recommendations/:ws (admin) — clientStatus IS visible', () => {
  it('admin read reflects clientStatus = "sent" after sendRecommendation', async () => {
    const ws = createWorkspace(`Admin ClientStatus ${Date.now()}`);
    const rec = makeRec({ status: 'pending' });
    seedRecSet(ws.id, [rec]);

    sendRecommendation(ws.id, rec.id);

    // Admin GET reads the full rec (no allow-list stripping). Requires admin HMAC token.
    const res = await authFetch(`/api/recommendations/${ws.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as RecommendationSet;

    const adminRec = body.recommendations.find(r => r.id === rec.id);
    expect(adminRec?.clientStatus).toBe('sent');
    expect(adminRec?.status).toBe('pending'); // RecStatus unchanged

    deleteWorkspace(ws.id);
  });
});

describe('sendRecommendation — error paths (FM-2)', () => {
  it('returns null when the rec id is not found', () => {
    const ws = createWorkspace(`Null RecId ${Date.now()}`);
    seedRecSet(ws.id, [makeRec({ status: 'pending' })]);

    const result = sendRecommendation(ws.id, 'nonexistent-rec-id');
    expect(result).toBeNull();

    deleteWorkspace(ws.id);
  });

  it('throws InvalidTransitionError when re-sending an already-sent rec', () => {
    const ws = createWorkspace(`Re-send ${Date.now()}`);
    const rec = makeRec({ status: 'pending' });
    seedRecSet(ws.id, [rec]);

    // First send — valid.
    sendRecommendation(ws.id, rec.id);

    // Second send on same rec — illegal edge (sent → sent has no outbound edge).
    expect(() => sendRecommendation(ws.id, rec.id)).toThrow();

    deleteWorkspace(ws.id);
  });
});
