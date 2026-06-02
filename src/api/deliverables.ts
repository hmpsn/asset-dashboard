import { get, patch } from './client';
import type { ClientDeliverable } from '../../shared/types/client-deliverable';

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
