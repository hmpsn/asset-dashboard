import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonFallback } from './db/json-validation.js';
import { validateTransition, WORK_ORDER_TRANSITIONS } from './state-machines.js';

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
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const stmts = createStmtCache(() => ({
  insert: db.prepare(
    `INSERT INTO work_orders (id, workspace_id, payment_id, product_type, status, page_ids, issue_checks, quantity, assigned_to, completed_at, notes, created_at, updated_at)
         VALUES (@id, @workspace_id, @payment_id, @product_type, @status, @page_ids, @issue_checks, @quantity, @assigned_to, @completed_at, @notes, @created_at, @updated_at)`,
  ),
  selectByWorkspace: db.prepare(
    `SELECT * FROM work_orders WHERE workspace_id = ? ORDER BY created_at DESC`,
  ),
  selectById: db.prepare(
    `SELECT * FROM work_orders WHERE id = ? AND workspace_id = ?`,
  ),
  update: db.prepare(
    `UPDATE work_orders SET status = @status, assigned_to = @assigned_to, notes = @notes, completed_at = @completed_at, updated_at = @updated_at WHERE id = @id`, // status-ok: validateTransition planned in Batch 2
  ),
}));

function rowToOrder(row: OrderRow): WorkOrder {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    paymentId: row.payment_id,
    productType: row.product_type as ProductType,
    status: row.status as WorkOrder['status'],
    pageIds: parseJsonFallback(row.page_ids, []),
    issueChecks: parseJsonFallback(row.issue_checks, undefined),
    quantity: row.quantity,
    assignedTo: row.assigned_to ?? undefined,
    completedAt: row.completed_at ?? undefined,
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
    notes: null,
    created_at: now,
    updated_at: now,
  });

  return order;
}

export function updateWorkOrder(
  workspaceId: string,
  orderId: string,
  updates: Partial<Pick<WorkOrder, 'status' | 'assignedTo' | 'notes' | 'completedAt'>>,
): WorkOrder | null {
  const order = getWorkOrder(workspaceId, orderId);
  if (!order) return null;

  // Validate status transition if status is being changed
  if (updates.status !== undefined && updates.status !== order.status) {
    validateTransition('work_order', WORK_ORDER_TRANSITIONS, order.status, updates.status);
  }

  if (updates.status !== undefined) order.status = updates.status;
  if (updates.assignedTo !== undefined) order.assignedTo = updates.assignedTo;
  if (updates.notes !== undefined) order.notes = updates.notes;
  if (updates.completedAt !== undefined) order.completedAt = updates.completedAt;
  order.updatedAt = new Date().toISOString();

  stmts().update.run({
    id: order.id,
    status: order.status,
    assigned_to: order.assignedTo ?? null,
    notes: order.notes ?? null,
    completed_at: order.completedAt ?? null,
    updated_at: order.updatedAt,
  });
  return order;
}
