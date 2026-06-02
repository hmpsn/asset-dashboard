// ── Work-order API endpoints (admin + client portal) ──────────────────
import { get, post, patch } from './client';
import type { WorkOrder, WorkOrderComment } from '../../shared/types/payments';

/** Admin (HMAC-authenticated) work-order surfaces — list, status PATCH, conversation. */
export const workOrders = {
  list: (wsId: string) =>
    get<WorkOrder[]>(`/api/work-orders/${wsId}`),

  /** PATCH status (e.g. mark complete, close out) / assignee / notes. */
  update: (
    wsId: string,
    orderId: string,
    body: Partial<{ status: WorkOrder['status']; assignedTo: string | null; notes: string }>,
  ) =>
    patch<WorkOrder>(`/api/work-orders/${wsId}/${orderId}`, body),

  listComments: (wsId: string, orderId: string) =>
    get<WorkOrderComment[]>(`/api/work-orders/${wsId}/${orderId}/comments`),

  /** Team reply on a work-order conversation (author forced 'team' server-side). */
  postComment: (wsId: string, orderId: string, content: string) =>
    post<WorkOrderComment>(`/api/work-orders/${wsId}/${orderId}/comment`, { content }),
};

/** Client-portal (public) work-order conversation surfaces. */
export const publicWorkOrders = {
  listComments: (wsId: string, orderId: string) =>
    get<WorkOrderComment[]>(`/api/public/work-order/${wsId}/${orderId}/comments`),

  /** Client comment on a work-order conversation (author forced 'client' server-side). */
  postComment: (wsId: string, orderId: string, content: string) =>
    post<WorkOrderComment>(`/api/public/work-order/${wsId}/${orderId}/comment`, { content }),
};
