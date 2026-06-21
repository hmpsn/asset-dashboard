/**
 * useClientMyLeads — The Issue (Client) P1b Lane C — the client's OWN captured-leads read.
 *
 * - useQuery: GET the authed client-portal "my leads" payload (the client's own form submissions,
 *   PII included — they may see their OWN leads, D3/D7). Consumes Lane A's `getMyLeads`
 *   (`src/api/conversionTracking.ts`), which is `getSafe`-backed → a flag-OFF 404 degrades to
 *   `{ leads: [] }`, never a throw. Gated on the caller's `the-issue-client-return-hook` flag via
 *   `enabled`: flag-OFF → no fetch, no WS subscription (byte-identical OFF).
 * - useWorkspaceEvents: the SECOND half of the WS contract (CLAUDE.md §Data Flow Rule #2) — a new
 *   capture broadcasts FORM_SUBMISSION_CAPTURED (workspace-scoped → useWorkspaceEvents, never
 *   useGlobalAdminEvents); this handler invalidates the my-leads query so the client's list
 *   refreshes live without a poll.
 */
import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { WS_EVENTS } from '../../lib/wsEvents';
import { useWorkspaceEvents } from '../useWorkspaceEvents';
import { getMyLeads } from '../../api/conversionTracking';
import type { NamedLeadView } from '../../../shared/types/the-issue.ts';

export interface UseClientMyLeadsResult {
  leads: NamedLeadView[];
  isLoading: boolean;
  isError: boolean;
}

/**
 * @param workspaceId - The workspace whose own captured leads to read.
 * @param enabled - The composed return-hook gate. When false, no fetch runs and no WS subscription
 *   side effects occur (flag-OFF byte-identical).
 */
export function useClientMyLeads(
  workspaceId: string,
  enabled: boolean = true,
): UseClientMyLeadsResult {
  const qc = useQueryClient();
  const queryEnabled = !!workspaceId && enabled;

  const query = useQuery({
    queryKey: queryKeys.client.myLeads(workspaceId),
    queryFn: () => getMyLeads(workspaceId),
    enabled: queryEnabled,
    staleTime: 30 * 1000, // 30s — leads arrive live via the WS invalidation below.
    refetchOnWindowFocus: false,
  });

  // ── Both-halves WS handler (CLAUDE.md §Data Flow Rule #2; workspace-scoped) ──────
  const wsHandlers = useMemo(
    () => ({
      [WS_EVENTS.FORM_SUBMISSION_CAPTURED]: () =>
        qc.invalidateQueries({ queryKey: queryKeys.client.myLeads(workspaceId) }),
    }),
    [qc, workspaceId],
  );
  useWorkspaceEvents(queryEnabled ? workspaceId || undefined : undefined, wsHandlers);

  return {
    leads: queryEnabled ? query.data?.leads ?? [] : [],
    isLoading: queryEnabled ? query.isLoading : false,
    isError: queryEnabled ? query.isError : false,
  };
}
