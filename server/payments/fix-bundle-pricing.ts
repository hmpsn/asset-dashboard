/**
 * SERVER-AUTHORITATIVE bundle math for SEO fixes.
 *
 * This module is the single source of truth for what a cart of fixes costs and
 * how it maps onto Stripe line items. The Health-tab cart UI mirrors these
 * numbers for display but NEVER computes the authoritative checkout total — a
 * contract test (`tests/contract/fix-catalog-checkout-parity.test.ts`) pins the
 * catalog prices to these computations so display can't drift from Stripe.
 *
 * Pricing rules (MONETIZATION.md §233):
 *   - metadata/schema: 1–9 → per-page rate; ≥10 → whole 10-page pack(s) for the
 *     round portion + per-page remainder ("buy multiple packs" for >10).
 *   - redirects: per-item only, no pack.
 *   - alt-text: ALWAYS one flat full-site charge, count-independent.
 */
import {
  FIX_CATALOG,
  FIX_PRODUCT_WIRING,
  type BundleFamily,
  type FixType,
} from '../../shared/types/fix-catalog.js';
import type { ProductType } from '../../shared/types/payments.js';

/** Reverse map: a bundle family back to its catalog FixType key. */
const FAMILY_TO_FIX_TYPE: Record<BundleFamily, FixType> = {
  metadata: 'metadata',
  schema: 'schema',
  redirects: 'redirect',
  'alt-text': 'alt-text',
};

/**
 * Map a Stripe ProductType back to its bundle family + how many "pages" one unit
 * of that product represents (the pack product counts as `pack.size` pages, the
 * per-page product as 1, alt-text's flat product as 1). Returns null for any
 * non-fix product so callers can pass those through untouched.
 *
 * This is what makes the server authoritative: a client cart split across
 * `fix_meta_10` + `fix_meta` is normalized back into a single page count and
 * re-bundled, so the client can never construct a cheaper-than-correct split.
 */
export function fixProductToFamilyPages(
  productType: ProductType,
): { family: BundleFamily; pages: number } | null {
  for (const fixType of Object.keys(FIX_PRODUCT_WIRING) as FixType[]) {
    const wiring = FIX_PRODUCT_WIRING[fixType];
    const entry = FIX_CATALOG[fixType];
    if (productType === wiring.perPageProduct) {
      // For alt-text the "per-page" product is the flat product; one unit = the
      // whole flat charge, which we represent as 1 page (count-independent downstream).
      return { family: entry.bundleFamily, pages: 1 };
    }
    if (wiring.packProduct && productType === wiring.packProduct) {
      return { family: entry.bundleFamily, pages: entry.pack?.size ?? 1 };
    }
  }
  return null;
}

export interface FamilyPricing {
  family: BundleFamily;
  count: number;
  /** Number of 10-page packs applied (0 for per-item-only / flat families). */
  packs: number;
  /** Items billed at the per-page rate after packs are taken out.
   *  For alt-text this is 1 (the single flat line) when count > 0, else 0. */
  perPageRemainder: number;
  /** Authoritative total in whole USD. */
  totalUsd: number;
}

export interface FixLineItem {
  productType: ProductType;
  quantity: number;
}

/** Whole-USD unit price for a fix Stripe product (per-page rate, pack price, or flat). */
export function fixProductUnitPriceUsd(productType: ProductType): number | null {
  for (const fixType of Object.keys(FIX_PRODUCT_WIRING) as FixType[]) {
    const wiring = FIX_PRODUCT_WIRING[fixType];
    const entry = FIX_CATALOG[fixType];
    if (productType === wiring.perPageProduct) return entry.priceUsd;
    if (wiring.packProduct && productType === wiring.packProduct) return entry.pack?.priceUsd ?? entry.priceUsd;
  }
  return null;
}

/**
 * Compute the authoritative price for `count` fixes of one family.
 * Returns zeroed pricing for `count <= 0`.
 */
export function computeFamilyPricing(family: BundleFamily, count: number): FamilyPricing {
  const fixType = FAMILY_TO_FIX_TYPE[family];
  const entry = FIX_CATALOG[fixType];

  if (count <= 0) {
    return { family, count: 0, packs: 0, perPageRemainder: 0, totalUsd: 0 };
  }

  // Alt-text is always a single flat full-site charge regardless of count.
  if (family === 'alt-text') {
    return { family, count, packs: 0, perPageRemainder: 1, totalUsd: entry.priceUsd };
  }

  // Pack-eligible families (metadata, schema): take whole packs out of the round
  // portion at/above the pack size, bill the remainder per-page.
  if (entry.pack && count >= entry.pack.size) {
    const packs = Math.floor(count / entry.pack.size);
    const perPageRemainder = count - packs * entry.pack.size;
    const totalUsd = packs * entry.pack.priceUsd + perPageRemainder * entry.priceUsd;
    return { family, count, packs, perPageRemainder, totalUsd };
  }

  // Per-item only (redirects, or pack-eligible families below the pack threshold).
  return { family, count, packs: 0, perPageRemainder: count, totalUsd: count * entry.priceUsd };
}

/** A cart item as received from the client (productType + quantity + optional page context). */
export interface IncomingCartItem {
  productType: ProductType;
  quantity: number;
  pageIds?: string[];
  issueChecks?: string[];
}

/** A normalized cart item the server will actually bill + fulfill. */
export interface NormalizedCartItem {
  productType: ProductType;
  quantity: number;
  pageIds?: string[];
  issueChecks?: string[];
}

/**
 * Normalize a raw client cart into the SERVER-AUTHORITATIVE set of line items.
 *
 * Fix-family products are aggregated by family (collapsing any client split of
 * pack vs per-page) and re-bundled via the bundle math. Non-fix products pass
 * through unchanged. `pageIds` / `issueChecks` for a fix family are merged and
 * carried onto the re-bundled items so post-checkout work orders still know
 * which pages to fix.
 */
export function normalizeFixCart(items: IncomingCartItem[]): NormalizedCartItem[] {
  const familyPages = new Map<BundleFamily, number>();
  const familyPageIds = new Map<BundleFamily, string[]>();
  const familyIssueChecks = new Map<BundleFamily, string[]>();
  const passthrough: NormalizedCartItem[] = [];

  for (const item of items) {
    const mapped = fixProductToFamilyPages(item.productType);
    if (!mapped) {
      passthrough.push({ ...item });
      continue;
    }
    const qty = Math.max(0, Math.floor(item.quantity));
    familyPages.set(mapped.family, (familyPages.get(mapped.family) ?? 0) + mapped.pages * qty);
    if (item.pageIds?.length) {
      familyPageIds.set(mapped.family, [...(familyPageIds.get(mapped.family) ?? []), ...item.pageIds]);
    }
    if (item.issueChecks?.length) {
      familyIssueChecks.set(mapped.family, [...(familyIssueChecks.get(mapped.family) ?? []), ...item.issueChecks]);
    }
  }

  const normalized: NormalizedCartItem[] = [...passthrough];
  for (const [family, pages] of familyPages) {
    const lineItems = computeFamilyLineItems(family, pages);
    const pageIds = familyPageIds.get(family);
    const issueChecks = familyIssueChecks.get(family);
    for (const li of lineItems) {
      normalized.push({
        productType: li.productType,
        quantity: li.quantity,
        ...(pageIds?.length ? { pageIds } : {}),
        ...(issueChecks?.length ? { issueChecks } : {}),
      });
    }
  }
  return normalized;
}

/**
 * Map `count` fixes of one family onto Stripe line items (pack product +
 * per-page product). Empty for `count <= 0`.
 */
export function computeFamilyLineItems(family: BundleFamily, count: number): FixLineItem[] {
  const fixType = FAMILY_TO_FIX_TYPE[family];
  const wiring = FIX_PRODUCT_WIRING[fixType];
  const pricing = computeFamilyPricing(family, count);

  if (pricing.count <= 0) return [];

  // Alt-text: a single flat line item.
  if (family === 'alt-text') {
    return [{ productType: wiring.perPageProduct, quantity: 1 }];
  }

  const items: FixLineItem[] = [];
  if (pricing.packs > 0 && wiring.packProduct) {
    items.push({ productType: wiring.packProduct, quantity: pricing.packs });
  }
  if (pricing.perPageRemainder > 0) {
    items.push({ productType: wiring.perPageProduct, quantity: pricing.perPageRemainder });
  }
  return items;
}
