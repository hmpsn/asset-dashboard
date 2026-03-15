/**
 * Bulk-create Stripe Products + Prices from PRODUCT_MAP.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_live_... npx tsx scripts/create-stripe-products.ts
 *
 * For test mode:
 *   STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/create-stripe-products.ts
 *
 * What it does:
 *   1. Reads every product from PRODUCT_MAP
 *   2. Creates a Stripe Product + Price for each (one-time, USD)
 *   3. Prints the env vars you need to add to .env
 *   4. Skips any product whose env key is already set
 *
 * Safe to re-run — it checks existing env vars first.
 */

import Stripe from 'stripe';

const PRODUCT_MAP: Record<string, { displayName: string; category: string; priceUsd: number; envKey: string; recurring?: boolean }> = {
  brief_blog:       { displayName: 'Blog Post Brief',         category: 'brief',    priceUsd: 125,  envKey: 'STRIPE_PRICE_BRIEF' },
  brief_landing:    { displayName: 'Landing Page Brief',      category: 'brief',    priceUsd: 150,  envKey: 'STRIPE_PRICE_BRIEF' },
  brief_service:    { displayName: 'Service Page Brief',      category: 'brief',    priceUsd: 150,  envKey: 'STRIPE_PRICE_BRIEF' },
  brief_location:   { displayName: 'Location Page Brief',     category: 'brief',    priceUsd: 150,  envKey: 'STRIPE_PRICE_BRIEF' },
  brief_product:    { displayName: 'Product Page Brief',      category: 'brief',    priceUsd: 150,  envKey: 'STRIPE_PRICE_BRIEF' },
  brief_pillar:     { displayName: 'Pillar/Hub Page Brief',   category: 'brief',    priceUsd: 200,  envKey: 'STRIPE_PRICE_BRIEF' },
  brief_resource:   { displayName: 'Resource/Guide Brief',    category: 'brief',    priceUsd: 150,  envKey: 'STRIPE_PRICE_BRIEF' },
  post_draft:       { displayName: 'Blog Post — AI Draft',    category: 'content',  priceUsd: 350,  envKey: 'STRIPE_PRICE_POST_DRAFT' },
  post_polished:    { displayName: 'Blog Post — Polished',    category: 'content',  priceUsd: 500,  envKey: 'STRIPE_PRICE_POST_POLISHED' },
  post_premium:     { displayName: 'Blog Post — Premium',     category: 'content',  priceUsd: 1000, envKey: 'STRIPE_PRICE_POST_PREMIUM' },
  schema_page:      { displayName: 'Schema — Per Page',       category: 'schema',   priceUsd: 35,   envKey: 'STRIPE_PRICE_SCHEMA_PAGE' },
  schema_site:      { displayName: 'Schema — Full Site',      category: 'schema',   priceUsd: 350,  envKey: 'STRIPE_PRICE_SCHEMA_SITE' },
  strategy:         { displayName: 'Keyword Strategy',        category: 'strategy', priceUsd: 400,  envKey: 'STRIPE_PRICE_STRATEGY' },
  strategy_refresh: { displayName: 'Strategy Refresh',        category: 'strategy', priceUsd: 200,  envKey: 'STRIPE_PRICE_STRATEGY_REFRESH' },
  plan_growth:      { displayName: 'Growth Plan',             category: 'plan',     priceUsd: 99,   envKey: 'STRIPE_PRICE_PLAN_GROWTH', recurring: true },
  plan_premium:     { displayName: 'Premium Plan',            category: 'plan',     priceUsd: 249,  envKey: 'STRIPE_PRICE_PLAN_PREMIUM', recurring: true },
  // Content subscriptions — recurring monthly
  content_starter:  { displayName: 'Starter Content (2 posts/mo)', category: 'subscription', priceUsd: 500,  envKey: 'STRIPE_PRICE_CONTENT_STARTER', recurring: true },
  content_growth:   { displayName: 'Growth Content (4 posts/mo)',  category: 'subscription', priceUsd: 900,  envKey: 'STRIPE_PRICE_CONTENT_GROWTH',  recurring: true },
  content_scale:    { displayName: 'Scale Content (8 posts/mo)',   category: 'subscription', priceUsd: 1600, envKey: 'STRIPE_PRICE_CONTENT_SCALE',   recurring: true },
};

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error('❌ Set STRIPE_SECRET_KEY env var first.\n   Example: STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/create-stripe-products.ts');
    process.exit(1);
  }

  const isTest = key.startsWith('sk_test_');
  console.log(`\n🔑 Using ${isTest ? 'TEST' : 'LIVE'} mode\n`);

  const stripe = new Stripe(key, { apiVersion: '2024-04-10' as Stripe.LatestApiVersion });

  // Dedupe by envKey — briefs all share one key, so only create one price
  const seen = new Map<string, string>(); // envKey → priceId
  const envLines: string[] = [];

  for (const [productType, config] of Object.entries(PRODUCT_MAP)) {
    // Skip if this envKey was already created in this run
    if (seen.has(config.envKey)) {
      console.log(`  ⏭  ${productType} → shares ${config.envKey} (already created)`);
      continue;
    }

    // Skip if env var is already set
    if (process.env[config.envKey]) {
      console.log(`  ✅ ${config.envKey} already set → ${process.env[config.envKey]}`);
      seen.set(config.envKey, process.env[config.envKey]!);
      continue;
    }

    try {
      // Create product
      const product = await stripe.products.create({
        name: config.displayName,
        metadata: { productType, category: config.category, source: 'asset-dashboard' },
      });

      // Create price (one-time or recurring monthly)
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: config.priceUsd * 100, // cents
        currency: 'usd',
        ...(config.recurring ? { recurring: { interval: 'month' as const } } : {}),
        metadata: { productType },
      });

      seen.set(config.envKey, price.id);
      envLines.push(`${config.envKey}=${price.id}`);
      console.log(`  ✅ ${config.displayName} → ${price.id} ($${config.priceUsd})`);
    } catch (err) {
      console.error(`  ❌ Failed to create ${config.displayName}:`, err instanceof Error ? err.message : err);
    }
  }

  if (envLines.length > 0) {
    console.log('\n────────────────────────────────────────');
    console.log('Add these to your .env file:\n');
    console.log(envLines.join('\n'));
    console.log('\n────────────────────────────────────────\n');
  } else {
    console.log('\n✅ All products already configured. Nothing to create.\n');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
