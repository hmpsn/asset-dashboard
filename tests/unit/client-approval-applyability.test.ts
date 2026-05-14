import { describe, expect, it } from 'vitest';
import type { ApprovalBatch, ApprovalItem } from '../../src/components/client/types';
import { isClientApplyableBatch } from '../../src/components/client/approvalApplyability';

function item(overrides: Partial<ApprovalItem>): ApprovalItem {
  return {
    id: 'item-1',
    pageId: 'page-1',
    pageTitle: 'Page',
    pageSlug: '/page',
    field: 'seoTitle',
    currentValue: 'Current',
    proposedValue: 'Proposed',
    status: 'approved',
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:00.000Z',
    ...overrides,
  };
}

function batch(items: ApprovalItem[]): ApprovalBatch {
  return {
    id: 'batch-1',
    workspaceId: 'ws-1',
    siteId: 'site-1',
    name: 'SEO Changes',
    status: 'approved',
    items,
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:00.000Z',
  };
}

describe('isClientApplyableBatch', () => {
  it('allows static SEO title and description items', () => {
    expect(isClientApplyableBatch(batch([
      item({ field: 'seoTitle' }),
      item({ id: 'item-2', field: 'seoDescription' }),
    ]))).toBe(true);
  });

  it('allows real CMS items with collection identity', () => {
    expect(isClientApplyableBatch(batch([
      item({ pageId: 'item-1', field: 'meta-title', collectionId: 'collection-1' }),
    ]))).toBe(true);
  });

  it('rejects synthetic CMS rows, empty CMS fields, and non-SEO CMS fields', () => {
    expect(isClientApplyableBatch(batch([
      item({ pageId: 'cms-synthetic-/blog/post', field: 'meta-title', collectionId: 'collection-1' }),
    ]))).toBe(false);
    expect(isClientApplyableBatch(batch([
      item({ pageId: 'item-1', field: '', collectionId: 'collection-1' }),
    ]))).toBe(false);
    expect(isClientApplyableBatch(batch([
      item({ pageId: 'item-1', field: 'slug', collectionId: 'collection-1' }),
    ]))).toBe(false);
  });

  it('rejects non-SEO static fields and empty batches', () => {
    expect(isClientApplyableBatch(batch([item({ field: 'name' })]))).toBe(false);
    expect(isClientApplyableBatch(batch([]))).toBe(false);
  });
});
