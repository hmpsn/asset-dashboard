import { useQuery, useQueryClient } from '@tanstack/react-query';
import { rankTracking } from '../../api/seo';
import { WS_EVENTS } from '../../lib/wsEvents';
import { useWorkspaceEvents } from '../../hooks/useWorkspaceEvents';
import { keywordTrackingKey } from '../../lib/keywordTracking';
import { queryKeys } from '../../lib/queryKeys';
import type { TrackedKeyword } from '../../../shared/types/rank-tracking';

export function usePageIntelligenceKeywordTracking(workspaceId: string) {
  const queryClient = useQueryClient();
  const trackedKeywordsQuery = useQuery({
    queryKey: queryKeys.admin.rankTrackingKeywords(workspaceId),
    queryFn: () => rankTracking.keywords(workspaceId),
    enabled: !!workspaceId,
    staleTime: 60 * 1000,
    select: (rows) => new Set((rows || []).map(k => keywordTrackingKey(k.query))),
  });
  const trackedKeywords = trackedKeywordsQuery.data ?? new Set<string>();
  const loadTrackedKeywords = () => {
    void trackedKeywordsQuery.refetch();
  };

  useWorkspaceEvents(workspaceId, {
    // ws-invalidation-ok: Page Intelligence owns a select-derived Set over the shared admin rank-tracking cache.
    [WS_EVENTS.RANK_TRACKING_UPDATED]: loadTrackedKeywords,
    // ws-invalidation-ok: strategy refresh can reconcile tracked state used by local badges.
    [WS_EVENTS.STRATEGY_UPDATED]: loadTrackedKeywords,
  });

  const trackKeyword = async (kw: string) => {
    const key = keywordTrackingKey(kw);
    if (!key || trackedKeywords.has(key)) return;
    try {
      await rankTracking.addKeyword(workspaceId, { query: kw });
      queryClient.setQueryData<TrackedKeyword[]>(
        queryKeys.admin.rankTrackingKeywords(workspaceId),
        (prev = []) => {
          const alreadyTracked = prev.some(row => keywordTrackingKey(row.query) === key);
          if (alreadyTracked) return prev;
          return [
            ...prev,
            {
              query: kw,
              pinned: false,
              addedAt: new Date().toISOString(),
              source: 'manual',
            },
          ];
        },
      );
    } catch {
      // silently ignore duplicates
    }
  };

  return {
    trackedKeywords,
    trackKeyword,
  };
}
