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

function filterBatches(batches: ApprovalBatch[], filter: string) {
  if (filter === 'needs-action') return batches.filter(b => b.items.some(i => i.status === 'pending' || !i.status));
  if (filter === 'ready') return batches.filter(b => b.items.some(i => i.status === 'approved') && !b.items.some(i => i.status === 'applied'));
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
    expect(result.every(b => b.items.some(i => i.status === 'pending'))).toBe(true);
  });

  it('ready: returns batches with approved items and no applied items', () => {
    const result = filterBatches([pending, approved, applied, mixed], 'ready');
    expect(result).toHaveLength(1);
    expect(result[0].items.every(i => i.status === 'approved')).toBe(true);
  });

  it('applied: returns batches where all items are applied', () => {
    const result = filterBatches([pending, approved, applied, mixed], 'applied');
    expect(result).toHaveLength(1);
    expect(result[0].items.every(i => i.status === 'applied')).toBe(true);
  });

  it('needs-action: does not return all-approved batches', () => {
    const result = filterBatches([approved], 'needs-action');
    expect(result).toHaveLength(0);
  });
});
