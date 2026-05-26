import { describe, expect, it } from 'vitest';
import { approvalItemSchema, approvalItemsArraySchema } from '../../server/schemas/approval-schemas.js';

describe('approval schemas', () => {
  const validItem = {
    id: 'item-1',
    pageId: 'page-1',
    pageTitle: 'Homepage',
    pageSlug: '/home',
    field: 'title',
    currentValue: 'Old title',
    proposedValue: 'New title',
    status: 'pending' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('accepts valid approval items with allowed status values', () => {
    expect(approvalItemSchema.safeParse(validItem).success).toBe(true);
    expect(
      approvalItemSchema.safeParse({ ...validItem, status: 'approved' }).success,
    ).toBe(true);
    expect(
      approvalItemSchema.safeParse({ ...validItem, status: 'rejected' }).success,
    ).toBe(true);
    expect(
      approvalItemSchema.safeParse({ ...validItem, status: 'applied' }).success,
    ).toBe(true);
  });

  it('rejects unknown status enum values', () => {
    const result = approvalItemSchema.safeParse({ ...validItem, status: 'queued' });
    expect(result.success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const { pageId: _omitted, ...withoutPageId } = validItem;
    const result = approvalItemSchema.safeParse(withoutPageId);
    expect(result.success).toBe(false);
  });

  it('validates arrays of approval items', () => {
    const result = approvalItemsArraySchema.safeParse([validItem]);
    expect(result.success).toBe(true);
  });
});
