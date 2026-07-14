import { useQuery } from '@tanstack/react-query';

import { brandSummaryApi } from '../../api/brand-summary';
import { queryKeys } from '../../lib/queryKeys';

export function useBrandSummary(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.client.brandSummary(workspaceId),
    queryFn: () => brandSummaryApi.get(workspaceId),
    enabled: !!workspaceId && enabled,
    staleTime: 30_000,
  });
}
