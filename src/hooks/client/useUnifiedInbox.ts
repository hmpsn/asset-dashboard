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

/** Result shape of the apply mutation (mirrors the legacy /apply route response). */
export interface ApplyDeliverableResult {
  results: Array<{ itemId: string; pageId: string; success: boolean; error?: string }>;
  applied: number;
  failed: number;
}

export interface ApplyDeliverableVars {
  /** The legacy approval-batch id, read off the deliverable's `payload.legacyBatchId`. */
  legacyBatchId: string;
}

/**
 * useApplyDeliverable — R3b "Apply to Website" mutation (DARK; only reachable behind `unified-inbox`).
 *
 * Calls the SAME proven legacy apply route via the typed wrapper (no new apply logic). On success it
 * invalidates the unified inbox query — the applied deliverable flips to `applied`, which is filtered
 * OUT of the client-facing list, so the item leaves the inbox (intended post-apply UX). Sibling of
 * useRespondToDeliverable.
 */
export function useApplyDeliverable(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation<ApplyDeliverableResult, Error, ApplyDeliverableVars>({
    mutationFn: ({ legacyBatchId }) => publicDeliverables.applyApproval(workspaceId, legacyBatchId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.client.unifiedInbox(workspaceId) });
    },
  });
}
