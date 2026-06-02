import { describe, expect, it } from 'vitest';
import type { ClientDeliverableItem } from '../../shared/types/client-deliverable';
import {
  isClientApplyableDeliverableBatch,
  isClientApplyableDeliverableItem,
  isClientApplyableFields,
} from '../../shared/applyability';

/**
 * R3b — the SHARED applyability predicate (shared/applyability.ts) on `ClientDeliverableItem` shapes.
 * This predicate must mirror the LEGACY ROUTE GATE (field/targetRef/collectionId), NOT the per-item
 * `applyable` column — the documented divergence (D-apply hardcodes `applyable:false` for the whole
 * approval family, but R3b applies through the proven legacy /apply route which ignores that column).
 */
function item(overrides: Partial<ClientDeliverableItem>): ClientDeliverableItem {
  return {
    id: 'di-1',
    deliverableId: 'd-1',
    status: 'approved',
    targetRef: 'page-1',
    collectionId: null,
    field: 'seoTitle',
    currentValue: 'Current',
    proposedValue: 'Proposed',
    clientValue: null,
    clientNote: null,
    applyable: false, // the whole approval family is hardcoded false under D-apply
    itemPayload: null,
    sortOrder: 0,
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('isClientApplyableDeliverableBatch', () => {
  it('allows static seoTitle / seoDescription items', () => {
    expect(isClientApplyableDeliverableBatch([
      item({ field: 'seoTitle' }),
      item({ id: 'di-2', field: 'seoDescription' }),
    ])).toBe(true);
  });

  it('rejects CMS structural fields (name / slug)', () => {
    expect(isClientApplyableDeliverableBatch([
      item({ targetRef: 'real-cms-1', field: 'name', collectionId: 'coll-1' }),
    ])).toBe(false);
    expect(isClientApplyableDeliverableBatch([
      item({ targetRef: 'real-cms-1', field: 'slug', collectionId: 'coll-1' }),
    ])).toBe(false);
  });

  it('allows real CMS items with other (SEO) fields', () => {
    expect(isClientApplyableDeliverableBatch([
      item({ targetRef: 'real-cms-1', field: 'meta-title', collectionId: 'coll-1' }),
    ])).toBe(true);
  });

  it('rejects synthetic cms- targetRef', () => {
    expect(isClientApplyableDeliverableBatch([
      item({ targetRef: 'cms-synthetic-/blog/post', field: 'seoTitle', collectionId: 'coll-1' }),
    ])).toBe(false);
  });

  it('rejects null field', () => {
    expect(isClientApplyableDeliverableBatch([item({ field: null })])).toBe(false);
  });

  it('rejects empty batches', () => {
    expect(isClientApplyableDeliverableBatch([])).toBe(false);
  });

  it('rejects a mixed batch with one non-applyable item (every-item gate)', () => {
    expect(isClientApplyableDeliverableBatch([
      item({ id: 'di-a', field: 'seoTitle' }),
      item({ id: 'di-b', targetRef: 'real-cms-1', field: 'slug', collectionId: 'coll-1' }),
    ])).toBe(false);
  });

  it('DOCUMENTED DIVERGENCE: applyable:false items still yield canApply=true (mirrors the route, not the column)', () => {
    // Every approval-family item is born applyable:false (D-apply). R3b applies through the legacy
    // route, which gates on field/targetRef/collectionId — so these are STILL client-applyable.
    const items = [item({ field: 'seoTitle', applyable: false })];
    expect(items.every((i) => i.applyable)).toBe(false); // every-ok — items is a non-empty literal; confirms the precondition
    expect(isClientApplyableDeliverableBatch(items)).toBe(true);
  });
});

describe('isClientApplyableDeliverableItem / isClientApplyableFields', () => {
  it('item predicate delegates to the fields predicate', () => {
    expect(isClientApplyableDeliverableItem(item({ field: 'seoTitle' }))).toBe(true);
    expect(isClientApplyableDeliverableItem(item({ field: 'name', targetRef: 'c', collectionId: 'coll-1' }))).toBe(false);
  });

  it('fields predicate matches the legacy route gate', () => {
    expect(isClientApplyableFields({ field: 'seoTitle', targetRef: 'page-1', collectionId: null })).toBe(true);
    expect(isClientApplyableFields({ field: 'seoDescription', targetRef: 'page-1', collectionId: null })).toBe(true);
    expect(isClientApplyableFields({ field: 'name', targetRef: 'page-1', collectionId: null })).toBe(false);
    expect(isClientApplyableFields({ field: 'seoTitle', targetRef: 'cms-x', collectionId: null })).toBe(false);
    expect(isClientApplyableFields({ field: null, targetRef: 'page-1', collectionId: null })).toBe(false);
  });
});
