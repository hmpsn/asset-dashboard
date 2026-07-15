import { useQuery } from '@tanstack/react-query';
import { get, getSafe } from '../../api/client';
import { briefingApi } from '../../api/briefing';
import { fetchClientIntelligence } from '../../api/analytics.js';
import { queryKeys } from '../../lib/queryKeys';
import type { PublishedBriefingResponse } from '../../../shared/types/briefing';
import type { ClientIntelligence } from '../../../shared/types/intelligence.js';
import type { ClientInsight, MonthlyDigestData } from '../../../shared/types/narrative.js';
import type { RecommendationSet } from '../../../shared/types/recommendations.ts';

interface ClientInsightsResponse {
  insights: ClientInsight[];
}

export const emptyMonthlyDigest: MonthlyDigestData = {
  availability: 'no_data',
  month: '',
  period: { start: '', end: '' },
  summary: '',
  wins: [],
  issuesAddressed: [],
  metrics: { clicksChange: 0, impressionsChange: 0, avgPositionChange: 0, pagesOptimized: 0 },
  roiHighlights: [],
};

export interface ClientInsightViewModelOptions {
  narrativeEnabled?: boolean;
  briefingEnabled?: boolean;
  monthlyDigestEnabled?: boolean;
  intelligenceEnabled?: boolean;
  recommendationsEnabled?: boolean;
}

export function useClientNarrativeInsightsView(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.client.clientInsights(workspaceId),
    queryFn: () =>
      getSafe<ClientInsightsResponse>(
        `/api/public/insights/${workspaceId}/narrative`,
        { insights: [] },
      ),
    staleTime: 10 * 60 * 1000,
    enabled: !!workspaceId && enabled,
  });
}

export function useClientMonthlyDigestView(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.client.monthlyDigest(workspaceId),
    queryFn: () =>
      getSafe<MonthlyDigestData>(
        `/api/public/insights/${workspaceId}/digest`,
        emptyMonthlyDigest,
      ),
    staleTime: 60 * 60 * 1000,
    enabled: !!workspaceId && enabled,
  });
}

export function useClientPublishedBriefingView(workspaceId: string, enabled: boolean) {
  return useQuery<PublishedBriefingResponse | null>({
    queryKey: queryKeys.client.briefing(workspaceId),
    queryFn: () => briefingApi.getPublished(workspaceId),
    enabled: enabled && !!workspaceId,
    staleTime: 60 * 60 * 1000,
  });
}

export function useClientIntelligenceView(workspaceId: string, enabled = true) {
  return useQuery<ClientIntelligence>({
    queryKey: queryKeys.client.intelligence(workspaceId),
    queryFn: () => fetchClientIntelligence(workspaceId),
    staleTime: 5 * 60 * 1000,
    enabled: !!workspaceId && enabled,
  });
}

export function useClientRecommendationSetView(workspaceId?: string, enabled = true) {
  return useQuery<RecommendationSet>({
    queryKey: queryKeys.shared.recommendations(workspaceId!),
    queryFn: (): Promise<RecommendationSet> =>
      get<RecommendationSet>(`/api/public/recommendations/${workspaceId}`),
    enabled: !!workspaceId && enabled,
    staleTime: 60_000,
  });
}

export function useClientInsightViewModel(
  workspaceId: string,
  options: ClientInsightViewModelOptions = {},
) {
  const narrative = useClientNarrativeInsightsView(workspaceId, options.narrativeEnabled ?? true);
  const monthlyDigest = useClientMonthlyDigestView(workspaceId, options.monthlyDigestEnabled ?? true);
  const briefing = useClientPublishedBriefingView(workspaceId, options.briefingEnabled ?? false);
  const intelligence = useClientIntelligenceView(workspaceId, options.intelligenceEnabled ?? true);
  const recommendations = useClientRecommendationSetView(workspaceId, options.recommendationsEnabled ?? true);

  return {
    narrative,
    monthlyDigest,
    briefing,
    intelligence,
    recommendations,
  };
}
