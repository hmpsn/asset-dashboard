/**
 * internal_link deliverable adapter (PR-1b, DARK).
 *
 * Claims the legacy `client_actions` rows with sourceType `internal_link` (the Internal Links
 * "Send to client" flow — src/components/InternalLinks.tsx). The internal-link sub-items
 * (anchorText / targetUrl / sourcePageUrl / contextSnippet / …) ride in
 * `client_deliverable.payload` JSON, NOT the typed `_item` columns (design §4.1 scoping).
 * kind = 'batch' (a modal with N link suggestions).
 *
 * sourceRef = `internal_link:<siteId>` (the B17/M2 stable-key fix). The live producer keyed on
 * a timestamp (`internal-links:<analyzedAt>`), so two analyses of the same site created two
 * rows; the adapter keys on the stable per-site key so a re-send of the same site dedupes onto
 * one row. The siteId is resolved by the seam (workspace → webflowSiteId) and passed in.
 *
 * Apply stays DISABLED (D-apply) — and is a PERMANENT no-op for this family: internal-link
 * insertions land in a manual operator/agency queue, never auto-written to Webflow.
 */
import { registerAdapter, type DeliverableAdapter } from './types.js';
import {
  type ClientActionInput,
  applyDisabledStub,
  buildClientActionPayload,
  internalLinkItems,
  validateNonEmptyItems,
} from './client-action-shared.js';

export const internalLinkAdapter: DeliverableAdapter<ClientActionInput> = {
  type: 'internal_link',
  validateSendable: ({ action }) => validateNonEmptyItems(internalLinkItems(action), 'suggestion'),
  buildPayload: ({ action }) =>
    buildClientActionPayload('internal_link', action, internalLinkItems(action), 'suggestion'),
  // Stable per-site key (B17): internal_link:<siteId>. Null when the workspace has no site.
  sourceRef: ({ siteId }) => (siteId ? `internal_link:${siteId}` : null),
  // apply opt-out — D-apply (permanent for this family). Stub throws if ever reached.
  applyDeliverable: applyDisabledStub,
};

registerAdapter(internalLinkAdapter as DeliverableAdapter);
