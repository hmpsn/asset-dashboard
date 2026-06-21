/**
 * useConversionTrackingStatus — The Issue (Client) P1a admin verification-readout hook.
 *
 * - useQuery: GET the conversion-tracking status (pinned/typed/forms-connected/last-lead/count).
 *   Gated on the caller's flag (measuredCapture) AND a GA4 property being configured. Flag-OFF →
 *   no fetch, no network traffic (byte-identical OFF).
 * - useWorkspaceEvents: the SECOND half of the WS contract (CLAUDE.md §Data Flow Rule #2) — the
 *   conversion-tracking webhook receiver broadcasts FORM_SUBMISSION_CAPTURED on a NEW capture; this
 *   handler invalidates the status query so the readout's last-lead / connected state refreshes
 *   live without a poll. The broadcast payload is PII-free ({ workspaceId, outcomeType }).
 */
import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { WS_EVENTS } from '../../lib/wsEvents';
import { useWorkspaceEvents } from '../useWorkspaceEvents';
import { conversionTrackingApi, type ConversionTrackingStatus } from '../../api/conversionTracking';

export interface UseConversionTrackingStatusResult {
  status: ConversionTrackingStatus | undefined;
  isLoading: boolean;
  isError: boolean;
}

/**
 * @param workspaceId - The workspace whose conversion-tracking status to read.
 * @param enabled - Composed gate (measuredCapture flag AND a configured GA4 property). When false,
 *   no fetch runs and no WS subscription side effects occur on the status query.
 */
export function useConversionTrackingStatus(
  workspaceId: string,
  enabled: boolean = true,
): UseConversionTrackingStatusResult {
  const qc = useQueryClient();
  const queryEnabled = !!workspaceId && enabled;
  const key = queryKeys.admin.conversionTrackingStatus(workspaceId);

  const query = useQuery({
    queryKey: key,
    queryFn: () => conversionTrackingApi.getStatus(workspaceId),
    enabled: queryEnabled,
    staleTime: 30 * 1000, // 30s — leads arrive live via the WS invalidation below.
    refetchOnWindowFocus: false,
  });

  // ── Both-halves WS handler (CLAUDE.md §Data Flow Rule #2) ─────────
  const wsHandlers = useMemo(
    () => ({
      [WS_EVENTS.FORM_SUBMISSION_CAPTURED]: () =>
        qc.invalidateQueries({ queryKey: queryKeys.admin.conversionTrackingStatus(workspaceId) }),
    }),
    [qc, workspaceId],
  );
  useWorkspaceEvents(queryEnabled ? workspaceId || undefined : undefined, wsHandlers);

  return {
    status: queryEnabled ? query.data : undefined,
    isLoading: queryEnabled ? query.isLoading : false,
    isError: queryEnabled ? query.isError : false,
  };
}
