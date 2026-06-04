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
import type { ClientDeliverable, DeliverableType } from '../../../shared/types/client-deliverable.js';
import { upsertDeliverable } from '../../client-deliverables.js';
import { getAdapter } from './deliverable-adapters/index.js';
import {
  classifyApprovalBatch,
  isApprovalBatchFamilyType,
} from './deliverable-adapters/approval-batch-classifier.js';
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
    return deliverable;
  } catch (err) {
    // Best-effort: the legacy batch is already persisted + the client notified. A mirror
    // failure must not surface to the operator or roll back the live send.
    log.error({ err, workspaceId, batchId: batch.id }, 'approval-batch mirror failed (swallowed)');
    return null;
  }
}

/** Resolve the sub-type: an explicit known type (validated to the family) else classify. */
function resolveType(batch: ApprovalBatch, explicit?: DeliverableType): DeliverableType {
  if (explicit && isApprovalBatchFamilyType(explicit)) return explicit;
  return classifyApprovalBatch(batch);
}
