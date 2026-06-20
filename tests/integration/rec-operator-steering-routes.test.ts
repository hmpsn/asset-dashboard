/**
 * The Issue — operator-steering ADMIN ROUTES.
 *
 * Exercises the four steering endpoints over the REAL admin router (HMAC-gated; the ephemeral
 * context injects the admin token via ctx.auth*):
 *
 *   PATCH /api/recommendations/:ws/:recId/wording   — correct a rec's wording
 *     · over-cap title/insight → 400
 *     · valid override applied in the admin GET /api/recommendations serialization
 *     · a blank field clears that override (source wording returns)
 *   POST  /api/recommendations/:ws/manual-rec        — add a rec the system missed
 *     · type 'cannibalization' (not in MANUAL_REC_ALLOWED_TYPES) → 400
 *     · valid mint → present in the set with a `manual:` source, clientStatus 'system',
 *       lifecycle 'active', status 'pending' (two-axis invariant)
 *   PATCH /api/recommendations/:ws/reorder           — set the client running order
 *     · a non-curated / absent recId → 400
 *     · valid order persisted (GET operator-overrides reflects it)
 *   GET   /api/recommendations/:ws/operator-overrides — the two override maps
 *
 * In-process server modules seed the rec set (same DATA_DIR); HTTP calls hit the spawned server.
 * Full cleanup, no git writes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import db from '../../server/db/index.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { createEphemeralTestContext } from './helpers.js';
import {
  saveRecommendations,
  loadRecommendations,
  computeRecommendationSummary,
} from '../../server/recommendations.js';
import {
  REC_WORDING_TITLE_MAX,
  REC_WORDING_INSIGHT_MAX,
  type OperatorOverridesResponse,
} from '../../shared/types/rec-operator-steering.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';

const ctx = createEphemeralTestContext(import.meta.url);

let seeded: SeededFullWorkspace;
let wsId = '';

function rec(overrides: Partial<Recommendation> = {}): Recommendation {
  const now = new Date().toISOString();
  return {
    id: 'r', workspaceId: wsId, priority: 'fix_soon', type: 'metadata',
    title: 'Source title', description: 'd', insight: 'Source insight', impact: 'medium', effort: 'medium',
    impactScore: 50, source: 'audit:title', affectedPages: [], trafficAtRisk: 0,
    impressionsAtRisk: 0, estimatedGain: 'g', actionType: 'manual',
    status: 'pending', createdAt: now, updatedAt: now, ...overrides,
  };
}

function seedSet(recs: Recommendation[]): void {
  const set: RecommendationSet = {
    workspaceId: wsId,
    generatedAt: new Date().toISOString(),
    recommendations: recs,
    summary: computeRecommendationSummary(recs),
  };
  saveRecommendations(set);
}

async function adminGetRecs(): Promise<Recommendation[]> {
  const res = await ctx.authApi(`/api/recommendations/${wsId}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as RecommendationSet).recommendations;
}

beforeAll(async () => {
  await ctx.startServer();
  seeded = seedWorkspace();
  wsId = seeded.workspaceId;
}, 30_000);

afterAll(async () => {
  db.prepare('DELETE FROM rec_operator_override WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM recommendation_sets WHERE workspace_id = ?').run(wsId);
  await ctx.stopServer();
  seeded.cleanup();
});

describe('PATCH /api/recommendations/:ws/:recId/wording', () => {
  it('rejects an over-cap title with 400', async () => {
    seedSet([rec({ id: 'w1' })]);
    const res = await ctx.authPatchJson(`/api/recommendations/${wsId}/w1/wording`, {
      title: 'x'.repeat(REC_WORDING_TITLE_MAX + 1),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an over-cap insight with 400', async () => {
    seedSet([rec({ id: 'w1' })]);
    const res = await ctx.authPatchJson(`/api/recommendations/${wsId}/w1/wording`, {
      insight: 'y'.repeat(REC_WORDING_INSIGHT_MAX + 1),
    });
    expect(res.status).toBe(400);
  });

  it('404s for a recId not in the set', async () => {
    seedSet([rec({ id: 'w1' })]);
    const res = await ctx.authPatchJson(`/api/recommendations/${wsId}/does-not-exist/wording`, {
      title: 'Corrected',
    });
    expect(res.status).toBe(404);
  });

  it('applies a valid wording override in the admin GET serialization', async () => {
    seedSet([rec({ id: 'w1', title: 'Source title', insight: 'Source insight' })]);
    const res = await ctx.authPatchJson(`/api/recommendations/${wsId}/w1/wording`, {
      title: 'Corrected title',
      insight: 'Corrected insight',
    });
    expect(res.status).toBe(200);

    const recs = await adminGetRecs();
    const w1 = recs.find(r => r.id === 'w1')!;
    expect(w1.title).toBe('Corrected title');
    expect(w1.insight).toBe('Corrected insight');

    // No baking: the stored blob still has the source wording.
    const stored = loadRecommendations(wsId)!.recommendations.find(r => r.id === 'w1')!;
    expect(stored.title).toBe('Source title');
    expect(stored.insight).toBe('Source insight');
  });

  it('a blank field clears that override (source wording returns in the admin GET)', async () => {
    seedSet([rec({ id: 'w1', title: 'Source title' })]);
    await ctx.authPatchJson(`/api/recommendations/${wsId}/w1/wording`, { title: 'Corrected title' });
    await ctx.authPatchJson(`/api/recommendations/${wsId}/w1/wording`, { title: '' });

    const recs = await adminGetRecs();
    expect(recs.find(r => r.id === 'w1')!.title).toBe('Source title');
  });

  it('MERGE over HTTP — a later title-only PATCH preserves the existing insight override', async () => {
    // Guards the trust-critical merge through the real request path: a title-only edit must NOT
    // clobber the insight override (which would mask a regenerated insight). Absent JSON key ⇒
    // undefined ⇒ preserved.
    seedSet([rec({ id: 'w1', title: 'Source title', insight: 'Source insight' })]);
    await ctx.authPatchJson(`/api/recommendations/${wsId}/w1/wording`, { title: 'T', insight: 'I' });
    await ctx.authPatchJson(`/api/recommendations/${wsId}/w1/wording`, { title: 'T2' }); // insight key absent

    const w1 = (await adminGetRecs()).find(r => r.id === 'w1')!;
    expect(w1.title).toBe('T2');
    expect(w1.insight).toBe('I'); // PRESERVED — not cleared by the partial PATCH
  });
});

describe('POST /api/recommendations/:ws/manual-rec', () => {
  it('rejects a disallowed type (cannibalization) with 400', async () => {
    seedSet([]);
    const res = await ctx.authPostJson(`/api/recommendations/${wsId}/manual-rec`, {
      type: 'cannibalization',
      title: 'Manual cannibalization',
      insight: 'should be blocked',
    });
    expect(res.status).toBe(400);
  });

  it('mints a valid manual rec with a manual: source and the right two-axis defaults', async () => {
    seedSet([]);
    const res = await ctx.authPostJson(`/api/recommendations/${wsId}/manual-rec`, {
      type: 'content',
      title: 'Write a pillar page on X',
      insight: 'The system missed this gap.',
      priority: 'fix_soon',
    });
    expect(res.status).toBe(200);
    const minted = (await res.json()) as Recommendation;
    expect(minted.source.startsWith('manual:')).toBe(true);
    expect(minted.type).toBe('content');
    expect(minted.actionType).toBe('manual');
    // Two-axis invariant: minted as system/active/pending — never abuses RecStatus.
    expect(minted.clientStatus).toBe('system');
    expect(minted.lifecycle).toBe('active');
    expect(minted.status).toBe('pending');

    // Present in the persisted set.
    const stored = loadRecommendations(wsId)!.recommendations.find(r => r.id === minted.id);
    expect(stored).toBeDefined();
    expect(stored!.title).toBe('Write a pillar page on X');
  });
});

describe('PATCH /api/recommendations/:ws/reorder', () => {
  it('rejects an order containing a non-curated recId with 400', async () => {
    // 'sys' is clientStatus 'system' → NOT curated; reorder must reject it.
    seedSet([
      rec({ id: 'sent1', clientStatus: 'sent', sentAt: new Date().toISOString() }),
      rec({ id: 'sys', clientStatus: 'system' }),
    ]);
    const res = await ctx.authPatchJson(`/api/recommendations/${wsId}/reorder`, {
      recIds: ['sent1', 'sys'],
    });
    expect(res.status).toBe(400);
  });

  it('rejects an order containing an absent recId with 400', async () => {
    seedSet([rec({ id: 'sent1', clientStatus: 'sent', sentAt: new Date().toISOString() })]);
    const res = await ctx.authPatchJson(`/api/recommendations/${wsId}/reorder`, {
      recIds: ['sent1', 'ghost'],
    });
    expect(res.status).toBe(400);
  });

  it('rejects an order containing duplicate recIds with 400', async () => {
    seedSet([
      rec({ id: 'a', clientStatus: 'sent', sentAt: new Date().toISOString() }),
      rec({ id: 'b', clientStatus: 'sent', sentAt: new Date().toISOString() }),
    ]);
    const res = await ctx.authPatchJson(`/api/recommendations/${wsId}/reorder`, {
      recIds: ['a', 'a', 'b'],
    });
    expect(res.status).toBe(400);
  });

  it('persists a valid reorder; GET operator-overrides reflects 0..n-1', async () => {
    seedSet([
      rec({ id: 'a', clientStatus: 'sent', sentAt: new Date().toISOString() }),
      rec({ id: 'b', clientStatus: 'sent', sentAt: new Date().toISOString() }),
      rec({ id: 'c', clientStatus: 'discussing', sentAt: new Date().toISOString() }),
    ]);
    const res = await ctx.authPatchJson(`/api/recommendations/${wsId}/reorder`, {
      recIds: ['c', 'a', 'b'],
    });
    expect(res.status).toBe(200);

    const ovRes = await ctx.authApi(`/api/recommendations/${wsId}/operator-overrides`);
    expect(ovRes.status).toBe(200);
    const overrides = (await ovRes.json()) as OperatorOverridesResponse;
    expect(overrides.workspaceId).toBe(wsId);
    expect(overrides.sortOrder.c).toBe(0);
    expect(overrides.sortOrder.a).toBe(1);
    expect(overrides.sortOrder.b).toBe(2);
  });
});

describe('GET /api/recommendations/:ws/operator-overrides', () => {
  it('returns the wording + sortOrder maps as records keyed by recId', async () => {
    seedSet([rec({ id: 'ov1', clientStatus: 'sent', sentAt: new Date().toISOString() })]);
    await ctx.authPatchJson(`/api/recommendations/${wsId}/ov1/wording`, { title: 'Corrected' });
    await ctx.authPatchJson(`/api/recommendations/${wsId}/reorder`, { recIds: ['ov1'] });

    const res = await ctx.authApi(`/api/recommendations/${wsId}/operator-overrides`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as OperatorOverridesResponse;
    expect(body.wording.ov1?.title).toBe('Corrected');
    expect(body.sortOrder.ov1).toBe(0);
  });
});
