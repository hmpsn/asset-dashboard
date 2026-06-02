/**
 * work_order deliverable adapter (PR-1fg, DARK — net-new ORDER type).
 *
 * Claims the paid fulfillment WORK ORDER (`WorkOrder`, stored in `work_orders`, keyed by `id`) —
 * the order a client paid for via Stripe (`server/stripe.ts` → `createWorkOrder`) and that the
 * agency works through the fix/schema fulfillment lifecycle (`server/work-orders.ts`:
 * `WORK_ORDER_TRANSITIONS` = `pending → in_progress → completed | cancelled`). This is a paid
 * ORDER, not a review artifact: the client does not approve/decline it — it progresses through a
 * fulfillment lifecycle the agency drives.
 *
 * kind = 'order' (design §4.1): a work order rides the canonical ORDER lifecycle
 * (`ordered → in_progress → completed`, plus `cancelled`), NOT the review/decision/batch
 * families. The order detail (product_type, payment id, page targets, issue checks, quantity)
 * rides in `client_deliverable.payload` JSON; this adapter emits NO typed child items (a work
 * order is a single order unit — the page targets are payload, not per-item review rows).
 *
 * sourceRef = `work_order:<id>` — STABLE per-order (`work_orders.id` is the globally-unique
 * natural key). A re-mirror of the same order (on a later status update) dedupes onto the same
 * deliverable row so the order deliverable reflects lifecycle progress in place (design §4.5).
 *
 * STATUS MAP (legacy WORK_ORDER_TRANSITIONS → canonical ORDER lifecycle, open-Q#4 — ABSORB at
 * projection time, do NOT rename the live `WORK_ORDER_TRANSITIONS` enum):
 *   pending     → ordered        (the entry state — a paid, not-yet-started order is `ordered`)
 *   in_progress → in_progress    (agency is working it)
 *   completed   → completed      (TERMINAL — fulfilled)
 *   cancelled   → cancelled      (TERMINAL — cancelled)
 * Use an EXHAUSTIVE switch with a `never` guard so a future WorkOrder status cannot silently
 * mis-map. The raw legacy status is ALWAYS carried in `payload.workOrderStatus` so the legacy
 * `pending` value is never lost (it is only RENAMED to `ordered` for the canonical projection).
 *
 * validateSendable: a PAID order is sendable — there is a fulfillment order to surface. An order
 * with no payment id (malformed) is rejected (Guarantee 0). (Interface completeness: work_order is
 * mirrored via the createWorkOrder/updateWorkOrder dual-write seam, not the unified sendToClient
 * service.)
 *
 * applyDeliverable: DISABLED (opt-out `appliesOnApprove`, throwing stub). A work order is NOT
 * applied by a client approve — fulfillment side-effects (page-state → live, client email,
 * recommendation resolution) live in the legacy `updateWorkOrder('completed')` source path
 * (`server/work-orders.ts` + `server/routes/work-orders.ts`), NOT a unified apply (D-apply).
 *
 * Leaf rule: this module imports ONLY shared types (payments, client-deliverable) + the adapter
 * contract. It does NOT import `work-orders.ts` or any source/route module (no cycle).
 */
import type { WorkOrder } from '../../../../shared/types/payments.js';
import type {
  ClientDeliverable,
  DeliverableStatus,
} from '../../../../shared/types/client-deliverable.js';
import {
  registerAdapter,
  type BuiltDeliverablePayload,
  type DeliverableAdapter,
  type SendableResult,
} from './types.js';

/**
 * WorkOrder status → canonical ORDER-lifecycle DeliverableStatus (open-Q#4). The legacy entry
 * state `pending` is ABSORBED to the canonical `ordered` at projection time — the live
 * `WORK_ORDER_TRANSITIONS` enum is NOT renamed. The raw legacy status is always carried in
 * `payload.workOrderStatus`, so the mapping never loses it. All four source statuses are covered
 * so a drifted value can never silently fall through (exhaustiveness guard).
 */
export function mapWorkOrderStatusToDeliverableStatus(
  status: WorkOrder['status'],
): DeliverableStatus {
  switch (status) {
    // The paid, not-yet-started order: legacy `pending` → canonical `ordered` (open-Q#4 absorb).
    case 'pending':
      return 'ordered';
    case 'in_progress':
      return 'in_progress';
    case 'completed':
      return 'completed';
    case 'closed':
      // An operator-closed order LEAVES the client lane: `cancelled` is NOT in
      // CLIENT_FACING_ORDER_STATUSES, so the re-mirror on `→ closed` excludes it
      // from the client unified inbox. The raw `closed` status is preserved in
      // payload.workOrderStatus (buildWorkOrderPayload carries order.status), so
      // the canonical mapping never loses it. (`completed` stays mapped to
      // `completed` → stays in the lane.)
      return 'cancelled';
    case 'cancelled':
      return 'cancelled';
    default: {
      // Exhaustiveness guard: a new WorkOrder status must extend this map explicitly.
      const _exhaustive: never = status;
      void _exhaustive;
      return 'ordered';
    }
  }
}

/**
 * The full payload carried in `client_deliverable.payload` for a work order. Nothing from the
 * source is dropped: the product type, the payment id, the page targets, the issue checks, the
 * quantity, the assignee — and ALWAYS the raw `workOrderStatus` so the canonical mapping never
 * loses the legacy `pending` value.
 */
export interface WorkOrderDeliverablePayload {
  family: 'work_order';
  /** ALWAYS carried — the raw legacy status, so the canonical mapping never loses `pending`. */
  workOrderStatus: WorkOrder['status'];
  /** The product the client paid for (fix_meta / schema_page / …). */
  productType: WorkOrder['productType'];
  /** FK to the payment that funded this order (work_orders.payment_id). */
  paymentId: string;
  /** The page targets (Webflow/page ids) this order touches. */
  pageIds: string[];
  /** Optional issue-check filters carried from the order, or null. */
  issueChecks: string[] | null;
  /** Order quantity (e.g. fix_meta_10 → 10). */
  quantity: number;
  /** Who the order is assigned to internally, or null. */
  assignedTo: string | null;
  [key: string]: unknown;
}

function stableSourceRef(id: string): string | null {
  return id ? `work_order:${id}` : null;
}

/** Build the typed payload JSON for a work order. */
function buildWorkOrderPayload(order: WorkOrder): WorkOrderDeliverablePayload {
  return {
    family: 'work_order',
    // ALWAYS carry the raw legacy status so the canonical mapping never loses `pending`.
    workOrderStatus: order.status,
    productType: order.productType,
    paymentId: order.paymentId,
    pageIds: order.pageIds ?? [],
    issueChecks: order.issueChecks ?? null,
    quantity: order.quantity,
    assignedTo: order.assignedTo ?? null,
  };
}

/** Human-readable title for an order (the product, humanized — mirrors the legacy activity label). */
function orderTitle(order: WorkOrder): string {
  return `Order: ${order.productType.replace(/_/g, ' ')}`;
}

/** Summary line: how many pages the order touches (its scope). */
function orderSummary(order: WorkOrder): string {
  const pageCount = Array.isArray(order.pageIds) ? order.pageIds.length : 0;
  return `${pageCount} page${pageCount !== 1 ? 's' : ''}`;
}

export const workOrderAdapter: DeliverableAdapter<WorkOrder> = {
  type: 'work_order',

  /**
   * Guarantee 0: a paid order (one with a payment id) is sendable — there is a fulfillment order
   * to surface. An order missing its payment id is malformed; reject it rather than mirror a
   * dangling order. (Interface completeness — work_order is mirrored via the
   * createWorkOrder/updateWorkOrder dual-write seam, not the unified sendToClient service.)
   */
  validateSendable: (order): SendableResult => {
    if (!order.paymentId) {
      return { ok: false, reason: 'work order has no payment id (not a paid, sendable order)' };
    }
    return { ok: true };
  },

  /**
   * Coherent typed payload (no child items — a work order is a single ORDER unit; the page targets
   * ride in payload, not per-item review rows). kind = 'order'.
   */
  buildPayload: (order): BuiltDeliverablePayload => ({
    title: orderTitle(order),
    summary: orderSummary(order),
    kind: 'order',
    payload: buildWorkOrderPayload(order),
    externalRef: order.paymentId,
    // No typed child items: the page targets are payload, not per-item approval rows.
  }),

  // Stable per-order key: work_order:<id>. id is the globally-unique work_orders.id.
  sourceRef: (order) => stableSourceRef(order.id),

  // apply disabled — a work order is NOT applied by a client approve. The fulfillment side-effects
  // (page-state → live, client email, recommendation resolution) live in the legacy
  // updateWorkOrder('completed') source path, NOT a unified apply. The adapter opts OUT of
  // `appliesOnApprove`; this stub throws if any future caller wires it on.
  applyDeliverable: workOrderApplyDisabledStub,
};

/**
 * The disabled-apply stub for work_order. A work order's terminal fulfillment side-effects —
 * flipping page states to `live`, emailing the client, resolving recommendations — happen in the
 * SOURCE path (`server/work-orders.ts:updateWorkOrder` + `server/routes/work-orders.ts`), NOT via
 * a unified apply. The adapter opts OUT of `appliesOnApprove`; this stub throws to make the
 * disabled-apply contract explicit if any future caller wires it on.
 */
export async function workOrderApplyDisabledStub(
  _deliverable: ClientDeliverable,
): Promise<{ applied: number }> {
  throw new Error(
    'work_order apply is disabled (D-apply): the fulfillment side-effects (page-state live, client email, rec resolution) live in the updateWorkOrder source path, not a unified apply',
  );
}

registerAdapter(workOrderAdapter as DeliverableAdapter);
