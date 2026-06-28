import type { ApprovalBatch } from '../../../shared/types/approvals.js';
import type {
  ClientDeliverable,
  DeliverableStatus,
  DeliverableType,
} from '../../../shared/types/client-deliverable.js';
import { findBySourceRef, upsertDeliverable } from '../../client-deliverables.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { WS_EVENTS } from '../../ws-events.js';
import { getDeliverableTransitions } from '../../state-machines.js';
import { createLogger } from '../../logger.js';
import { classifyApprovalBatch } from './deliverable-adapters/approval-batch-classifier.js';

const log = createLogger('approval-batch-mirror-sync');

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

function approvalBatchSourceRef(type: DeliverableType, batch: ApprovalBatch): string {
  return `${type}:${batch.id}`;
}

function findBatchMirror(
  workspaceId: string,
  batch: ApprovalBatch,
): { existing: ClientDeliverable; type: DeliverableType } | null {
  const type = classifyApprovalBatch(batch);
  const existing = findBySourceRef(workspaceId, type, approvalBatchSourceRef(type, batch));
  return existing ? { existing, type } : null;
}

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

function deliverableStatusForBatch(batch: ApprovalBatch): DeliverableStatus | null {
  switch (batch.status) {
    case 'approved': return 'approved';
    case 'rejected': return 'changes_requested';
    case 'partial': return 'partial';
    default: return null;
  }
}

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

    const allowed = getDeliverableTransitions(type)[existing.status];
    if (!allowed?.includes(target)) {
      const mirrorAlreadyDecided = existing.status === 'declined'
        || existing.status === 'approved'
        || existing.status === 'applied'
        || existing.status === 'cancelled'
        || existing.status === 'expired';
      log[mirrorAlreadyDecided ? 'debug' : 'warn'](
        { workspaceId, batchId: batch.id, from: existing.status, to: target },
        mirrorAlreadyDecided
          ? 'mirror status sync skipped: mirror already decided (unified-path echo)'
          : 'mirror status sync skipped: unexpected illegal deliverable transition',
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
