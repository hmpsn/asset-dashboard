// @ds-rebuilt
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { contentPerformance } from '../../api/seo';
import type { ContentPerformanceResponse } from '../../../shared/types/content';

export interface ContentPerformanceTrendPoint {
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface ContentPerformanceTrendResponse {
  trend: ContentPerformanceTrendPoint[];
}

export const adminContentPerformanceKeys = {
  all: (workspaceId: string) => ['admin-content-performance', workspaceId] as const,
  read: (workspaceId: string, days: number) => [...adminContentPerformanceKeys.all(workspaceId), 'read', days] as const,
  trend: (workspaceId: string, requestId: string) => [...adminContentPerformanceKeys.all(workspaceId), 'trend', requestId] as const,
};

function asContentPerformanceResponse(value: unknown): ContentPerformanceResponse {
  return value as ContentPerformanceResponse;
}

function asContentPerformanceTrendResponse(value: unknown): ContentPerformanceTrendResponse {
  return value as ContentPerformanceTrendResponse;
}

export function useAdminContentPerformance(workspaceId: string, days = 90) {
  return useQuery({
    queryKey: adminContentPerformanceKeys.read(workspaceId, days),
    queryFn: async () => asContentPerformanceResponse(await contentPerformance.get(workspaceId, days)),
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
    queryFn: async () => asContentPerformanceTrendResponse(await contentPerformance.trend(workspaceId, requestId ?? '')),
    enabled: !!workspaceId && !!requestId,
    staleTime: 60_000,
  });
}

export function useAdminContentPerformanceRefresh(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => contentPerformance.refresh(workspaceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminContentPerformanceKeys.all(workspaceId) });
    },
  });
}
