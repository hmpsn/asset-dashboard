/**
 * Pack-upsell math for the SEO fix cart drawer.
 *
 * The drawer nudges a client toward the 10-page pack only when buying the pack
 * actually SAVES money versus the per-page total at the current quantity. The
 * breakeven is derived from the catalog (per-page price vs pack price), never
 * hard-coded — e.g. the metadata pack ($179) only beats per-page ($20) at 9
 * pages, and schema ($299 vs $39) at 8. Firing earlier showed "save $-39".
 */
import {
  FIX_CATALOG,
  FIX_PRODUCT_WIRING,
  type FixType,
} from '../../../shared/types/fix-catalog.js';
import type { ProductType } from '../../../shared/types/payments.js';

export interface PackUpsell {
  /** Pack price in whole USD. */
  packPrice: number;
  /** Pack size (pages). */
  packSize: number;
  /** Positive USD saved by buying the pack instead of `quantity` per-page items. */
  savings: number;
}

/** Reverse-map a per-page Stripe product to its catalog FixType (if any). */
function fixTypeForPerPageProduct(productType: ProductType): FixType | undefined {
  for (const fixType of Object.keys(FIX_PRODUCT_WIRING) as FixType[]) {
    if (FIX_PRODUCT_WIRING[fixType].perPageProduct === productType) return fixType;
  }
  return undefined;
}

/**
 * Compute the pack upsell for a per-page cart item at the given quantity.
 *
 * Returns null when:
 *  - the product has no pack,
 *  - quantity already meets/exceeds the pack size (no nudge — they'd just buy the pack), or
 *  - buying the pack would NOT save money (savings <= 0).
 */
export function packUpsellForItem(
  productType: ProductType,
  quantity: number,
): PackUpsell | null {
  const fixType = fixTypeForPerPageProduct(productType);
  if (!fixType) return null;

  const entry = FIX_CATALOG[fixType];
  if (!entry.pack) return null;

  const { size: packSize, priceUsd: packPrice } = entry.pack;
  // Only nudge below a full pack — at/over the pack size they should just buy it.
  if (quantity >= packSize) return null;

  const savings = quantity * entry.priceUsd - packPrice;
  if (savings <= 0) return null;

  return { packPrice, packSize, savings };
}
