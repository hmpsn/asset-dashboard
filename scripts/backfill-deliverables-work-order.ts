/**
 * Backfill: mirror legacy `work_orders` rows into the unified `client_deliverable` model
 * (PR-1fg cutover tooling — NOT run automatically).
 *
 * Run during the work_order cutover, AFTER the dual-write seam is live (so freshly-created/updated
 * orders already mirror):
 *
 *   npx tsx scripts/backfill-deliverables-work-order.ts            # backfill
 *   npx tsx scripts/backfill-deliverables-work-order.ts --dry-run  # report only, no writes
 *
 * Idempotent + sourceRef normalization (design §4.5): every order routes through the adapter's own
 * `sourceRef()` — the stable `work_order:<id>` key — so a backfill collapses onto the SAME row a
 * fresh dual-write produces. It then SKIPS any order whose deliverable already exists (DO-NOTHING).
 * Re-running is a no-op.
 *
 * The canonical ORDER-lifecycle status is computed from each order's current legacy status via the
 * adapter's `mapWorkOrderStatusToDeliverableStatus` (pending→ordered, in_progress, completed,
 * cancelled), so a backfilled order reflects its real fulfillment state. The raw legacy status is
 * always carried in `payload.workOrderStatus`.
 *
 * Apply stays disabled for this type (D-apply): a work order is not applied by a client approve —
 * the fulfillment side-effects live in the legacy updateWorkOrder source path. Backfilled rows
 * reflect the legacy order status; no apply is replayed.
 */
import db from '../server/db/index.js';
import { parseJsonFallback } from '../server/db/json-validation.js';
import type { ProductType, WorkOrder } from '../shared/types/payments.js';
import { findBySourceRef, upsertDeliverable } from '../server/client-deliverables.js';
import { getAdapter } from '../server/domains/inbox/deliverable-adapters/index.js';
import { mapWorkOrderStatusToDeliverableStatus } from '../server/domains/inbox/deliverable-adapters/work-order.js';
import { createLogger } from '../server/logger.js';

const log = createLogger('backfill-deliverables-work-order');
void log;

interface OrderRow {
  id: string;
  workspace_id: string;
  payment_id: string;
  product_type: string;
  status: string;
  page_ids: string;
  issue_checks: string | null;
  quantity: number;
  assigned_to: string | null;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Read every legacy work_order from the DB (cutover tooling reads the old table). */
function readAllOrders(): WorkOrder[] {
  const rows = db.prepare('SELECT * FROM work_orders').all() as OrderRow[];
  return rows.map(rowToOrder);
}

/** Parse a raw work_orders row into a WorkOrder (mirrors work-orders.ts:rowToOrder). */
function rowToOrder(row: OrderRow): WorkOrder {
  const pageIds = parseJsonFallback<unknown>(row.page_ids, []);
  const issueChecks = row.issue_checks ? parseJsonFallback<unknown>(row.issue_checks, []) : undefined;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    paymentId: row.payment_id,
    productType: row.product_type as ProductType,
    status: row.status as WorkOrder['status'],
    pageIds: Array.isArray(pageIds) ? (pageIds as string[]) : [],
    issueChecks: Array.isArray(issueChecks) ? (issueChecks as string[]) : undefined,
    quantity: row.quantity,
    assignedTo: row.assigned_to ?? undefined,
    completedAt: row.completed_at ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface BackfillResult {
  total: number;
  inserted: number;
  skipped: number;
}

/**
 * Backfill all legacy work_orders. Idempotent: routes every order through the adapter's stable
 * `sourceRef()` (`work_order:<id>`) and skips orders whose deliverable already exists (DO-NOTHING).
 * Skips not-ready (paymentless) orders (adapter Guarantee 0). When `dryRun` is true, classifies +
 * counts but writes nothing.
 */
export function backfillWorkOrderDeliverables(opts: { dryRun?: boolean } = {}): BackfillResult {
  const orders = readAllOrders();
  const adapter = getAdapter('work_order');

  let inserted = 0;
  let skipped = 0;

  for (const order of orders) {
    // Guarantee 0: skip a not-ready (paymentless) order.
    const sendable = adapter.validateSendable(order);
    if (!sendable.ok) {
      skipped += 1;
      continue;
    }

    const sourceRef = adapter.sourceRef(order);

    // DO-NOTHING: a deliverable for this (ws, work_order, sourceRef) already exists → skip.
    if (sourceRef != null && findBySourceRef(order.workspaceId, 'work_order', sourceRef) != null) {
      skipped += 1;
      continue;
    }

    if (opts.dryRun) {
      inserted += 1; // would-insert count
      continue;
    }

    const built = adapter.buildPayload(order);
    upsertDeliverable({
      workspaceId: order.workspaceId,
      type: 'work_order',
      kind: built.kind, // 'order'
      status: mapWorkOrderStatusToDeliverableStatus(order.status),
      title: built.title,
      summary: built.summary ?? null,
      payload: built.payload,
      externalRef: built.externalRef ?? null,
      sentAt: order.createdAt,
      appliedAt: order.completedAt ?? null,
      generatedAt: order.createdAt,
      source: 'backfill-work-order',
      sourceRef,
    });
    inserted += 1;
  }

  return { total: orders.length, inserted, skipped };
}

// ── CLI entry (only when invoked directly, not when imported by tests) ─────────
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const dryRun = process.argv.includes('--dry-run');
  const result = backfillWorkOrderDeliverables({ dryRun });
  console.log(dryRun ? 'DRY RUN (no writes):' : 'Backfill complete:');
  console.log(`  total work orders: ${result.total}`);
  console.log(`  inserted: ${result.inserted}`);
  console.log(`  skipped (already mirrored / not sendable): ${result.skipped}`);
}
