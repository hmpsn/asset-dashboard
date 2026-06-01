/**
 * client_action dual-write mirror (PR-1b, DARK behind the flag).
 *
 * At the client_action SEND seam (`createAdminClientAction` in client-actions-mutations.ts —
 * the single place all four producer routes funnel through: RedirectManager, InternalLinks,
 * AeoReview, ContentDecay), when the `unified-deliverables-broken-family` flag is ON we ALSO
 * mirror the freshly-created legacy `client_action` into the unified `client_deliverable`
 * model via the registered adapter + `upsertDeliverable`. Default off → this is a no-op (NO
 * production behavior change).
 *
 * Hooking ONE place (after the create) covers all four producer routes with one mirror call,
 * mirroring how PR-1a hooks the single `createBatch` seam.
 *
 * Scope (kept tight per the plan): this is the SEND-TIME mirror only. We do NOT mirror on the
 * public respond path, and we do NOT change any reads. Apply stays a permanent no-op for this
 * family (D-apply — manual operator queue): the mirrored row is born `awaiting_client`.
 *
 * The mirror is best-effort and MUST NOT break the live legacy create: any failure is logged
 * and swallowed (the legacy action is already persisted + the client already notified by the
 * mutation helper). The flag being off makes this unreachable, so a dark bug can never reach
 * prod.
 *
 * sourceRef resolution: the redirect / internal_link sourceRefs key on the workspace's Webflow
 * siteId (a workspace maps to exactly one site), which the producers do NOT carry in the action
 * payload — so this seam resolves it from the workspace and passes it into the adapter input.
 * The adapter itself stays a leaf (types + store only); this non-leaf seam does the lookup.
 *
 * Leaf rule: imports the registry + the store + the flag reader + the workspace getter; not
 * imported back by them.
 */
import type { ClientAction } from '../../../shared/types/client-actions.js';
import type { ClientDeliverable } from '../../../shared/types/client-deliverable.js';
import { isFeatureEnabled } from '../../feature-flags.js';
import { upsertDeliverable } from '../../client-deliverables.js';
import { getWorkspace } from '../../workspaces.js';
import { getAdapter } from './deliverable-adapters/index.js';
import {
  type ClientActionInput,
  clientActionDeliverableType,
} from './deliverable-adapters/client-action-shared.js';
import { createLogger } from '../../logger.js';

const log = createLogger('client-action-dual-write');

/** The flag that gates the entire client_action dual-write. Default false (dark). */
export const CLIENT_ACTION_FAMILY_FLAG = 'unified-deliverables-broken-family' as const;

/**
 * Mirror a freshly-created client_action into `client_deliverable` IFF the flag is on.
 * Returns the mirrored deliverable, or null when the flag is off (no-op) or the mirror was
 * skipped/failed. Never throws — the live legacy create must not be affected.
 */
export function mirrorClientActionToDeliverable(
  workspaceId: string,
  action: ClientAction,
): ClientDeliverable | null {
  // Flag default false → dark no-op. The single gate for the whole machinery.
  if (!isFeatureEnabled(CLIENT_ACTION_FAMILY_FLAG)) return null;

  try {
    const type = clientActionDeliverableType(action.sourceType);
    const adapter = getAdapter(type);

    // Resolve the workspace's Webflow siteId for the redirect/internal_link stable sourceRef.
    const siteId = getWorkspace(workspaceId)?.webflowSiteId ?? null;
    const input: ClientActionInput = { action, siteId };

    // Guarantee 0 (the adapter rejects not-ready inputs — empty item arrays, or a
    // content_decay action with no targetKeyword per B13).
    const sendable = adapter.validateSendable(input);
    if (!sendable.ok) {
      log.warn(
        { workspaceId, actionId: action.id, type, reason: sendable.reason },
        'client-action mirror skipped: adapter rejected the action',
      );
      return null;
    }

    const built = adapter.buildPayload(input);
    const sourceRef = adapter.sourceRef(input);
    const nowIso = new Date().toISOString();

    const deliverable = upsertDeliverable({
      workspaceId,
      type,
      kind: built.kind,
      // Send-time mirror: the row is born awaiting_client, matching the legacy "sent to client
      // for review" state (the legacy action is born `pending`).
      status: 'awaiting_client',
      title: built.title,
      summary: built.summary ?? null,
      payload: built.payload,
      note: action.clientNote ?? null,
      externalRef: built.externalRef ?? null,
      parentDeliverableId: built.parentDeliverableId ?? null,
      sentAt: nowIso,
      generatedAt: nowIso,
      source: 'client-action-mirror',
      sourceRef,
      items: built.items,
    });

    log.debug(
      { workspaceId, actionId: action.id, type, deliverableId: deliverable.id },
      'client action mirrored into client_deliverable (dual-write)',
    );
    return deliverable;
  } catch (err) {
    // Best-effort: the legacy action is already persisted + the client notified. A mirror
    // failure must not surface to the operator or roll back the live create.
    log.error({ err, workspaceId, actionId: action.id }, 'client-action mirror failed (swallowed)');
    return null;
  }
}
