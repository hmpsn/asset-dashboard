/**
 * React Query hook for anomaly alerts data
 * Replaces manual useEffect fetch pattern in AnomalyAlerts.tsx
 */

import { useQuery } from '@tanstack/react-query';
import { get } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';
import { STALE_TIMES } from '../../lib/queryClient';

interface AnomalyAlert {
  id: string;
  workspaceId: string;
  workspaceName: string;
  type: 'traffic_drop' | 'traffic_spike' | 'impressions_drop' | 'ctr_drop' | 'position_decline' | 'bounce_spike' | 'audit_score_drop' | 'audit_score_improvement' | 'conversion_drop';
  severity: 'critical' | 'warning' | 'positive';
  title: string;
  description: string;
  metric: string;
  currentValue: number;
  previousValue: number;
  changePct: number;
  aiSummary?: string;
  detectedAt: string;
  dismissedAt?: string;
  acknowledgedAt?: string;
  source: 'gsc' | 'ga4' | 'audit';
}

export function useAnomalyAlerts(workspaceId: string, isAdmin: boolean = true) {
  return useQuery({
    queryKey: queryKeys.admin.anomalyAlerts(workspaceId),
    queryFn: async (): Promise<AnomalyAlert[]> => {
      const endpoint = isAdmin 
        ? `/api/anomalies/${workspaceId}`
        : `/api/public/anomalies/${workspaceId}`;
      const response = await get<AnomalyAlert[]>(endpoint);
      return Array.isArray(response) ? response : [];
    },
    staleTime: STALE_TIMES.STABLE,
    enabled: !!workspaceId && isAdmin,
    retry: 1,
    refetchInterval: 10 * 60 * 1000, // Auto-refresh every 10 minutes
  });
}
