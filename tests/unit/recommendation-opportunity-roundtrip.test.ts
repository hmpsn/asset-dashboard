import { describe, it, expect } from 'vitest';
import { recommendationSchema, recommendationSummarySchema, opportunityScoreSchema } from '../../server/schemas/workspace-schemas.js';
import { parseJsonSafeArray, parseJsonSafe } from '../../server/db/json-validation.js';
import { computeOpportunityValue } from '../../server/scoring/opportunity-value.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';

// Exercises the EXACT persistence transform loadRecommendations uses:
//   save → JSON.stringify(recommendations)   load → parseJsonSafeArray(raw, recommendationSchema)
// so the Opportunity Value round-trip (PR2) is verified without a DB/server boot.

const now = '2026-06-01T00:00:00.000Z';
function makeRec(over: Partial<Recommendation> = {}): Recommendation {
  return {
    id: 'rec_1', workspaceId: 'ws_1', priority: 'fix_now', type: 'content',
    title: 't', description: 'd', insight: 'i', impact: 'high', effort: 'low',
    impactScore: 70, source: 'quick_wins', affectedPages: ['/p'], trafficAtRisk: 10,
    impressionsAtRisk: 100, estimatedGain: '+X', actionType: 'manual',
    status: 'pending', createdAt: now, updatedAt: now, ...over,
  };
}
const ctx = { table: 'recommendation_sets', field: 'recommendations', workspaceId: 'ws_1' };

describe('Opportunity Value persistence round-trip (PR2)', () => {
  it('a real computeOpportunityValue() output passes opportunityScoreSchema (no type/schema drift)', () => {
    const opp = computeOpportunityValue({ branch: 'quick_win', roiScore: 120, intent: 'commercial', cpc: 2 });
    expect(opportunityScoreSchema.safeParse(opp).success).toBe(true);
  });

  it('round-trips a recommendation carrying a full opportunity object', () => {
    const opportunity = computeOpportunityValue({ branch: 'ranking_opp', volume: 1500, currentPosition: 8, difficulty: 25, authorityStrength: 50, intent: 'commercial' });
    const raw = JSON.stringify([makeRec({ opportunity })]);
    const parsed = parseJsonSafeArray(raw, recommendationSchema, ctx) as Recommendation[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].opportunity).toEqual(opportunity);
    expect(parsed[0].opportunity?.modelVersion).toBe('ov-1');
  });

  it('legacy recs (no opportunity) survive and parse with opportunity undefined', () => {
    const raw = JSON.stringify([makeRec()]);
    const parsed = parseJsonSafeArray(raw, recommendationSchema, ctx) as Recommendation[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].opportunity).toBeUndefined();
  });

  it('a MALFORMED opportunity degrades to undefined (.catch) — the rec is NOT dropped', () => {
    const good = computeOpportunityValue({ branch: 'quick_win', roiScore: 90 });
    const recBad = { ...makeRec({ id: 'rec_bad' }), opportunity: { value: 'not-a-number', nope: true } };
    const recGood = makeRec({ id: 'rec_good', opportunity: good });
    const raw = JSON.stringify([recBad, recGood]);
    const parsed = parseJsonSafeArray(raw, recommendationSchema, ctx) as Recommendation[];
    // both survive (item-level resilience); the bad opportunity is dropped to undefined
    expect(parsed.map(r => r.id).sort()).toEqual(['rec_bad', 'rec_good']);
    const bad = parsed.find(r => r.id === 'rec_bad');
    expect(bad?.opportunity).toBeUndefined();
    expect(parsed.find(r => r.id === 'rec_good')?.opportunity).toEqual(good);
  });

  it('summary round-trips topOpportunityRationale', () => {
    const summary: RecommendationSet['summary'] = {
      fixNow: 1, fixSoon: 0, fixLater: 0, ongoing: 0, totalImpactScore: 70,
      trafficAtRisk: 10, estimatedRecoverableClicks: 1, estimatedRecoverableImpressions: 12,
      topRecommendationId: 'rec_1', topOpportunityRationale: '#1: target X — value 87 ($420/wk)',
    };
    const back = parseJsonSafe(JSON.stringify(summary), recommendationSummarySchema, { ...summary, topOpportunityRationale: undefined }, ctx) as RecommendationSet['summary'];
    expect(back.topOpportunityRationale).toBe('#1: target X — value 87 ($420/wk)');
  });
});
