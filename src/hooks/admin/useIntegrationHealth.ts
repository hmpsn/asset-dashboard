import { useQuery } from '@tanstack/react-query';
import { integrationHealth } from '../../api/misc';
import { queryKeys } from '../../lib/queryKeys';
import { STALE_TIMES } from '../../lib/queryClient';

export function useIntegrationHealth(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.admin.integrationHealth(workspaceId),
    queryFn: () => integrationHealth.get(workspaceId),
    enabled: !!workspaceId,
    staleTime: STALE_TIMES.STABLE,
    refetchOnWindowFocus: true,
  });
}
