/**
 * Integration tests for the recommendation resolution lifecycle.
 *
 * Covers:
 * - Seeding a recommendation set and reading it back via GET
 * - Resolving (completing) a recommendation → status updates to 'completed'
 * - Dismissing a recommendation → status updates to 'dismissed'
 * - List filtering by status (?status=resolved / ?status=dismissed / default active)
 * - After resolution, the rec does not appear in the default (active) list
 * - Invalid transition attempts (already-completed/dismissed recs with wrong status values)
 * - Resolving multiple recs in sequence
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { saveRecommendations, loadRecommendations } from '../../server/recommendations.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';

const ctx = createTestContext(13568); // port-ok: 13201-13567 already allocated in integration suite
const { api, patchJson, del } = ctx;

let testWsId = '';

/** Build a minimal valid Recommendation for seeding. */
function makeRec(overrides: Partial<Recommendation> = {}): Recommendation {
  const now = new Date().toISOString();
  return {
    id: `rec_test_${Math.random().toString(36).slice(2, 10)}`,
    workspaceId: testWsId,
    priority: 'fix_now',
    type: 'metadata',
    title: 'Test recommendation',
    description: 'Fix the meta description on the homepage.',
    insight: 'The homepage is missing a meta description which hurts CTR.',
    impact: 'high',
    effort: 'low',
    impactScore: 75,
    source: 'audit:meta-description',
    affectedPages: ['home'],
    trafficAtRisk: 200,
    impressionsAtRisk: 5000,
    estimatedGain: 'Fixing this could increase organic clicks by 5-15% on 1 affected page',
    actionType: 'manual',
    status: 'pending',
    assignedTo: 'client',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Seed a RecommendationSet directly into the DB (bypasses external API calls). */
function seedRecommendationSet(recs: Recommendation[]): void {
  const set: RecommendationSet = {
    workspaceId: testWsId,
    generatedAt: new Date().toISOString(),
    recommendations: recs,
    summary: {
      fixNow: recs.filter(r => r.priority === 'fix_now' && r.status === 'pending').length,
      fixSoon: recs.filter(r => r.priority === 'fix_soon' && r.status === 'pending').length,
      fixLater: recs.filter(r => r.priority === 'fix_later' && r.status === 'pending').length,
      ongoing: recs.filter(r => r.priority === 'ongoing' && r.status === 'pending').length,
      totalImpactScore: recs.reduce((s, r) => s + r.impactScore, 0),
      trafficAtRisk: recs.reduce((s, r) => s + r.trafficAtRisk, 0),
      estimatedRecoverableClicks: 24,
      estimatedRecoverableImpressions: 600,
    },
  };
  saveRecommendations(set);
}

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Rec Resolution Test Workspace');
  testWsId = ws.id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(testWsId);
  await ctx.stopServer();
});

// ─── 1. Read / list ─────────────────────────────────────────────────────────

describe('Recommendations — seeded GET', () => {
  it('GET returns the seeded recommendation set with expected fields', async () => {
    const rec = makeRec({ id: 'rec_read_test_001' });
    seedRecommendationSet([rec]);

    const res = await api(`/api/public/recommendations/${testWsId}`);
    expect(res.status).toBe(200);

    const body = await res.json() as RecommendationSet;
    expect(body.workspaceId).toBe(testWsId);
    expect(body.recommendations).toBeInstanceOf(Array);
    expect(body.recommendations.length).toBeGreaterThanOrEqual(1);

    const found = body.recommendations.find(r => r.id === 'rec_read_test_001');
    expect(found).toBeDefined();
    expect(found!.status).toBe('pending');
    expect(found!.title).toBe('Test recommendation');
    expect(found!.priority).toBe('fix_now');
    expect(found!.impactScore).toBe(75);
  });
});

// ─── 2. Resolution lifecycle ────────────────────────────────────────────────

describe('Recommendations — resolution (completed)', () => {
  it('PATCH status=completed → 200, status updated in response', async () => {
    const rec = makeRec({ id: 'rec_resolve_001', status: 'pending' });
    seedRecommendationSet([rec]);

    const res = await patchJson(
      `/api/public/recommendations/${testWsId}/rec_resolve_001`,
      { status: 'completed' },
    );
    expect(res.status).toBe(200);

    const body = await res.json() as Recommendation;
    expect(body.id).toBe('rec_resolve_001');
    expect(body.status).toBe('completed');
  });

  it('resolved rec is persisted — subsequent GET reflects completed status', async () => {
    const rec = makeRec({ id: 'rec_resolve_002', status: 'pending' });
    seedRecommendationSet([rec]);

    await patchJson(
      `/api/public/recommendations/${testWsId}/rec_resolve_002`,
      { status: 'completed' },
    );

    const res = await api(`/api/public/recommendations/${testWsId}?status=completed`);
    expect(res.status).toBe(200);
    const body = await res.json() as RecommendationSet;
    const found = body.recommendations.find(r => r.id === 'rec_resolve_002');
    expect(found).toBeDefined();
    expect(found!.status).toBe('completed');
  });

  it('PATCH status=in_progress → 200, status updated', async () => {
    const rec = makeRec({ id: 'rec_in_progress_001', status: 'pending' });
    seedRecommendationSet([rec]);

    const res = await patchJson(
      `/api/public/recommendations/${testWsId}/rec_in_progress_001`,
      { status: 'in_progress' },
    );
    expect(res.status).toBe(200);

    const body = await res.json() as Recommendation;
    expect(body.status).toBe('in_progress');
  });
});

// ─── 3. Dismissal lifecycle ─────────────────────────────────────────────────

describe('Recommendations — dismissal', () => {
  it('DELETE dismisses a recommendation → 200 { ok: true }', async () => {
    const rec = makeRec({ id: 'rec_dismiss_001', status: 'pending' });
    seedRecommendationSet([rec]);

    const res = await del(`/api/public/recommendations/${testWsId}/rec_dismiss_001`);
    expect(res.status).toBe(200);

    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('dismissed rec is persisted — subsequent GET with ?status=dismissed shows it', async () => {
    const rec = makeRec({ id: 'rec_dismiss_002', status: 'pending' });
    seedRecommendationSet([rec]);

    await del(`/api/public/recommendations/${testWsId}/rec_dismiss_002`);

    const res = await api(`/api/public/recommendations/${testWsId}?status=dismissed`);
    expect(res.status).toBe(200);
    const body = await res.json() as RecommendationSet;
    const found = body.recommendations.find(r => r.id === 'rec_dismiss_002');
    expect(found).toBeDefined();
    expect(found!.status).toBe('dismissed');
  });

  it('PATCH status=dismissed → 200, equivalent to DELETE dismiss path', async () => {
    const rec = makeRec({ id: 'rec_dismiss_via_patch', status: 'pending' });
    seedRecommendationSet([rec]);

    const res = await patchJson(
      `/api/public/recommendations/${testWsId}/rec_dismiss_via_patch`,
      { status: 'dismissed' },
    );
    expect(res.status).toBe(200);

    const body = await res.json() as Recommendation;
    expect(body.status).toBe('dismissed');
  });
});

// ─── 4. List filtering ──────────────────────────────────────────────────────

describe('Recommendations — list filtering by status', () => {
  beforeAll(() => {
    // Seed a set with mixed statuses for filter tests
    seedRecommendationSet([
      makeRec({ id: 'rec_filter_pending', status: 'pending' }),
      makeRec({ id: 'rec_filter_completed', status: 'completed' }),
      makeRec({ id: 'rec_filter_dismissed', status: 'dismissed' }),
      makeRec({ id: 'rec_filter_in_progress', status: 'in_progress' }),
    ]);
  });

  it('?status=pending returns only pending recs', async () => {
    const res = await api(`/api/public/recommendations/${testWsId}?status=pending`);
    expect(res.status).toBe(200);
    const body = await res.json() as RecommendationSet;
    for (const r of body.recommendations) {
      expect(r.status).toBe('pending');
    }
    const ids = body.recommendations.map(r => r.id);
    expect(ids).toContain('rec_filter_pending');
    expect(ids).not.toContain('rec_filter_completed');
    expect(ids).not.toContain('rec_filter_dismissed');
  });

  it('?status=completed returns only completed recs', async () => {
    const res = await api(`/api/public/recommendations/${testWsId}?status=completed`);
    expect(res.status).toBe(200);
    const body = await res.json() as RecommendationSet;
    for (const r of body.recommendations) {
      expect(r.status).toBe('completed');
    }
    const ids = body.recommendations.map(r => r.id);
    expect(ids).toContain('rec_filter_completed');
  });

  it('?status=dismissed returns only dismissed recs', async () => {
    const res = await api(`/api/public/recommendations/${testWsId}?status=dismissed`);
    expect(res.status).toBe(200);
    const body = await res.json() as RecommendationSet;
    for (const r of body.recommendations) {
      expect(r.status).toBe('dismissed');
    }
    const ids = body.recommendations.map(r => r.id);
    expect(ids).toContain('rec_filter_dismissed');
  });

  it('?status=in_progress returns only in_progress recs', async () => {
    const res = await api(`/api/public/recommendations/${testWsId}?status=in_progress`);
    expect(res.status).toBe(200);
    const body = await res.json() as RecommendationSet;
    for (const r of body.recommendations) {
      expect(r.status).toBe('in_progress');
    }
    const ids = body.recommendations.map(r => r.id);
    expect(ids).toContain('rec_filter_in_progress');
  });

  it('default (no ?status filter) returns all statuses', async () => {
    const res = await api(`/api/public/recommendations/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as RecommendationSet;
    const statuses = new Set(body.recommendations.map(r => r.status));
    // All four seeded statuses should appear
    expect(statuses.has('pending')).toBe(true);
    expect(statuses.has('completed')).toBe(true);
    expect(statuses.has('dismissed')).toBe(true);
    expect(statuses.has('in_progress')).toBe(true);
  });
});

// ─── 5. After resolution — active list exclusion ────────────────────────────

describe('Recommendations — resolved rec absent from active list', () => {
  it('resolved (completed) rec does not appear in ?status=pending filter', async () => {
    const rec = makeRec({ id: 'rec_active_excl_001', status: 'pending' });
    seedRecommendationSet([rec]);

    // Resolve it
    const patchRes = await patchJson(
      `/api/public/recommendations/${testWsId}/rec_active_excl_001`,
      { status: 'completed' },
    );
    expect(patchRes.status).toBe(200);

    // Should NOT appear in pending list
    const listRes = await api(`/api/public/recommendations/${testWsId}?status=pending`);
    expect(listRes.status).toBe(200);
    const body = await listRes.json() as RecommendationSet;
    const ids = body.recommendations.map(r => r.id);
    expect(ids).not.toContain('rec_active_excl_001');
  });

  it('dismissed rec does not appear in ?status=pending filter', async () => {
    const rec = makeRec({ id: 'rec_active_excl_002', status: 'pending' });
    seedRecommendationSet([rec]);

    await del(`/api/public/recommendations/${testWsId}/rec_active_excl_002`);

    const listRes = await api(`/api/public/recommendations/${testWsId}?status=pending`);
    expect(listRes.status).toBe(200);
    const body = await listRes.json() as RecommendationSet;
    const ids = body.recommendations.map(r => r.id);
    expect(ids).not.toContain('rec_active_excl_002');
  });
});

// ─── 6. Invalid status values ────────────────────────────────────────────────

describe('Recommendations — invalid status transitions rejected at API boundary', () => {
  it('PATCH with unknown status string returns 400', async () => {
    const rec = makeRec({ id: 'rec_invalid_status_001', status: 'pending' });
    seedRecommendationSet([rec]);

    const res = await patchJson(
      `/api/public/recommendations/${testWsId}/rec_invalid_status_001`,
      { status: 'resolved' }, // not a valid RecStatus value
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Valid status required');
  });

  it('PATCH with empty status body returns 400', async () => {
    const rec = makeRec({ id: 'rec_invalid_status_002', status: 'pending' });
    seedRecommendationSet([rec]);

    const res = await patchJson(
      `/api/public/recommendations/${testWsId}/rec_invalid_status_002`,
      {},
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Valid status required');
  });

  it('PATCH with null status returns 400', async () => {
    const rec = makeRec({ id: 'rec_invalid_status_003', status: 'pending' });
    seedRecommendationSet([rec]);

    const res = await patchJson(
      `/api/public/recommendations/${testWsId}/rec_invalid_status_003`,
      { status: null },
    );
    expect(res.status).toBe(400);
  });
});

// ─── 7. Multiple sequential resolutions ─────────────────────────────────────

describe('Recommendations — multiple sequential resolutions', () => {
  it('resolving several recs in sequence all succeed and each status is persisted', async () => {
    const recs = [
      makeRec({ id: 'rec_seq_001', status: 'pending', source: 'audit:title' }),
      makeRec({ id: 'rec_seq_002', status: 'pending', source: 'audit:meta-description' }),
      makeRec({ id: 'rec_seq_003', status: 'pending', source: 'audit:h1' }),
    ];
    seedRecommendationSet(recs);

    for (const rec of recs) {
      const res = await patchJson(
        `/api/public/recommendations/${testWsId}/${rec.id}`,
        { status: 'completed' },
      );
      expect(res.status, `Expected 200 for ${rec.id}`).toBe(200);
      const body = await res.json() as Recommendation;
      expect(body.status).toBe('completed');
    }

    // All three should be visible in the completed filter
    const listRes = await api(`/api/public/recommendations/${testWsId}?status=completed`);
    expect(listRes.status).toBe(200);
    const body = await listRes.json() as RecommendationSet;
    const completedIds = new Set(body.recommendations.map(r => r.id));

    expect(completedIds.has('rec_seq_001')).toBe(true);
    expect(completedIds.has('rec_seq_002')).toBe(true);
    expect(completedIds.has('rec_seq_003')).toBe(true);
  });

  it('mix of complete + dismiss in sequence — each reflects its final state', async () => {
    const recs = [
      makeRec({ id: 'rec_mix_001', status: 'pending', source: 'audit:canonical' }),
      makeRec({ id: 'rec_mix_002', status: 'pending', source: 'audit:robots' }),
    ];
    seedRecommendationSet(recs);

    // Complete the first
    const res1 = await patchJson(
      `/api/public/recommendations/${testWsId}/rec_mix_001`,
      { status: 'completed' },
    );
    expect(res1.status).toBe(200);

    // Dismiss the second
    const res2 = await del(`/api/public/recommendations/${testWsId}/rec_mix_002`);
    expect(res2.status).toBe(200);

    // Verify both persisted correctly
    const completedRes = await api(`/api/public/recommendations/${testWsId}?status=completed`);
    const completedBody = await completedRes.json() as RecommendationSet;
    expect(completedBody.recommendations.some(r => r.id === 'rec_mix_001')).toBe(true);

    const dismissedRes = await api(`/api/public/recommendations/${testWsId}?status=dismissed`);
    const dismissedBody = await dismissedRes.json() as RecommendationSet;
    expect(dismissedBody.recommendations.some(r => r.id === 'rec_mix_002')).toBe(true);
  });
});

// ─── 8. Not-found handling ──────────────────────────────────────────────────

describe('Recommendations — not-found handling', () => {
  it('PATCH on unknown recId returns 404', async () => {
    seedRecommendationSet([makeRec({ id: 'rec_exists_001' })]);

    const res = await patchJson(
      `/api/public/recommendations/${testWsId}/rec_does_not_exist`,
      { status: 'completed' },
    );
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Recommendation not found');
  });

  it('DELETE on unknown recId returns 404', async () => {
    seedRecommendationSet([makeRec({ id: 'rec_exists_002' })]);

    const res = await del(`/api/public/recommendations/${testWsId}/rec_does_not_exist`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Recommendation not found');
  });
});

// ─── 9. Direct DB state verification ────────────────────────────────────────

describe('Recommendations — DB state consistency', () => {
  it('loadRecommendations reflects PATCH-mutated status without another HTTP GET', async () => {
    const rec = makeRec({ id: 'rec_db_check_001', status: 'pending' });
    seedRecommendationSet([rec]);

    await patchJson(
      `/api/public/recommendations/${testWsId}/rec_db_check_001`,
      { status: 'in_progress' },
    );

    // Read directly from DB via the module function (same process in test env)
    const stored = loadRecommendations(testWsId);
    expect(stored).not.toBeNull();
    const storedRec = stored!.recommendations.find(r => r.id === 'rec_db_check_001');
    expect(storedRec).toBeDefined();
    expect(storedRec!.status).toBe('in_progress');
  });
});
