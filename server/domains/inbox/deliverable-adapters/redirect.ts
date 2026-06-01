/**
 * redirect deliverable adapter (PR-1b, DARK).
 *
 * Claims the legacy `client_actions` rows with sourceType `redirect_proposal` (the Redirect
 * Manager "Send to client" flow — src/components/RedirectManager.tsx). The redirect sub-items
 * (source / target / rationale / type) ride in `client_deliverable.payload` JSON, NOT the
 * typed `_item` columns (design §4.1 scoping). kind = 'batch' (a modal with N redirects).
 *
 * sourceRef = `redirect:<siteId>` (the B17/M2 stable-key fix). The live producer keyed on a
 * timestamp (`redirects:<scannedAt>`), so two scans of the same site created two rows; the
 * adapter keys on the stable per-site key so a re-send of the same site dedupes onto one row.
 * The siteId is resolved by the seam (workspace → webflowSiteId) and passed in the input.
 *
 * Apply stays DISABLED (D-apply) — and is a PERMANENT no-op for this family: redirects land
 * in a manual operator/agency queue, never auto-written to Webflow.
 */
import { registerAdapter, type DeliverableAdapter } from './types.js';
import {
  type ClientActionInput,
  applyDisabledStub,
  buildClientActionPayload,
  redirectItems,
  validateNonEmptyItems,
} from './client-action-shared.js';

export const redirectAdapter: DeliverableAdapter<ClientActionInput> = {
  type: 'redirect',
  validateSendable: ({ action }) => validateNonEmptyItems(redirectItems(action), 'redirect'),
  buildPayload: ({ action }) =>
    buildClientActionPayload('redirect', action, redirectItems(action), 'redirect'),
  // Stable per-site key (B17): redirect:<siteId>. Null when the workspace has no site.
  sourceRef: ({ siteId }) => (siteId ? `redirect:${siteId}` : null),
  // apply opt-out — D-apply (permanent for this family). Stub throws if ever reached.
  applyDeliverable: applyDisabledStub,
};

registerAdapter(redirectAdapter as DeliverableAdapter);
