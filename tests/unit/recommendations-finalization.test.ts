import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/analytics-insights-store.js', () => ({
  getInsights: vi.fn(() => []),
}));

vi.mock('../../server/feature-flags.js', () => ({
  isFeatureEnabled: vi.fn(() => false),
}));

vi.mock('../../server/insight-feedback.js', () => ({
  buildStrategySignals: vi.fn(() => []),
}));

vi.mock('../../server/keyword-feedback.js', () => ({
  getDeclinedKeywords: vi.fn(() => []),
  getRequestedKeywords: vi.fn(() => []),
}));

vi.mock('../../server/keyword-strategy-context.js', () => ({
  buildStrategyKeywordEvaluationContext: vi.fn(() => undefined),
}));

vi.mock('../../server/workspaces.js', () => ({
  getPageIdBySlug: vi.fn(() => null),
  updatePageState: vi.fn(),
}));

import {
  finalizeRecommendations,
  type RecommendationFinalizationContext,
} from '../../server/domains/recommendations/finalization.js';
import { updatePageState } from '../../server/workspaces.js';
import type { ActionType } from '../../shared/types/outcome-tracking.js';
import type {
  OpportunityScore,
  Recommendation,
  RecommendationSet,
} from '../../shared/types/recommendations.js';

const now = '2026-06-26T12:00:00.000Z';

function rec(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: 'rec-old',
    workspaceId: 'ws-finalization',
    priority: 'fix_soon',
    type: 'metadata',
    title: 'Fix title',
    description: 'Description',
    insight: 'Original insight',
    impact: 'medium',
    effort: 'low',
    impactScore: 45,
    source: 'audit:title',
    affectedPages: ['services'],
    trafficAtRisk: 10,
    impressionsAtRisk: 100,
    estimatedGain: 'Gain copy',
    actionType: 'manual',
    status: 'pending',
    assignedTo: 'team',
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z',
    ...overrides,
  };
}

function set(recommendations: Recommendation[]): RecommendationSet {
  return {
    workspaceId: 'ws-finalization',
    generatedAt: '2026-06-20T00:00:00.000Z',
    recommendations,
    summary: {
      fixNow: 0,
      fixSoon: recommendations.length,
      fixLater: 0,
      ongoing: 0,
      totalImpactScore: recommendations.reduce((sum, recommendation) => sum + recommendation.impactScore, 0),
      trafficAtRisk: recommendations.reduce((sum, recommendation) => sum + recommendation.trafficAtRisk, 0),
      topRecommendationId: recommendations[0]?.id ?? null,
    },
  };
}

function opportunity(value: number): OpportunityScore {
  return {
    value,
    emvPerWeek: 12,
    predictedEmv: 48,
    roiPerEffortDay: 4,
    confidence: 0.8,
    calibration: 1,
    groundedSpine: 'computed',
    calibrationVersion: 'test',
    modelVersion: 'ov-1',
    components: [
      {
        dimension: 'demand',
        rawValue: value,
        normalized: value / 100,
        weight: 1,
        contribution: value,
        evidence: 'test evidence',
      },
    ],
  };
}

function baseContext(overrides: Partial<RecommendationFinalizationContext> = {}): RecommendationFinalizationContext {
  return {
    workspaceId: 'ws-finalization',
    workspaceName: 'Finalization Test',
    now,
    assignedTo: 'team',
    existing: null,
    failedCategories: new Set(),
    inFlightContentKeywords: new Set(),
    slugToPageId: new Map([['services', 'page-services']]),
    effectiveBusinessPriorities: [],
    outcomeLearnings: null,
    intelligence: null,
    strategySignals: [],
    actionTypeForRecommendation: (): ActionType => 'audit_fix_applied',
    ...overrides,
  };
}

describe('recommendation finalization', () => {
  beforeEach(() => {
    vi.mocked(updatePageState).mockClear();
  });

  it('retains old recommendations when their producer category failed instead of dropping them', () => {
    const oldRec = rec({ id: 'old-audit', source: 'audit:title' });
    const result = finalizeRecommendations([], baseContext({
      existing: set([oldRec]),
      failedCategories: new Set(['audit']),
    }));

    expect(result.autoResolved).toBe(0);
    expect(result.set.recommendations).toHaveLength(1);
    expect(result.set.recommendations[0]).toMatchObject({
      id: 'old-audit',
      status: 'pending',
      insight: 'Original insight',
    });
    expect(updatePageState).not.toHaveBeenCalled();
  });

  it('auto-resolves vanished non-exempt recommendations and marks the page live only when no active rec remains', () => {
    const vanished = rec({ id: 'vanished', source: 'audit:title', affectedPages: ['services'] });
    const activeSamePage = rec({
      id: 'active-same-page',
      source: 'audit:description',
      affectedPages: ['services'],
      title: 'Fix description',
    });
    const result = finalizeRecommendations([activeSamePage], baseContext({
      existing: set([vanished]),
    }));

    const resolved = result.set.recommendations.find(recommendation => recommendation.id === 'vanished');
    expect(resolved).toMatchObject({
      status: 'completed',
      updatedAt: now,
    });
    expect(resolved?.insight).toContain('Auto-resolved');
    expect(result.autoResolved).toBe(1);
    expect(result.autoResolvedPageStateIds).toEqual([]);
    expect(updatePageState).not.toHaveBeenCalled();
  });

  it('updates page state for an auto-resolved rec when no active recommendation remains on that page', () => {
    const vanished = rec({ id: 'resolved-alone', source: 'audit:title', affectedPages: ['services'] });
    const result = finalizeRecommendations([], baseContext({
      existing: set([vanished]),
    }));

    expect(result.autoResolved).toBe(1);
    expect(result.autoResolvedPageStateIds).toEqual(['page-services']);
    expect(updatePageState).toHaveBeenCalledWith('ws-finalization', 'page-services', {
      status: 'live',
      source: 'recommendation',
      recommendationId: 'resolved-alone',
    });
  });

  it('runs canonical OV scoring before final sorting and summary assembly', () => {
    const lowValue = rec({
      id: 'low',
      source: 'strategy:content-gap',
      title: 'Low opportunity',
      affectedPages: ['low'],
      impactScore: 99,
      opportunity: opportunity(20),
    });
    const highValue = rec({
      id: 'high',
      source: 'strategy:content-gap',
      title: 'High opportunity',
      affectedPages: ['high'],
      priority: 'fix_later',
      impactScore: 1,
      opportunity: opportunity(85),
    });

    const result = finalizeRecommendations([lowValue, highValue], baseContext());

    expect(result.set.recommendations.map(recommendation => recommendation.id)).toEqual(['high', 'low']);
    expect(result.set.recommendations[0]).toMatchObject({
      id: 'high',
      impactScore: 85,
      priority: 'fix_now',
    });
    expect(result.set.summary.topRecommendationId).toBe('high');
    expect(result.set.summary.totalOpportunityValue).toBe(105);
  });
});
