import { randomUUID } from 'crypto';
import db from './db/index.js';

export interface ApprovalItem {
  id: string;
  pageId: string;
  pageTitle: string;
  pageSlug: string;
  field: string;              // 'seoTitle' | 'seoDescription' for pages, or CMS field slug
  collectionId?: string;      // present for CMS items
  currentValue: string;
  proposedValue: string;
  clientValue?: string;       // client's edited version (if they modify it)
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  clientNote?: string;
  reason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalBatch {
  id: string;
  workspaceId: string;
  siteId: string;
  name: string;
  items: ApprovalItem[];
  status: 'pending' | 'partial' | 'approved' | 'applied';
  createdAt: string;
  updatedAt: string;
}

// ── SQLite row shape ──

interface BatchRow {
  id: string;
  workspace_id: string;
  site_id: string;
  name: string;
  items: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface Stmts {
  insert: ReturnType<typeof db.prepare>;
  selectByWorkspace: ReturnType<typeof db.prepare>;
  selectById: ReturnType<typeof db.prepare>;
  update: ReturnType<typeof db.prepare>;
  deleteById: ReturnType<typeof db.prepare>;
}

let _stmts: Stmts | null = null;
function stmts(): Stmts {
  if (!_stmts) {
    _stmts = {
      insert: db.prepare(
        `INSERT INTO approval_batches (id, workspace_id, site_id, name, items, status, created_at, updated_at)
         VALUES (@id, @workspace_id, @site_id, @name, @items, @status, @created_at, @updated_at)`,
      ),
      selectByWorkspace: db.prepare(
        `SELECT * FROM approval_batches WHERE workspace_id = ?`,
      ),
      selectById: db.prepare(
        `SELECT * FROM approval_batches WHERE id = ? AND workspace_id = ?`,
      ),
      update: db.prepare(
        `UPDATE approval_batches SET items = @items, status = @status, updated_at = @updated_at WHERE id = @id`,
      ),
      deleteById: db.prepare(
        `DELETE FROM approval_batches WHERE id = ? AND workspace_id = ?`,
      ),
    };
  }
  return _stmts;
}

function rowToBatch(row: BatchRow): ApprovalBatch {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    name: row.name,
    items: JSON.parse(row.items),
    status: row.status as ApprovalBatch['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createBatch(
  workspaceId: string,
  siteId: string,
  name: string,
  items: Omit<ApprovalItem, 'id' | 'status' | 'createdAt' | 'updatedAt'>[]
): ApprovalBatch {
  const now = new Date().toISOString();
  const batch: ApprovalBatch = {
    id: `ab_${randomUUID().slice(0, 8)}`,
    workspaceId,
    siteId,
    name,
    items: items.map(item => ({
      ...item,
      id: `ai_${randomUUID().slice(0, 8)}`,
      status: 'pending' as const,
      createdAt: now,
      updatedAt: now,
    })),
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
  stmts().insert.run({
    id: batch.id,
    workspace_id: workspaceId,
    site_id: siteId,
    name,
    items: JSON.stringify(batch.items),
    status: batch.status,
    created_at: now,
    updated_at: now,
  });
  return batch;
}

export function listBatches(workspaceId: string): ApprovalBatch[] {
  const rows = stmts().selectByWorkspace.all(workspaceId) as BatchRow[];
  return rows.map(rowToBatch);
}

export function getBatch(workspaceId: string, batchId: string): ApprovalBatch | undefined {
  const row = stmts().selectById.get(batchId, workspaceId) as BatchRow | undefined;
  return row ? rowToBatch(row) : undefined;
}

export function updateItem(
  workspaceId: string,
  batchId: string,
  itemId: string,
  update: Partial<Pick<ApprovalItem, 'status' | 'clientValue' | 'clientNote'>>
): ApprovalBatch | null {
  const batch = getBatch(workspaceId, batchId);
  if (!batch) return null;
  const item = batch.items.find(i => i.id === itemId);
  if (!item) return null;

  Object.assign(item, update, { updatedAt: new Date().toISOString() });

  // Recalculate batch status
  const statuses = batch.items.map(i => i.status);
  if (statuses.every(s => s === 'applied')) batch.status = 'applied';
  else if (statuses.every(s => s === 'approved' || s === 'applied')) batch.status = 'approved';
  else if (statuses.some(s => s === 'approved')) batch.status = 'partial';
  else batch.status = 'pending';

  batch.updatedAt = new Date().toISOString();
  stmts().update.run({
    id: batch.id,
    items: JSON.stringify(batch.items),
    status: batch.status,
    updated_at: batch.updatedAt,
  });
  return batch;
}

export function markBatchApplied(workspaceId: string, batchId: string, itemIds: string[]): ApprovalBatch | null {
  const batch = getBatch(workspaceId, batchId);
  if (!batch) return null;

  for (const item of batch.items) {
    if (itemIds.includes(item.id)) {
      item.status = 'applied';
      item.updatedAt = new Date().toISOString();
    }
  }

  const statuses = batch.items.map(i => i.status);
  if (statuses.every(s => s === 'applied')) batch.status = 'applied';
  batch.updatedAt = new Date().toISOString();
  stmts().update.run({
    id: batch.id,
    items: JSON.stringify(batch.items),
    status: batch.status,
    updated_at: batch.updatedAt,
  });
  return batch;
}

export function deleteBatch(workspaceId: string, batchId: string): boolean {
  const info = stmts().deleteById.run(batchId, workspaceId);
  return info.changes > 0;
}
