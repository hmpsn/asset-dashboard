import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('client insight hook view-model boundary', () => {
  it('keeps client insight section queries in the shared view-model hook owner', () => {
    const viewModelSrc = readFileSync('src/hooks/client/useClientInsightViewModel.ts', 'utf-8'); // readFile-ok — source boundary contract for client insight query ownership.

    expect(viewModelSrc).toContain('useClientNarrativeInsightsView');
    expect(viewModelSrc).toContain('useClientMonthlyDigestView');
    expect(viewModelSrc).toContain('useClientPublishedBriefingView');
    expect(viewModelSrc).toContain('useClientIntelligenceView');
    expect(viewModelSrc).toContain('useClientRecommendationSetView');
    expect(viewModelSrc).toContain('useClientInsightViewModel');
    expect(viewModelSrc).toContain('queryKeys.client.clientInsights');
    expect(viewModelSrc).toContain('queryKeys.client.monthlyDigest');
    expect(viewModelSrc).toContain('queryKeys.client.briefing');
    expect(viewModelSrc).toContain('queryKeys.client.intelligence');
    expect(viewModelSrc).toContain('queryKeys.shared.recommendations');
  });

  it('keeps legacy hook files as compatibility wrappers', () => {
    const wrappers = [
      ['src/hooks/client/useClientInsights.ts', 'useClientNarrativeInsightsView'],
      ['src/hooks/client/useMonthlyDigest.ts', 'useClientMonthlyDigestView'],
      ['src/hooks/client/useClientBriefing.ts', 'useClientPublishedBriefingView'],
      ['src/hooks/client/useClientIntelligence.ts', 'useClientIntelligenceView'],
    ] as const;

    for (const [file, delegate] of wrappers) {
      const src = readFileSync(file, 'utf-8'); // readFile-ok — source boundary contract for compatibility hook wrappers.
      expect(src).toContain(delegate);
      expect(src).not.toContain('useQuery(');
      expect(src).not.toContain('getSafe<');
      expect(src).not.toContain('briefingApi.getPublished');
      expect(src).not.toContain('fetchClientIntelligence');
    }
  });

  it('keeps InsightsEngine on the shared recommendation section hook', () => {
    const src = readFileSync('src/components/client/InsightsEngine.tsx', 'utf-8'); // readFile-ok — source boundary contract for recommendation query ownership.

    expect(src).toContain("from '../../hooks/client/useClientInsightViewModel'");
    expect(src).toContain('useClientRecommendationSetView(workspaceId)');
    expect(src).not.toContain('useQuery<RecommendationSet>');
    expect(src).not.toContain('/api/public/recommendations/${workspaceId}`');
  });
});
