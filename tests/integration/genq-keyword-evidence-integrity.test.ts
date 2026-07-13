import { afterEach, describe, expect, it } from 'vitest';

import { listContentGaps, replaceAllContentGaps } from '../../server/content-gaps.js';
import { appendStrategyRecommendations } from '../../server/domains/recommendations/strategy-producers.js';
import { runPageAssignmentBatches } from '../../server/keyword-strategy-synthesis/page-assignment.js';
import { getPageKeyword, upsertPageKeyword } from '../../server/page-keywords.js';
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
  it('restores pool evidence onto page assignments and persists the field sources', async () => {
    const workspaceId = createTestWorkspace('Page assignment evidence');
    const page = { path: '/emergency-dentist', title: 'Emergency Dentist', seoTitle: '', seoDesc: '', contentSnippet: '' };
    const assignments = await runPageAssignmentBatches({
      workspaceId, businessSection: 'Dental practice', pagesForBatching: [page], allPageInfo: [page],
      strategyMode: 'full', pagesToPreserve: [], existingPageKeywords: [], gscByPath: new Map(),
      providerKeywordsByPath: new Map(), keywordPoolReference: '', seoGenQualityEnabled: false,
      closedSetBlock: '', candidateIds: new Set(), isEligibleGeneratedKeyword: () => true,
      keywordPool: new Map([['emergency dentist', {
        volume: 900, difficulty: 30, source: 'discovery:keyword_ideas', cpc: 14,
        cpcSource: 'dataforseo:keyword-ideas', intent: 'transactional', intentSource: 'dataforseo:keyword-ideas',
      }]]),
      callStrategyAI: async () => JSON.stringify([{
        pagePath: page.path, pageTitle: page.title, primaryKeyword: 'emergency dentist',
        secondaryKeywords: [], searchIntent: 'informational',
      }]),
      callNamedStrategyAI: async () => '', sendProgress: () => undefined,
    });

    expect(assignments[0]).toEqual(expect.objectContaining({
      cpc: 14, cpcSource: 'dataforseo:keyword-ideas', searchIntent: 'transactional', intentSource: 'dataforseo:keyword-ideas',
    }));
    upsertPageKeyword(workspaceId, assignments[0]);
    expect(getPageKeyword(workspaceId, page.path)).toEqual(expect.objectContaining({
      cpc: 14, cpcSource: 'dataforseo:keyword-ideas', searchIntent: 'transactional', intentSource: 'dataforseo:keyword-ideas',
    }));
  });

  it('feeds persisted content-gap CPC into the recommendation Opportunity Value consumer', () => {
    const workspaceId = createTestWorkspace('Recommendation persisted evidence');
    const controlWorkspaceId = createTestWorkspace('Recommendation no CPC control');
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
      cpcSource: 'dataforseo',
      intentSource: 'discovery:keyword_ideas',
      opportunityScore: 82,
    }]);
    replaceAllContentGaps(controlWorkspaceId, [{
      topic: 'Emergency Dentist Landing Page', targetKeyword: 'emergency dentist near me',
      intent: 'transactional', priority: 'high', rationale: 'High-intent local service demand.',
      suggestedPageType: 'service', volume: 720, difficulty: 29, opportunityScore: 82,
    }]);

    expect(listContentGaps(workspaceId)[0]).toEqual(expect.objectContaining({
      cpc: 12.75, cpcSource: 'dataforseo', intent: 'transactional', intentSource: 'discovery:keyword_ideas',
    }));

    const recommendations: Recommendation[] = [];
    const controls: Recommendation[] = [];
    appendStrategyRecommendations(recommendations, producerContext(workspaceId));
    appendStrategyRecommendations(controls, producerContext(controlWorkspaceId));
    const recommendation = recommendations.find(item => item.source === 'strategy:content-gap');
    const control = controls.find(item => item.source === 'strategy:content-gap');

    expect(recommendation).toBeDefined();
    expect(recommendation?.targetKeyword).toBe('emergency dentist near me');
    expect(recommendation?.opportunity?.emvPerWeek).toBeGreaterThan(control?.opportunity?.emvPerWeek ?? Infinity);
    expect(recommendation?.opportunity?.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: 'intent', rawValue: 'transactional' }),
    ]));
  });
});
