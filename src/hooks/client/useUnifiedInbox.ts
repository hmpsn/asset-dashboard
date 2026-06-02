import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { publicDeliverables } from '../../api/deliverables';
import type { DeliverableResponseDecision } from '../../api/deliverables';
import { queryKeys } from '../../lib/queryKeys';
import { useFeatureFlag } from '../useFeatureFlag';
import type { ClientDeliverable } from '../../../shared/types/client-deliverable';

/**
 * useUnifiedInbox — the client unified deliverable inbox read hook (PR-2a, DARK).
 *
 * Reads GET /api/public/deliverables/:workspaceId via the typed api wrapper (no raw fetch).
 * Gated on the `unified-inbox` feature flag: the query is DISABLED unless the flag is on, so the
 * flag-off path never fires the request (production behavior unchanged). The hook reads the flag
 * itself so callers don't have to thread it through — but also AND-gates on a caller `enabled`.
 *
 * Returns the list plus the flag state so the consumer (InboxTab) can branch its rendering.
 */
export function useUnifiedInbox(workspaceId: string, enabled = true) {
  const unifiedInbox = useFeatureFlag('unified-inbox');
  const query = useQuery({
    queryKey: queryKeys.client.unifiedInbox(workspaceId),
    queryFn: () => publicDeliverables.list(workspaceId),
    enabled: !!workspaceId && enabled && unifiedInbox,
    staleTime: 30_000,
  });
  return {
    unifiedInbox,
    deliverables: query.data?.deliverables ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

export interface RespondToDeliverableVars {
  deliverableId: string;
  decision: DeliverableResponseDecision;
  note?: string;
}

/**
 * useRespondToDeliverable — the uniform Approve / Request changes / Decline mutation (PR-2a).
 *
 * Calls the REAL PATCH /respond endpoint (dark — only reachable when the unified inbox renders).
 * On success it invalidates the unified inbox query so the list reflects the new status.
 */
export function useRespondToDeliverable(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation<ClientDeliverable, Error, RespondToDeliverableVars>({
    mutationFn: ({ deliverableId, decision, note }) =>
      publicDeliverables.respond(workspaceId, deliverableId, { decision, note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.client.unifiedInbox(workspaceId) });
    },
  });
}
