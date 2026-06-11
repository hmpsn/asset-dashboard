import { useQuery, useQueryClient } from '@tanstack/react-query';
import { rankTracking } from '../../../api';
import { useWorkspaceEvents } from '../../../hooks/useWorkspaceEvents';
import { queryKeys } from '../../../lib/queryKeys';
import { WS_EVENTS } from '../../../lib/wsEvents';
import type { RankHistoryEntry } from '../../../../shared/types/rank-tracking';

/** A4 (audit #15): days of rank history shown on the requested-keyword trend card.
 *  Matches the rank_snapshots retention window (180 days, server-enforced). */
export const REQUESTED_KEYWORD_TREND_DAYS = 180;

interface UseRequestedKeywordRankTrendOptions {
  workspaceId?: string;
  /** Client-requested keyword queries (already filtered to `client_requested` source). */
  keywords: string[];
}

/**
 * 180-day rank series for the client's requested keywords, read from the public
 * rank-history endpoint the portal already uses (filtered to the requested
 * queries). Refreshes on RANK_TRACKING_UPDATED — the server broadcasts that
 * event for both new snapshots and keyword lifecycle changes.
 */
export function useRequestedKeywordRankTrend({ workspaceId, keywords }: UseRequestedKeywordRankTrendOptions) {
  const queryClient = useQueryClient();
  const sortedKeywords = [...keywords].sort();

  const trendQuery = useQuery({
    queryKey: queryKeys.client.requestedKeywordTrend(workspaceId ?? '', sortedKeywords),
    queryFn: () => rankTracking.historyFiltered(workspaceId!, sortedKeywords, REQUESTED_KEYWORD_TREND_DAYS),
    enabled: Boolean(workspaceId) && sortedKeywords.length > 0,
    select: (data): RankHistoryEntry[] => (Array.isArray(data) ? data : []),
  });

  useWorkspaceEvents(workspaceId, {
    // ws-invalidation-ok: the trend card owns this client-requested-keyword-trend key.
    [WS_EVENTS.RANK_TRACKING_UPDATED]: () => {
      if (!workspaceId) return;
      queryClient.invalidateQueries({ queryKey: ['client-requested-keyword-trend', workspaceId] });
    },
  });

  return trendQuery;
}
