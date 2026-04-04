import { useQuery } from '@tanstack/react-query';
import { fetchClientIntelligence } from '../../api/analytics.js';
import { queryKeys } from '../../lib/queryKeys.js';
import type { ClientIntelligence } from '../../../shared/types/intelligence.js';

export function useClientIntelligence(workspaceId: string) {
  return useQuery<ClientIntelligence>({
    queryKey: queryKeys.client.intelligence(workspaceId),
    queryFn: () => fetchClientIntelligence(workspaceId),
    staleTime: 5 * 60 * 1000, // 5 min — intelligence refreshes on a 6h cron
    enabled: !!workspaceId,
  });
}
