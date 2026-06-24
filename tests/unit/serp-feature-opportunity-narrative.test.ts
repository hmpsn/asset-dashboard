/**
 * Client narrative projector for serp_feature_opportunity insights (SEO Decision
 * Engine P6 / national-serp-tracking). The projector has two branches
 * (server/signal-story-registry.ts:167):
 *   - AI-Overview UNCITED (aiOverviewPresent && aiOverviewCited === false):
 *     headline calls out the AI Overview answering without citing the client.
 *   - Otherwise: a featured-result opportunity headline.
 */
import { describe, expect, it } from 'vitest';

import type { AnalyticsInsight, SerpFeatureOpportunityData } from '../../shared/types/analytics.js';
import { buildClientInsightStory } from '../../server/signal-story-registry.js';

function makeInsight(data: SerpFeatureOpportunityData): AnalyticsInsight<'serp_feature_opportunity'> {
  return {
    id: 'insight-serp-feature',
    workspaceId: 'ws_test',
    pageId: '/guide',
    insightType: 'serp_feature_opportunity',
    severity: 'positive',
    computedAt: '2026-06-24T00:00:00.000Z',
    impactScore: 70,
    domain: 'search',
    data,
  };
}

describe('serp_feature_opportunity client narrative', () => {
  it('AI-Overview-uncited branch: headline mentions AI Overview, narrative non-empty', () => {
    const story = buildClientInsightStory(makeInsight({
      keyword: 'cold brew',
      matchedUrl: 'https://x.com',
      currentPosition: 4,
      presentFeatures: ['ai_overview'],
      aiOverviewPresent: true,
      aiOverviewCited: false,
      estimatedMonthlyCitations: 1200,
    }));

    expect(story).not.toBeNull();
    expect(story?.headline).toContain('AI Overview');
    expect(story?.narrative.length ?? 0).toBeGreaterThan(0);
    // Sanity: the uncited branch threads the keyword + the volume-derived upside.
    expect(story?.narrative).toContain('cold brew');
    expect(story?.impact).toContain('1,200');
  });

  it('featured-result branch when no AI-Overview opportunity', () => {
    const story = buildClientInsightStory(makeInsight({
      keyword: 'cold brew',
      matchedUrl: 'https://x.com',
      currentPosition: 4,
      presentFeatures: ['featured_snippet'],
      aiOverviewPresent: false,
      aiOverviewCited: false,
      estimatedMonthlyCitations: 0,
    }));

    expect(story).not.toBeNull();
    expect(story?.headline).toMatch(/Featured-result opportunity/);
    expect(story?.headline).not.toContain('AI Overview');
    expect(story?.narrative.length ?? 0).toBeGreaterThan(0);
  });
});
