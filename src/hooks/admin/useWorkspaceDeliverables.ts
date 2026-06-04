import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminDeliverables } from '../../api/deliverables';
import { queryKeys } from '../../lib/queryKeys';
import type { AdminDeliverableView } from '../../../shared/types/admin-deliverable-view';

/** Reads GET `/api/deliverables/:workspaceId` via the typed admin API wrapper. */
export function useWorkspaceDeliverables(workspaceId: string | undefined, enabled = true) {
  const query = useQuery({
    queryKey: workspaceId
      ? queryKeys.admin.workspaceDeliverables(workspaceId)
      : ['admin-workspace-deliverables-disabled'],
    queryFn: () => adminDeliverables.list(workspaceId as string),
    enabled: !!workspaceId && enabled,
    staleTime: 30_000,
  });
  return {
    deliverables: (query.data?.deliverables ?? []) as AdminDeliverableView[],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/**
 * Calls POST `/api/deliverables/:ws/:id/remind` and invalidates the admin pane query on success.
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
