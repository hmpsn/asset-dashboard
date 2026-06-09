import { describe, it, expect } from 'vitest';
import { computeRecommendationSummary, getRecoveryRate } from '../../server/recommendations.js';
import type { Recommendation } from '../../shared/types/recommendations.js';

describe('getRecoveryRate', () => {
  it('returns rate for a known issue type', () => {
    const r = getRecoveryRate('title');
    expect(r.perRec).toBe('10-25%');
    expect(r.summary).toBeCloseTo(0.18);
  });
  it('returns rate for a low-impact issue type', () => {
    const r = getRecoveryRate('og-image');
    expect(r.perRec).toBe('1-3%');
    expect(r.summary).toBeCloseTo(0.02);
  });
  it('returns default rate for unknown issue type', () => {
    const r = getRecoveryRate('made-up-issue');
    expect(r.perRec).toBe('5-15%');
    expect(r.summary).toBeCloseTo(0.12);
  });
});

describe('Opportunity Value summary math', () => {
  function makeRec(overrides: Partial<Recommendation>): Recommendation {
    const now = new Date().toISOString();
    return {
      id: 'rec',
      workspaceId: 'ws-rec-summary',
      priority: 'fix_now',
      type: 'metadata',
      title: 'Fix title',
      description: 'Description',
      insight: 'Insight',
      impact: 'high',
      effort: 'low',
      impactScore: 50,
      source: 'audit:title',
      affectedPages: [],
      trafficAtRisk: 1000,
      impressionsAtRisk: 5000,
      estimatedGain: '10-25%',
      actionType: 'manual',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  it('does not emit legacy aggregate recovery-rate fields', () => {
    const summary = computeRecommendationSummary([
      makeRec({ id: 'rec-1', impactScore: 90, trafficAtRisk: 1000 }),
      makeRec({ id: 'rec-2', impactScore: 40, trafficAtRisk: 500, priority: 'fix_later' }),
    ]);

    expect(summary.totalOpportunityValue).toBe(130);
    expect(summary.actionableOpportunityValue).toBe(90);
    expect(summary.topOpportunityValue).toBe(90);
    expect(summary).not.toHaveProperty('estimatedRecoverableClicks');
    expect(summary).not.toHaveProperty('estimatedRecoverableImpressions');
  });
});
