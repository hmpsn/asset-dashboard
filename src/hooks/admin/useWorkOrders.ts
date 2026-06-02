// ── Work Orders React Query hooks (admin) ───────────────────────────────────
// Admin hooks for the focused work-order conversation/close panel: list, the
// per-order conversation thread, a status PATCH (mark complete / close out), and
// the team reply mutation. All mutations invalidate the relevant admin-prefixed
// keys; the WORK_ORDER_COMMENT / WORK_ORDER_UPDATE WS handlers (useWsInvalidation)
// also invalidate these keys so the panel stays live.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { workOrders } from '../../api/work-orders';
import { queryKeys } from '../../lib/queryKeys';
import { useToast } from '../../components/Toast';
import type { WorkOrder } from '../../../shared/types/payments';

function toastErr(toast: ReturnType<typeof useToast>['toast'], fallback: string) {
  return (err: unknown) => {
    const msg = err instanceof Error && err.message ? err.message : fallback;
    toast(msg, 'error');
  };
}

export function useAdminWorkOrders(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.admin.workOrders(workspaceId),
    queryFn: () => workOrders.list(workspaceId),
    enabled: !!workspaceId && enabled,
  });
}

export function useAdminWorkOrderComments(workspaceId: string, orderId: string | null) {
  return useQuery({
    queryKey: queryKeys.admin.workOrderComments(workspaceId, orderId ?? ''),
    queryFn: () => workOrders.listComments(workspaceId, orderId!),
    enabled: !!workspaceId && !!orderId,
  });
}

export function useUpdateWorkOrderStatus(workspaceId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({ orderId, status }: { orderId: string; status: WorkOrder['status'] }) =>
      workOrders.update(workspaceId, orderId, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.workOrders(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(workspaceId) });
    },
    onError: toastErr(toast, 'Failed to update work order'),
  });
}

export function usePostWorkOrderComment(workspaceId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({ orderId, content }: { orderId: string; content: string }) =>
      workOrders.postComment(workspaceId, orderId, content),
    onSuccess: (_data, { orderId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.workOrderComments(workspaceId, orderId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.workOrders(workspaceId) });
    },
    onError: toastErr(toast, 'Failed to post comment'),
  });
}
