/**
 * Task 3 (#13) — secure + de-cost the public recommendations GET.
 *
 * COST (mandatory): GET /api/public/recommendations/:wsId must NOT auto-generate
 * recommendations inline on a cache-miss. On miss it returns the last-known/empty
 * set quickly via loadRecommendations(), never the heavy generateRecommendations()
 * pipeline (which the SEO_AUDIT job already runs post-audit — see jobs.ts).
 *
 * Behavioral proof that generation did NOT run: generateRecommendations() PERSISTS
 * its result via saveRecommendations(). So if the GET still triggered inline gen,
 * loadRecommendations(wsId) would be non-null AFTER the request. The de-costed GET
 * leaves the store untouched, so loadRecommendations(wsId) stays null. We assert
 * the store is still empty after the GET — the discriminator between "loaded empty"
 * and "generated + saved".
 *
 * AUTH: the GET uses requireClientPortalAuth() (soft gate — matches the sibling
 * PATCH/DELETE). A password-set workspace with no session → 401; a passwordless
 * workspace passes through (the client InsightsEngine/useRecommendations hook
 * fetches with no token for demo/passwordless portals, so a hard gate would break
 * legitimate access).
 *
 * Port: 13887 (next free integration port).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { loadRecommendations, saveRecommendations } from '../../server/recommendations.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';

const ctx = createTestContext(13887, { autoPublicAuth: true }); // port-ok: next free integration port
const { api, postJson, clearCookies } = ctx;

let emptyWsId = '';        // known workspace, NO cached recommendations
let cachedWsId = '';       // known workspace WITH a cached recommendation set
let passwordWsId = '';     // password-set workspace (auth gate should 401 without session)
const wsPassword = 'rec-get-test-password';
let passwordlessWsId = ''; // passwordless workspace (soft gate passes through)

function makeRec(workspaceId: string, id: string): Recommendation {
  const now = new Date().toISOString();
  return {
    id,
    workspaceId,
    priority: 'fix_now',
    type: 'metadata',
    title: 'Cached recommendation',
    description: 'A pre-existing cached rec.',
    insight: 'Cached insight.',
    impact: 'high',
    effort: 'low',
    impactScore: 50,
    source: 'audit:meta-description',
    affectedPages: ['home'],
    trafficAtRisk: 100,
    impressionsAtRisk: 2000,
    estimatedGain: 'Could increase organic clicks',
    actionType: 'manual',
    status: 'pending',
    assignedTo: 'client',
    createdAt: now,
    updatedAt: now,
  };
}

function seedSet(workspaceId: string, recs: Recommendation[]): void {
  const set: RecommendationSet = {
    workspaceId,
    generatedAt: new Date().toISOString(),
    recommendations: recs,
    summary: {
      fixNow: recs.length, fixSoon: 0, fixLater: 0, ongoing: 0,
      totalImpactScore: recs.reduce((s, r) => s + r.impactScore, 0),
      trafficAtRisk: recs.reduce((s, r) => s + r.trafficAtRisk, 0),
      estimatedRecoverableClicks: 0,
      estimatedRecoverableImpressions: 0,
      topRecommendationId: recs[0]?.id ?? null,
    },
  };
  saveRecommendations(set);
}

beforeAll(async () => {
  await ctx.startServer();

  emptyWsId = createWorkspace('Rec GET Empty WS').id;

  cachedWsId = createWorkspace('Rec GET Cached WS').id;
  seedSet(cachedWsId, [makeRec(cachedWsId, 'rec_cached_001')]);

  passwordWsId = createWorkspace('Rec GET Password WS').id;
  updateWorkspace(passwordWsId, { clientPassword: wsPassword });

  passwordlessWsId = createWorkspace('Rec GET Passwordless WS').id;
  // Intentionally no clientPassword.
}, 25_000);

afterAll(async () => {
  deleteWorkspace(emptyWsId);
  deleteWorkspace(cachedWsId);
  deleteWorkspace(passwordWsId);
  deleteWorkspace(passwordlessWsId);
  await ctx.stopServer();
});

describe('GET /api/public/recommendations/:wsId — cost: no inline generation on cache-miss', () => {
  it('returns 200 with an empty set for a known workspace that has no cached recs', async () => {
    clearCookies();
    // Precondition: the store is genuinely empty for this workspace.
    expect(loadRecommendations(emptyWsId)).toBeNull();

    const res = await api(`/api/public/recommendations/${emptyWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as RecommendationSet;
    expect(body).toHaveProperty('workspaceId', emptyWsId);
    expect(Array.isArray(body.recommendations)).toBe(true);
    expect(body.recommendations.length).toBe(0);
  });

  it('does NOT call generateRecommendations on a cache-miss (store stays empty)', async () => {
    clearCookies();
    // Use a dedicated fresh workspace so the assertion is unambiguous: nothing
    // was cached before, and nothing must be persisted by the GET.
    const freshWsId = createWorkspace('Rec GET No-Gen WS').id;
    try {
      expect(loadRecommendations(freshWsId)).toBeNull();

      const res = await api(`/api/public/recommendations/${freshWsId}`);
      expect(res.status).toBe(200);

      // The discriminator: generateRecommendations() persists via
      // saveRecommendations(). If inline gen ran, the store would now be
      // non-null. The de-costed GET reads-or-returns-empty and persists nothing.
      expect(loadRecommendations(freshWsId)).toBeNull();
    } finally {
      deleteWorkspace(freshWsId);
    }
  });

  it('returns the cached set unchanged when one already exists (no regeneration)', async () => {
    clearCookies();
    const res = await api(`/api/public/recommendations/${cachedWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as RecommendationSet;
    expect(body.recommendations.map(r => r.id)).toContain('rec_cached_001');
  });

  it('returns 404 (not 500) for an unknown workspace', async () => {
    clearCookies();
    const res = await api('/api/public/recommendations/ws_definitely_nonexistent_13887');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

describe('GET /api/public/recommendations/:wsId — auth (soft gate)', () => {
  it('returns 401 for a password-set workspace with no session', async () => {
    clearCookies();
    const res = await api(`/api/public/recommendations/${passwordWsId}`, {
      headers: { 'x-no-auto-public-auth': 'true' },
    });
    expect(res.status).toBe(401);
    const body = await res.json().catch(() => ({}));
    expect(body).toHaveProperty('error');
  });

  it('returns 200 for a passwordless workspace (legitimate demo access preserved)', async () => {
    clearCookies();
    const res = await api(`/api/public/recommendations/${passwordlessWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as RecommendationSet;
    expect(Array.isArray(body.recommendations)).toBe(true);
  });

  it('returns 200 for a password-set workspace once an authenticated session exists', async () => {
    clearCookies();
    const authRes = await postJson(`/api/public/auth/${passwordWsId}`, { password: wsPassword });
    expect(authRes.status).toBe(200);
    const res = await api(`/api/public/recommendations/${passwordWsId}`);
    expect(res.status).not.toBe(401);
    expect(res.status).toBe(200);
  });
});
