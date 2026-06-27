import { useClientIntelligenceView } from './useClientInsightViewModel';

export function useClientIntelligence(workspaceId: string) {
  return useClientIntelligenceView(workspaceId);
}
