/**
 * useAdminLeads — The Issue (Client) P1b admin named-leads readout hook (Lane B, consumes A5).
 *
 * - useQuery: GET the operator's captured named-leads (PII; requireWorkspaceAccess), paginated.
 *   Gated on the caller's flag (measuredCapture). Flag-OFF / disabled → no fetch, no network
 *   traffic (byte-identical OFF). The API wrapper (conversionTrackingApi.listLeads) falls back to
 *   a safe empty `{ leads: [], total: 0 }` on a flag-OFF 404.
 * - useWorkspaceEvents: the SECOND half of the WS contract (CLAUDE.md §Data Flow Rule #2) — the
 *   daily poller broadcasts FORM_SUBMISSION_CAPTURED on a NEW capture (PII-free payload); this
 *   handler invalidates the leads query so the readout refreshes live. The prefix key
 *   ['admin-form-submissions', wsId] invalidates every page variant.
 */
import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { WS_EVENTS } from '../../lib/wsEvents';
import { useWorkspaceEvents } from '../useWorkspaceEvents';
import { conversionTrackingApi } from '../../api/conversionTracking';
import type { NamedLeadView } from '../../../shared/types/the-issue';

export interface UseAdminLeadsResult {
  leads: NamedLeadView[];
  total: number;
  isLoading: boolean;
  isError: boolean;
}

/**
 * @param workspaceId - The workspace whose captured leads to read.
 * @param params - Optional pagination ({ limit, offset }).
 * @param enabled - Composed gate (the measuredCapture flag). When false, no fetch runs and no WS
 *   subscription side effects occur.
 */
export function useAdminLeads(
  workspaceId: string,
  params?: { limit?: number; offset?: number },
  enabled: boolean = true,
): UseAdminLeadsResult {
  const qc = useQueryClient();
  const queryEnabled = !!workspaceId && enabled;
  // The factory key is the workspace prefix (['admin-form-submissions', wsId]); the params object is
  // appended here so each page is a distinct cache entry while the prefix still invalidates them all.
  const key = [...queryKeys.admin.formSubmissions(workspaceId), params ?? {}] as const;

  const query = useQuery({
    queryKey: key,
    queryFn: () => conversionTrackingApi.listLeads(workspaceId, params),
    enabled: queryEnabled,
    staleTime: 30 * 1000, // 30s — new captures arrive live via the WS invalidation below.
    refetchOnWindowFocus: false,
  });

  // ── Both-halves WS handler (CLAUDE.md §Data Flow Rule #2) ─────────
  const wsHandlers = useMemo(
    () => ({
      [WS_EVENTS.FORM_SUBMISSION_CAPTURED]: () =>
        // Prefix invalidation — refreshes every paginated variant on a new capture.
        qc.invalidateQueries({ queryKey: queryKeys.admin.formSubmissions(workspaceId) }),
    }),
    [qc, workspaceId],
  );
  useWorkspaceEvents(queryEnabled ? workspaceId || undefined : undefined, wsHandlers);

  return {
    leads: queryEnabled ? query.data?.leads ?? [] : [],
    total: queryEnabled ? query.data?.total ?? 0 : 0,
    isLoading: queryEnabled ? query.isLoading : false,
    isError: queryEnabled ? query.isError : false,
  };
}
