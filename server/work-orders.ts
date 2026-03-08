import fs from 'fs';
import { getDataDir } from './data-dir.js';
import type { ProductType } from './payments.js';

const WORK_ORDERS_DIR = getDataDir('work-orders');
fs.mkdirSync(WORK_ORDERS_DIR, { recursive: true });

// --- Types ---

export interface WorkOrder {
  id: string;
  workspaceId: string;
  paymentId: string;
  productType: ProductType;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  pageIds: string[];
  issueChecks?: string[];
  quantity: number;
  assignedTo?: string;
  completedAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// --- Storage helpers ---

function getFile(workspaceId: string): string {
  return `${WORK_ORDERS_DIR}/${workspaceId}.json`;
}

function read(workspaceId: string): WorkOrder[] {
  try {
    const f = getFile(workspaceId);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch { /* fresh */ }
  return [];
}

function write(workspaceId: string, items: WorkOrder[]) {
  fs.writeFileSync(getFile(workspaceId), JSON.stringify(items, null, 2));
}

// --- CRUD ---

export function listWorkOrders(workspaceId: string): WorkOrder[] {
  return read(workspaceId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getWorkOrder(workspaceId: string, orderId: string): WorkOrder | undefined {
  return read(workspaceId).find(o => o.id === orderId);
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
  const items = read(workspaceId);
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

  items.push(order);
  write(workspaceId, items);
  return order;
}

export function updateWorkOrder(
  workspaceId: string,
  orderId: string,
  updates: Partial<Pick<WorkOrder, 'status' | 'assignedTo' | 'notes' | 'completedAt'>>,
): WorkOrder | null {
  const items = read(workspaceId);
  const order = items.find(o => o.id === orderId);
  if (!order) return null;

  if (updates.status !== undefined) order.status = updates.status;
  if (updates.assignedTo !== undefined) order.assignedTo = updates.assignedTo;
  if (updates.notes !== undefined) order.notes = updates.notes;
  if (updates.completedAt !== undefined) order.completedAt = updates.completedAt;
  order.updatedAt = new Date().toISOString();

  write(workspaceId, items);
  return order;
}
