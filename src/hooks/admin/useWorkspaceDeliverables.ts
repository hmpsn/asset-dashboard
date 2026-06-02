import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminDeliverables } from '../../api/deliverables';
import { queryKeys } from '../../lib/queryKeys';
import { useFeatureFlag } from '../useFeatureFlag';
import type { AdminDeliverableView } from '../../../shared/types/admin-deliverable-view';

/**
 * useWorkspaceDeliverables — the admin "Client Deliverables" pane read hook (PR-2b, DARK).
 *
 * Reads GET /api/deliverables/:workspaceId via the typed api wrapper (no raw fetch). Gated on the
 * `unified-inbox` flag: the query is DISABLED unless the flag is on, so the flag-off path never
 * fires the request (production behavior unchanged). The hook reads the flag itself so the mount
 * branch (App.tsx) stays a small additive check.
 *
 * Returns the annotated list (status axis + stale flag) plus the flag state.
 */
export function useWorkspaceDeliverables(workspaceId: string | undefined, enabled = true) {
  const unifiedInbox = useFeatureFlag('unified-inbox');
  const query = useQuery({
    queryKey: workspaceId
      ? queryKeys.admin.workspaceDeliverables(workspaceId)
      : ['admin-workspace-deliverables-disabled'],
    queryFn: () => adminDeliverables.list(workspaceId as string),
    enabled: !!workspaceId && enabled && unifiedInbox,
    staleTime: 30_000,
  });
  return {
    unifiedInbox,
    deliverables: (query.data?.deliverables ?? []) as AdminDeliverableView[],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/**
 * useRemindDeliverable — the operator "Remind" nudge (PR-2b).
 *
 * Calls the existing POST /api/deliverables/:ws/:id/remind (Phase 0 admin route). On success it
 * invalidates the admin pane query so the list reflects any state/age change.
 */
export function useRemindDeliverable(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deliverableId: string) => adminDeliverables.remind(workspaceId, deliverableId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.admin.workspaceDeliverables(workspaceId),
      });
    },
  });
}
