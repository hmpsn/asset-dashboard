/**
 * schema_plan dual-write mirror.
 *
 * At the schema_plan SEND seam (`POST /api/webflow/schema-plan/:siteId/send-to-client` in
 * `server/routes/webflow-schema.ts`, where the plan status flips to `sent_to_client`), mirror the
 * freshly-sent `SchemaSitePlan` into the unified `client_deliverable` model via the registered
 * `schema_plan` adapter + `upsertDeliverable`.
 *
 * Scope (kept tight per the plan): this is the SEND-TIME mirror only. We do NOT mirror on the
 * public feedback path (`:874`), and we do NOT change any reads. Apply stays disabled (D-apply):
 * the mirrored row is born `awaiting_client` (matching the legacy `sent_to_client` state) and a
 * client approve does NOT auto-publish — operator publish is a separate transition.
 *
 * The mirror is best-effort and MUST NEVER break the live legacy send: any failure is logged and
 * swallowed (the plan status is already persisted + the client already notified by the route).
 *
 * siteId → workspaceId resolution: the deliverable's workspace_id must be the OWNING workspace.
 * The `SchemaSitePlan` already carries `workspaceId` (the owning workspace — `schema_site_plans`
 * stores `workspace_id` per row), so the seam reads it straight off the plan; no guess, no
 * separate site→workspace lookup. (The route also has the workspace in hand —
 * `getWorkspace(plan.workspaceId)` — and passes that same id here.)
 *
 * Leaf rule: imports the registry + the store + the flag reader; not imported back by them.
 */
import type { SchemaSitePlan } from '../../../shared/types/schema-plan.js';
import type { ClientDeliverable } from '../../../shared/types/client-deliverable.js';
import { findBySourceRef, upsertDeliverable } from '../../client-deliverables.js';
import { getAdapter } from './deliverable-adapters/index.js';
import type { SchemaPlanInput } from './deliverable-adapters/schema-plan.js';
import { createLogger } from '../../logger.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { WS_EVENTS } from '../../ws-events.js';

const log = createLogger('schema-plan-dual-write');

function schemaPlanDeliverableStatus(
  status: SchemaSitePlan['status'],
): ClientDeliverable['status'] | null {
  switch (status) {
    case 'sent_to_client':
      return 'awaiting_client';
    case 'client_approved':
      return 'approved';
    case 'client_changes_requested':
      return 'changes_requested';
    case 'active':
      return 'applied';
    default:
      return null;
  }
}

function safeBroadcastDeliverable(
  workspaceId: string,
  event: typeof WS_EVENTS.DELIVERABLE_UPDATED,
  deliverable: ClientDeliverable,
): void {
  try {
    broadcastToWorkspace(workspaceId, event, {
      deliverableId: deliverable.id,
      type: deliverable.type,
      status: deliverable.status,
    });
  } catch (err) {
    log.warn({ err, workspaceId, deliverableId: deliverable.id, event }, 'schema-plan deliverable broadcast failed (swallowed)');
  }
}

/**
 * Mirror a freshly-sent schema plan into `client_deliverable`. Returns the mirrored deliverable, or
 * null when the mirror was skipped/failed. Never throws — the live legacy send must not be affected.
 *
 * @param workspaceId the OWNING workspace (the route resolves it from `plan.workspaceId`).
 * @param plan the SchemaSitePlan as read back at the send seam (status already `sent_to_client`).
 */
export function mirrorSchemaPlanToDeliverable(
  workspaceId: string,
  plan: SchemaSitePlan,
): ClientDeliverable | null {
  try {
    const adapter = getAdapter('schema_plan');
    const input: SchemaPlanInput = { plan };

    // Guarantee 0: the adapter rejects a not-ready (empty) plan.
    const sendable = adapter.validateSendable(input);
    if (!sendable.ok) {
      log.warn(
        { workspaceId, siteId: plan.siteId, planId: plan.id, reason: sendable.reason },
        'schema-plan mirror skipped: adapter rejected the plan',
      );
      return null;
    }

    const built = adapter.buildPayload(input);
    const sourceRef = adapter.sourceRef(input);
    if (!sourceRef) {
      log.warn({ workspaceId, siteId: plan.siteId, planId: plan.id }, 'schema-plan mirror skipped: adapter returned no sourceRef');
      return null;
    }
    const nowIso = new Date().toISOString();

    const deliverable = upsertDeliverable({
      // OWNING workspace — read off the plan, not guessed (schema_site_plans stores workspace_id).
      workspaceId,
      type: 'schema_plan',
      kind: built.kind, // 'review'
      // Send-time mirror: born awaiting_client, matching the legacy `sent_to_client` state.
      status: 'awaiting_client',
      title: built.title,
      summary: built.summary ?? null,
      payload: built.payload,
      // externalRef = siteId; parentDeliverableId best-effort (null while schema_item is dark).
      externalRef: built.externalRef ?? null,
      parentDeliverableId: built.parentDeliverableId ?? null,
      sentAt: nowIso,
      // Carry the plan's own generation timestamp (not "now").
      generatedAt: plan.generatedAt,
      source: 'schema-plan-mirror',
      sourceRef,
    });

    log.debug(
      { workspaceId, siteId: plan.siteId, planId: plan.id, deliverableId: deliverable.id },
      'schema plan mirrored into client_deliverable (dual-write)',
    );
    return deliverable;
  } catch (err) {
    // Best-effort: the plan status is already persisted + the client notified. A mirror failure
    // must not surface to the operator or roll back the live send.
    log.error({ err, workspaceId, siteId: plan.siteId }, 'schema-plan mirror failed (swallowed)');
    return null;
  }
}

export function syncSchemaPlanDeliverable(plan: SchemaSitePlan): ClientDeliverable | null {
  const adapter = getAdapter('schema_plan');
  const input: SchemaPlanInput = { plan };
  const sourceRef = adapter.sourceRef(input);
  const deliverableStatus = schemaPlanDeliverableStatus(plan.status);
  if (!sourceRef || !deliverableStatus) return null;

  try {
    const built = adapter.buildPayload(input);
    const existing = findBySourceRef(plan.workspaceId, 'schema_plan', sourceRef);
    const nowIso = new Date().toISOString();
    const deliverable = upsertDeliverable({
      id: existing?.id,
      workspaceId: plan.workspaceId,
      type: 'schema_plan',
      kind: built.kind,
      status: deliverableStatus,
      title: built.title,
      summary: built.summary ?? null,
      payload: built.payload,
      note: existing?.note ?? null,
      clientResponseNote: existing?.clientResponseNote ?? null,
      externalRef: built.externalRef ?? null,
      parentDeliverableId: built.parentDeliverableId ?? null,
      sentAt: existing?.sentAt ?? nowIso,
      decidedAt: deliverableStatus === 'approved' || deliverableStatus === 'changes_requested'
        ? (existing?.decidedAt ?? nowIso)
        : existing?.decidedAt ?? null,
      appliedAt: deliverableStatus === 'applied'
        ? (existing?.appliedAt ?? nowIso)
        : existing?.appliedAt ?? null,
      generatedAt: plan.generatedAt,
      source: existing?.source ?? 'schema-plan-sync',
      sourceRef,
    });
    safeBroadcastDeliverable(plan.workspaceId, WS_EVENTS.DELIVERABLE_UPDATED, deliverable);
    return deliverable;
  } catch (err) {
    log.error({ err, workspaceId: plan.workspaceId, siteId: plan.siteId }, 'schema-plan deliverable sync failed');
    return null;
  }
}

export function cancelSchemaPlanDeliverable(workspaceId: string, siteId: string): ClientDeliverable | null {
  const sourceRef = `schema_plan:${siteId}`;
  const existing = findBySourceRef(workspaceId, 'schema_plan', sourceRef);
  if (!existing) return null;

  try {
    const deliverable = upsertDeliverable({
      id: existing.id,
      workspaceId: existing.workspaceId,
      type: existing.type,
      kind: existing.kind,
      status: 'cancelled',
      title: existing.title,
      summary: existing.summary,
      payload: existing.payload,
      note: existing.note,
      clientResponseNote: existing.clientResponseNote,
      externalRef: existing.externalRef,
      parentDeliverableId: existing.parentDeliverableId,
      sentAt: existing.sentAt,
      decidedAt: existing.decidedAt,
      dueAt: existing.dueAt,
      appliedAt: existing.appliedAt,
      generatedAt: existing.generatedAt,
      source: existing.source,
      sourceRef: existing.sourceRef,
    });
    safeBroadcastDeliverable(workspaceId, WS_EVENTS.DELIVERABLE_UPDATED, deliverable);
    return deliverable;
  } catch (err) {
    log.error({ err, workspaceId, siteId }, 'schema-plan deliverable cancel sync failed');
    return null;
  }
}
