/**
 * Unit tests for packUpsellForItem — the SEO cart pack-upsell math.
 *
 * Regression (feat/client-revenue-r1 §5): the drawer showed "save $-39" at
 * qty 7–8 because it fired at quantity >= 7 with hard-coded math. The upsell
 * must only appear when buying the pack actually saves money, with the
 * breakeven derived from the catalog (metadata: 9, schema: 8).
 */
import { describe, it, expect } from 'vitest';
import { packUpsellForItem } from '../../src/components/client/seoCartUpsell';
import { FIX_CATALOG } from '../../shared/types/fix-catalog';

describe('packUpsellForItem — metadata (fix_meta, $20/pg, $179/10)', () => {
  it('returns null at qty 7 (per-page $140 < $179 — would be negative savings)', () => {
    expect(packUpsellForItem('fix_meta', 7)).toBeNull();
  });

  it('returns null at qty 8 ($160 < $179)', () => {
    expect(packUpsellForItem('fix_meta', 8)).toBeNull();
  });

  it('returns positive savings at qty 9 ($180 > $179 → save $1)', () => {
    const upsell = packUpsellForItem('fix_meta', 9);
    expect(upsell).not.toBeNull();
    expect(upsell!.savings).toBe(1);
    expect(upsell!.packPrice).toBe(179);
    expect(upsell!.packSize).toBe(10);
  });

  it('returns null at qty 10 (at pack size — just buy the pack)', () => {
    expect(packUpsellForItem('fix_meta', 10)).toBeNull();
  });
});

describe('packUpsellForItem — schema (schema_page, $39/pg, $299/10)', () => {
  it('returns null at qty 7 ($273 < $299)', () => {
    expect(packUpsellForItem('schema_page', 7)).toBeNull();
  });

  it('returns positive savings at qty 8 ($312 > $299 → save $13)', () => {
    const upsell = packUpsellForItem('schema_page', 8);
    expect(upsell).not.toBeNull();
    expect(upsell!.savings).toBe(13);
    expect(upsell!.packPrice).toBe(299);
  });
});

describe('packUpsellForItem — no-pack products', () => {
  it('returns null for fix_redirect (no pack)', () => {
    expect(packUpsellForItem('fix_redirect', 5)).toBeNull();
  });

  it('returns null for fix_alt (flat, no pack)', () => {
    expect(packUpsellForItem('fix_alt', 5)).toBeNull();
  });

  it('returns null for a non-fix product', () => {
    expect(packUpsellForItem('brief_blog', 5)).toBeNull();
  });
});

describe('packUpsellForItem — never reports a non-positive saving', () => {
  it('every reported savings across all quantities is strictly positive', () => {
    for (const fixType of Object.keys(FIX_CATALOG) as Array<keyof typeof FIX_CATALOG>) {
      const entry = FIX_CATALOG[fixType];
      if (!entry.pack) continue;
      const product = fixType === 'metadata' ? 'fix_meta' : fixType === 'schema' ? 'schema_page' : null;
      if (!product) continue;
      for (let qty = 1; qty < entry.pack.size; qty++) {
        const upsell = packUpsellForItem(product, qty);
        if (upsell) expect(upsell.savings).toBeGreaterThan(0);
      }
    }
  });
});
