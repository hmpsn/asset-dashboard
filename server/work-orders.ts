import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonSafeArray } from './db/json-validation.js';
import { validateTransition, WORK_ORDER_TRANSITIONS } from './state-machines.js';
import { invalidateContentPipelineCache } from './workspace-data.js';
import { invalidateIntelligenceCache } from './intelligence/cache-invalidation.js';
import { resolveRecommendationsForChange } from './domains/recommendations/resolution-service.js';
import { getPageState } from './page-edit-states.js';
import { mirrorWorkOrderToDeliverable } from './domains/inbox/work-order-dual-write.js';
import { createLogger } from './logger.js';
import { z } from 'zod';
import { invalidateMonthlyDigestCache } from './monthly-digest-cache.js';

const log = createLogger('work-orders');

// --- Types ---

export type { WorkOrder } from '../shared/types/payments.ts';
import type { ProductType, WorkOrder } from '../shared/types/payments.ts';

// ── SQLite row shape ──

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
  closed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const stmts = createStmtCache(() => ({
  insert: db.prepare(
    `INSERT INTO work_orders (id, workspace_id, payment_id, product_type, status, page_ids, issue_checks, quantity, assigned_to, completed_at, closed_at, notes, created_at, updated_at)
         VALUES (@id, @workspace_id, @payment_id, @product_type, @status, @page_ids, @issue_checks, @quantity, @assigned_to, @completed_at, @closed_at, @notes, @created_at, @updated_at)`,
  ),
  selectByWorkspace: db.prepare(
    `SELECT * FROM work_orders WHERE workspace_id = ? ORDER BY created_at DESC`,
  ),
  selectById: db.prepare(
    `SELECT * FROM work_orders WHERE id = ? AND workspace_id = ?`,
  ),
  update: db.prepare(
    `UPDATE work_orders SET status = @status, assigned_to = @assigned_to, notes = @notes, completed_at = @completed_at, closed_at = @closed_at, updated_at = @updated_at WHERE id = @id AND workspace_id = @workspace_id`, // status-ok: validateTransition guard in updateWorkOrder()
  ),
}));

function rowToOrder(row: OrderRow): WorkOrder {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    paymentId: row.payment_id,
    productType: row.product_type as ProductType,
    status: row.status as WorkOrder['status'],
    pageIds: parseJsonSafeArray(row.page_ids, z.string(), {
      table: 'work_orders',
      field: 'page_ids',
      workspaceId: row.workspace_id,
    }),
    issueChecks: row.issue_checks
      ? parseJsonSafeArray(row.issue_checks, z.string(), {
        table: 'work_orders',
        field: 'issue_checks',
        workspaceId: row.workspace_id,
      })
      : undefined,
    quantity: row.quantity,
    assignedTo: row.assigned_to ?? undefined,
    completedAt: row.completed_at ?? undefined,
    closedAt: row.closed_at ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- CRUD ---

export function listWorkOrders(workspaceId: string): WorkOrder[] {
  const rows = stmts().selectByWorkspace.all(workspaceId) as OrderRow[];
  return rows.map(rowToOrder);
}

export function getWorkOrder(workspaceId: string, orderId: string): WorkOrder | undefined {
  const row = stmts().selectById.get(orderId, workspaceId) as OrderRow | undefined;
  return row ? rowToOrder(row) : undefined;
}

export function createWorkOrder(
  workspaceId: string,
  data: {
    paymentId: string;
    productType: ProductType;
    status?: WorkOrder['status'];
    pageIds?: string[];
    issueChecks?: string[];
    quantity?: number;
  },
): WorkOrder {
  const now = new Date().toISOString();

  const order: WorkOrder = {
    id: `wo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    workspaceId,
    paymentId: data.paymentId,
    productType: data.productType,
    status: data.status || 'pending',
    pageIds: data.pageIds || [],
    issueChecks: data.issueChecks,
    quantity: data.quantity || 1,
    createdAt: now,
    updatedAt: now,
  };

  stmts().insert.run({
    id: order.id,
    workspace_id: workspaceId,
    payment_id: order.paymentId,
    product_type: order.productType,
    status: order.status,
    page_ids: JSON.stringify(order.pageIds),
    issue_checks: order.issueChecks ? JSON.stringify(order.issueChecks) : null,
    quantity: order.quantity,
    assigned_to: null,
    completed_at: null,
    closed_at: null,
    notes: null,
    created_at: now,
    updated_at: now,
  });

  invalidateWorkOrderCaches(workspaceId);

  // Mirror the freshly-created order into client_deliverable. Best-effort/never-throws so it can
  // never break the live create. Idempotent on `work_order:<id>`.
  mirrorWorkOrderToDeliverable(order);

  return order;
}

export function updateWorkOrder(
  workspaceId: string,
  orderId: string,
  updates: Partial<Pick<WorkOrder, 'status' | 'assignedTo' | 'notes' | 'completedAt' | 'closedAt'>>,
): WorkOrder | null {
  const order = getWorkOrder(workspaceId, orderId);
  if (!order) return null;
  const previousStatus = order.status;

  // Validate status transition if status is being changed
  if (updates.status !== undefined && updates.status !== order.status) {
    validateTransition('work_order', WORK_ORDER_TRANSITIONS, order.status, updates.status);
  }

  if (updates.status !== undefined) order.status = updates.status;
  if (updates.assignedTo !== undefined) order.assignedTo = updates.assignedTo;
  if (updates.notes !== undefined) order.notes = updates.notes;
  if (updates.completedAt !== undefined) order.completedAt = updates.completedAt;
  if (updates.closedAt !== undefined) order.closedAt = updates.closedAt;
  order.updatedAt = new Date().toISOString();

  stmts().update.run({
    id: order.id,
    workspace_id: workspaceId,
    status: order.status,
    assigned_to: order.assignedTo ?? null,
    notes: order.notes ?? null,
    completed_at: order.completedAt ?? null,
    closed_at: order.closedAt ?? null,
    updated_at: order.updatedAt,
  });
  invalidateWorkOrderCaches(workspaceId);
  const wasDigestCompleted = previousStatus === 'completed' || previousStatus === 'closed';
  const isDigestCompleted = order.status === 'completed' || order.status === 'closed';
  if (wasDigestCompleted !== isDigestCompleted) {
    invalidateMonthlyDigestCache(workspaceId);
  }

  // Re-mirror the order on a status change so the order deliverable reflects lifecycle progress
  // (pending→ordered, in_progress, completed, cancelled). Gated on a status change to skip pure
  // assignee/notes edits. Best-effort/never-throws; idempotent on `work_order:<id>`.
  if (updates.status !== undefined) {
    mirrorWorkOrderToDeliverable(order);
  }

  // A completed fix order resolves any recommendations covering the pages it
  // touched, so the priority list drops them immediately (GSC-lag-free).
  // order.pageIds are Webflow/page IDs (the page_edit_states key), but
  // recommendation.affectedPages are SLUGS — resolve each id to its slug via
  // page_edit_states before matching. Guarded so a resolver failure can never
  // abort the work-order completion side-effects that run after updateWorkOrder
  // returns (page-state → live, activity log, client email). // rec-refresh-ok
  if (updates.status === 'completed' && order.pageIds.length > 0) {
    try {
      const affectedSlugs = order.pageIds
        .map(id => getPageState(workspaceId, id)?.slug)
        .filter((s): s is string => typeof s === 'string' && s.length > 0);
      if (affectedSlugs.length > 0) {
        resolveRecommendationsForChange(workspaceId, { affectedPages: affectedSlugs });
      }
    } catch (err) {
      log.warn({ err, workOrderId: order.id }, 'Failed to resolve recommendations after work-order completion');
    }
  }

  return order;
}

function invalidateWorkOrderCaches(workspaceId: string): void {
  invalidateContentPipelineCache(workspaceId);
  invalidateIntelligenceCache(workspaceId);
}
