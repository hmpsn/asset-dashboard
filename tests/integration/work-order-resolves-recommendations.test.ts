/**
 * Integration test for Task 1.1 — completing a work order resolves the
 * recommendations covering its pages, in-process via updateWorkOrder().
 *
 * This exercises the real wiring added in server/work-orders.ts (not a replica):
 * updateWorkOrder(status:'completed') resolves the work order's pageIds (which
 * are Webflow/page IDs — the page_edit_states key) to their SLUGS via
 * getPageState(), then calls resolveRecommendationsForChange() which matches
 * recommendation.affectedPages (slugs). The test deliberately seeds page IDs
 * that DIFFER from the rec slugs and registers the id→slug mapping, so it FAILS
 * against the earlier (pre-fix) code that passed raw page IDs to the slug matcher.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';

import { setBroadcast } from '../../server/broadcast.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { createWorkOrder, updateWorkOrder } from '../../server/work-orders.js';
import { updatePageState } from '../../server/page-edit-states.js';
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
  it('resolves recs by mapping Webflow/CMS page IDs to slugs (static + CMS)', () => {
    // Page IDs are deliberately NOT slugs — a Webflow-style native id and a
    // cms-* id, each mapped to its slug via page_edit_states.
    const STATIC_PAGE_ID = 'wf-6471abc-services-001';
    const CMS_PAGE_ID = 'cms-blog-guide';
    updatePageState(ws.workspaceId, STATIC_PAGE_ID, { slug: 'services', status: 'in_review' });
    updatePageState(ws.workspaceId, CMS_PAGE_ID, { slug: 'blog/guide', status: 'in_review' });

    seedRecs(ws.workspaceId, [
      makeRec(ws.workspaceId, { id: 'rec_static', affectedPages: ['services'], status: 'pending' }),
      makeRec(ws.workspaceId, { id: 'rec_cms', affectedPages: ['blog/guide'], status: 'pending' }),
      makeRec(ws.workspaceId, { id: 'rec_other', affectedPages: ['about'], status: 'pending' }),
    ]);

    const order = createWorkOrder(ws.workspaceId, {
      paymentId: `pay_${Math.random().toString(36).slice(2, 8)}`,
      productType: 'fix_meta',
      pageIds: [STATIC_PAGE_ID, CMS_PAGE_ID],
    });

    updateWorkOrder(ws.workspaceId, order.id, { status: 'in_progress' });
    updateWorkOrder(ws.workspaceId, order.id, { status: 'completed', completedAt: new Date().toISOString() });

    const stored = loadRecommendations(ws.workspaceId)!;
    // Both covered recs resolve via the id→slug mapping...
    expect(stored.recommendations.find(r => r.id === 'rec_static')!.status).toBe('completed');
    expect(stored.recommendations.find(r => r.id === 'rec_cms')!.status).toBe('completed');
    // ...the uncovered rec stays active.
    expect(stored.recommendations.find(r => r.id === 'rec_other')!.status).toBe('pending');
    // Summary is recomputed so headline counts don't stay inflated.
    expect(stored.summary.fixNow).toBe(1); // only rec_other remains active
  });

  it('resolves nothing (and does not throw) when a page ID has no slug mapping', () => {
    seedRecs(ws.workspaceId, [
      makeRec(ws.workspaceId, { id: 'rec_keep', affectedPages: ['services'], status: 'pending' }),
    ]);

    const order = createWorkOrder(ws.workspaceId, {
      paymentId: `pay_${Math.random().toString(36).slice(2, 8)}`,
      productType: 'fix_meta',
      pageIds: ['wf-unmapped-page-999'], // no page_edit_states row → no slug
    });

    updateWorkOrder(ws.workspaceId, order.id, { status: 'in_progress' });
    expect(() =>
      updateWorkOrder(ws.workspaceId, order.id, { status: 'completed', completedAt: new Date().toISOString() }),
    ).not.toThrow();

    const stored = loadRecommendations(ws.workspaceId)!;
    expect(stored.recommendations.find(r => r.id === 'rec_keep')!.status).toBe('pending');
  });

  it('does not resolve recs when the order is cancelled, not completed', () => {
    const STATIC_PAGE_ID = 'wf-6471abc-services-002';
    updatePageState(ws.workspaceId, STATIC_PAGE_ID, { slug: 'services', status: 'in_review' });
    seedRecs(ws.workspaceId, [
      makeRec(ws.workspaceId, { id: 'rec_keep', affectedPages: ['services'], status: 'pending' }),
    ]);

    const order = createWorkOrder(ws.workspaceId, {
      paymentId: `pay_${Math.random().toString(36).slice(2, 8)}`,
      productType: 'fix_meta',
      pageIds: [STATIC_PAGE_ID],
    });

    updateWorkOrder(ws.workspaceId, order.id, { status: 'cancelled' });

    const stored = loadRecommendations(ws.workspaceId)!;
    expect(stored.recommendations.find(r => r.id === 'rec_keep')!.status).toBe('pending');
  });
});
