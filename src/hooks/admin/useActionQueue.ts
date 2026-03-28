import { useQuery } from '@tanstack/react-query';
import { getSafe } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';
import type { AnalyticsInsight } from '../../../shared/types/analytics.js';

interface ActionQueueResponse {
  items: AnalyticsInsight[];
}

export function useActionQueue(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.admin.actionQueue(workspaceId),
    queryFn: () =>
      getSafe<ActionQueueResponse>(
        `/api/insights/${workspaceId}/queue`,
        { items: [] },
      ),
    staleTime: 5 * 60 * 1000,
    enabled: !!workspaceId,
  });
}
