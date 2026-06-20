/**
 * The Issue — operator-steering PUBLIC PROJECTION (flag-gated).
 *
 * The client-facing read is the payoff: when the Issue flag is ON for a workspace, the public
 * GET /api/public/recommendations/:ws must reflect the operator's wording corrections AND the
 * operator's client running order. When the flag is OFF, the public read must be BYTE-IDENTICAL
 * to the no-override read — the steering apply is per-workspace flag-gated like the rest of the
 * Issue client read, so a non-Issue client never sees an override leak.
 *
 *   flag ON  : a wording override changes the public title/insight; a reorder changes the order.
 *   flag OFF : setting the same overrides leaves the public payload unchanged (byte-identical).
 *
 * Exercises the REAL public GET (not the admin route). Two workspaces isolate ON vs OFF. The
 * ephemeral context auto-injects admin HMAC on /api/public calls; workspaces are passwordless so
 * the soft-gated public read passes through. Full cleanup, no git writes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import db from '../../server/db/index.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { createEphemeralTestContext } from './helpers.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import {
  saveRecommendations,
  computeRecommendationSummary,
} from '../../server/recommendations.js';
import {
  setWordingOverride,
  setSortOrders,
} from '../../server/rec-operator-overrides.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api } = ctx;

let onWs: SeededFullWorkspace;
let offWs: SeededFullWorkspace;

function rec(wsId: string, overrides: Partial<Recommendation> = {}): Recommendation {
  const now = new Date().toISOString();
  return {
    id: 'r', workspaceId: wsId, priority: 'fix_soon', type: 'metadata',
    title: 'Source title', description: 'd', insight: 'Source insight', impact: 'medium', effort: 'medium',
    impactScore: 50, source: 'audit:title', affectedPages: [], trafficAtRisk: 0,
    impressionsAtRisk: 0, estimatedGain: 'g', actionType: 'manual',
    status: 'pending', createdAt: now, updatedAt: now,
    clientStatus: 'sent', sentAt: now, lifecycle: 'active', ...overrides,
  };
}

function seedSet(wsId: string, recs: Recommendation[]): void {
  const set: RecommendationSet = {
    workspaceId: wsId,
    generatedAt: new Date().toISOString(),
    recommendations: recs,
    summary: computeRecommendationSummary(recs),
  };
  saveRecommendations(set);
}

async function publicRecs(wsId: string): Promise<Recommendation[]> {
  const res = await api(`/api/public/recommendations/${wsId}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as RecommendationSet).recommendations;
}

beforeAll(async () => {
  await ctx.startServer();
  onWs = seedWorkspace({ clientPassword: '' });
  offWs = seedWorkspace({ clientPassword: '' });
  setWorkspaceFlagOverride('strategy-the-issue', onWs.workspaceId, true);
  // offWs: leave the flag at its OFF default.
}, 30_000);

afterAll(async () => {
  for (const ws of [onWs, offWs]) {
    db.prepare('DELETE FROM rec_operator_override WHERE workspace_id = ?').run(ws.workspaceId);
    db.prepare('DELETE FROM recommendation_sets WHERE workspace_id = ?').run(ws.workspaceId);
  }
  setWorkspaceFlagOverride('strategy-the-issue', onWs.workspaceId, null);
  await ctx.stopServer();
  onWs.cleanup();
  offWs.cleanup();
});

describe('public projection — flag ON applies overrides', () => {
  it('reflects a wording override on the public read', async () => {
    const wsId = onWs.workspaceId;
    seedSet(wsId, [rec(wsId, { id: 'p1', title: 'Source title', insight: 'Source insight' })]);
    setWordingOverride(wsId, 'p1', { title: 'Operator title', insight: 'Operator insight' });

    const recs = await publicRecs(wsId);
    const p1 = recs.find(r => r.id === 'p1')!;
    expect(p1.title).toBe('Operator title');
    expect(p1.insight).toBe('Operator insight');
  });

  it('reflects the operator running order (operator-ordered recs lead, in the chosen order)', async () => {
    const wsId = onWs.workspaceId;
    const now = new Date().toISOString();
    seedSet(wsId, [
      rec(wsId, { id: 'a', createdAt: now }),
      rec(wsId, { id: 'b', createdAt: now }),
      rec(wsId, { id: 'c', createdAt: now }),
    ]);
    // Operator pulls 'c' to the front, then 'a', then 'b'.
    setSortOrders(wsId, ['c', 'a', 'b']);

    const ids = (await publicRecs(wsId)).map(r => r.id);
    // The operator-ordered ids appear first, in the operator's order.
    expect(ids.slice(0, 3)).toEqual(['c', 'a', 'b']);
  });
});

describe('public projection — flag OFF is byte-identical', () => {
  it('setting wording + sort overrides does NOT change the public payload when the flag is off', async () => {
    const wsId = offWs.workspaceId;
    const now = new Date().toISOString();
    seedSet(wsId, [
      rec(wsId, { id: 'x', title: 'Source X', createdAt: now }),
      rec(wsId, { id: 'y', title: 'Source Y', createdAt: now }),
    ]);

    // Baseline read with NO overrides applied (flag off → nothing applied anyway).
    const before = await api(`/api/public/recommendations/${wsId}`);
    const beforeBody = await before.text();

    // Now set both kinds of override.
    setWordingOverride(wsId, 'x', { title: 'Operator X', insight: 'Operator insight' });
    setSortOrders(wsId, ['y', 'x']);

    const after = await api(`/api/public/recommendations/${wsId}`);
    const afterBody = await after.text();

    // BYTE-IDENTICAL: the flag-OFF public read ignores the overrides entirely.
    expect(afterBody).toBe(beforeBody);
    // Sanity: the source wording (not the operator override) is what the client sees.
    const recs = JSON.parse(afterBody).recommendations as Recommendation[];
    expect(recs.find(r => r.id === 'x')!.title).toBe('Source X');
    expect(recs.map(r => r.id)).toEqual(['x', 'y']); // natural order preserved
  });
});
