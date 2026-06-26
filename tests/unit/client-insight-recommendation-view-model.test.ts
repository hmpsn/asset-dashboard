import { describe, expect, it } from 'vitest';
import { buildClientRecommendationResponsesView } from '../../server/client-insight-recommendation-view-model.js';
import type { Recommendation } from '../../shared/types/recommendations.js';

function rec(overrides: Partial<Recommendation>): Recommendation {
  const now = '2026-06-01T00:00:00.000Z';
  return {
    id: overrides.id ?? 'rec-1',
    workspaceId: overrides.workspaceId ?? 'ws-rec-view',
    priority: overrides.priority ?? 'fix_now',
    type: overrides.type ?? 'content',
    title: overrides.title ?? 'Refresh services page',
    description: overrides.description ?? 'Update content',
    insight: overrides.insight ?? 'Traffic dropped',
    impact: overrides.impact ?? 'More qualified visits',
    effort: overrides.effort ?? 'medium',
    impactScore: overrides.impactScore ?? 80,
    source: overrides.source ?? 'test',
    affectedPages: overrides.affectedPages ?? ['/services'],
    trafficAtRisk: overrides.trafficAtRisk ?? 0,
    impressionsAtRisk: overrides.impressionsAtRisk ?? 0,
    estimatedGain: overrides.estimatedGain ?? 'More traffic',
    actionType: overrides.actionType ?? 'content_refresh',
    status: overrides.status ?? 'pending',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    ...overrides,
  };
}

describe('buildClientRecommendationResponsesView', () => {
  it('counts only client response statuses and caps newest recent responses', () => {
    const recs = [
      rec({ id: 'system', title: 'System rec', clientStatus: 'system', updatedAt: '2026-06-07T00:00:00.000Z' }),
      rec({ id: 'approved-1', title: 'Approved 1', clientStatus: 'approved', updatedAt: '2026-06-06T00:00:00.000Z' }),
      rec({ id: 'declined-1', title: 'Declined 1', clientStatus: 'declined', updatedAt: '2026-06-05T00:00:00.000Z' }),
      rec({ id: 'discussing-1', title: 'Discussing 1', clientStatus: 'discussing', updatedAt: '2026-06-04T00:00:00.000Z' }),
      rec({ id: 'approved-2', title: 'Approved 2', clientStatus: 'approved', updatedAt: '2026-06-03T00:00:00.000Z' }),
      rec({ id: 'declined-2', title: 'Declined 2', clientStatus: 'declined', updatedAt: '2026-06-02T00:00:00.000Z' }),
      rec({ id: 'discussing-2', title: 'Discussing 2', clientStatus: 'discussing', updatedAt: '2026-06-01T00:00:00.000Z' }),
    ];

    const view = buildClientRecommendationResponsesView(recs);

    expect(view).toEqual({
      approved: 2,
      declined: 2,
      discussing: 2,
      recent: [
        { title: 'Approved 1', clientStatus: 'approved', respondedAt: '2026-06-06T00:00:00.000Z' },
        { title: 'Declined 1', clientStatus: 'declined', respondedAt: '2026-06-05T00:00:00.000Z' },
        { title: 'Discussing 1', clientStatus: 'discussing', respondedAt: '2026-06-04T00:00:00.000Z' },
        { title: 'Approved 2', clientStatus: 'approved', respondedAt: '2026-06-03T00:00:00.000Z' },
        { title: 'Declined 2', clientStatus: 'declined', respondedAt: '2026-06-02T00:00:00.000Z' },
      ],
    });
    expect(JSON.stringify(view)).not.toContain('System rec');
  });
});
