// ── Client work-order conversation hooks ──────────────────────────────────────
// The client "Work in progress" track-lane card reads its own conversation
// thread (public GET) and posts comments (public POST, author forced 'client'
// server-side). Both keyed on the work order id (extracted from the deliverable's
// sourceRef `work_order:<id>`).

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { publicWorkOrders } from '../../api/work-orders';
import { queryKeys } from '../../lib/queryKeys';
import type { WorkOrderComment } from '../../../shared/types/payments';

export function useClientWorkOrderComments(workspaceId: string, orderId: string | null, enabled = true) {
  return useQuery<WorkOrderComment[]>({
    queryKey: queryKeys.client.workOrderComments(workspaceId, orderId ?? ''),
    queryFn: () => publicWorkOrders.listComments(workspaceId, orderId!),
    enabled: !!workspaceId && !!orderId && enabled,
    staleTime: 30_000,
  });
}

export function usePostClientWorkOrderComment(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation<WorkOrderComment, Error, { orderId: string; content: string }>({
    mutationFn: ({ orderId, content }) => publicWorkOrders.postComment(workspaceId, orderId, content),
    onSuccess: (_data, { orderId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.client.workOrderComments(workspaceId, orderId) });
    },
  });
}
