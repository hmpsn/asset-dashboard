// ── Fix catalog ─────────────────────────────────────────────────
//
// The single source of truth for client-facing "Fix this — $X" pricing on the
// Health tab. Encodes MONETIZATION.md's existing technical-SEO numbers
// ($20/page meta, $39/page schema, $19/redirect, $50 flat alt-text; Metadata
// Pack $179/10pg, Schema Pack $299/10pg). Alt-text has NO pack — it is always a
// flat full-site charge regardless of how many images need alt text.
//
// CROSS-LANE CONTRACT (HealthTab UI lane codes against `FIX_CATALOG`'s shape —
// do NOT change the value shape without syncing the UI lane):
//   FIX_CATALOG: Record<FixType, {
//     label: string;
//     priceUsd: number;                 // per-page (or flat, for alt-text) display price
//     bundleFamily: BundleFamily;
//     pack?: { size: number; priceUsd: number };
//   }>
//
// The server is the ONLY authority on cart totals (see
// `server/payments/fix-bundle-pricing.ts`). The UI mirrors these prices for
// display but never computes the authoritative checkout amount. A contract test
// (`tests/contract/fix-catalog-checkout-parity.test.ts`) pins the catalog ↔
// checkout-builder mapping so display can never drift from what Stripe charges.

import type { ProductType } from './payments.js';

/** Client-facing fixable-issue families surfaced with a purchase path. */
export type FixType = 'metadata' | 'schema' | 'redirect' | 'alt-text';

/** Bundle family a fix rolls up into for pack pricing. One-to-one with FixType today,
 *  kept as its own union so the server bundle math reads against an explicit concept. */
export type BundleFamily = 'metadata' | 'schema' | 'alt-text' | 'redirects';

/** The contract-frozen catalog entry shape the UI lane codes against. */
export interface FixCatalogEntry {
  label: string;
  /** Per-page price in USD for metadata/schema/redirect; flat full-site price for alt-text. */
  priceUsd: number;
  bundleFamily: BundleFamily;
  /** 10-page pack pricing where the family supports it. Absent for redirect + alt-text. */
  pack?: { size: number; priceUsd: number };
  /** True when the price is a single count-independent flat charge (alt-text only).
   *  The UI renders "$50 flat" instead of "$X/pg" and never shows per-page math. */
  isFlat?: boolean;
}

/**
 * The fix catalog. UI + server both import this; prices here MUST equal the
 * configured Stripe product prices (asserted by the parity contract test).
 */
export const FIX_CATALOG: Record<FixType, FixCatalogEntry> = {
  metadata: {
    label: 'Metadata optimization',
    priceUsd: 20,
    bundleFamily: 'metadata',
    pack: { size: 10, priceUsd: 179 },
  },
  schema: {
    label: 'Schema generation + publishing',
    priceUsd: 39,
    bundleFamily: 'schema',
    pack: { size: 10, priceUsd: 299 },
  },
  redirect: {
    label: 'Redirect fix',
    priceUsd: 19,
    bundleFamily: 'redirects',
    // No pack — redirects are priced strictly per-item.
  },
  'alt-text': {
    label: 'Alt text optimization',
    priceUsd: 50,
    bundleFamily: 'alt-text',
    isFlat: true,
    // No pack — alt-text is ALWAYS a flat full-site charge regardless of count.
  },
};

export const FIX_TYPES = Object.freeze(Object.keys(FIX_CATALOG)) as readonly FixType[];

export function isFixType(value: string): value is FixType {
  return (FIX_TYPES as readonly string[]).includes(value);
}

// ── Stripe product wiring ───────────────────────────────────────
//
// Maps each fix family to the EXISTING Stripe products (server/stripe.ts
// PRODUCT_MAP). The per-page product is what 1–9 items bill against; the pack
// product is what ≥10 items roll into. Kept OUT of `FixCatalogEntry` (the
// contract-frozen shape) so the UI lane never reaches for env-key/product
// identifiers it shouldn't render.
//
// COVERAGE NOTE: alt-text maps to `fix_alt` (a single flat full-site product),
// so `perPageProduct` IS the flat product and `packProduct` is undefined.

export interface FixProductWiring {
  /** Stripe ProductType billed per page (or, for alt-text, the single flat charge). */
  perPageProduct: ProductType;
  /** Stripe ProductType for the 10-page pack, where one exists. */
  packProduct?: ProductType;
}

export const FIX_PRODUCT_WIRING: Record<FixType, FixProductWiring> = {
  metadata: { perPageProduct: 'fix_meta', packProduct: 'fix_meta_10' },
  schema: { perPageProduct: 'schema_page', packProduct: 'schema_10' },
  redirect: { perPageProduct: 'fix_redirect' },
  'alt-text': { perPageProduct: 'fix_alt' },
};

// ── Recommendation type → fix type ──────────────────────────────
//
// Bridges the recommendation engine's `RecType` discriminator to the fix
// catalog so HealthTab rows can decide whether a given rec is purchasable and
// which family it bills under. Only the types with a self-service per-item fix
// product are mapped; everything else (content, performance, technical, …) has
// no entry → no price-tagged CTA (those route to "talk to us"/work-order flows).

export const REC_TYPE_TO_FIX_TYPE: Partial<Record<string, FixType>> = {
  metadata: 'metadata',
  schema: 'schema',
  accessibility: 'alt-text', // alt-text fixes surface as accessibility recs
};

// ── Audit check type → fix type ─────────────────────────────────
//
// Maps the raw `SeoIssue.check` strings (from the audit engine) to the fix
// catalog. This lets the HealthTab rows decide whether a given audit check
// has a purchasable fix path directly from the audit data, without going
// through the recommendations engine.
//
// Only checks that have a clear per-item or flat fix product are listed.
// Unmapped checks have no price-tagged CTA.

export const AUDIT_CHECK_TO_FIX_TYPE: Partial<Record<string, FixType>> = {
  // Metadata family
  title: 'metadata',
  'meta-description': 'metadata',
  h1: 'metadata',
  canonical: 'metadata',
  'og-tags': 'metadata',
  'og-image': 'metadata',
  'duplicate-title': 'metadata',
  'duplicate-description': 'metadata',
  // Schema family
  'structured-data': 'schema',
  'aeo-faq-no-schema': 'schema',
  // Alt-text (flat)
  'img-alt': 'alt-text',
  // Redirects
  'redirect-chains': 'redirect',
};

export function fixTypeForAuditCheck(check: string): FixType | undefined {
  return AUDIT_CHECK_TO_FIX_TYPE[check.toLowerCase()];
}

export function fixTypeForRecType(recType: string): FixType | undefined {
  return REC_TYPE_TO_FIX_TYPE[recType];
}

// ── Impact band (D-IMPACT) ──────────────────────────────────────
//
// The server strips raw `emvPerWeek` from client-facing recommendation payloads
// and replaces it with a banded conservative range. The UI renders this as
// "Est. ~$80–$160/mo at stake" with a methodology "(i)" popover.
//
// `monthlyRangeUsd` is absent when the projected value is below the display floor
// (~$25/mo). The impact line must only render when `monthlyRangeUsd` is present.
//
// Pre-declared shape (R1-A server lane commits the projection; R1-B UI lane codes
// against this):
//   impactBand?: { band: 'low'|'medium'|'high'; monthlyRangeUsd?: [number, number] }

export interface ImpactBand {
  band: 'low' | 'medium' | 'high';
  /** Conservative monthly USD range [lower, upper] — absent when below floor */
  monthlyRangeUsd?: [number, number];
}
