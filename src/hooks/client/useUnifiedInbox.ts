import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { publicDeliverables } from '../../api/deliverables';
import type { DeliverableResponseDecision } from '../../api/deliverables';
import { queryKeys } from '../../lib/queryKeys';
import type { ClientDeliverable } from '../../../shared/types/client-deliverable';

/** Reads GET `/api/public/deliverables/:workspaceId` via the typed API wrapper. */
export function useUnifiedInbox(workspaceId: string, enabled = true) {
  const query = useQuery({
    queryKey: queryKeys.client.unifiedInbox(workspaceId),
    queryFn: () => publicDeliverables.list(workspaceId),
    enabled: !!workspaceId && enabled,
    staleTime: 30_000,
  });
  return {
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
  /**
   * R3 per-item subset (approval family only): the items the client flagged in the
   * DeliverableDetailModal — each carrying the `ClientDeliverableItem.id` plus the typed flag note.
   * Forwarded to /respond; the server approves the unflagged items and holds (rejects) the flagged
   * ones, persisting the typed note onto each held item. Ignored on reject decisions / the
   * client_action family.
   */
  flaggedItems?: { itemId: string; note?: string }[];
  /**
   * Item 2 — EDIT-before-approve (approval family only): the per-item edited proposed values the
   * client typed in the inline editor (seoTitle/seoDescription). Forwarded to /respond; the server
   * persists each as the legacy approval item's `clientValue` (the Webflow apply path prefers it).
   * Orthogonal to `flaggedItems`. Ignored on reject decisions / the client_action family.
   */
  editedItems?: { itemId: string; value: string }[];
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
    mutationFn: ({ deliverableId, decision, note, flaggedItems, editedItems }) =>
      publicDeliverables.respond(workspaceId, deliverableId, { decision, note, flaggedItems, editedItems }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.client.unifiedInbox(workspaceId) });
    },
  });
}

/** Result shape of the apply mutation. */
export interface ApplyDeliverableResult {
  results: Array<{ itemId: string; pageId: string; success: boolean; error?: string }>;
  applied: number;
  failed: number;
}

export interface ApplyDeliverableVars {
  /** The client-facing deliverable id. The server resolves its approval-batch source. */
  deliverableId: string;
}

/**
 * Calls the canonical deliverable apply route via the typed wrapper. On success it invalidates the unified
 * inbox query so the applied deliverable leaves the client-facing list.
 */
export function useApplyDeliverable(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation<ApplyDeliverableResult, Error, ApplyDeliverableVars>({
    mutationFn: ({ deliverableId }) => publicDeliverables.applyApproval(workspaceId, deliverableId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.client.unifiedInbox(workspaceId) });
    },
  });
}
