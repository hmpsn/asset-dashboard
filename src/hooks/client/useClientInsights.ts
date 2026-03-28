import { useQuery } from '@tanstack/react-query';
import { getSafe } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';
import type { ClientInsight } from '../../../shared/types/narrative.js';

interface ClientInsightsResponse {
  insights: ClientInsight[];
}

export function useClientInsights(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.client.clientInsights(workspaceId),
    queryFn: () =>
      getSafe<ClientInsightsResponse>(
        `/api/public/insights/${workspaceId}/narrative`,
        { insights: [] },
      ),
    staleTime: 10 * 60 * 1000, // 10 min — client data changes less frequently
    enabled: !!workspaceId,
  });
}
