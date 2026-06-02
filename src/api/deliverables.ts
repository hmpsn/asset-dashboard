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
    body: { decision: DeliverableResponseDecision; note?: string },
  ) =>
    patch<ClientDeliverable>(
      `/api/public/deliverables/${wsId}/${deliverableId}/respond`,
      body,
    ),
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
