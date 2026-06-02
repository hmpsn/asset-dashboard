import { get, patch, post } from './client';
import type { ClientDeliverable } from '../../shared/types/client-deliverable';
import type { AdminDeliverablesResponse } from '../../shared/types/admin-deliverable-view';

/** The client response decision verbs (mirrors the /respond route's Zod enum). */
export type DeliverableResponseDecision = 'approved' | 'changes_requested' | 'declined';

interface UnifiedInboxResponse {
  deliverables: ClientDeliverable[];
}

/**
 * Typed client wrapper for the unified send-to-client deliverable endpoints (PR-2a, DARK).
 *
 *   GET   /api/public/deliverables/:workspaceId            — the client-facing unified list
 *   PATCH /api/public/deliverables/:workspaceId/:id/respond — approve / request-changes / decline
 *
 * No raw fetch in components (CLAUDE.md). Consumed only behind the `unified-inbox` flag.
 */
export const publicDeliverables = {
  list: (wsId: string) =>
    get<UnifiedInboxResponse>(`/api/public/deliverables/${wsId}`),

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
   * R3b — Apply to Website (DARK). Calls the SAME proven legacy apply route the legacy
   * ApprovalBatchCard uses (no new apply logic): it does the Webflow writes + server-side
   * applyability gate + markBatchApplied + activity + outcome tracking + broadcasts, and (behind
   * APPROVAL_FAMILY_FLAG) flips the unified mirror to `applied`. `legacyBatchId` is read off the
   * deliverable's `payload.legacyBatchId`. Return shape matches the route at approvals.ts.
   */
  applyApproval: (wsId: string, legacyBatchId: string) =>
    post<{
      results: Array<{ itemId: string; pageId: string; success: boolean; error?: string }>;
      applied: number;
      failed: number;
    }>(`/api/public/approvals/${wsId}/${legacyBatchId}/apply`),
};

/**
 * Typed client wrapper for the ADMIN unified send-to-client endpoints (PR-2b, DARK).
 *
 *   GET  /api/deliverables/:workspaceId            — the operator "Client Deliverables" pane list
 *                                                    (every status, annotated with the status axis
 *                                                    + stale flag)
 *   POST /api/deliverables/:workspaceId/:id/remind — re-nudge the client about an awaiting item
 *
 * No raw fetch in components (CLAUDE.md). Consumed only behind the `unified-inbox` flag.
 */
export const adminDeliverables = {
  list: (wsId: string) => get<AdminDeliverablesResponse>(`/api/deliverables/${wsId}`),

  remind: (wsId: string, deliverableId: string) =>
    post<ClientDeliverable>(`/api/deliverables/${wsId}/${deliverableId}/remind`),
};
