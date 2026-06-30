/**
 * useIssueLenses — React Query hook for The Issue's four-jobs lenses (Phase 5, Lane C).
 *
 * - useQuery: GET the two ADMIN read-projections (keyword targets + content work-orders) of the
 *   curated Issue rec set.
 * - useWorkspaceEvents: the second half of the WS contract — the projection is recomputed from
 *   loadRecommendations + listContentRequests, so it invalidates on the existing events that mutate
 *   either source: RECOMMENDATIONS_UPDATED (curation/strike/send), CONTENT_REQUEST_CREATED, and
 *   CONTENT_REQUEST_UPDATE (production-stage changes). No new WS event.
 *
 * `enabled` is gated on the caller's flag (theIssueEnabled) AND workspaceId. Flag-OFF → no fetch,
 * no network traffic, no behavior change (byte-identical OFF).
 */

import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { WS_EVENTS } from '../../lib/wsEvents';
import { useWorkspaceEvents } from '../useWorkspaceEvents';
import { getIssueLenses } from '../../api/issueLenses';
import type {
  ContentWorkOrderRow,
  KeywordTargetRow,
} from '../../../shared/types/strategy-issue-lenses';

export interface UseIssueLensesResult {
  keywordTargets: KeywordTargetRow[];
  contentWorkOrders: ContentWorkOrderRow[];
  isLoading: boolean;
  isError: boolean;
}

/**
 * @param workspaceId - The workspace whose lenses to project.
 * @param enabled - The composed flag gate (theIssueEnabled). When false, no fetch runs.
 */
export function useIssueLenses(
  workspaceId: string,
  enabled: boolean = true,
): UseIssueLensesResult {
  const qc = useQueryClient();
  const queryEnabled = !!workspaceId && enabled;
  const key = queryKeys.admin.issueLenses(workspaceId);

  const query = useQuery({
    queryKey: key,
    queryFn: () => getIssueLenses(workspaceId),
    enabled: queryEnabled,
    staleTime: 2 * 60 * 1000, // 2 min — the WS handlers cover live curation/production updates.
    refetchOnWindowFocus: false,
  });

  // ── Both-halves WS handler (CLAUDE.md §Data Flow Rule #2) ─────────
  const wsHandlers = useMemo(() => {
    const invalidate = () =>
      qc.invalidateQueries({ queryKey: queryKeys.admin.issueLenses(workspaceId) });
    return {
      [WS_EVENTS.RECOMMENDATIONS_UPDATED]: invalidate,
      [WS_EVENTS.CONTENT_REQUEST_CREATED]: invalidate,
      [WS_EVENTS.CONTENT_REQUEST_UPDATE]: invalidate,
    };
  }, [qc, workspaceId]);
  useWorkspaceEvents(workspaceId || undefined, wsHandlers);

  return {
    keywordTargets: query.data?.keywordTargets ?? [],
    contentWorkOrders: query.data?.contentWorkOrders ?? [],
    isLoading: queryEnabled ? query.isLoading : false,
    isError: queryEnabled ? query.isError : false,
  };
}
