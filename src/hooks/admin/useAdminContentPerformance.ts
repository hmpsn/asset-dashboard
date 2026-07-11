// @ds-rebuilt
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { contentPerformance } from '../../api/seo';

export const adminContentPerformanceKeys = {
  all: (workspaceId: string) => ['admin-content-performance', workspaceId] as const,
  read: (workspaceId: string, days: number) => [...adminContentPerformanceKeys.all(workspaceId), 'read', days] as const,
  trend: (workspaceId: string, requestId: string) => [...adminContentPerformanceKeys.all(workspaceId), 'trend', requestId] as const,
};

export function useAdminContentPerformance(workspaceId: string, days = 90) {
  return useQuery({
    queryKey: adminContentPerformanceKeys.read(workspaceId, days),
    queryFn: () => contentPerformance.get(workspaceId),
    enabled: !!workspaceId,
    staleTime: 60_000,
  });
}

export function useAdminContentPerformanceTrend(
  workspaceId: string,
  requestId: string | null | undefined,
) {
  return useQuery({
    queryKey: adminContentPerformanceKeys.trend(workspaceId, requestId ?? 'missing-request'),
    queryFn: () => contentPerformance.trend(workspaceId, requestId ?? ''),
    enabled: !!workspaceId && !!requestId,
    staleTime: 60_000,
  });
}

export function useAdminContentPerformanceRefresh(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => queryClient.refetchQueries({ queryKey: adminContentPerformanceKeys.all(workspaceId) }),
  });
}
