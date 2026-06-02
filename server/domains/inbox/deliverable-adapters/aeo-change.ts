/**
 * aeo_change deliverable adapter (PR-1b, DARK).
 *
 * Claims the legacy `client_actions` rows with sourceType `aeo_change` (the AEO Review
 * "Send to client" flow — src/components/AeoReview.tsx). The AEO diff sub-items
 * (page / section / current / proposed / rationale / effort / priority) ride in
 * `client_deliverable.payload` JSON, NOT the typed `_item` columns (design §4.1 scoping).
 * kind = 'batch' (a modal with N proposed changes).
 *
 * sourceRef = `aeo:<pageUrl>` (already a stable per-page key in the live producer — the live
 * sourceId is `aeo:<pageUrl>` too, so this family was NOT timestamp-keyed). The adapter reads
 * the pageUrl from `payload.metadata.origin.pageUrl`. When that origin is missing we fall back
 * to the legacy sourceId verbatim (which the live producer already set to `aeo:<pageUrl>`), so
 * legacy + fresh still dedupe onto one row.
 *
 * Apply stays DISABLED (D-apply) — and is a PERMANENT no-op for this family: AEO changes land
 * in a manual operator/agency queue, never auto-written to Webflow.
 */
import { registerAdapter, type DeliverableAdapter } from './types.js';
import {
  type ClientActionInput,
  aeoDiffs,
  applyDisabledStub,
  buildClientActionPayload,
  originPageUrl,
  respondToClientActionSource,
  validateNonEmptyItems,
} from './client-action-shared.js';

export const aeoChangeAdapter: DeliverableAdapter<ClientActionInput> = {
  type: 'aeo_change',
  validateSendable: ({ action }) => validateNonEmptyItems(aeoDiffs(action), 'change'),
  buildPayload: ({ action }) =>
    buildClientActionPayload('aeo_change', action, aeoDiffs(action), 'change'),
  // Stable per-page key: aeo:<pageUrl>. The origin block is authoritative; fall back to the
  // legacy sourceId (the live producer already set it to `aeo:<pageUrl>`) so legacy + fresh
  // dedupe as one. Null only if neither is available.
  sourceRef: ({ action }) => {
    const pageUrl = originPageUrl(action);
    if (pageUrl) return `aeo:${pageUrl}`;
    return action.sourceId ?? null;
  },
  // R2: propagate the client decision to the legacy client_action. Source path owns the email.
  respondToSource: respondToClientActionSource,
  // apply opt-out — D-apply (permanent for this family). Stub throws if ever reached.
  applyDeliverable: applyDisabledStub,
};

registerAdapter(aeoChangeAdapter as DeliverableAdapter);
