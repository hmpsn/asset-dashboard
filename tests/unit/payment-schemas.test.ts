import { describe, expect, it } from 'vitest';
import { cartItemSchema, cartItemsArraySchema } from '../../server/schemas/payment-schemas.js';

describe('payment schemas', () => {
  it('accepts valid cart item arrays', () => {
    const result = cartItemsArraySchema.safeParse([
      {
        productType: 'seo_fix',
        pageIds: ['page-1', 'page-2'],
        issueChecks: ['title', 'meta_description'],
        quantity: 2,
      },
      {
        productType: 'content_plan',
      },
    ]);

    expect(result.success).toBe(true);
  });

  it('rejects cart items with invalid array element types', () => {
    const result = cartItemsArraySchema.safeParse([
      {
        productType: 'seo_fix',
        pageIds: ['page-1', 2],
      },
    ]);

    expect(result.success).toBe(false);
  });

  it('preserves unknown fields via passthrough behavior', () => {
    const result = cartItemSchema.safeParse({
      productType: 'seo_fix',
      customMetadata: 'retain-me',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customMetadata).toBe('retain-me');
    }
  });
});
