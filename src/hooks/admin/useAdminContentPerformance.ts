// @ds-rebuilt
import { useQuery } from '@tanstack/react-query';
import { contentPerformance } from '../../api/seo';
import { queryKeys } from '../../lib/queryKeys';

export function useAdminContentPerformance(workspaceId: string, days = 90) {
  return useQuery({
    queryKey: queryKeys.admin.contentPerformance(workspaceId, days),
    queryFn: () => contentPerformance.get(workspaceId),
    enabled: !!workspaceId,
    staleTime: 60_000,
  });
}

export function useAdminContentPerformanceTrend(
  workspaceId: string,
  itemId: string | null | undefined,
) {
  return useQuery({
    queryKey: queryKeys.admin.contentPerformanceTrend(workspaceId, itemId ?? 'missing-item'),
    queryFn: () => contentPerformance.trend(workspaceId, itemId ?? ''),
    enabled: !!workspaceId && !!itemId,
    staleTime: 60_000,
  });
}
