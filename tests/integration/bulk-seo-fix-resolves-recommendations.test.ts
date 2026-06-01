/**
 * Integration test for FIX A — the bulk-seo-fix background job resolves the
 * recommendations covering the pages it fixed.
 *
 * The bulk-seo-fix job (server/routes/jobs.ts) applies AI-generated SEO titles/
 * descriptions, writes live page state, then in its post-loop block calls
 * resolveRecommendationsForPageIds(workspaceId, appliedPageIds) — the shared
 * helper that maps Webflow/page IDs (the page_edit_states key) to their SLUGS via
 * getPageState() before matching recommendation.affectedPages (slugs).
 *
 * Driving the full async AI+Webflow job end-to-end is infeasible in a unit test
 * (the integration server runs in a spawned process where AI/Webflow can't be
 * stubbed), so this exercises the exact resolver wiring the job's post-loop block
 * invokes — seeding page_edit_states id→slug mappings that DIFFER from the rec
 * slugs (mirroring the Phase-1 work-order test) so it FAILS against code that
 * passes raw page IDs to the slug matcher or never resolves at all.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';

import { setBroadcast } from '../../server/broadcast.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { updatePageState } from '../../server/page-edit-states.js';
import {
  resolveRecommendationsForPageIds,
  saveRecommendations,
  loadRecommendations,
} from '../../server/recommendations.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';

beforeAll(() => {
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

describe('bulk-seo-fix post-loop resolver (resolveRecommendationsForPageIds)', () => {
  it('resolves recs by mapping the applied Webflow page IDs to their slugs', () => {
    // The applied page IDs are deliberately NOT the slugs — Webflow native ids
    // mapped to slugs via page_edit_states (the bulk-seo-fix updatePageState write).
    const PAGE_ID_A = 'wf-native-services-aaa';
    const PAGE_ID_B = 'wf-native-pricing-bbb';
    updatePageState(ws.workspaceId, PAGE_ID_A, { slug: 'services', status: 'live' });
    updatePageState(ws.workspaceId, PAGE_ID_B, { slug: 'pricing', status: 'live' });

    seedRecs(ws.workspaceId, [
      makeRec(ws.workspaceId, { id: 'rec_services', affectedPages: ['services'], status: 'pending' }),
      makeRec(ws.workspaceId, { id: 'rec_pricing', affectedPages: ['pricing'], status: 'pending' }),
      makeRec(ws.workspaceId, { id: 'rec_other', affectedPages: ['about'], status: 'pending' }),
    ]);

    const resolved = resolveRecommendationsForPageIds(ws.workspaceId, [PAGE_ID_A, PAGE_ID_B]);
    expect(resolved).toBe(2);

    const stored = loadRecommendations(ws.workspaceId)!;
    expect(stored.recommendations.find(r => r.id === 'rec_services')!.status).toBe('completed');
    expect(stored.recommendations.find(r => r.id === 'rec_pricing')!.status).toBe('completed');
    // The page the bulk fix did NOT touch stays active.
    expect(stored.recommendations.find(r => r.id === 'rec_other')!.status).toBe('pending');
    // Summary recomputed so headline counts don't stay inflated.
    expect(stored.summary.fixNow).toBe(1); // only rec_other remains active
  });

  it('resolves nothing (and returns 0, does not throw) when a page ID has no slug mapping', () => {
    seedRecs(ws.workspaceId, [
      makeRec(ws.workspaceId, { id: 'rec_keep', affectedPages: ['services'], status: 'pending' }),
    ]);

    let resolved = -1;
    expect(() => {
      resolved = resolveRecommendationsForPageIds(ws.workspaceId, ['wf-unmapped-999']);
    }).not.toThrow();
    expect(resolved).toBe(0);

    const stored = loadRecommendations(ws.workspaceId)!;
    expect(stored.recommendations.find(r => r.id === 'rec_keep')!.status).toBe('pending');
  });
});
