/**
 * work_order dual-write mirror (PR-1fg, DARK behind the flag).
 *
 * At the work_order CREATE + UPDATE seams (`createWorkOrder` after insert, and `updateWorkOrder`
 * after a status change — both in `server/work-orders.ts`), when the `unified-deliverables-rest`
 * flag is ON we ALSO mirror the `WorkOrder` into the unified `client_deliverable` model via the
 * registered `work_order` adapter + `upsertDeliverable`. Default off → this is a no-op (NO
 * production behavior change).
 *
 * Why BOTH seams: a work order is an ORDER that progresses through a fulfillment lifecycle
 * (`pending → in_progress → completed | cancelled`). The CREATE mirror gives the order an
 * `ordered` deliverable the moment it is paid; the UPDATE mirror re-mirrors on each status change
 * so the order deliverable reflects lifecycle progress IN PLACE (idempotent on `work_order:<id>` —
 * the second mirror UPDATEs the same row, never inserts a duplicate). The `ON CONFLICT DO UPDATE`
 * in the store already drives the dedup; the canonical status is recomputed from the order's
 * current status each time.
 *
 * Scope (kept tight): this is the create/update mirror only. We do NOT change any reads. Apply
 * stays disabled (D-apply): a client does not approve an order, and the fulfillment side-effects
 * live in the legacy `updateWorkOrder('completed')` source path.
 *
 * The mirror is best-effort and MUST NEVER break the live legacy create/update: any failure is
 * logged and swallowed (the order is already persisted by the time the mirror runs). The flag
 * being off makes this unreachable, so a dark bug can never reach prod.
 *
 * Leaf rule: imports the registry + the store + the flag reader; not imported back by them. The
 * `WorkOrder` carries its own `workspaceId`, so the seam passes it straight through (no lookup).
 */
import type { WorkOrder } from '../../../shared/types/payments.js';
import type { ClientDeliverable } from '../../../shared/types/client-deliverable.js';
import { isFeatureEnabled } from '../../feature-flags.js';
import { upsertDeliverable } from '../../client-deliverables.js';
import { getAdapter } from './deliverable-adapters/index.js';
import { mapWorkOrderStatusToDeliverableStatus } from './deliverable-adapters/work-order.js';
import { createLogger } from '../../logger.js';

const log = createLogger('work-order-dual-write');

/** The flag that gates the entire work_order dual-write. GLOBAL flag, default false (dark). */
export const WORK_ORDER_FLAG = 'unified-deliverables-rest' as const;

/**
 * Mirror a work order into `client_deliverable` IFF the flag is on. Called at BOTH the create seam
 * (a freshly-inserted order) and the update seam (after a status change), so the order deliverable
 * reflects lifecycle progress. Idempotent on `work_order:<id>` — a re-mirror UPDATEs the same row.
 * Returns the mirrored deliverable, or null when the flag is off (no-op) or the mirror was
 * skipped/failed. Never throws — the live legacy create/update must not be affected.
 */
export function mirrorWorkOrderToDeliverable(order: WorkOrder): ClientDeliverable | null {
  // Flag default false → dark no-op. The single gate for the whole machinery.
  if (!isFeatureEnabled(WORK_ORDER_FLAG)) return null;

  try {
    const adapter = getAdapter('work_order');

    // Guarantee 0: the adapter rejects a malformed (paymentless) order.
    const sendable = adapter.validateSendable(order);
    if (!sendable.ok) {
      log.warn(
        { workspaceId: order.workspaceId, workOrderId: order.id, reason: sendable.reason },
        'work-order mirror skipped: adapter rejected the order',
      );
      return null;
    }

    const built = adapter.buildPayload(order);
    const sourceRef = adapter.sourceRef(order);
    // Canonical ORDER-lifecycle status, recomputed from the order's CURRENT status each mirror so
    // the deliverable tracks lifecycle progress (pending→ordered, in_progress, completed, cancelled).
    const status = mapWorkOrderStatusToDeliverableStatus(order.status);

    const deliverable = upsertDeliverable({
      // OWNING workspace — read off the order itself (work_orders stores workspace_id per row).
      workspaceId: order.workspaceId,
      type: 'work_order',
      kind: built.kind, // 'order'
      status,
      title: built.title,
      summary: built.summary ?? null,
      payload: built.payload,
      externalRef: built.externalRef ?? null,
      // An order is "sent" the moment it is paid/created — carry the order's own createdAt.
      sentAt: order.createdAt,
      // The order's completion timestamp once fulfilled (legacy completedAt), else null.
      appliedAt: order.completedAt ?? null,
      generatedAt: order.createdAt,
      source: 'work-order-mirror',
      sourceRef,
      // No child items — a work order is a single ORDER unit (page targets ride in payload).
    });

    log.debug(
      { workspaceId: order.workspaceId, workOrderId: order.id, status, deliverableId: deliverable.id },
      'work order mirrored into client_deliverable (dual-write)',
    );
    return deliverable;
  } catch (err) {
    // Best-effort: the order is already persisted. A mirror failure must not surface to the
    // operator or roll back the live create/update.
    log.error({ err, workspaceId: order.workspaceId, workOrderId: order.id }, 'work-order mirror failed (swallowed)');
    return null;
  }
}
