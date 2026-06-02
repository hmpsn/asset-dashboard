/**
 * content_decay deliverable adapter (PR-1b, DARK).
 *
 * Claims the legacy `client_actions` rows with sourceType `content_decay` (the Content Decay
 * "Send to client" flow — src/components/ContentDecay.tsx). UNLIKE the other three family
 * types, content_decay is a SINGLE inline refresh recommendation per page (one decaying page),
 * so kind = 'decision' (rendered inline in Decisions, not a batch modal). The page metrics +
 * refresh recommendation ride in `client_deliverable.payload` JSON (design §4.1 scoping).
 *
 * sourceRef = `content_decay:<pagePath>` (already a stable per-page key in the live producer —
 * the live sourceId is `content-decay:<page.page>`, so this family was NOT timestamp-keyed).
 * The adapter reads the page path from `payload.metadata.origin.pageUrl` (the canonical origin),
 * falling back to `payload.page.page` then the legacy sourceId so legacy + fresh dedupe as one.
 *
 * validateSendable (B13): a content_decay action MUST carry a non-empty `targetKeyword` — a
 * refresh recommendation with no keyword to target is not a sendable decision. The keyword is
 * read from `payload.metadata.origin.targetKeyword`.
 *
 * Apply stays DISABLED (D-apply) — and is a PERMANENT no-op for this family: a content refresh
 * is a manual operator/agency action, never auto-applied.
 */
import { registerAdapter, type DeliverableAdapter } from './types.js';
import {
  type ClientActionInput,
  applyDisabledStub,
  buildClientActionPayload,
  originPageUrl,
  originTargetKeyword,
  respondToClientActionSource,
} from './client-action-shared.js';

/** Resolve the decaying page path for the sourceRef: origin → payload.page.page → null. */
function decayPagePath(input: ClientActionInput): string | null {
  const fromOrigin = originPageUrl(input.action);
  if (fromOrigin) return fromOrigin;
  const page = (input.action.payload as { page?: { page?: unknown } }).page;
  if (page && typeof page.page === 'string' && page.page.trim()) return page.page.trim();
  return null;
}

export const contentDecayAdapter: DeliverableAdapter<ClientActionInput> = {
  type: 'content_decay',
  // B13: a decay action with no targetKeyword is NOT sendable.
  validateSendable: ({ action }) => {
    const keyword = originTargetKeyword(action);
    if (!keyword) {
      return { ok: false, reason: 'content decay action has no targetKeyword (B13)' };
    }
    return { ok: true };
  },
  // Single inline decision (one decaying page) — the page object is the sole "item".
  buildPayload: ({ action }) => {
    const page = (action.payload as { page?: unknown }).page;
    const items = page != null ? [page] : [];
    return buildClientActionPayload('content_decay', action, items, 'page');
  },
  // Stable per-page key: content_decay:<pagePath>, derived from origin.pageUrl / payload.page.page
  // (the producer always sets these, so this is the path real rows take — and the backfill
  // derives the SAME key, so dual-write + backfill dedupe as one). The raw-sourceId fallback is a
  // last resort for a malformed row missing both; note it is NOT dedup-preserving (the legacy
  // sourceId uses a HYPHEN prefix `content-decay:` vs this underscore key) — but such a row also
  // lacks targetKeyword and is B13-skipped before insert, so it can never produce a duplicate.
  sourceRef: (input) => {
    const pagePath = decayPagePath(input);
    if (pagePath) return `content_decay:${pagePath}`;
    return input.action.sourceId ?? null;
  },
  // R2: propagate the client decision to the legacy client_action. Source path owns the email.
  respondToSource: respondToClientActionSource,
  // apply opt-out — D-apply (permanent for this family). Stub throws if ever reached.
  applyDeliverable: applyDisabledStub,
};

registerAdapter(contentDecayAdapter as DeliverableAdapter);
