import { useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { publicDeliverables } from '../../api/deliverables';
import type { DeliverableResponseDecision } from '../../api/deliverables';
import { queryKeys } from '../../lib/queryKeys';
import type {
  ClientDeliverable,
  ClientDeliverableItem,
} from '../../../shared/types/client-deliverable';
import type {
  BrandReviewClientDecisionRequest,
  ClientBrandReviewDecisionReceipt,
} from '../../../shared/types/brand-generation';

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

export type RespondToBrandReviewVars = BrandReviewClientDecisionRequest & {
  deliverableId: string;
};

interface BrandReviewErrorRefreshResult {
  deliverableId: string;
  itemId: string;
  reviewToken: string;
  refreshSucceeded: boolean;
  refreshedItem: ClientDeliverableItem | null;
}

type UnifiedInboxData = Awaited<ReturnType<typeof publicDeliverables.list>>;
const BRAND_REVIEW_DECISION_TIMEOUT_MS = 8_000;
const BRAND_REVIEW_CONFIRM_TIMEOUT_MS = 5_000;

async function withAbortTimeout<T>(
  timeoutMs: number,
  timeoutMessage: string,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error(timeoutMessage));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function readInboxForDecisionConfirmation(workspaceId: string): Promise<UnifiedInboxData> {
  return withAbortTimeout(
    BRAND_REVIEW_CONFIRM_TIMEOUT_MS,
    'Brand review confirmation timed out',
    signal => publicDeliverables.list(workspaceId, signal),
  );
}

function patchBrandReviewDecision(
  current: UnifiedInboxData | undefined,
  variables: RespondToBrandReviewVars,
  receipt: ClientBrandReviewDecisionReceipt,
): UnifiedInboxData | undefined {
  if (
    !current
    || receipt.reviewDeliverableId !== variables.deliverableId
    || receipt.deliverableItemId !== variables.deliverableItemId
  ) {
    return current;
  }

  let patched = false;
  const deliverables = current.deliverables.map(deliverable => {
    if (deliverable.id !== variables.deliverableId || !deliverable.items) return deliverable;
    const items = deliverable.items.map(item => {
      if (
        item.id !== variables.deliverableItemId
        || item.itemPayload?.reviewToken !== variables.reviewToken
      ) {
        return item;
      }
      patched = true;
      return {
        ...item,
        status: receipt.itemStatus,
        clientNote: variables.decision === 'changes_requested' ? variables.note : null,
      };
    });
    return patched
      ? { ...deliverable, status: receipt.bundleStatus, items }
      : deliverable;
  });

  return patched ? { ...current, deliverables } : current;
}

/**
 * Item-level brand review mutation. This is intentionally separate from
 * `useRespondToDeliverable`: callers must name one client-safe deliverable item, and the request
 * union cannot decline or decide an entire brand bundle.
 */
export function useRespondToBrandReview(workspaceId: string) {
  const queryClient = useQueryClient();
  const lastErrorRefresh = useRef<BrandReviewErrorRefreshResult | null>(null);
  const mutation = useMutation<ClientBrandReviewDecisionReceipt, Error, RespondToBrandReviewVars>({
    mutationFn: ({ deliverableId, ...decision }) => {
      lastErrorRefresh.current = null;
      return withAbortTimeout(
        BRAND_REVIEW_DECISION_TIMEOUT_MS,
        'Brand review decision timed out',
        signal => publicDeliverables.respondToBrandReview(
          workspaceId,
          deliverableId,
          decision,
          signal,
        ),
      );
    },
    onSuccess: (receipt, variables) => {
      queryClient.setQueryData<UnifiedInboxData>(
        queryKeys.client.unifiedInbox(workspaceId),
        current => patchBrandReviewDecision(current, variables, receipt),
      );
      // The token-guarded receipt patch is the completion barrier. Revalidation is advisory and
      // must not hold a committed decision UI hostage to a second network request.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.client.unifiedInbox(workspaceId),
      });
    },
    onError: async (_error, variables) => {
      lastErrorRefresh.current = {
        deliverableId: variables.deliverableId,
        itemId: variables.deliverableItemId,
        reviewToken: variables.reviewToken,
        refreshSucceeded: false,
        refreshedItem: null,
      };
      try {
        const refreshed = await readInboxForDecisionConfirmation(workspaceId);
        queryClient.setQueryData(queryKeys.client.unifiedInbox(workspaceId), refreshed);
        const refreshedItem = refreshed.deliverables
          .find(deliverable => deliverable.id === variables.deliverableId)
          ?.items?.find(item => item.id === variables.deliverableItemId) ?? null;
        lastErrorRefresh.current = {
          deliverableId: variables.deliverableId,
          itemId: variables.deliverableItemId,
          reviewToken: variables.reviewToken,
          refreshSucceeded: true,
          refreshedItem,
        };
      } catch {
        // Preserve the original mutation error. The caller keeps the item non-actionable when
        // this confirming read fails, because the decision outcome is genuinely unknown.
      }
    },
  });

  return {
    ...mutation,
    getLastErrorRefresh: (
      deliverableId: string,
      itemId: string,
      reviewToken: string,
    ): BrandReviewErrorRefreshResult | null => {
      const result = lastErrorRefresh.current;
      if (
        !result
        || result.deliverableId !== deliverableId
        || result.itemId !== itemId
        || result.reviewToken !== reviewToken
      ) {
        return null;
      }
      return result;
    },
  };
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
