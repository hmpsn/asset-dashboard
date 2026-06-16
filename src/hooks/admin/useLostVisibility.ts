import { useQuery } from '@tanstack/react-query';
import { getSafe } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';
import type { AnalyticsInsight, LostVisibilityData } from '../../../shared/types/analytics';

/**
 * Reads the workspace's lost_visibility insight (top lost queries) from the public insights feed.
 * Shares the ['admin-insight-feed', wsId] cache with useInsightFeed (same queryFn) but selects the
 * raw structured LostVisibilityData — the query strings + totalImpressions that the lossy
 * FeedInsight transform drops. Returns null when there is no lost_visibility insight.
 */
export function useLostVisibility(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.admin.insightFeed(workspaceId!),
    queryFn: () => getSafe<AnalyticsInsight[]>('/api/public/insights/' + workspaceId, []),
    enabled: !!workspaceId,
    select: (insights): LostVisibilityData | null => {
      const found = insights.find(i => i.insightType === 'lost_visibility');
      return found ? (found.data as LostVisibilityData) : null;
    },
  });
}
