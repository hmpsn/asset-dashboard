/**
 * Audit-resolution launch PR — Blocker 1: "Request this" pricing/scope/tier (Lane E).
 *
 * Owner-ratified D1 = Option A (tier-aware "Request this"):
 *   - Free + monetizable rec → server-side 403, NO content request created (the route is the gate,
 *     not a hidden button).
 *   - Growth/Premium → the request succeeds, mints ONE lineage-stamped content request, clientStatus
 *     → approved.
 *   - The public read (`GET /api/public/recommendations/:ws`) projects an `actOn` descriptor on each
 *     rec when strategy-the-issue is ON: Free → { mode: 'locked', requiredTier: 'growth' };
 *     Growth → { mode: 'included' }.
 *   - L6 atomicity: a throw mid-transaction rolls back the greenlight (clientStatus) AND the request
 *     together — never an orphaned approved rec with no work item.
 *
 * In-process `createApp()` server: lets us (a) module-mock broadcast (no WS noise) and (b) wrap
 * `createContentRequest` so the L6 atomicity case can force a throw between the two writes. Auth:
 * act-on uses requireAuthenticatedClientPortalAuth (passwordless does NOT pass by URL), so every
 * call carries the admin HMAC token, which passes the portal gate — the SAME passthrough the
 * child-process autoPublicAuth helper uses.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// ─── Broadcast mock (registered before app import) ───────────────────────────
vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

// ─── content-requests mock: delegate to the REAL impl, but allow per-test throw ──
// We wrap ONLY createContentRequest so the L6 atomicity case can force a throw inside the act-on
// transaction (after the greenlight write). All other exports pass through unchanged so
// listContentRequests etc. read the real store.
const createContentRequestSpy = vi.hoisted(() => vi.fn());
let forceCreateRequestThrow = false;
vi.mock('../../server/content-requests.js', async () => {
  const actual = await vi.importActual<typeof import('../../server/content-requests.js')>(
    '../../server/content-requests.js',
  );
  createContentRequestSpy.mockImplementation(
    (...args: Parameters<typeof actual.createContentRequest>) => {
      if (forceCreateRequestThrow) throw new Error('forced createContentRequest failure (L6)');
      return actual.createContentRequest(...args);
    },
  );
  return { ...actual, createContentRequest: createContentRequestSpy };
});

// ─── Imports (after mocks) ────────────────────────────────────────────────────
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import { signAdminToken } from '../../server/middleware.js';
import {
  saveRecommendations,
  loadRecommendations,
  computeRecommendationSummary,
} from '../../server/recommendations.js';
import { listContentRequests } from '../../server/content-requests.js';
import type { Recommendation, RecommendationSet, RecType } from '../../shared/types/recommendations.js';

// ─── Server bootstrap (in-process, port 0) ────────────────────────────────────
let baseUrl = '';
let server: http.Server | undefined;

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => server!.close((err) => (err ? reject(err) : resolve())));
  server = undefined;
}

// Admin HMAC token passes the client-portal gate (mirrors the autoPublicAuth child-process helper).
const adminHeaders = () => ({ 'x-auth-token': signAdminToken(), 'Content-Type': 'application/json' });

function getJson(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: { 'x-auth-token': signAdminToken() } });
}
function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { method: 'POST', headers: adminHeaders(), body: JSON.stringify(body) });
}

// ─── Workspaces (one per tier) ────────────────────────────────────────────────
let freeWsId = '';
let growthWsId = '';
let freeCleanup: (() => void) | undefined;
let growthCleanup: (() => void) | undefined;

const now = () => new Date().toISOString();

function seedRecInto(workspaceId: string, recId: string, overrides: Partial<Recommendation> = {}): void {
  const ts = now();
  const type: RecType = (overrides.type as RecType) ?? 'content'; // content → monetizable
  const rec: Recommendation = {
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
    source: 'audit:content',
    affectedPages: ['/blog/example'],
    trafficAtRisk: 10,
    impressionsAtRisk: 500,
    estimatedGain: 'Could capture meaningful organic demand',
    actionType: 'manual',
    targetKeyword: `keyword-${recId}`,
    status: 'pending',
    clientStatus: 'sent',
    sentAt: ts,
    lifecycle: 'active',
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
  const existing = loadRecommendations(workspaceId);
  const prior: Recommendation[] = existing
    ? existing.recommendations.filter((r) => r.id !== recId)
    : [];
  const recs = [...prior, rec];
  const set: RecommendationSet = {
    workspaceId,
    generatedAt: ts,
    recommendations: recs,
    summary: computeRecommendationSummary(recs),
  };
  saveRecommendations(set);
}

function reloadRec(workspaceId: string, recId: string): Recommendation | undefined {
  return loadRecommendations(workspaceId)?.recommendations.find((r) => r.id === recId);
}

beforeAll(async () => {
  await startTestServer();
  // Genuine free tier: seedWorkspace seeds NULL trialEndsAt, so tier:'free' resolves to free
  // (computeEffectiveTier only promotes free→growth on an ACTIVE trial). Passwordless portal.
  const free = seedWorkspace({ tier: 'free', clientPassword: '' });
  freeWsId = free.workspaceId;
  freeCleanup = free.cleanup;
  const growth = seedWorkspace({ tier: 'growth', clientPassword: '' });
  growthWsId = growth.workspaceId;
  growthCleanup = growth.cleanup;
  setWorkspaceFlagOverride('strategy-the-issue', freeWsId, true);
  setWorkspaceFlagOverride('strategy-the-issue', growthWsId, true);
}, 25_000);

afterAll(async () => {
  if (freeWsId) setWorkspaceFlagOverride('strategy-the-issue', freeWsId, null);
  if (growthWsId) setWorkspaceFlagOverride('strategy-the-issue', growthWsId, null);
  await stopTestServer();
  freeCleanup?.();
  growthCleanup?.();
});

beforeEach(() => {
  forceCreateRequestThrow = false;
  createContentRequestSpy.mockClear();
});

describe('Blocker 1 — Free-tier act-on on a monetizable rec is gated server-side (403, no request)', () => {
  it('returns 403 and creates NO content request (list count unchanged)', async () => {
    seedRecInto(freeWsId, 'rec_free_gate', { type: 'content', clientStatus: 'sent', sentAt: now() });
    const before = listContentRequests(freeWsId).length;

    const res = await postJson(`/api/public/recommendations/${freeWsId}/rec_free_gate/act-on`, {});
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; requiredTier?: string };
    expect(typeof body.error).toBe('string');
    expect(body.requiredTier).toBe('growth');

    // No request minted, and the rec was NOT greenlit (clientStatus stays 'sent').
    expect(listContentRequests(freeWsId).length).toBe(before);
    expect(reloadRec(freeWsId, 'rec_free_gate')?.clientStatus).toBe('sent');
    expect(createContentRequestSpy).not.toHaveBeenCalled();
  });
});

describe('Blocker 1 — Growth-tier act-on succeeds (one lineage-stamped request, clientStatus→approved)', () => {
  it('mints exactly one content request stamped with the rec id and approves the rec', async () => {
    seedRecInto(growthWsId, 'rec_growth_acton', { type: 'content', clientStatus: 'sent', sentAt: now() });
    const before = listContentRequests(growthWsId).filter((r) => r.recommendationId === 'rec_growth_acton').length;

    const res = await postJson(`/api/public/recommendations/${growthWsId}/rec_growth_acton/act-on`, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      recommendation: { clientStatus?: string; actOn?: { mode: string } };
      requestId: string;
    };
    expect(body.recommendation.clientStatus).toBe('approved');
    expect(typeof body.requestId).toBe('string');
    // The act-on RESPONSE projects the rec with its actOn descriptor (flag ON, Growth → included) —
    // an effectiveTier mis-resolution returning 'locked' would slip past the clientStatus assertion.
    expect(body.recommendation.actOn?.mode).toBe('included');

    const reqs = listContentRequests(growthWsId).filter((r) => r.recommendationId === 'rec_growth_acton');
    expect(reqs.length).toBe(before + 1);
    expect(reqs[0].recommendationId).toBe('rec_growth_acton');
    expect(reqs[0].source).toBe('client');
    expect(reqs[0].status).toBe('requested'); // queued — nothing generated
    expect(reloadRec(growthWsId, 'rec_growth_acton')?.clientStatus).toBe('approved');
  });
});

describe('Blocker 1 — Free-tier act-on on a NON-monetizable rec is NOT gated (the gate must not over-fire)', () => {
  it('returns 200 and creates the request for a non-monetizable type (keyword_gap) on Free', async () => {
    // keyword_gap is a non-monetizable authority_bet move (REC_POLICY_REGISTRY). The three-way gate
    // (flag ON && free && monetizable) must NOT fire — only the monetizable arm is gated.
    seedRecInto(freeWsId, 'rec_free_nonmon', { type: 'keyword_gap', clientStatus: 'sent', sentAt: now() });
    const res = await postJson(`/api/public/recommendations/${freeWsId}/rec_free_nonmon/act-on`, {});
    expect(res.status).toBe(200);
    expect(reloadRec(freeWsId, 'rec_free_nonmon')?.clientStatus).toBe('approved');
    expect(
      listContentRequests(freeWsId).filter((r) => r.recommendationId === 'rec_free_nonmon').length,
    ).toBe(1);
  });
});

describe('Blocker 1 — act-on route is byte-identical (no 403 gate) when strategy-the-issue is OFF', () => {
  it('a Free + monetizable rec is NOT 403-gated when the flag is off (the gate is flag-gated)', async () => {
    seedRecInto(freeWsId, 'rec_flagoff_acton', { type: 'content', clientStatus: 'sent', sentAt: now() });
    setWorkspaceFlagOverride('strategy-the-issue', freeWsId, false);
    try {
      const res = await postJson(`/api/public/recommendations/${freeWsId}/rec_flagoff_acton/act-on`, {});
      // The tier gate's first conjunct is exposeClientStatus (= the flag), so flag-OFF skips it.
      expect(res.status).not.toBe(403);
    } finally {
      setWorkspaceFlagOverride('strategy-the-issue', freeWsId, true);
    }
  });
});

describe('Blocker 1 — actOn projection descriptor on the public read (flag ON)', () => {
  it('Free → { mode: "locked", requiredTier: "growth" } on a monetizable rec', async () => {
    seedRecInto(freeWsId, 'rec_free_proj', { type: 'content', clientStatus: 'sent', sentAt: now() });
    const res = await getJson(`/api/public/recommendations/${freeWsId}?clientStatus=sent`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      recommendations: Array<{ id: string; actOn?: { mode: string; requiredTier?: string } }>;
    };
    const rec = body.recommendations.find((r) => r.id === 'rec_free_proj');
    expect(rec).toBeDefined();
    expect(rec!.actOn).toBeDefined();
    expect(rec!.actOn!.mode).toBe('locked');
    expect(rec!.actOn!.requiredTier).toBe('growth');
  });

  it('Growth → { mode: "included" } on a monetizable rec', async () => {
    seedRecInto(growthWsId, 'rec_growth_proj', { type: 'content', clientStatus: 'sent', sentAt: now() });
    const res = await getJson(`/api/public/recommendations/${growthWsId}?clientStatus=sent`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      recommendations: Array<{ id: string; actOn?: { mode: string; requiredTier?: string } }>;
    };
    const rec = body.recommendations.find((r) => r.id === 'rec_growth_proj');
    expect(rec).toBeDefined();
    expect(rec!.actOn).toBeDefined();
    expect(rec!.actOn!.mode).toBe('included');
  });
});

describe('Blocker 1 — L6 atomicity: a throw rolls back greenlight + request together', () => {
  it('a forced createContentRequest throw leaves the rec un-approved and no request written', async () => {
    seedRecInto(growthWsId, 'rec_atomic', { type: 'content', clientStatus: 'sent', sentAt: now() });
    const before = listContentRequests(growthWsId).filter((r) => r.recommendationId === 'rec_atomic').length;
    expect(before).toBe(0);

    forceCreateRequestThrow = true;
    const res = await postJson(`/api/public/recommendations/${growthWsId}/rec_atomic/act-on`, {});
    // The route lets a non-classified throw propagate → 500 (the outer txn rolled back).
    expect(res.status).toBe(500);

    // ROLLBACK PROOF: the greenlight (clientStatus → approved) did NOT persist, and NO request exists.
    expect(reloadRec(growthWsId, 'rec_atomic')?.clientStatus).toBe('sent');
    expect(
      listContentRequests(growthWsId).filter((r) => r.recommendationId === 'rec_atomic').length,
    ).toBe(0);

    // Recovery: with the throw cleared, the same rec greenlights normally (clientStatus still 'sent'
    // means the transition is legal again — proof the failed attempt left a clean slate).
    forceCreateRequestThrow = false;
    const ok = await postJson(`/api/public/recommendations/${growthWsId}/rec_atomic/act-on`, {});
    expect(ok.status).toBe(200);
    expect(reloadRec(growthWsId, 'rec_atomic')?.clientStatus).toBe('approved');
    expect(
      listContentRequests(growthWsId).filter((r) => r.recommendationId === 'rec_atomic').length,
    ).toBe(1);
  });
});
