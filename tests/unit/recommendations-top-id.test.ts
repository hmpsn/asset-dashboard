/**
 * Task 3.3 — summary.topRecommendationId pointer
 *
 * Tests that computeRecommendationSummary sets topRecommendationId to the id
 * of the highest-ranked ACTIVE (non-completed, non-dismissed) recommendation,
 * or null when no active recs exist.
 *
 * Invariants under test:
 *   1. The top-ranked active rec's id is captured as topRecommendationId.
 *   2. Completed and dismissed recs are excluded from candidacy.
 *   3. When the only active rec is fix_now, that rec becomes the top id.
 *   4. When no active recs exist (all completed/dismissed), topRecommendationId is null.
 *   5. The recs array passed to computeRecommendationSummary is already sorted
 *      (by tier + impactScore), so activeRecs[0] is the true top rec.
 *
 * All functions under test are pure / non-async / non-DB.
 */
import { describe, it, expect } from 'vitest';
import { computeRecommendationSummary } from '../../server/recommendations.js';
import type { Recommendation, RecPriority, RecStatus } from '../../shared/types/recommendations.js';

function makeRec(overrides: Partial<Recommendation> = {}): Recommendation {
  const now = new Date().toISOString();
  return {
    id: `rec_${Math.random().toString(36).slice(2, 10)}`,
    workspaceId: 'ws-top-id-test',
    priority: 'fix_soon' as RecPriority,
    type: 'metadata',
    title: 'Generic recommendation',
    description: 'Do the thing.',
    insight: 'Why it matters.',
    impact: 'medium',
    effort: 'low',
    impactScore: 50,
    source: 'audit:title',
    affectedPages: [],
    trafficAtRisk: 100,
    impressionsAtRisk: 1000,
    estimatedGain: '5-15%',
    actionType: 'manual',
    status: 'pending' as RecStatus,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('computeRecommendationSummary — topRecommendationId', () => {
  it('sets topRecommendationId to the id of the first active rec (pre-sorted array)', () => {
    const topRec = makeRec({ id: 'rec_top', priority: 'fix_now', impactScore: 80, status: 'pending' });
    const lowerRec = makeRec({ id: 'rec_lower', priority: 'fix_soon', impactScore: 50, status: 'pending' });
    // Recs are passed in sorted order (as they would be after sortRecommendations)
    const summary = computeRecommendationSummary([topRec, lowerRec]);
    expect(summary.topRecommendationId).toBe('rec_top');
  });

  it('skips completed recs — topRecommendationId is the first non-completed rec', () => {
    const completedRec = makeRec({ id: 'rec_completed', priority: 'fix_now', impactScore: 90, status: 'completed' });
    const activeRec = makeRec({ id: 'rec_active', priority: 'fix_soon', impactScore: 60, status: 'pending' });
    const summary = computeRecommendationSummary([completedRec, activeRec]);
    expect(summary.topRecommendationId).toBe('rec_active');
  });

  it('skips dismissed recs — topRecommendationId is the first non-dismissed rec', () => {
    const dismissedRec = makeRec({ id: 'rec_dismissed', priority: 'fix_now', impactScore: 90, status: 'dismissed' });
    const activeRec = makeRec({ id: 'rec_active2', priority: 'fix_soon', impactScore: 55, status: 'pending' });
    const summary = computeRecommendationSummary([dismissedRec, activeRec]);
    expect(summary.topRecommendationId).toBe('rec_active2');
  });

  it('returns null when all recs are completed or dismissed', () => {
    const done1 = makeRec({ id: 'rec_done1', status: 'completed' });
    const done2 = makeRec({ id: 'rec_done2', status: 'dismissed' });
    const summary = computeRecommendationSummary([done1, done2]);
    expect(summary.topRecommendationId).toBeNull();
  });

  it('returns null for an empty recs array', () => {
    const summary = computeRecommendationSummary([]);
    expect(summary.topRecommendationId).toBeNull();
  });

  it('returns the single active rec id when only one active rec exists', () => {
    const rec = makeRec({ id: 'rec_only', priority: 'fix_now', impactScore: 75, status: 'in_progress' });
    const summary = computeRecommendationSummary([rec]);
    expect(summary.topRecommendationId).toBe('rec_only');
  });
});
