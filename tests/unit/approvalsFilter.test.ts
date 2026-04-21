import { describe, it, expect } from 'vitest';
import type { ApprovalBatch, ApprovalItem } from '../../shared/types/approvals';

function makeItem(status: ApprovalItem['status']): ApprovalItem {
  return {
    id: `id-${Math.random()}`, pageId: 'p1', pageTitle: 'Page', pageSlug: '/page',
    field: 'seoTitle', currentValue: '', proposedValue: '',
    status, createdAt: '', updatedAt: '',
  };
}

function makeBatch(statuses: ApprovalItem['status'][]): ApprovalBatch {
  return {
    id: `batch-${Math.random()}`, workspaceId: 'ws1', siteId: 's1',
    name: 'Test Batch', status: 'pending',
    items: statuses.map(makeItem),
    createdAt: '', updatedAt: '',
  };
}

// "ready" = all decisions made, has approvals, not yet fully applied (mirrors isReady in ApprovalsTab)
function isReady(b: ApprovalBatch) {
  return b.items.length > 0 &&
    !b.items.some(i => i.status === 'pending' || !i.status) &&
    b.items.some(i => i.status === 'approved') &&
    !b.items.every(i => i.status === 'applied'); // every-ok — b.items.length > 0 guard on line above
}

function filterBatches(batches: ApprovalBatch[], filter: string) {
  if (filter === 'needs-action') return batches.filter(b => b.items.some(i => i.status === 'pending' || !i.status));
  if (filter === 'ready') return batches.filter(isReady);
  if (filter === 'applied') return batches.filter(b => b.items.length > 0 && b.items.every(i => i.status === 'applied'));
  return batches;
}

describe('ApprovalsTab filter logic', () => {
  const pending = makeBatch(['pending', 'pending']);
  const approved = makeBatch(['approved', 'approved']);
  const applied = makeBatch(['applied', 'applied']);
  const mixed = makeBatch(['pending', 'approved', 'applied']);

  it('all: returns all batches', () => {
    const result = filterBatches([pending, approved, applied, mixed], 'all');
    expect(result).toHaveLength(4);
  });

  it('needs-action: returns batches with pending items', () => {
    const result = filterBatches([pending, approved, applied, mixed], 'needs-action');
    expect(result).toHaveLength(2);
    expect(result.every(b => b.items.some(i => i.status === 'pending'))).toBe(true); // every-ok — length guarded by toHaveLength(2) above
  });

  it('ready: returns only fully-decided batches that have approvals', () => {
    const result = filterBatches([pending, approved, applied, mixed], 'ready');
    expect(result).toHaveLength(1);
    expect(result[0].items.every(i => i.status === 'approved')).toBe(true); // every-ok — result[0] guaranteed by toHaveLength(1) above
  });

  it('ready: does not return batches that still have pending items', () => {
    const approvedPending = makeBatch(['approved', 'pending']);
    const result = filterBatches([approvedPending], 'ready');
    expect(result).toHaveLength(0);
  });

  it('applied: returns batches where all items are applied', () => {
    const result = filterBatches([pending, approved, applied, mixed], 'applied');
    expect(result).toHaveLength(1);
    expect(result[0].items.every(i => i.status === 'applied')).toBe(true); // every-ok — result[0] guaranteed by toHaveLength(1) above
  });

  it('needs-action: does not return all-approved batches', () => {
    const result = filterBatches([approved], 'needs-action');
    expect(result).toHaveLength(0);
  });
});
