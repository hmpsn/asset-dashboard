/**
 * Shared machinery for the client_action deliverable family (PR-1b, DARK).
 *
 * The legacy `client_actions` table physically stores FOUR deliverable types in one table
 * (audit §A): `redirect` (legacy sourceType `redirect_proposal`), `internal_link`,
 * `aeo_change`, `content_decay`. These are the manual operator-queue work types — there is
 * no automated apply path (a human/agency executes them), so apply stays a permanent no-op
 * for this family (D-apply), not just "disabled until cutover".
 *
 * UNLIKE the approval_batch family (whose per-item rows live in the typed `_item` columns),
 * the client_action sub-items — the multi-field internal-link / AEO / redirect arrays — live
 * in `client_deliverable.payload` JSON, NOT the typed `_item` columns (design §4.1 scoping;
 * the `_item` columns are reserved for the approval/SEO family's per-page field writes).
 * So `buildPayload` maps the source `ClientActionPayload` faithfully into `payload` and emits
 * NO child items.
 *
 * kind mapping (design §4.1):
 *   - content_decay → 'decision' (a single inline refresh recommendation per page)
 *   - redirect / internal_link / aeo_change → 'batch' (a modal with N sub-items)
 *
 * sourceRef (the B17/M2 stable-key fix — computed from the adapter INPUT, self-contained,
 * does NOT depend on the legacy timestamp-keyed client_action sourceId):
 *   - redirect       → `redirect:<siteId>`
 *   - internal_link  → `internal_link:<siteId>`
 *   - aeo_change     → `aeo:<pageUrl>`
 *   - content_decay  → `content_decay:<pagePath>`
 * AEO/decay already key stably on the page path; redirect/internal_link were timestamp-keyed
 * in the live producer, so the adapter keys on the stable per-site key instead. The live
 * producer sourceId is NOT touched this PR (that is a cutover concern) — the adapter's own
 * sourceRef is fully self-contained and correct.
 *
 * Leaf rule: this module imports only shared types + the store input shape; it is NOT
 * imported back by the store/service (no circular value-import). The `siteId` and `pageUrl`
 * the sourceRefs need are resolved by the NON-leaf seams (the dual-write resolves siteId from
 * the workspace; the backfill resolves it from the workspace too) and passed into the input.
 */
import type {
  AeoChangeDiff,
  AeoChangePayload,
  ClientAction,
  ClientActionPayload,
  InternalLinkItem,
  InternalLinkPayload,
  RedirectItem,
  RedirectProposalPayload,
} from '../../../../shared/types/client-actions.js';
import type { ClientDeliverable } from '../../../../shared/types/client-deliverable.js';
import type {
  BuiltDeliverablePayload,
  DeliverableSourceDecision,
  RespondToSourceOptions,
  RespondToSourceResult,
  SendableResult,
} from './types.js';
import { createLogger } from '../../../logger.js';

const clientActionRespondLog = createLogger('client-action-shared');

/**
 * The adapter input for every client_action-family type: the persisted `ClientAction` (as
 * built by `server/client-actions.ts:createClientAction`) plus the resolved Webflow `siteId`
 * for the workspace (a workspace maps to exactly one site). The dual-write seam passes the
 * freshly-created action + the workspace's siteId straight through; the backfill passes a row
 * read from `client_actions` + the same resolved siteId. `siteId` is needed for the
 * redirect/internal_link stable sourceRef (those payloads do not carry the page path).
 */
export interface ClientActionInput {
  action: ClientAction;
  /** Resolved by the seam (workspace → webflowSiteId). May be null if the workspace has none. */
  siteId: string | null;
}

/** The four client_action-family deliverable types this PR owns. */
export const CLIENT_ACTION_FAMILY_TYPES = [
  'redirect',
  'internal_link',
  'aeo_change',
  'content_decay',
] as const;

export type ClientActionFamilyType = (typeof CLIENT_ACTION_FAMILY_TYPES)[number];

/**
 * Map a legacy `client_actions.source_type` onto the unified deliverable type. The only
 * non-identity mapping is `redirect_proposal` → `redirect` (the legacy source type carries
 * the `_proposal` suffix the unified model drops). Used by the dual-write + backfill.
 */
export function clientActionDeliverableType(
  sourceType: ClientAction['sourceType'],
): ClientActionFamilyType {
  switch (sourceType) {
    case 'redirect_proposal':
      return 'redirect';
    case 'internal_link':
      return 'internal_link';
    case 'aeo_change':
      return 'aeo_change';
    case 'content_decay':
      return 'content_decay';
  }
}

// ── Payload extractors (read the heterogeneous union faithfully) ────────────────

/** The origin page path/url an action carries in `payload.metadata.origin.pageUrl`. */
export function originPageUrl(action: ClientAction): string | null {
  const origin = action.payload?.metadata?.origin;
  const url = origin?.pageUrl;
  return typeof url === 'string' && url.trim() ? url.trim() : null;
}

/** The origin target keyword an action carries in `payload.metadata.origin.targetKeyword`. */
export function originTargetKeyword(action: ClientAction): string | null {
  const origin = action.payload?.metadata?.origin;
  const kw = origin?.targetKeyword;
  return typeof kw === 'string' && kw.trim() ? kw.trim() : null;
}

/** Extract the redirect sub-items from a redirect_proposal action payload. */
export function redirectItems(action: ClientAction): RedirectItem[] {
  const payload = action.payload as Partial<RedirectProposalPayload>;
  return Array.isArray(payload.redirects) ? payload.redirects : [];
}

/** Extract the internal-link sub-items from an internal_link action payload. */
export function internalLinkItems(action: ClientAction): InternalLinkItem[] {
  const payload = action.payload as Partial<InternalLinkPayload>;
  return Array.isArray(payload.suggestions) ? payload.suggestions : [];
}

/** Extract the AEO diff sub-items from an aeo_change action payload. */
export function aeoDiffs(action: ClientAction): AeoChangeDiff[] {
  const payload = action.payload as Partial<AeoChangePayload>;
  return Array.isArray(payload.diffs) ? payload.diffs : [];
}

// ── Shared buildPayload body ────────────────────────────────────────────────────

/**
 * Build the typed payload for a client_action-family deliverable. The sub-items ride in the
 * `payload` JSON (NOT the typed `_item` columns — design §4.1 scoping), so this emits NO
 * child items. `payload` keeps the legacy discriminators (family, sub-type, the legacy
 * action id) for traceability plus the faithfully-mapped sub-item array under `items`.
 */
export function buildClientActionPayload(
  type: ClientActionFamilyType,
  action: ClientAction,
  items: unknown[],
  itemNoun: string,
): BuiltDeliverablePayload {
  const count = items.length;
  const kind = type === 'content_decay' ? 'decision' : 'batch';
  return {
    title: action.title,
    summary:
      kind === 'decision'
        ? action.summary
        : `${count} ${itemNoun}${count !== 1 ? 's' : ''} for review`,
    kind,
    payload: {
      family: 'client_action',
      subType: type,
      legacyActionId: action.id,
      legacySourceId: action.sourceId ?? null,
      // The sub-items live in payload JSON (design §4.1), keyed by their source array name so
      // the round-trip is lossless and a reader can reconstruct the modal without the _item table.
      items,
      // Preserve the origin metadata block so the apply/queue path can reconstruct linkage.
      origin: action.payload?.metadata?.origin ?? null,
    },
    // No typed child items for the client_action family (sub-items ride in payload JSON).
  };
}

/**
 * Shared `validateSendable` for the array-backed client_action types (redirect /
 * internal_link / aeo_change): reject an empty sub-item array — an action with nothing to
 * review is a not-ready operator action.
 */
export function validateNonEmptyItems(items: unknown[], noun: string): SendableResult {
  if (!items || items.length === 0) {
    return { ok: false, reason: `client action has no ${noun}` };
  }
  return { ok: true };
}

/**
 * The disabled-apply stub for the client_action family. The client_action types land in a
 * MANUAL operator queue — there is no automated apply (a human/agency executes the redirect /
 * internal link / AEO change / content refresh). Apply is therefore a permanent no-op for this
 * family: adapters opt OUT of `appliesOnApprove`, so `respondToDeliverable` never calls this.
 * It throws to make the contract explicit if any future caller wires it on prematurely.
 */
export async function applyDisabledStub(_deliverable: ClientDeliverable): Promise<{ applied: number }> {
  throw new Error(
    'client_action apply is a permanent no-op (D-apply): the redirect / internal_link / aeo_change / content_decay types land in a manual operator queue with no automated apply path',
  );
}

// ── R2: respond propagation ──────────────────────────────────────────────────────

/**
 * Read the legacy client_action id off a mirrored deliverable's payload. Every
 * client_action-family adapter stashes it as `payload.legacyActionId`
 * (`buildClientActionPayload`), so this is the deliverable → source mapping for the family.
 */
function legacyActionId(deliverable: ClientDeliverable): string | null {
  const id = (deliverable.payload as { legacyActionId?: unknown })?.legacyActionId;
  return typeof id === 'string' && id.trim() ? id : null;
}

/**
 * R2 source propagation for the whole client_action family. Maps the deliverable back to its
 * legacy `client_action` (via `payload.legacyActionId`) and drives the SHARED
 * `respondToPublicClientAction` mutation (the existing public respond logic — reused, not
 * reimplemented):
 *   - approved                       → client_action status `approved`
 *     (fires the team-approved email + feedback loop + playbook enqueue, exactly as the
 *      legacy public respond route does — this is the family's single team-notify owner).
 *   - changes_requested / declined   → client_action status `changes_requested`
 *     (the legacy respond mutation does NOT email the team on changes_requested — the known
 *      B4 gap, explicitly OUT OF SCOPE here; we do NOT add a new email, matching the route).
 *
 * Returns `{ handled: true }` so respondToDeliverable suppresses its own deliverable-level
 * team email for this family — the source path is the single owner of the team-facing
 * notification (whatever form it takes per decision), so the team is never double-notified.
 *
 * A missing payload id or absent/non-pending action is a swallowed best-effort miss (the
 * deliverable mirror has already moved); we still report `handled: true` so the unified path
 * does not ALSO email for a family whose canonical surface is the source action.
 */
export async function respondToClientActionSource(
  workspaceId: string,
  deliverable: ClientDeliverable,
  decision: DeliverableSourceDecision,
  opts: RespondToSourceOptions = {},
): Promise<RespondToSourceResult> {
  const actionId = legacyActionId(deliverable);
  if (!actionId) {
    clientActionRespondLog.warn(
      { workspaceId, deliverableId: deliverable.id, type: deliverable.type },
      'client_action respondToSource: no legacyActionId in payload — source not updated',
    );
    return { handled: true };
  }
  // approve → approved; changes_requested / declined → changes_requested (client_action has no
  // `declined` status — the family's changes path is its reject path, per the R2 spec).
  const status = decision === 'approved' ? 'approved' : 'changes_requested';
  try {
    // Lazy import to break the module cycle: client-actions-mutations.ts (the reuse target)
    // imports the dual-write barrel, which imports every adapter (including this leaf). A
    // static import here would close that loop; the runtime-only dynamic import does not.
    const { respondToPublicClientAction } = await import('../client-actions-mutations.js'); // dynamic-import-ok: breaks adapter↔mutations cycle (R2)
    respondToPublicClientAction(
      workspaceId,
      actionId,
      { status, clientNote: opts.note ?? undefined },
      opts.actor,
    );
  } catch (err) {
    // The legacy mutation throws (404 / 409) when the action is missing or already decided.
    // The deliverable mirror has already moved; a source miss is best-effort and must not
    // surface to the unified respond caller (the team-notify ownership is unchanged).
    clientActionRespondLog.warn(
      { err, workspaceId, actionId, deliverableId: deliverable.id },
      'client_action respondToSource: legacy respond mutation failed (swallowed best-effort)',
    );
  }
  return { handled: true };
}

/** Re-export for the payload union narrowing the adapters need. */
export type {
  AeoChangeDiff,
  ClientActionPayload,
  InternalLinkItem,
  RedirectItem,
};
