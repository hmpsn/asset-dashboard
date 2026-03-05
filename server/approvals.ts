import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const DATA_BASE = process.env.DATA_DIR
  || (process.env.NODE_ENV === 'production' ? '/tmp/asset-dashboard' : '');
const APPROVALS_DIR = DATA_BASE
  ? path.join(DATA_BASE, 'approvals')
  : path.join(process.env.HOME || '', 'toUpload', 'approvals');

fs.mkdirSync(APPROVALS_DIR, { recursive: true });

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

function batchFile(workspaceId: string): string {
  return path.join(APPROVALS_DIR, `${workspaceId}.json`);
}

function readBatches(workspaceId: string): ApprovalBatch[] {
  try {
    const file = batchFile(workspaceId);
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
  } catch { /* ignore */ }
  return [];
}

function writeBatches(workspaceId: string, batches: ApprovalBatch[]) {
  fs.writeFileSync(batchFile(workspaceId), JSON.stringify(batches, null, 2));
}

export function createBatch(
  workspaceId: string,
  siteId: string,
  name: string,
  items: Omit<ApprovalItem, 'id' | 'status' | 'createdAt' | 'updatedAt'>[]
): ApprovalBatch {
  const batches = readBatches(workspaceId);
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
  batches.unshift(batch);
  writeBatches(workspaceId, batches);
  return batch;
}

export function listBatches(workspaceId: string): ApprovalBatch[] {
  return readBatches(workspaceId);
}

export function getBatch(workspaceId: string, batchId: string): ApprovalBatch | undefined {
  return readBatches(workspaceId).find(b => b.id === batchId);
}

export function updateItem(
  workspaceId: string,
  batchId: string,
  itemId: string,
  update: Partial<Pick<ApprovalItem, 'status' | 'clientValue' | 'clientNote'>>
): ApprovalBatch | null {
  const batches = readBatches(workspaceId);
  const batch = batches.find(b => b.id === batchId);
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
  writeBatches(workspaceId, batches);
  return batch;
}

export function markBatchApplied(workspaceId: string, batchId: string, itemIds: string[]): ApprovalBatch | null {
  const batches = readBatches(workspaceId);
  const batch = batches.find(b => b.id === batchId);
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
  writeBatches(workspaceId, batches);
  return batch;
}

export function deleteBatch(workspaceId: string, batchId: string): boolean {
  const batches = readBatches(workspaceId);
  const idx = batches.findIndex(b => b.id === batchId);
  if (idx === -1) return false;
  batches.splice(idx, 1);
  writeBatches(workspaceId, batches);
  return true;
}
