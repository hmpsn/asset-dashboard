/**
 * Approval-batch dual-write mirror.
 *
 * At each approval-batch SEND seam (the `createBatch` callers — the admin approvals send
 * path and the content-plan send-samples / send-template-review routes), mirror the freshly-created
 * legacy batch into the unified `client_deliverable` model via the registered adapter +
 * `upsertDeliverable`.
 *
 * Scope (kept tight per the plan): this is the SEND-TIME mirror only. We do NOT mirror on
 * the public approve / apply / per-item paths in this PR — the response-side dual-write is
 * a follow-up. We do NOT change any reads. Apply stays disabled (D-apply): the mirrored
 * row is born `awaiting_client` and its items are `applyable=false`.
 *
 * The mirror is best-effort and MUST NOT break the live legacy send: any failure is logged
 * and swallowed (the legacy batch is already persisted + the client already notified by the
 * route).
 *
 * Leaf rule: imports the registry + the store + the flag reader; not imported back by them.
 */
import type { ApprovalBatch } from '../../../shared/types/approvals.js';
import type { ClientDeliverable, DeliverableStatus, DeliverableType } from '../../../shared/types/client-deliverable.js';
import { findBySourceRef, upsertDeliverable } from '../../client-deliverables.js';
import { getAdapter } from './deliverable-adapters/index.js';
import {
  classifyApprovalBatch,
  isApprovalBatchFamilyType,
} from './deliverable-adapters/approval-batch-classifier.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { WS_EVENTS } from '../../ws-events.js';
import { getDeliverableTransitions, validateTransition } from '../../state-machines.js';
import { createLogger } from '../../logger.js';

const log = createLogger('approval-batch-dual-write');

export interface MirrorApprovalBatchOptions {
  /**
   * The known sub-type for this seam, when the caller already knows it (the content-plan
   * routes set `content_plan_sample` / `content_plan_template` explicitly). When omitted,
   * the deterministic classifier resolves it from the batch (the admin approvals path,
   * which carries seo_edit / audit_issue / schema_item interleaved).
   */
  type?: DeliverableType;
  /** Operator send-note (drives Decisions-vs-Conversations routing downstream). */
  note?: string | null;
  /** Originating operator tool, for traceability. */
  source?: string | null;
}

/**
 * Mirror a freshly-created approval batch into `client_deliverable`.
 * Returns the mirrored deliverable, or null when the mirror was skipped/failed. Never throws —
 * the live legacy send must not be affected.
 */
export function mirrorApprovalBatchToDeliverable(
  workspaceId: string,
  batch: ApprovalBatch,
  opts: MirrorApprovalBatchOptions = {},
): ClientDeliverable | null {
  try {
    const type = resolveType(batch, opts.type);
    const adapter = getAdapter(type);

    // Guarantee 0 (the adapter rejects not-ready inputs — e.g. an empty batch).
    const sendable = adapter.validateSendable(batch);
    if (!sendable.ok) {
      log.warn(
        { workspaceId, batchId: batch.id, type, reason: sendable.reason },
        'approval-batch mirror skipped: adapter rejected the batch',
      );
      return null;
    }

    const built = adapter.buildPayload(batch);
    const sourceRef = adapter.sourceRef(batch);
    const nowIso = new Date().toISOString();

    const deliverable = upsertDeliverable({
      workspaceId,
      type,
      kind: built.kind,
      // Send-time mirror: the row is born awaiting_client, matching the legacy "sent to
      // client for review" state. Apply stays disabled (items are applyable=false).
      status: 'awaiting_client',
      title: built.title,
      summary: built.summary ?? null,
      payload: built.payload,
      note: opts.note ?? batch.note ?? null,
      externalRef: built.externalRef ?? null,
      parentDeliverableId: built.parentDeliverableId ?? null,
      sentAt: nowIso,
      generatedAt: nowIso,
      source: opts.source ?? 'approval-batch-mirror',
      sourceRef,
      items: built.items,
    });

    log.debug(
      { workspaceId, batchId: batch.id, type, deliverableId: deliverable.id },
      'approval batch mirrored into client_deliverable (dual-write)',
    );
    // The unified client Inbox renders exclusively from the deliverables query and
    // subscribes to DELIVERABLE_SENT — without this broadcast a client with the Inbox
    // open never sees the new Decision until refocus (Data Flow Rule #2). Single seam:
    // covers the admin approvals send AND both content-plan review seams.
    safeBroadcast(workspaceId, WS_EVENTS.DELIVERABLE_SENT, deliverable);
    return deliverable;
  } catch (err) {
    // Best-effort: the legacy batch is already persisted + the client notified. A mirror
    // failure must not surface to the operator or roll back the live send.
    log.error({ err, workspaceId, batchId: batch.id }, 'approval-batch mirror failed (swallowed)');
    return null;
  }
}

/** Broadcast without letting a transport failure poison the mirror result. */
function safeBroadcast(workspaceId: string, event: string, deliverable: ClientDeliverable): void {
  try {
    broadcastToWorkspace(workspaceId, event, {
      deliverableId: deliverable.id,
      type: deliverable.type,
      status: deliverable.status,
    });
  } catch (err) {
    log.warn({ err, workspaceId, deliverableId: deliverable.id, event }, 'deliverable broadcast failed (swallowed)');
  }
}

/** Locate the mirror row for a legacy batch via the same classifier + adapter the send used. */
function findBatchMirror(
  workspaceId: string,
  batch: ApprovalBatch,
): { existing: ClientDeliverable; type: DeliverableType } | null {
  const type = classifyApprovalBatch(batch);
  const sourceRef = getAdapter(type).sourceRef(batch);
  if (!sourceRef) return null;
  const existing = findBySourceRef(workspaceId, type, sourceRef);
  return existing ? { existing, type } : null;
}

/** Re-upsert the mirror with a new status, preserving every other field (cancel/sync template). */
function moveMirrorStatus(
  existing: ClientDeliverable,
  status: DeliverableStatus,
  opts: { decidedAt?: string | null; clientResponseNote?: string | null } = {},
): ClientDeliverable {
  return upsertDeliverable({
    id: existing.id,
    workspaceId: existing.workspaceId,
    type: existing.type,
    kind: existing.kind,
    status,
    title: existing.title,
    summary: existing.summary,
    payload: existing.payload,
    note: existing.note,
    clientResponseNote: opts.clientResponseNote !== undefined ? opts.clientResponseNote : existing.clientResponseNote,
    externalRef: existing.externalRef,
    parentDeliverableId: existing.parentDeliverableId,
    sentAt: existing.sentAt,
    decidedAt: opts.decidedAt !== undefined ? opts.decidedAt : existing.decidedAt,
    dueAt: existing.dueAt,
    appliedAt: existing.appliedAt,
    generatedAt: existing.generatedAt,
    source: existing.source,
    sourceRef: existing.sourceRef,
  });
}

/** Project a legacy batch decision status onto the deliverable status space. */
function deliverableStatusForBatch(batch: ApprovalBatch): DeliverableStatus | null {
  switch (batch.status) {
    case 'approved': return 'approved';
    case 'rejected': return 'changes_requested';
    case 'partial': return 'partial';
    default: return null; // pending/applied: send-time state / owned by markDeliverableApplied
  }
}

/**
 * Sync the mirror's status to the legacy batch after a respond (R2/R3) driven through the
 * LEGACY public routes. Idempotent: when the unified respondToDeliverable path already moved
 * the mirror (it calls the same respond services), the target status matches and this is a
 * no-op. Illegal moves (e.g. onto a cancelled mirror) are skipped, not thrown — the legacy
 * source write already committed and must not be failed by mirror bookkeeping.
 * Returns the mirror row (moved or not) or null when there is nothing to sync.
 */
export function syncApprovalBatchDeliverableStatus(
  workspaceId: string,
  batch: ApprovalBatch,
  opts: { clientResponseNote?: string | null } = {},
): ClientDeliverable | null {
  try {
    const target = deliverableStatusForBatch(batch);
    if (!target) return null;
    const found = findBatchMirror(workspaceId, batch);
    if (!found) return null;
    const { existing, type } = found;
    if (existing.status === target) return existing;

    try {
      validateTransition('client_deliverable', getDeliverableTransitions(type), existing.status, target);
    } catch (err) {
      log.warn(
        { err, workspaceId, batchId: batch.id, from: existing.status, to: target },
        'mirror status sync skipped: illegal deliverable transition',
      );
      return existing;
    }

    const deliverable = moveMirrorStatus(existing, target, {
      decidedAt: existing.decidedAt ?? new Date().toISOString(),
      ...(opts.clientResponseNote != null ? { clientResponseNote: opts.clientResponseNote } : {}),
    });
    safeBroadcast(workspaceId, WS_EVENTS.DELIVERABLE_UPDATED, deliverable);
    return deliverable;
  } catch (err) {
    log.error({ err, workspaceId, batchId: batch.id }, 'mirror status sync failed (swallowed)');
    return null;
  }
}

/**
 * Cancel the mirror when the admin deletes/withdraws the legacy batch. Without this the
 * orphaned row stays awaiting_client in the client Inbox FOREVER (and a client response to
 * the orphan would silently no-op against the missing batch). Mirrors the
 * cancelSchemaPlanDeliverable template; 'cancelled' is excluded from CLIENT_FACING_STATUSES
 * so the already-subscribed DELIVERABLE_UPDATED removes the card live.
 */
export function cancelApprovalBatchDeliverable(
  workspaceId: string,
  batch: ApprovalBatch,
): ClientDeliverable | null {
  try {
    const found = findBatchMirror(workspaceId, batch);
    if (!found) return null;
    if (found.existing.status === 'cancelled') return found.existing;
    const deliverable = moveMirrorStatus(found.existing, 'cancelled');
    safeBroadcast(workspaceId, WS_EVENTS.DELIVERABLE_UPDATED, deliverable);
    return deliverable;
  } catch (err) {
    log.error({ err, workspaceId, batchId: batch.id }, 'mirror cancel failed (swallowed)');
    return null;
  }
}

/** Resolve the sub-type: an explicit known type (validated to the family) else classify. */
function resolveType(batch: ApprovalBatch, explicit?: DeliverableType): DeliverableType {
  if (explicit && isApprovalBatchFamilyType(explicit)) return explicit;
  return classifyApprovalBatch(batch);
}
