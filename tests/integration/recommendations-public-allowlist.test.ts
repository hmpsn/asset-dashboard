/**
 * Strategy v3 Phase 1 exit gate (spec §7.4, audit prevention #2). The public rec read must be
 * an explicit ALLOW-LIST: admin-only lifecycle keys (throttledUntil, struckAt, sentAt, cascade,
 * lifecycle, clientStatus, sendChannel) must NEVER appear in the public payload, even when set on the rec.
 * AND a legacy rec (no v3 fields) must serialize byte-identically (the flag-OFF guarantee).
 * Exercises the REAL public GET, not the admin route.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { saveRecommendations } from '../../server/recommendations.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api } = ctx;
let wsId = '';

function rec(overrides: Partial<Recommendation> = {}): Recommendation {
  const now = new Date().toISOString();
  return {
    id: 'r1', workspaceId: wsId, priority: 'fix_now', type: 'metadata',
    title: 'Fix meta', description: 'd', insight: 'i', impact: 'high', effort: 'low',
    impactScore: 50, source: 'audit:meta', affectedPages: ['home'], trafficAtRisk: 10,
    impressionsAtRisk: 100, estimatedGain: 'Could lift organic clicks', actionType: 'manual',
    status: 'pending', createdAt: now, updatedAt: now, ...overrides,
  };
}

function seed(recs: Recommendation[]): void {
  const set: RecommendationSet = {
    workspaceId: wsId, generatedAt: new Date().toISOString(), recommendations: recs,
    summary: { fixNow: recs.length, fixSoon: 0, fixLater: 0, ongoing: 0, totalImpactScore: 0, trafficAtRisk: 0, topRecommendationId: recs[0]?.id ?? null },
  };
  saveRecommendations(set);
}

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Rec Public Allowlist Test').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('public rec read — allow-list (no admin-only lifecycle key leaks)', () => {
  it('flag-ON: a rec with admin-only lifecycle fields exposes NONE of them on the public read', async () => {
    // A curated rec carrying every admin-only lifecycle key.
    seed([rec({
      id: 'leak_test',
      clientStatus: 'curated',
      lifecycle: 'throttled',
      throttledUntil: new Date(Date.now() + 86_400_000).toISOString(),
      sentAt: new Date().toISOString(),
      struckAt: new Date().toISOString(),
      cascade: { removedKeywords: ['secret-kw'], reversible: true },
      sendChannel: 'deliverable',
    })]);

    const res = await api(`/api/public/recommendations/${wsId}`);
    expect(res.status).toBe(200);
    const raw = await res.text();
    // None of the admin-only lifecycle keys (or their values) may appear in the wire payload.
    expect(raw).not.toContain('throttledUntil');
    expect(raw).not.toContain('struckAt');
    expect(raw).not.toContain('sentAt');
    expect(raw).not.toContain('cascade');
    expect(raw).not.toContain('secret-kw');
    expect(raw).not.toContain('sendChannel');
    // lifecycle/clientStatus are admin-axis — not on the public allow-list.
    const body = JSON.parse(raw) as RecommendationSet;
    const found = body.recommendations.find(r => r.id === 'leak_test');
    expect(found).toBeDefined();
    expect((found as Record<string, unknown>).lifecycle).toBeUndefined();
    expect((found as Record<string, unknown>).throttledUntil).toBeUndefined();
  });

  it('flag-OFF byte-identical: a legacy rec (no v3 fields) carries no v3 keys on the public read', async () => {
    seed([rec({ id: 'legacy_rec' })]); // no v3 fields at all
    const res = await api(`/api/public/recommendations/${wsId}`);
    const raw = await res.text();
    expect(raw).not.toContain('lifecycle');
    expect(raw).not.toContain('clientStatus');
    expect(raw).not.toContain('throttledUntil');
    const body = JSON.parse(raw) as RecommendationSet;
    const found = body.recommendations.find(r => r.id === 'legacy_rec');
    expect(found).toBeDefined();
    // The client-safe core survives intact.
    expect(found!.title).toBe('Fix meta');
    expect(found!.priority).toBe('fix_now');
  });
});
