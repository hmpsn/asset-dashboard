import { useQuery } from '@tanstack/react-query';
import { get } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';
import { STALE_TIMES } from '../../lib/queryClient';

interface HealthStatus {
  hasOpenAIKey: boolean;
  hasWebflowToken: boolean;
}

export const HEALTH_KEY = queryKeys.admin.health();

export function useHealthCheck() {
  return useQuery<HealthStatus>({
    queryKey: HEALTH_KEY,
    queryFn: () => get<HealthStatus>('/api/health'),
    staleTime: STALE_TIMES.STABLE,
    refetchOnWindowFocus: true,
  });
}

export type { HealthStatus };
