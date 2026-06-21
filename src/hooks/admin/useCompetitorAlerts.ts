/**
 * useCompetitorAlerts — React Query hook for the admin Competitors page alert feed (Phase 6, Lane C).
 *
 * - useQuery: GET /api/workspaces/:wsId/competitor-alerts → recent competitor-movement alerts.
 *   `staleTime` ~1h: the alerts are produced by the weekly Monday competitor-monitoring cron, so a
 *   long stale window avoids needless refetches; the WS handler covers live strategy regen.
 * - useWorkspaceEvents: the second half of the WS contract (CLAUDE.md §Data Flow Rule #2). The
 *   competitor cron / strategy regeneration touches competitor data and broadcasts STRATEGY_UPDATED,
 *   so the feed invalidates on that existing event — no new WS event.
 */

import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { WS_EVENTS } from '../../lib/wsEvents';
import { useWorkspaceEvents } from '../useWorkspaceEvents';
import { getCompetitorAlerts } from '../../api/competitorAlerts';
import type { CompetitorAlertView } from '../../../shared/types/competitor-alerts';

export interface UseCompetitorAlertsResult {
  alerts: CompetitorAlertView[];
  isLoading: boolean;
  isError: boolean;
}

export function useCompetitorAlerts(workspaceId: string): UseCompetitorAlertsResult {
  const qc = useQueryClient();
  const enabled = !!workspaceId;

  const query = useQuery({
    queryKey: queryKeys.admin.competitorAlerts(workspaceId),
    queryFn: () => getCompetitorAlerts(workspaceId),
    enabled,
    staleTime: 60 * 60 * 1000, // 1h — alerts refresh weekly; the WS handler covers regen.
    refetchOnWindowFocus: false,
  });

  // ── Both-halves WS handler (CLAUDE.md §Data Flow Rule #2) ─────────
  const wsHandlers = useMemo(() => {
    const invalidate = () =>
      qc.invalidateQueries({ queryKey: queryKeys.admin.competitorAlerts(workspaceId) });
    return {
      [WS_EVENTS.STRATEGY_UPDATED]: invalidate,
    };
  }, [qc, workspaceId]);
  useWorkspaceEvents(workspaceId || undefined, wsHandlers);

  return {
    alerts: query.data?.alerts ?? [],
    isLoading: enabled ? query.isLoading : false,
    isError: enabled ? query.isError : false,
  };
}
