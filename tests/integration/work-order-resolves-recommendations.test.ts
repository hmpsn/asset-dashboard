/**
 * Integration test for Task 1.1 — completing a work order resolves the
 * recommendations covering its pages, in-process via updateWorkOrder().
 *
 * This exercises the real wiring added in server/work-orders.ts (not a replica):
 * updateWorkOrder(status:'completed') → resolveRecommendationsForChange() marks
 * matching recs 'completed' so they leave the active priority list immediately.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';

import { setBroadcast } from '../../server/broadcast.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { createWorkOrder, updateWorkOrder } from '../../server/work-orders.js';
import { saveRecommendations, loadRecommendations } from '../../server/recommendations.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';

beforeAll(() => {
  // Boot a no-op broadcast so resolveRecommendationsForChange() can broadcast
  // without the "called before init" throw (no Express server in this process).
  setBroadcast(() => {}, () => {});
});

let ws: SeededFullWorkspace;

function makeRec(wsId: string, overrides: Partial<Recommendation> = {}): Recommendation {
  const now = new Date().toISOString();
  return {
    id: `rec_${Math.random().toString(36).slice(2, 10)}`,
    workspaceId: wsId,
    priority: 'fix_now',
    type: 'metadata',
    title: 'Fix it',
    description: 'desc',
    insight: 'why',
    impact: 'high',
    effort: 'low',
    impactScore: 70,
    source: 'audit:title',
    affectedPages: ['services'],
    trafficAtRisk: 100,
    impressionsAtRisk: 1000,
    estimatedGain: 'gain',
    actionType: 'manual',
    status: 'pending',
    assignedTo: 'team',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function seedRecs(wsId: string, recs: Recommendation[]): void {
  const set: RecommendationSet = {
    workspaceId: wsId,
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

beforeEach(() => {
  ws = seedWorkspace();
});

afterEach(() => {
  ws.cleanup();
});

describe('work-order completion resolves matching recommendations', () => {
  it('marks a pending rec covering a completed order page as completed', () => {
    seedRecs(ws.workspaceId, [
      makeRec(ws.workspaceId, { id: 'rec_match', affectedPages: ['services'], status: 'pending' }),
      makeRec(ws.workspaceId, { id: 'rec_other', affectedPages: ['about'], status: 'pending' }),
    ]);

    const order = createWorkOrder(ws.workspaceId, {
      paymentId: `pay_${Math.random().toString(36).slice(2, 8)}`,
      productType: 'fix_meta',
      pageIds: ['services'],
    });

    updateWorkOrder(ws.workspaceId, order.id, { status: 'in_progress' });
    updateWorkOrder(ws.workspaceId, order.id, { status: 'completed', completedAt: new Date().toISOString() });

    const stored = loadRecommendations(ws.workspaceId)!;
    expect(stored.recommendations.find(r => r.id === 'rec_match')!.status).toBe('completed');
    // Non-covered rec is untouched and still active.
    expect(stored.recommendations.find(r => r.id === 'rec_other')!.status).toBe('pending');
  });

  it('does not resolve recs when the order is cancelled, not completed', () => {
    seedRecs(ws.workspaceId, [
      makeRec(ws.workspaceId, { id: 'rec_keep', affectedPages: ['services'], status: 'pending' }),
    ]);

    const order = createWorkOrder(ws.workspaceId, {
      paymentId: `pay_${Math.random().toString(36).slice(2, 8)}`,
      productType: 'fix_meta',
      pageIds: ['services'],
    });

    updateWorkOrder(ws.workspaceId, order.id, { status: 'cancelled' });

    const stored = loadRecommendations(ws.workspaceId)!;
    expect(stored.recommendations.find(r => r.id === 'rec_keep')!.status).toBe('pending');
  });
});
