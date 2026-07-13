import { afterEach, describe, expect, it } from 'vitest';

import { replaceAllContentGaps } from '../../server/content-gaps.js';
import { appendStrategyRecommendations } from '../../server/domains/recommendations/strategy-producers.js';
import type { StrategyRecommendationProducerContext } from '../../server/domains/recommendations/producer-contexts.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import type { Recommendation } from '../../shared/types/recommendations.js';

const cleanup = new Set<string>();

afterEach(() => {
  for (const workspaceId of cleanup) deleteWorkspace(workspaceId);
  cleanup.clear();
});

function createTestWorkspace(label: string): string {
  const workspaceId = createWorkspace(`${label} ${Date.now()}`).id;
  cleanup.add(workspaceId);
  return workspaceId;
}

function producerContext(workspaceId: string): StrategyRecommendationProducerContext {
  return {
    workspaceId,
    now: '2026-07-13T00:00:00.000Z',
    assignedTo: 'team',
    effortDaysFor: () => null,
    authorityStrength: null,
    timingBoosts: new Map(),
    opportunityOptions: {},
    failedCategories: new Set(),
    ctrCurve: null,
    traffic: {},
    declinedKeywords: new Set(),
    inFlightContentKeywords: new Set(),
    domainStrength: 0,
    backlinkProfile: null,
  };
}

describe('generation-quality keyword evidence integrity', () => {
  it('feeds persisted content-gap CPC into the recommendation Opportunity Value consumer', () => {
    const workspaceId = createTestWorkspace('Recommendation persisted evidence');
    replaceAllContentGaps(workspaceId, [{
      topic: 'Emergency Dentist Landing Page',
      targetKeyword: 'emergency dentist near me',
      intent: 'transactional',
      priority: 'high',
      rationale: 'High-intent local service demand.',
      suggestedPageType: 'service',
      volume: 720,
      difficulty: 29,
      cpc: 12.75,
      opportunityScore: 82,
    }]);

    const recommendations: Recommendation[] = [];
    appendStrategyRecommendations(recommendations, producerContext(workspaceId));
    const recommendation = recommendations.find(item => item.source === 'strategy:content-gap');

    expect(recommendation).toBeDefined();
    expect(recommendation?.targetKeyword).toBe('emergency dentist near me');
    expect(recommendation?.opportunity?.emvPerWeek).toBeGreaterThan(100);
    expect(recommendation?.opportunity?.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: 'intent', rawValue: 'transactional' }),
    ]));
  });
});
