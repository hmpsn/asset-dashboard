import { useClientNarrativeInsightsView } from './useClientInsightViewModel';

export function useClientInsights(workspaceId: string, enabled = true) {
  return useClientNarrativeInsightsView(workspaceId, enabled);
}
