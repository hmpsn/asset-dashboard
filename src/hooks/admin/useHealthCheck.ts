import { useQuery } from '@tanstack/react-query';
import { get } from '../../api/client';

interface HealthStatus {
  hasOpenAIKey: boolean;
  hasWebflowToken: boolean;
}

const HEALTH_KEY = ['admin-health'] as const;

export function useHealthCheck() {
  return useQuery<HealthStatus>({
    queryKey: HEALTH_KEY,
    queryFn: () => get<HealthStatus>('/api/health'),
    staleTime: 120_000,
    refetchOnWindowFocus: true,
  });
}

export { HEALTH_KEY };
export type { HealthStatus };
