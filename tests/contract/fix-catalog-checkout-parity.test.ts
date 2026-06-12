/**
 * CONTRACT: the fix catalog (client display source) must agree with the Stripe
 * products the server actually charges. Price-display drift between the HealthTab
 * catalog and the configured Stripe product is the spec's named risk (§5). This
 * test pins:
 *   1. every FIX_CATALOG per-page price === the mapped Stripe product price
 *   2. every FIX_CATALOG pack price === the mapped pack Stripe product price
 *   3. the bundle math's authoritative total === sum of its own line-item prices
 *      (so the UI mirror and the Stripe charge can never diverge)
 */
import { describe, it, expect } from 'vitest';
import {
  FIX_CATALOG,
  FIX_PRODUCT_WIRING,
  FIX_TYPES,
} from '../../shared/types/fix-catalog.js';
import {
  computeFamilyPricing,
  computeFamilyLineItems,
  fixProductUnitPriceUsd,
} from '../../server/payments/fix-bundle-pricing.js';
import { getProductConfig } from '../../server/stripe.js';

describe('fix catalog ↔ Stripe product parity', () => {
  it('every fix type maps to a real, priced Stripe per-page product', () => {
    for (const fixType of FIX_TYPES) {
      const entry = FIX_CATALOG[fixType];
      const wiring = FIX_PRODUCT_WIRING[fixType];
      const config = getProductConfig(wiring.perPageProduct);
      expect(config, `${fixType} per-page product missing`).not.toBeNull();
      expect(config!.priceUsd, `${fixType} per-page price drift`).toBe(entry.priceUsd);
    }
  });

  it('pack-eligible fix types map to a real, priced Stripe pack product', () => {
    for (const fixType of FIX_TYPES) {
      const entry = FIX_CATALOG[fixType];
      const wiring = FIX_PRODUCT_WIRING[fixType];
      if (!entry.pack) {
        expect(wiring.packProduct, `${fixType} should have no pack product`).toBeUndefined();
        continue;
      }
      const config = getProductConfig(wiring.packProduct!);
      expect(config, `${fixType} pack product missing`).not.toBeNull();
      expect(config!.priceUsd, `${fixType} pack price drift`).toBe(entry.pack.priceUsd);
    }
  });

  it('bundle total equals the sum of its mapped Stripe line-item prices', () => {
    // Exercise a spread of counts per family, including pack thresholds.
    const cases: Array<{ family: 'metadata' | 'schema' | 'redirects' | 'alt-text'; count: number }> = [
      { family: 'metadata', count: 1 },
      { family: 'metadata', count: 9 },
      { family: 'metadata', count: 10 },
      { family: 'metadata', count: 23 },
      { family: 'schema', count: 10 },
      { family: 'schema', count: 27 },
      { family: 'redirects', count: 15 },
      { family: 'alt-text', count: 40 },
    ];
    for (const { family, count } of cases) {
      const pricing = computeFamilyPricing(family, count);
      const lineItems = computeFamilyLineItems(family, count);
      const lineTotal = lineItems.reduce((sum, li) => {
        const unit = fixProductUnitPriceUsd(li.productType);
        expect(unit, `${li.productType} has no unit price`).not.toBeNull();
        return sum + unit! * li.quantity;
      }, 0);
      expect(lineTotal, `${family}×${count} total drift`).toBe(pricing.totalUsd);
    }
  });
});
