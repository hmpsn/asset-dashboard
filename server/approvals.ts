import { randomUUID } from 'crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';

export type { ApprovalItem, ApprovalBatch } from '../shared/types/approvals.ts';
import type { ApprovalItem, ApprovalBatch } from '../shared/types/approvals.ts';
import { parseJsonFallback } from './db/json-validation.js';
import { approvalItemSchema } from './schemas/approval-schemas.js';
import { createLogger } from './logger.js';
import { validateTransition, APPROVAL_ITEM_TRANSITIONS } from './state-machines.js';
import { invalidateIntelligenceCache } from './intelligence/cache-invalidation.js';
import { invalidateMonthlyDigestCache } from './monthly-digest-cache.js';

const log = createLogger('approvals');

// ── SQLite row shape ──

interface BatchRow {
  id: string;
  workspace_id: string;
  site_id: string;
  name: string;
  items: string;
  status: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

const stmts = createStmtCache(() => ({
  insert: db.prepare(
    `INSERT INTO approval_batches (id, workspace_id, site_id, name, items, status, note, created_at, updated_at)
         VALUES (@id, @workspace_id, @site_id, @name, @items, @status, @note, @created_at, @updated_at)`,
  ),
  selectByWorkspace: db.prepare(
    // ORDER BY parity with selectByWorkspacePaged — unpaged and paged reads must
    // return rows in the same order (newest first) so callers see a stable order.
    `SELECT * FROM approval_batches WHERE workspace_id = ? ORDER BY created_at DESC`,
  ),
  selectByWorkspacePaged: db.prepare(
    `SELECT * FROM approval_batches WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ),
  countByWorkspace: db.prepare(
    `SELECT COALESCE(COUNT(*), 0) AS cnt FROM approval_batches WHERE workspace_id = ?`,
  ),
  selectById: db.prepare(
    `SELECT * FROM approval_batches WHERE id = ? AND workspace_id = ?`,
  ),
  update: db.prepare(
    // status-ok: approval_batches.status is a DERIVED aggregate of item statuses (recomputed in recalcBatchStatus, lines ~189-197), NOT an independent lifecycle. The guarded machine is the ITEM transition (validateTransition + APPROVAL_ITEM_TRANSITIONS, line ~177). Census verdict: aggregation, not a state machine (docs/rules/lifecycle-state-machines.md).
    `UPDATE approval_batches SET items = @items, status = @status, updated_at = @updated_at WHERE id = @id AND workspace_id = @workspace_id`,
  ),
  deleteById: db.prepare(
    `DELETE FROM approval_batches WHERE id = ? AND workspace_id = ?`,
  ),
}));

function rowToBatch(row: BatchRow): ApprovalBatch {
  const rawItems = parseJsonFallback<unknown[]>(row.items, []);
  let healed = false;
  let dropped = 0;
  const items: ApprovalItem[] = [];
  for (const raw of rawItems) {
    if (typeof raw !== 'object' || raw === null) { dropped++; continue; }
    const obj = raw as Record<string, unknown>;
    // Heal missing status from historical Object.assign bug
    if (!obj.status) { obj.status = 'pending'; healed = true; }
    const result = approvalItemSchema.safeParse(obj);
    if (result.success) items.push(result.data as ApprovalItem);
    else dropped++;
  }
  if (dropped > 0) {
    log.warn({ batchId: row.id, workspaceId: row.workspace_id, dropped, total: rawItems.length }, 'approval_batches.items: dropped invalid items');
  }
  if (healed) {
    stmts().update.run({ id: row.id, workspace_id: row.workspace_id, items: JSON.stringify(items), status: row.status, updated_at: new Date().toISOString() });
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    name: row.name,
    items,
    status: row.status as ApprovalBatch['status'],
    note: row.note ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createBatch(
  workspaceId: string,
  siteId: string,
  name: string,
  items: Omit<ApprovalItem, 'id' | 'status' | 'createdAt' | 'updatedAt'>[],
  note?: string
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
    note,
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
    note: note ?? null,
    created_at: now,
    updated_at: now,
  });
  invalidateIntelligenceCache(workspaceId);
  return batch;
}

export function listBatches(workspaceId: string): ApprovalBatch[] {
  const rows = stmts().selectByWorkspace.all(workspaceId) as BatchRow[];
  return rows.map(rowToBatch);
}

export interface ListBatchesPagedResult {
  items: ApprovalBatch[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export function listBatchesPaged(
  workspaceId: string,
  limit: number,
  offset: number,
): ListBatchesPagedResult {
  const countRow = stmts().countByWorkspace.get(workspaceId) as { cnt: number };
  const total = Number(countRow.cnt) || 0;
  const rows = stmts().selectByWorkspacePaged.all(workspaceId, limit, offset) as BatchRow[];
  return {
    items: rows.map(rowToBatch),
    total,
    limit,
    offset,
    hasMore: offset + rows.length < total,
  };
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

  // Validate status transition if status is being changed
  if (update.status !== undefined && update.status !== item.status) {
    validateTransition('approval_item', APPROVAL_ITEM_TRANSITIONS, item.status, update.status);
  }

  // Filter out undefined values to prevent overwriting existing fields (e.g. status)
  const defined = Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined));
  Object.assign(item, defined, { updatedAt: new Date().toISOString() });

  recalcBatchStatus(batch);
  invalidateIntelligenceCache(workspaceId);
  return batch;
}

/** Recalculate batch status from item statuses and persist. */
function recalcBatchStatus(batch: ApprovalBatch): void {
  const statuses = batch.items.map(i => i.status);
  // Guard: .every() on empty array returns true vacuously — keep batch pending
  if (statuses.length === 0) { batch.status = 'pending'; }
  else if (statuses.every(s => s === 'applied')) batch.status = 'applied';
  else if (statuses.every(s => s === 'approved' || s === 'applied')) batch.status = 'approved';
  else if (statuses.every(s => s === 'rejected')) batch.status = 'rejected';
  else if (statuses.some(s => s === 'approved' || s === 'rejected' || s === 'applied')) batch.status = 'partial';
  else batch.status = 'pending';

  batch.updatedAt = new Date().toISOString();
  stmts().update.run({
    id: batch.id,
    workspace_id: batch.workspaceId,
    items: JSON.stringify(batch.items),
    status: batch.status,
    updated_at: batch.updatedAt,
  });
}

export function markBatchApplied(workspaceId: string, batchId: string, itemIds: string[]): ApprovalBatch | null {
  const batch = getBatch(workspaceId, batchId);
  if (!batch) return null;

  let applied = 0;
  for (const item of batch.items) {
    if (itemIds.includes(item.id)) {
      // Only approved items may transition to applied
      if (item.status !== 'approved') {
        log.warn({ batchId, itemId: item.id, status: item.status }, 'markBatchApplied: skipping non-approved item');
        continue;
      }
      item.status = 'applied';
      item.updatedAt = new Date().toISOString();
      applied += 1;
    }
  }

  recalcBatchStatus(batch);
  invalidateIntelligenceCache(workspaceId);
  if (applied > 0) invalidateMonthlyDigestCache(workspaceId);
  return batch;
}

export function deleteBatch(workspaceId: string, batchId: string): boolean {
  const info = stmts().deleteById.run(batchId, workspaceId);
  if (info.changes > 0) {
    invalidateIntelligenceCache(workspaceId);
    invalidateMonthlyDigestCache(workspaceId);
  }
  return info.changes > 0;
}
