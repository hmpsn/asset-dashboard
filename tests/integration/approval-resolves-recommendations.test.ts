/**
 * Integration test for Task 1.1 — approving a SEO approval item resolves the
 * recommendations covering its page, exercised over the real HTTP route.
 *
 * PATCH /api/public/approvals/:workspaceId/:batchId/:itemId { status: 'approved' }
 * runs in the spawned server (where broadcast is initialised) and calls
 * resolveRecommendationsForChange() after its DB writes. The matching rec must
 * drop to 'completed' and out of the active priority list. A rejection must NOT
 * resolve the rec (the client declined the fix).
 *
 * Recs + approval batches are seeded in-process; the spawned server shares the
 * worker-local SQLite DB, so HTTP reads/writes see the seeded rows (same pattern
 * as recommendation-resolution.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createBatch } from '../../server/approvals.js';
import { saveRecommendations, loadRecommendations } from '../../server/recommendations.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';

const ctx = createTestContext(13872); // port-ok: next free port above 13871
const { patchJson } = ctx;

let testWsId = '';
const SITE_ID = 'test-site-approval-resolve';

function makeRec(overrides: Partial<Recommendation> = {}): Recommendation {
  const now = new Date().toISOString();
  return {
    id: `rec_${Math.random().toString(36).slice(2, 10)}`,
    workspaceId: testWsId,
    priority: 'fix_now',
    type: 'metadata',
    title: 'Fix the title',
    description: 'desc',
    insight: 'why',
    impact: 'high',
    effort: 'low',
    impactScore: 80,
    source: 'audit:title',
    affectedPages: ['services'],
    trafficAtRisk: 100,
    impressionsAtRisk: 1000,
    estimatedGain: 'gain',
    actionType: 'manual',
    status: 'pending',
    assignedTo: 'client',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function seedRecs(recs: Recommendation[]): void {
  const set: RecommendationSet = {
    workspaceId: testWsId,
    generatedAt: new Date().toISOString(),
    recommendations: recs,
    summary: {
      fixNow: 0, fixSoon: 0, fixLater: 0, ongoing: 0,
      totalImpactScore: 0, trafficAtRisk: 0,
      estimatedRecoverableClicks: 0, estimatedRecoverableImpressions: 0,
    },
  };
  saveRecommendations(set);
}

beforeAll(async () => {
  await ctx.startServer();
  testWsId = createWorkspace('Approval Resolve Recs Test').id; // passwordless → portal auth passes
}, 25_000);

afterAll(async () => {
  deleteWorkspace(testWsId);
  await ctx.stopServer();
});

beforeEach(() => {
  // Clear any prior rec set for a clean slate per test.
  seedRecs([]);
});

describe('approving a SEO item resolves matching recommendations', () => {
  it('marks the rec covering the approved page as completed', async () => {
    const batch = createBatch(testWsId, SITE_ID, 'Resolve batch', [
      { pageId: 'page-services', pageTitle: 'Services', pageSlug: 'services', publishedPath: '/services', field: 'seoTitle', currentValue: 'old', proposedValue: 'new' },
    ]);
    seedRecs([
      makeRec({ id: 'rec_services', affectedPages: ['services'], status: 'pending' }),
      makeRec({ id: 'rec_about', affectedPages: ['about'], status: 'pending' }),
    ]);

    const res = await patchJson(
      `/api/public/approvals/${testWsId}/${batch.id}/${batch.items[0].id}`,
      { status: 'approved' },
    );
    expect(res.status).toBe(200);

    const stored = loadRecommendations(testWsId)!;
    expect(stored.recommendations.find(r => r.id === 'rec_services')!.status).toBe('completed');
    expect(stored.recommendations.find(r => r.id === 'rec_about')!.status).toBe('pending');
  });

  it('rejecting an item does NOT resolve the rec', async () => {
    const batch = createBatch(testWsId, SITE_ID, 'Reject batch', [
      { pageId: 'page-services', pageTitle: 'Services', pageSlug: 'services', publishedPath: '/services', field: 'seoTitle', currentValue: 'old', proposedValue: 'new' },
    ]);
    seedRecs([makeRec({ id: 'rec_keep', affectedPages: ['services'], status: 'pending' })]);

    const res = await patchJson(
      `/api/public/approvals/${testWsId}/${batch.id}/${batch.items[0].id}`,
      { status: 'rejected', clientNote: 'no thanks' },
    );
    expect(res.status).toBe(200);

    const stored = loadRecommendations(testWsId)!;
    expect(stored.recommendations.find(r => r.id === 'rec_keep')!.status).toBe('pending');
  });
});
