import { get, patch, post } from './client';
import type { ClientDeliverable } from '../../shared/types/client-deliverable';
import type { AdminDeliverablesResponse } from '../../shared/types/admin-deliverable-view';
import type {
  BrandReviewClientDecisionRequest,
  ClientBrandReviewDecisionReceipt,
} from '../../shared/types/brand-generation';

/** The client response decision verbs (mirrors the /respond route's Zod enum). */
export type DeliverableResponseDecision = 'approved' | 'changes_requested' | 'declined';

interface UnifiedInboxResponse {
  deliverables: ClientDeliverable[];
}

/**
 * Typed client wrapper for the canonical send-to-client deliverable endpoints.
 *
 *   GET   /api/public/deliverables/:workspaceId            — the client-facing unified list
 *   PATCH /api/public/deliverables/:workspaceId/:id/respond — approve / request-changes / decline
 *   POST  /api/public/deliverables/:workspaceId/:id/apply   — apply approved SEO changes
 *
 * No raw fetch in components (CLAUDE.md).
 */
export const publicDeliverables = {
  list: (wsId: string, signal?: AbortSignal) =>
    get<UnifiedInboxResponse>(`/api/public/deliverables/${wsId}`, signal),

  respond: (
    wsId: string,
    deliverableId: string,
    body: {
      decision: DeliverableResponseDecision;
      note?: string;
      /**
       * R3 per-item subset (approval family only): the items the client flagged in the detail
       * modal — each carrying the `ClientDeliverableItem.id` plus the typed flag note. On
       * `approved`, the server approves the unflagged items and holds the flagged ones ("implement
       * N of M"), persisting the typed note onto each held item. Ignored on reject decisions /
       * client_action.
       */
      flaggedItems?: { itemId: string; note?: string }[];
      /**
       * Item 2 — EDIT-before-approve (approval family only): the per-item edited proposed values
       * (seoTitle/seoDescription) the client typed in the inline editor. The server persists each as
       * the legacy approval item's `clientValue` (the Webflow apply path prefers it). Orthogonal to
       * `flaggedItems`. Ignored on reject decisions / client_action.
       */
      editedItems?: { itemId: string; value: string }[];
    },
  ) =>
    patch<ClientDeliverable>(
      `/api/public/deliverables/${wsId}/${deliverableId}/respond`,
      body,
    ),

  /**
   * Brand-generation review is deliberately item-scoped. It shares the canonical deliverable
   * respond URL, but its discriminated request can never express a generic whole-bundle decision.
   * The server commits the frozen brand source, generation item, and mirror child atomically.
   */
  respondToBrandReview: (
    wsId: string,
    deliverableId: string,
    body: BrandReviewClientDecisionRequest,
    signal?: AbortSignal,
  ) =>
    patch<ClientBrandReviewDecisionReceipt>(
      `/api/public/deliverables/${wsId}/${deliverableId}/respond`,
      body,
      signal,
    ),

  /**
   * R3b — Apply to Website. Calls the canonical deliverable apply route; the server resolves the
   * legacy approval batch id and delegates to the proven apply service for Webflow writes,
   * markBatchApplied, activity, outcome tracking, broadcasts, and mirror flip.
   */
  applyApproval: (wsId: string, deliverableId: string) =>
    post<{
      results: Array<{ itemId: string; pageId: string; success: boolean; error?: string }>;
      applied: number;
      failed: number;
    }>(`/api/public/deliverables/${wsId}/${deliverableId}/apply`),
};

/**
 * Typed client wrapper for the admin send-to-client endpoints.
 *
 *   GET  /api/deliverables/:workspaceId            — the operator "Client Deliverables" pane list
 *                                                    (every status, annotated with the status axis
 *                                                    + stale flag)
 *   POST /api/deliverables/:workspaceId/:id/remind — re-nudge the client about an awaiting item
 *
 * No raw fetch in components (CLAUDE.md).
 */
export const adminDeliverables = {
  list: (wsId: string) => get<AdminDeliverablesResponse>(`/api/deliverables/${wsId}`),

  remind: (wsId: string, deliverableId: string) =>
    post<ClientDeliverable>(`/api/deliverables/${wsId}/${deliverableId}/remind`),
};
