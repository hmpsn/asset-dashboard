/**
 * Live-Stripe price drift guard.
 *
 * TRUST BOUNDARY: the catalog↔code parity test (tests/contract/
 * fix-catalog-checkout-parity.test.ts) pins FIX_CATALOG to PRODUCT_MAP in code,
 * but it CANNOT see the env-configured Stripe Price objects. If a Stripe Price
 * drifts (e.g. someone edits the price in the Stripe dashboard), the client
 * button says "$20" while Stripe charges "$25" — a silent revenue/UX bug the
 * code-only parity test will never catch.
 *
 * This script closes that gap: it fetches each configured fix Price's
 * `unit_amount` via the Stripe SDK and compares it to the expected whole-USD
 * price in FIX_CATALOG / PRODUCT_MAP. It exits non-zero on any drift so CI (or a
 * pre-release check) fails loudly.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_live_... npx tsx scripts/verify-stripe-prices.ts
 *   npm run verify:stripe-prices
 *
 * Without STRIPE_SECRET_KEY it SKIPS gracefully (exit 0) — local/dev and CI
 * without Stripe creds are not blocked.
 */
import Stripe from 'stripe';
import {
  FIX_CATALOG,
  FIX_PRODUCT_WIRING,
  FIX_TYPES,
} from '../shared/types/fix-catalog.js';
import { getProductConfig } from '../server/stripe.js';
import type { ProductType } from '../shared/types/payments.js';

/**
 * Content products actually BILLED from env-configured Stripe Price IDs. These
 * are the cart-/Buy-now-priced families (R2-E made them cart-addable). The cart
 * + single-purchase flows resolve content to exactly these two products
 * (contentProductType: brief_only → brief_blog, full_post → post_polished), so
 * these are the only content Prices that can be charged and the only ones whose
 * `priceUsd` is guaranteed to match the configured Stripe Price.
 *
 * NOTE: other brief/post entries in PRODUCT_MAP share one env Price
 * (STRIPE_PRICE_BRIEF etc.) but carry display-only priceUsd variants — they are
 * never charged directly, so verifying them here would produce false drift
 * against a single shared Stripe Price. The Premium 10% discount is applied at
 * checkout-BUILD time via an inline price_data override, so the configured Price
 * stays the FULL price and is validated exactly like the fix prices.
 */
const CONTENT_PRICE_PRODUCTS: ProductType[] = [
  'brief_blog', 'post_polished',
];

interface PriceCheck {
  productType: ProductType;
  label: string;
  expectedUsd: number;
  stripePriceId: string;
}

/** Expand the fix catalog into every billed Stripe product (per-page + packs). */
function buildPriceChecks(): { checks: PriceCheck[]; unconfigured: string[] } {
  const checks: PriceCheck[] = [];
  const unconfigured: string[] = [];

  for (const fixType of FIX_TYPES) {
    const entry = FIX_CATALOG[fixType];
    const wiring = FIX_PRODUCT_WIRING[fixType];

    const perPage = getProductConfig(wiring.perPageProduct);
    if (!perPage?.stripePriceId) {
      unconfigured.push(`${fixType} per-page (${wiring.perPageProduct})`);
    } else {
      checks.push({
        productType: wiring.perPageProduct,
        label: `${fixType} per-page`,
        expectedUsd: entry.priceUsd,
        stripePriceId: perPage.stripePriceId,
      });
    }

    if (entry.pack && wiring.packProduct) {
      const pack = getProductConfig(wiring.packProduct);
      if (!pack?.stripePriceId) {
        unconfigured.push(`${fixType} pack (${wiring.packProduct})`);
      } else {
        checks.push({
          productType: wiring.packProduct,
          label: `${fixType} pack`,
          expectedUsd: entry.pack.priceUsd,
          stripePriceId: pack.stripePriceId,
        });
      }
    }
  }

  // Content prices (briefs/posts) — full-price guard (discount is build-time).
  for (const productType of CONTENT_PRICE_PRODUCTS) {
    const config = getProductConfig(productType);
    if (!config?.stripePriceId) {
      unconfigured.push(`content (${productType})`);
      continue;
    }
    checks.push({
      productType,
      label: `content ${productType}`,
      expectedUsd: config.priceUsd,
      stripePriceId: config.stripePriceId,
    });
  }

  return { checks, unconfigured };
}

async function main(): Promise<void> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    console.log('verify:stripe-prices — SKIP (no STRIPE_SECRET_KEY). Set it to verify live prices.');
    process.exit(0);
  }

  const stripe = new Stripe(secretKey, { apiVersion: '2026-02-25.clover' });
  const { checks, unconfigured } = buildPriceChecks();

  if (unconfigured.length > 0) {
    console.log('verify:stripe-prices — the following fix products have no configured Stripe Price (skipped):');
    for (const u of unconfigured) console.log(`  · ${u}`);
  }

  if (checks.length === 0) {
    console.log('verify:stripe-prices — no configured fix prices to verify. Nothing to do.');
    process.exit(0);
  }

  const drifts: string[] = [];

  for (const check of checks) {
    let price: Stripe.Price;
    try {
      price = await stripe.prices.retrieve(check.stripePriceId);
    } catch (err) {
      drifts.push(`${check.label} (${check.productType}): could not retrieve price ${check.stripePriceId} — ${(err as Error).message}`);
      continue;
    }

    if (price.unit_amount == null) {
      drifts.push(`${check.label} (${check.productType}): Stripe price ${check.stripePriceId} has no unit_amount`);
      continue;
    }

    const stripeUsd = price.unit_amount / 100;
    if (stripeUsd !== check.expectedUsd) {
      drifts.push(
        `${check.label} (${check.productType}): catalog $${check.expectedUsd} ≠ Stripe $${stripeUsd} (price ${check.stripePriceId})`,
      );
    } else {
      console.log(`  ✓ ${check.label} (${check.productType}) — $${check.expectedUsd} matches Stripe`);
    }
  }

  if (drifts.length > 0) {
    console.error('\nverify:stripe-prices — PRICE DRIFT DETECTED:');
    for (const d of drifts) console.error(`  ✗ ${d}`);
    console.error('\nThe client button price and the Stripe charge will not match. Fix the Stripe Price or the catalog before releasing.');
    process.exit(1);
  }

  console.log(`\nverify:stripe-prices — OK. ${checks.length} price(s) match the catalog.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('verify:stripe-prices — unexpected error:', err);
  process.exit(1);
});
