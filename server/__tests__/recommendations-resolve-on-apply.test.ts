// @vitest-environment node
/**
 * Unit tests for resolveRecommendationsForChange().
 *
 * Verifies the in-place resolution helper used by the approvals apply path,
 * per-item approve/reject, and work-order completion:
 * - non-completed recs whose affectedPages intersect the changed pages are
 *   marked 'completed' (via validateTransition)
 * - already completed/dismissed recs are left untouched
 * - the `source` filter, when provided, scopes resolution to matching recs
 * - non-intersecting recs are untouched
 * - returns the count of recs it resolved
 *
 * Broadcast is stubbed via setBroadcast() because the unit-test process does not
 * boot the Express server (which is what normally initialises the singleton).
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

import db from '../db/index.js';
import { setBroadcast } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import {
  saveRecommendations,
  loadRecommendations,
  resolveRecommendationsForChange,
} from '../recommendations.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';

// FK enforcement is OFF in the test env (tests/db-setup.ts) — ad-hoc workspace IDs are fine.
const WS_ID = 'test-ws-resolve-on-apply';

const broadcastSpy = vi.fn();

beforeAll(() => {
  // Install a no-op broadcast so resolveRecommendationsForChange() can call
  // broadcastToWorkspace() without the "called before init" throw.
  setBroadcast(() => {}, broadcastSpy);
});

function makeRec(overrides: Partial<Recommendation> = {}): Recommendation {
  const now = new Date().toISOString();
  return {
    id: `rec_${Math.random().toString(36).slice(2, 10)}`,
    workspaceId: WS_ID,
    priority: 'fix_now',
    type: 'metadata',
    title: 'Test recommendation',
    description: 'Fix the meta description.',
    insight: 'Missing meta description hurts CTR.',
    impact: 'high',
    effort: 'low',
    impactScore: 75,
    source: 'audit:meta-description',
    affectedPages: ['home'],
    trafficAtRisk: 200,
    impressionsAtRisk: 5000,
    estimatedGain: 'Could increase clicks 5-15%',
    actionType: 'manual',
    status: 'pending',
    assignedTo: 'client',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function seed(recs: Recommendation[]): void {
  const set: RecommendationSet = {
    workspaceId: WS_ID,
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

describe('resolveRecommendationsForChange', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM recommendation_sets WHERE workspace_id = ?').run(WS_ID);
    broadcastSpy.mockClear();
  });

  it('marks a pending rec whose affectedPages intersect the change as completed', () => {
    seed([makeRec({ id: 'rec_match', affectedPages: ['home'], status: 'pending' })]);

    const resolved = resolveRecommendationsForChange(WS_ID, { affectedPages: ['home'] });

    expect(resolved).toBe(1);
    const stored = loadRecommendations(WS_ID)!;
    expect(stored.recommendations.find(r => r.id === 'rec_match')!.status).toBe('completed');
  });

  it('normalises URL-shaped affected pages before comparing', () => {
    seed([makeRec({ id: 'rec_url', affectedPages: ['services'], status: 'pending' })]);

    const resolved = resolveRecommendationsForChange(WS_ID, {
      affectedPages: ['https://example.com/services/'],
    });

    expect(resolved).toBe(1);
    expect(loadRecommendations(WS_ID)!.recommendations[0].status).toBe('completed');
  });

  it('leaves recs whose pages do not intersect untouched', () => {
    seed([makeRec({ id: 'rec_other', affectedPages: ['about'], status: 'pending' })]);

    const resolved = resolveRecommendationsForChange(WS_ID, { affectedPages: ['home'] });

    expect(resolved).toBe(0);
    expect(loadRecommendations(WS_ID)!.recommendations[0].status).toBe('pending');
  });

  it('leaves already-completed and dismissed recs untouched', () => {
    seed([
      makeRec({ id: 'rec_done', affectedPages: ['home'], status: 'completed' }),
      makeRec({ id: 'rec_gone', affectedPages: ['home'], status: 'dismissed' }),
    ]);

    const resolved = resolveRecommendationsForChange(WS_ID, { affectedPages: ['home'] });

    expect(resolved).toBe(0);
    const stored = loadRecommendations(WS_ID)!;
    expect(stored.recommendations.find(r => r.id === 'rec_done')!.status).toBe('completed');
    expect(stored.recommendations.find(r => r.id === 'rec_gone')!.status).toBe('dismissed');
  });

  it('resolves in_progress recs too', () => {
    seed([makeRec({ id: 'rec_wip', affectedPages: ['home'], status: 'in_progress' })]);

    const resolved = resolveRecommendationsForChange(WS_ID, { affectedPages: ['home'] });

    expect(resolved).toBe(1);
    expect(loadRecommendations(WS_ID)!.recommendations[0].status).toBe('completed');
  });

  it('when source is provided, only resolves recs whose source matches the prefix', () => {
    seed([
      makeRec({ id: 'rec_audit', affectedPages: ['home'], status: 'pending', source: 'audit:title' }),
      makeRec({ id: 'rec_decay', affectedPages: ['home'], status: 'pending', source: 'decay:home' }),
    ]);

    const resolved = resolveRecommendationsForChange(WS_ID, {
      affectedPages: ['home'],
      source: 'audit',
    });

    expect(resolved).toBe(1);
    const stored = loadRecommendations(WS_ID)!;
    expect(stored.recommendations.find(r => r.id === 'rec_audit')!.status).toBe('completed');
    expect(stored.recommendations.find(r => r.id === 'rec_decay')!.status).toBe('pending');
  });

  it('returns 0 and does not broadcast when there is no rec set', () => {
    const resolved = resolveRecommendationsForChange(WS_ID, { affectedPages: ['home'] });
    expect(resolved).toBe(0);
    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it('returns 0 and does not broadcast when affectedPages is empty', () => {
    seed([makeRec({ id: 'rec_x', affectedPages: ['home'], status: 'pending' })]);
    const resolved = resolveRecommendationsForChange(WS_ID, { affectedPages: [] });
    expect(resolved).toBe(0);
    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it('broadcasts RECOMMENDATIONS_UPDATED when at least one rec is resolved', () => {
    seed([makeRec({ id: 'rec_b', affectedPages: ['home'], status: 'pending' })]);

    resolveRecommendationsForChange(WS_ID, { affectedPages: ['home'] });

    expect(broadcastSpy).toHaveBeenCalledWith(
      WS_ID,
      WS_EVENTS.RECOMMENDATIONS_UPDATED,
      expect.objectContaining({ resolved: 1 }),
    );
  });

  it('does not broadcast when nothing was resolved', () => {
    seed([makeRec({ id: 'rec_none', affectedPages: ['about'], status: 'pending' })]);

    resolveRecommendationsForChange(WS_ID, { affectedPages: ['home'] });

    expect(broadcastSpy).not.toHaveBeenCalled();
  });
});
