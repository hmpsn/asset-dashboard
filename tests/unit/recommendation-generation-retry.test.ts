import { describe, expect, it, vi } from 'vitest';

import {
  commitRecommendationCandidatesWithRetry,
  fingerprintRecommendationGenerationInputs,
} from '../../server/domains/recommendations/generation-service.js';
import { RecommendationGenerationRevisionConflictError } from '../../server/domains/recommendations/storage.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';

function candidate(): Recommendation {
  const now = '2026-07-13T00:00:00.000Z';
  return {
    id: 'retry-rec', workspaceId: 'ws-retry', priority: 'fix_soon', type: 'metadata',
    title: 'Pristine', description: 'Description', insight: 'Insight', impact: 'medium',
    effort: 'low', impactScore: 50, source: 'audit:title', affectedPages: ['/'], trafficAtRisk: 0,
    impressionsAtRisk: 0, estimatedGain: 'Gain', actionType: 'manual', status: 'pending',
    createdAt: now, updatedAt: now,
  };
}

function finalized(recommendations: Recommendation[]): { set: RecommendationSet; autoResolved: number; autoResolvedPageStateIds: string[] } {
  return {
    set: {
      workspaceId: 'ws-retry', generatedAt: '2026-07-13T00:00:00.000Z', recommendations,
      summary: { fixNow: 0, fixSoon: 1, fixLater: 0, ongoing: 0, totalImpactScore: 50, trafficAtRisk: 0, topRecommendationId: 'retry-rec' },
    },
    autoResolved: 0,
    autoResolvedPageStateIds: [],
  };
}

describe('recommendation generation CAS retry', () => {
  it('fingerprints semantic inputs canonically while excluding volatile candidate identity', () => {
    const first = candidate();
    const second = { ...candidate(), id: 'different-random-id', createdAt: '2030-01-01T00:00:00.000Z', updatedAt: '2030-01-02T00:00:00.000Z' };
    const context = {
      assignedTo: 'client' as const,
      failedCategories: new Set(['audit' as const, 'strategy' as const]),
      inFlightContentKeywords: new Set(['beta', 'alpha']),
      slugToPageId: new Map([['/b', 'page-b'], ['/a', 'page-a']]),
      effectiveBusinessPriorities: ['qualified leads'],
      outcomeLearnings: null,
      strategySignals: [],
    };
    const reorderedContext = {
      ...context,
      failedCategories: new Set(['strategy' as const, 'audit' as const]),
      inFlightContentKeywords: new Set(['alpha', 'beta']),
      slugToPageId: new Map([['/a', 'page-a'], ['/b', 'page-b']]),
    };

    const firstFingerprint = fingerprintRecommendationGenerationInputs([first], context);
    expect(fingerprintRecommendationGenerationInputs([second], reorderedContext)).toBe(firstFingerprint);
    expect(fingerprintRecommendationGenerationInputs([{ ...second, title: 'Semantic change' }], context)).not.toBe(firstFingerprint);
    expect(firstFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('retries once at the latest revision with a fresh candidate clone', () => {
    const source = [candidate()];
    let attempts = 0;
    const commit = vi.fn((_workspaceId: string, revision: number, finalize: (set: RecommendationSet | null) => ReturnType<typeof finalized>) => {
      attempts += 1;
      if (attempts === 1) throw new RecommendationGenerationRevisionConflictError('ws-retry', revision);
      return finalize(null);
    });
    const finalize = vi.fn((_existing: RecommendationSet | null, candidates: Recommendation[]) => {
      candidates[0].title = 'Finalized';
      return finalized(candidates);
    });

    const result = commitRecommendationCandidatesWithRetry('ws-retry', 3, source, finalize, null, {
      loadSnapshot: vi.fn(() => ({ revision: 4, set: null, provenance: null })),
      commit,
    });

    expect(commit.mock.calls.map(call => call[1])).toEqual([3, 4]);
    expect(finalize).toHaveBeenCalledOnce();
    expect(result.set.recommendations[0].title).toBe('Finalized');
    expect(source[0].title).toBe('Pristine');
  });

  it('propagates a second typed conflict after exactly two attempts', () => {
    const commit = vi.fn((_workspaceId: string, revision: number) => {
      throw new RecommendationGenerationRevisionConflictError('ws-retry', revision);
    });
    const finalize = vi.fn((_existing: RecommendationSet | null, candidates: Recommendation[]) => finalized(candidates));

    expect(() => commitRecommendationCandidatesWithRetry('ws-retry', 7, [candidate()], finalize, null, {
      loadSnapshot: vi.fn(() => ({ revision: 8, set: null, provenance: null })),
      commit,
    })).toThrow(RecommendationGenerationRevisionConflictError);
    expect(commit).toHaveBeenCalledTimes(2);
    expect(finalize).not.toHaveBeenCalled();
  });
});
