// @ds-rebuilt
import { useQuery } from '@tanstack/react-query';
import { contentPerformance } from '../../api/seo';

export const adminContentPerformanceKeys = {
  all: (workspaceId: string) => ['admin-content-performance', workspaceId] as const,
  read: (workspaceId: string, days: number) => [...adminContentPerformanceKeys.all(workspaceId), 'read', days] as const,
  trend: (workspaceId: string, itemId: string) => [...adminContentPerformanceKeys.all(workspaceId), 'trend', itemId] as const,
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
  itemId: string | null | undefined,
) {
  return useQuery({
    queryKey: adminContentPerformanceKeys.trend(workspaceId, itemId ?? 'missing-item'),
    queryFn: () => contentPerformance.trend(workspaceId, itemId ?? ''),
    enabled: !!workspaceId && !!itemId,
    staleTime: 60_000,
  });
}
