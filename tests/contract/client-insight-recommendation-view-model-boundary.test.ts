import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('client recommendation view-model boundary', () => {
  it('keeps public recommendation read projections out of the route module', () => {
    const routeSrc = readFileSync('server/routes/recommendations.ts', 'utf-8'); // readFile-ok — source boundary contract for public recommendation projection ownership.

    expect(routeSrc).toContain("from '../client-insight-recommendation-view-model.js'");
    expect(routeSrc).toContain('buildClientRecommendationSetView(workspaceId');
    expect(routeSrc).toContain('buildClientRecommendationView(workspaceId, rec)');
    expect(routeSrc).toContain('buildClientRecommendationResponsesView(recs)');
    expect(routeSrc).not.toContain("from '../recommendation-public-projection.js'");
    expect(routeSrc).not.toContain('stripEmvFromPublicRecs(');
    expect(routeSrc).not.toContain('toPublicRecommendationSet(');
    expect(routeSrc).not.toContain('getSortOrderMap(');
  });

  it('keeps the view-model leaf as the public recommendation projection owner', () => {
    const viewModelSrc = readFileSync('server/client-insight-recommendation-view-model.ts', 'utf-8'); // readFile-ok — source boundary contract for recommendation view model ownership.

    expect(viewModelSrc).toContain('stripEmvFromPublicRecs');
    expect(viewModelSrc).toContain('toPublicRecommendationSet');
    expect(viewModelSrc).toContain('applyWordingOverrides');
    expect(viewModelSrc).toContain('getSortOrderMap');
    expect(viewModelSrc).toContain('buildClientRecommendationResponsesView');
  });
});
