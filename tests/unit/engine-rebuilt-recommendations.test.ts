import { describe, expect, it } from 'vitest';
import type { Recommendation } from '../../shared/types/recommendations';
import * as engineHook from '../../src/hooks/admin/useEngineRebuilt';

const NOW = Date.parse('2026-07-11T12:00:00.000Z');

function rec(id: string, overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id,
    workspaceId: 'ws-engine-partition',
    priority: 'fix_now',
    type: 'content',
    title: id,
    description: `${id} description`,
    insight: `${id} insight`,
    impact: 'high',
    effort: 'low',
    impactScore: 80,
    source: 'test',
    affectedPages: [],
    trafficAtRisk: 0,
    impressionsAtRisk: 0,
    estimatedGain: '',
    actionType: 'manual',
    status: 'pending',
    clientStatus: 'system',
    lifecycle: 'active',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('Engine recommendation partition', () => {
  it('is the canonical isActiveRec set plus its exact ordered complement', () => {
    const partition = (engineHook as unknown as {
      partitionEngineRecommendations?: (
        recommendations: Recommendation[],
        now?: number,
      ) => { active: Recommendation[]; history: Recommendation[] };
    }).partitionEngineRecommendations;
    expect(partition).toBeTypeOf('function');

    const recommendations = [
      rec('active'),
      rec('discussing-active', { clientStatus: 'discussing' }),
      rec('expired-throttle-active', { lifecycle: 'throttled', throttledUntil: '2026-07-10T00:00:00.000Z' }),
      rec('completed', { status: 'completed' }),
      rec('dismissed', { status: 'dismissed' }),
      rec('struck', { lifecycle: 'struck' }),
      rec('future-throttle', { lifecycle: 'throttled', throttledUntil: '2026-07-12T00:00:00.000Z' }),
      rec('sent', { clientStatus: 'sent' }),
      rec('approved', { clientStatus: 'approved' }),
      rec('declined', { clientStatus: 'declined' }),
    ];

    const result = partition?.(recommendations, NOW);
    expect(result?.active.map(item => item.id)).toEqual([
      'active',
      'discussing-active',
      'expired-throttle-active',
    ]);
    expect(result?.history.map(item => item.id)).toEqual([
      'completed',
      'dismissed',
      'struck',
      'future-throttle',
      'sent',
      'approved',
      'declined',
    ]);
    expect([...(result?.active ?? []), ...(result?.history ?? [])]).toHaveLength(recommendations.length);
    expect(new Set([...(result?.active ?? []), ...(result?.history ?? [])].map(item => item.id)).size)
      .toBe(recommendations.length);
  });
});
