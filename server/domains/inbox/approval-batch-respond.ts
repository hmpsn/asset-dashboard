/**
 * approval-batch respond service (R2) — the reusable "client decided on a whole batch"
 * core, extracted from the route-inline logic in `server/routes/approvals.ts` so BOTH the
 * public approve/per-item routes AND the unified-inbox `respondToSource` propagation drive
 * the SAME source write (no divergence).
 *
 * R2 is WHOLE-batch propagation (per-item granularity is R3): a client `approve` in the
 * unified inbox approves every pending item; a `changes_requested`/`declined` rejects every
 * pending item. Each item move goes through the legacy `updateItem` (which guards the
 * approval_item state machine + recalculates batch status), so the batch ends up `approved`
 * / `rejected` / `partial` exactly as the route would compute it.
 *
 * This service OWNS the team notification for the approval_batch family (the
 * `notifyTeamActionApproved` / `notifyTeamChangesRequested` the route fires) + the
 * `APPROVAL_UPDATE` broadcast + the activity log. `respondToDeliverable` therefore SUPPRESSES
 * its own deliverable-level team email for this family to avoid double-notify (the source
 * path is the single team-email owner).
 *
 * Apply is NOT triggered here — R2 propagates only the DECISION/status. The Webflow publish
 * ("Apply to Website") stays a separate operator/client step (R3, the `/apply` route),
 * exactly as today (D-apply).
 *
 * Leaf rule: imports the approvals store + email + broadcast + activity; it is NOT imported
 * back by any of them (no circular value-import).
 */
import db from '../../db/index.js';
import { getBatch, updateItem } from '../../approvals.js';
import { addActivity } from '../../activity-log.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { notifyTeamActionApproved, notifyTeamChangesRequested } from '../../email.js';
import { getClientPortalUrl, getWorkspace } from '../../workspaces.js';
import { WS_EVENTS } from '../../ws-events.js';
import { createLogger } from '../../logger.js';
import type { ApprovalBatch } from '../../../shared/types/approvals.js';

const log = createLogger('approval-batch-respond');

/** The whole-batch decision the client made (R2 maps the deliverable decision onto this). */
export type ApprovalBatchDecision = 'approved' | 'rejected';

/**
 * R3 per-item override: a single legacy approval item's resolved status. When the client
 * approves the deliverable but flags a subset of items ("implement N of M"), the source write
 * must approve the UNFLAGGED items and reject the FLAGGED ones — driven per legacy item id
 * rather than whole-batch. `legacyItemId` is the `approval_item.id` (carried on the deliverable
 * item's `itemPayload.legacyItemId`).
 */
export interface ApprovalItemDecision {
  legacyItemId: string;
  status: 'approved' | 'rejected';
  /** Optional per-item client note (the flag note); falls back to the batch-level note. */
  note?: string | null;
}

export interface RespondToApprovalBatchOptions {
  /** Client note carried onto each item + the team email + activity. */
  note?: string | null;
  /** Optional actor (client user) for the activity log. */
  actor?: { id?: string; name?: string };
  /**
   * R3 per-item mode. When provided (non-empty), drive each named legacy item to its resolved
   * status (approve subset / reject flagged) inside the transaction INSTEAD of the whole-batch
   * approve-all-pending. When absent, the whole-batch back-compat behavior (R2) is unchanged.
   * Items not named here are left untouched (already-decided items stay decided). The team-notify
   * + activity + broadcast still fire once, keyed to the top-level `decision`.
   */
  itemDecisions?: ApprovalItemDecision[];
}

export interface RespondToApprovalBatchResult {
  /** The batch after the decision (status recalculated by `updateItem`). */
  batch: ApprovalBatch;
  /** How many pending items were moved by this decision. */
  itemsUpdated: number;
}

/**
 * Apply a whole-batch client decision to the legacy approval batch (R2 source write).
 *
 * `approved` → every pending item → approved; `rejected` → every pending item → rejected.
 * Each move is guarded by the approval_item state machine inside `updateItem`; the batch
 * status is recalculated after each move. Fires the team email (this family's single owner),
 * the APPROVAL_UPDATE broadcast, and the activity log.
 *
 * Returns null when the batch does not exist (caller decides whether that is fatal — for the
 * unified `respondToSource` it is a swallowed best-effort miss; the deliverable mirror already
 * moved). Throws InvalidTransitionError only if an item is in an illegal state for the move
 * (the caller surfaces it as a 4xx — same as the route).
 */
export function respondToApprovalBatch(
  workspaceId: string,
  batchId: string,
  decision: ApprovalBatchDecision,
  opts: RespondToApprovalBatchOptions = {},
): RespondToApprovalBatchResult | null {
  const batch = getBatch(workspaceId, batchId);
  if (!batch) {
    log.warn({ workspaceId, batchId }, 'respondToApprovalBatch: batch not found');
    return null;
  }

  const note = opts.note ?? undefined;
  const itemStatus = decision === 'approved' ? 'approved' : 'rejected';
  const itemDecisions = opts.itemDecisions;
  const perItemMode = Array.isArray(itemDecisions) && itemDecisions.length > 0;

  // Only PENDING items are movable (approved/rejected/applied items are already decided — the
  // approval_item machine would reject e.g. applied→rejected). Mirrors the route's pending filter.
  const pendingItems = batch.items.filter(i => i.status === 'pending');

  let updatedBatch = batch;
  let itemsUpdated = 0;
  // Atomic: all per-item moves commit together, so a mid-loop failure (e.g. a concurrent
  // request flipping an item) cannot leave the batch half-decided. Side-effects (activity,
  // email, broadcast) fire AFTER, outside the transaction.
  db.transaction(() => {
    if (perItemMode) {
      // R3 per-item: drive each NAMED pending item to its resolved status (approve subset / reject
      // flagged). Items not named are left untouched; non-pending named items are skipped (the
      // approval_item machine would reject re-deciding an already-decided item).
      const byLegacyId = new Map(itemDecisions.map(d => [d.legacyItemId, d]));
      for (const item of pendingItems) {
        const decisionForItem = byLegacyId.get(item.id);
        if (!decisionForItem) continue;
        const itemNote = decisionForItem.note ?? note;
        const result = updateItem(workspaceId, batchId, item.id, {
          status: decisionForItem.status,
          ...(itemNote ? { clientNote: itemNote } : {}),
        });
        if (result) {
          updatedBatch = result;
          itemsUpdated += 1;
        }
      }
    } else {
      for (const item of pendingItems) {
        const result = updateItem(workspaceId, batchId, item.id, {
          status: itemStatus,
          ...(note ? { clientNote: note } : {}),
        });
        if (result) {
          updatedBatch = result;
          itemsUpdated += 1;
        }
      }
    }
  })();

  const ws = getWorkspace(workspaceId);
  const actorName = opts.actor?.name || 'Client';
  // In R3 per-item mode some items may have been REJECTED (flagged/held) even on an `approved`
  // top-level decision — reflect "N of M" in the activity copy rather than "all changes".
  const rejectedInThisMove = perItemMode
    ? itemDecisions!.filter(d => d.status === 'rejected').length
    : 0;

  if (decision === 'approved') {
    const approvalSummary =
      rejectedInThisMove > 0
        ? `${actorName} approved ${itemsUpdated - rejectedInThisMove} of ${itemsUpdated} changes in batch "${batch.name}" (held ${rejectedInThisMove})`
        : `${actorName} approved all changes in batch "${batch.name}"`;
    addActivity(
      workspaceId,
      'approval_applied',
      approvalSummary,
      note,
      { batchId },
      opts.actor,
    );
    notifyTeamActionApproved({
      workspaceId,
      workspaceName: ws?.name || workspaceId,
      actionTitle: `SEO batch approved: ${batch.name}`,
      sourceType: 'seo_approval',
      actionSummary: `${itemsUpdated} approved change${itemsUpdated === 1 ? '' : 's'}`,
      clientNote: note,
      dashboardUrl: ws ? getClientPortalUrl(ws) : undefined,
    });
  } else {
    addActivity(
      workspaceId,
      'changes_requested',
      `${actorName} requested changes on batch "${batch.name}"`,
      note,
      { batchId },
      opts.actor,
    );
    notifyTeamChangesRequested({
      workspaceName: ws?.name || workspaceId,
      workspaceId,
      topic: `SEO revision requested: ${batch.name}`,
      targetKeyword: batch.name,
      feedback: note || '',
    });
  }

  broadcastToWorkspace(workspaceId, WS_EVENTS.APPROVAL_UPDATE, {
    batchId,
    status: decision,
  });

  return { batch: updatedBatch, itemsUpdated };
}
