/**
 * Task 3.2 — feed effectiveBusinessPriorities into recommendation ranking.
 *
 * Pure-logic tests for the intent-alignment ranking added to
 * server/recommendations.ts:
 *   - isRecIntentAligned(rec, priorities): does a rec's topic/affectedPages
 *     match a stated business priority?
 *   - sortRecommendations(recs, priorities): the canonical ranking — tier order
 *     PRIMARY, impactScore SECONDARY, intent alignment as the final tiebreaker.
 *
 * Invariants under test:
 *   1. With a stated priority matching rec B, rec B outranks an equal-tier,
 *      equal-impactScore rec A (intent breaks the tie).
 *   2. A higher-tier rec is NEVER displaced by an intent-aligned lower-tier rec
 *      (tier order stays primary — intent is bounded to within-tier reordering).
 *   3. Intent alignment never beats a higher impactScore within the same tier
 *      (impactScore stays ahead of intent in the comparator).
 *
 * All functions under test are pure / non-async / non-DB.
 */
import { describe, it, expect } from 'vitest';
import { isRecIntentAligned, sortRecommendations } from '../../server/recommendations.js';
import type { Recommendation, RecPriority } from '../../shared/types/recommendations.js';

function makeRec(overrides: Partial<Recommendation> = {}): Recommendation {
  const now = new Date().toISOString();
  return {
    id: `rec_${Math.random().toString(36).slice(2, 10)}`,
    workspaceId: 'ws-intent-ranking',
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
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('isRecIntentAligned', () => {
  it('matches a priority against the rec title topic', () => {
    const rec = makeRec({ title: 'Add FAQ schema to the plumbing services pages' });
    expect(isRecIntentAligned(rec, ['Grow plumbing services revenue'])).toBe(true);
  });

  it('matches a priority against the rec affectedPages slug', () => {
    const rec = makeRec({ title: 'Fix metadata', affectedPages: ['services/emergency-plumbing'] });
    expect(isRecIntentAligned(rec, ['Win more emergency jobs'])).toBe(true);
  });

  it('strips a [category] prefix from a client priority before matching', () => {
    const rec = makeRec({ title: 'Improve the roofing landing page' });
    expect(isRecIntentAligned(rec, ['[growth] roofing leads'])).toBe(true);
  });

  it('does not match on generic stopwords alone', () => {
    const rec = makeRec({ title: 'Fix the page title and the meta', affectedPages: ['about'] });
    // "the", "and", "page" are too generic to imply intent alignment.
    expect(isRecIntentAligned(rec, ['Improve the overall page experience and the site'])).toBe(false);
  });

  it('does NOT match when the only shared token is the structural noun "services"', () => {
    // A services-page rec should NOT align to a priority like "Grow services revenue"
    // because "services" is a structural/page-type noun, not a distinctive topic word.
    const rec = makeRec({
      title: 'Improve metadata on the services page',
      affectedPages: ['services'],
    });
    expect(isRecIntentAligned(rec, ['Grow services revenue'])).toBe(false);
  });

  it('DOES match when a distinctive priority term (e.g. "plumbing") appears in the rec', () => {
    const rec = makeRec({
      title: 'Add FAQ schema to the plumbing services page',
      affectedPages: ['services/plumbing'],
    });
    expect(isRecIntentAligned(rec, ['Grow plumbing revenue'])).toBe(true);
  });

  it('DOES match on short but distinctive industry terms (length >= 3) such as "spa" and "law"', () => {
    const spaRec = makeRec({ title: 'Add schema to the spa landing page' });
    expect(isRecIntentAligned(spaRec, ['Grow spa bookings'])).toBe(true);

    const lawRec = makeRec({ title: 'Improve metadata on law practice pages' });
    expect(isRecIntentAligned(lawRec, ['Win law firm leads'])).toBe(true);
  });

  it('returns false when there are no priorities', () => {
    const rec = makeRec({ title: 'Add FAQ schema to plumbing services' });
    expect(isRecIntentAligned(rec, [])).toBe(false);
  });
});

describe('sortRecommendations — intent alignment as within-tier tiebreaker', () => {
  it('ranks an intent-aligned rec above an equal-tier, equal-impact rec', () => {
    const recA = makeRec({
      id: 'rec_A',
      priority: 'fix_soon',
      impactScore: 60,
      title: 'Fix metadata on the about page',
      affectedPages: ['about'],
    });
    const recB = makeRec({
      id: 'rec_B',
      priority: 'fix_soon',
      impactScore: 60,
      title: 'Fix metadata on the plumbing services page',
      affectedPages: ['services/plumbing'],
    });

    const recs = [recA, recB];
    sortRecommendations(recs, ['Grow plumbing services revenue']);

    expect(recs.map(r => r.id)).toEqual(['rec_B', 'rec_A']);
  });

  it('does NOT displace a higher-tier rec with an intent-aligned lower-tier rec', () => {
    const higherTier = makeRec({
      id: 'rec_fix_now',
      priority: 'fix_now',
      impactScore: 40,
      title: 'Fix broken canonical on the about page',
      affectedPages: ['about'],
    });
    const intentAlignedLowerTier = makeRec({
      id: 'rec_fix_soon',
      priority: 'fix_soon',
      impactScore: 90,
      title: 'Improve the plumbing services landing page',
      affectedPages: ['services/plumbing'],
    });

    const recs = [intentAlignedLowerTier, higherTier];
    sortRecommendations(recs, ['Grow plumbing services revenue']);

    // fix_now must come first despite the lower-tier rec being both higher-impact
    // AND intent-aligned. Intent only reorders within a tier.
    expect(recs[0].id).toBe('rec_fix_now');
  });

  it('does NOT let intent alignment beat a higher impactScore within the same tier', () => {
    const higherImpact = makeRec({
      id: 'rec_high_impact',
      priority: 'fix_soon',
      impactScore: 80,
      title: 'Fix metadata on the about page',
      affectedPages: ['about'],
    });
    const intentAlignedLowerImpact = makeRec({
      id: 'rec_intent',
      priority: 'fix_soon',
      impactScore: 50,
      title: 'Improve the plumbing services page',
      affectedPages: ['services/plumbing'],
    });

    const recs = [intentAlignedLowerImpact, higherImpact];
    sortRecommendations(recs, ['Grow plumbing services revenue']);

    // impactScore stays ahead of intent: the 80-score rec wins even though the
    // 50-score rec is intent-aligned.
    expect(recs[0].id).toBe('rec_high_impact');
  });

  it('preserves the existing tier→impactScore order when no priorities are stated', () => {
    const a = makeRec({ id: 'a', priority: 'fix_now', impactScore: 90 });
    const b = makeRec({ id: 'b', priority: 'fix_now', impactScore: 70 });
    const c = makeRec({ id: 'c', priority: 'fix_soon', impactScore: 99 });

    const recs = [c, b, a];
    sortRecommendations(recs, []);

    expect(recs.map(r => r.id)).toEqual(['a', 'b', 'c']);
  });
});
