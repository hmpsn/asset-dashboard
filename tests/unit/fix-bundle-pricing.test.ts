/**
 * Unit tests for server/payments/fix-bundle-pricing.ts — the SERVER-AUTHORITATIVE
 * bundle math for SEO fixes. The cart UI mirrors these numbers but never computes
 * the checkout total; this function is the single source of truth.
 *
 * MONETIZATION.md §233:
 *   - 1–9 pages: per-page rate ($20 meta, $39 schema, $19 redirect)
 *   - 10+ pages: pack pricing — buy whole 10-page pack(s) for the round portion,
 *     remainder billed per-page (Metadata Pack $179/10pg, Schema Pack $299/10pg)
 *   - Alt text: ALWAYS flat $50 full-site regardless of count
 *   - Redirects: no pack — always per-item
 */
import { describe, it, expect } from 'vitest';
import { computeFamilyPricing, computeFamilyLineItems } from '../../server/payments/fix-bundle-pricing.js';

describe('computeFamilyPricing — metadata (per-page $20, pack $179/10)', () => {
  it('1 item → 1 × $20 = $20', () => {
    expect(computeFamilyPricing('metadata', 1).totalUsd).toBe(20);
  });
  it('9 items → 9 × $20 = $180 (still cheaper to NOT pack at 9)', () => {
    expect(computeFamilyPricing('metadata', 9).totalUsd).toBe(180);
  });
  it('10 items → 1 pack = $179 (saves $21 vs 10×$20)', () => {
    const r = computeFamilyPricing('metadata', 10);
    expect(r.totalUsd).toBe(179);
    expect(r.packs).toBe(1);
    expect(r.perPageRemainder).toBe(0);
  });
  it('23 items → 2 packs + 3 per-page = $179×2 + $20×3 = $418', () => {
    const r = computeFamilyPricing('metadata', 23);
    expect(r.packs).toBe(2);
    expect(r.perPageRemainder).toBe(3);
    expect(r.totalUsd).toBe(179 * 2 + 20 * 3);
  });
});

describe('computeFamilyPricing — schema (per-page $39, pack $299/10)', () => {
  it('9 items → 9 × $39 = $351', () => {
    expect(computeFamilyPricing('schema', 9).totalUsd).toBe(351);
  });
  it('10 items → 1 pack = $299', () => {
    const r = computeFamilyPricing('schema', 10);
    expect(r.totalUsd).toBe(299);
    expect(r.packs).toBe(1);
  });
  it('23 items → 2 packs + 3 per-page = $299×2 + $39×3 = $715', () => {
    const r = computeFamilyPricing('schema', 23);
    expect(r.totalUsd).toBe(299 * 2 + 39 * 3);
  });
});

describe('computeFamilyPricing — redirects (per-item $19, NO pack)', () => {
  it('1 → $19', () => {
    expect(computeFamilyPricing('redirects', 1).totalUsd).toBe(19);
  });
  it('15 → 15 × $19 = $285 (never packs)', () => {
    const r = computeFamilyPricing('redirects', 15);
    expect(r.totalUsd).toBe(19 * 15);
    expect(r.packs).toBe(0);
    expect(r.perPageRemainder).toBe(15);
  });
});

describe('computeFamilyPricing — alt-text (flat $50, count-independent)', () => {
  it('1 → $50', () => {
    expect(computeFamilyPricing('alt-text', 1).totalUsd).toBe(50);
  });
  it('50 → still $50 (flat full-site)', () => {
    const r = computeFamilyPricing('alt-text', 50);
    expect(r.totalUsd).toBe(50);
    expect(r.packs).toBe(0);
    expect(r.perPageRemainder).toBe(1); // one flat line item
  });
});

describe('computeFamilyPricing — guards', () => {
  it('count ≤ 0 → $0, no line items', () => {
    expect(computeFamilyPricing('metadata', 0).totalUsd).toBe(0);
  });
});

describe('computeFamilyLineItems — maps to Stripe products', () => {
  it('metadata 23 → [fix_meta_10 ×2, fix_meta ×3]', () => {
    const items = computeFamilyLineItems('metadata', 23);
    const pack = items.find(i => i.productType === 'fix_meta_10');
    const per = items.find(i => i.productType === 'fix_meta');
    expect(pack?.quantity).toBe(2);
    expect(per?.quantity).toBe(3);
  });
  it('schema 10 → [schema_10 ×1] only (no per-page remainder line)', () => {
    const items = computeFamilyLineItems('schema', 10);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ productType: 'schema_10', quantity: 1 });
  });
  it('redirects 15 → [fix_redirect ×15]', () => {
    const items = computeFamilyLineItems('redirects', 15);
    expect(items).toEqual([{ productType: 'fix_redirect', quantity: 15 }]);
  });
  it('alt-text 40 → [fix_alt ×1] (flat, ignores count)', () => {
    const items = computeFamilyLineItems('alt-text', 40);
    expect(items).toEqual([{ productType: 'fix_alt', quantity: 1 }]);
  });
});
