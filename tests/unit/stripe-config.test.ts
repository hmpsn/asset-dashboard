/**
 * Unit tests for server/stripe-config.ts — encryption, config CRUD.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  saveStripeKeys,
  getStripeConfig,
  getStripeConfigSafe,
  saveStripeProducts,
  clearStripeConfig,
  getStripeSecretKey,
  getStripeWebhookSecret,
  getStripePublishableKey,
  getStripePriceId,
  type StripeProductPrice,
} from '../../server/stripe-config.js';

// Clean up after all tests
afterEach(() => {
  clearStripeConfig();
});

// ── Encryption / Decryption round-trip ──

describe('saveStripeKeys / getStripeConfig', () => {
  it('encrypts and decrypts secret key round-trip', () => {
    saveStripeKeys('sk_test_abc123', 'whsec_test_xyz', 'pk_test_pub');

    const config = getStripeConfig();
    expect(config).not.toBeNull();
    expect(config!.secretKey).toBe('sk_test_abc123');
    expect(config!.webhookSecret).toBe('whsec_test_xyz');
    expect(config!.publishableKey).toBe('pk_test_pub');
    expect(config!.updatedAt).toBeDefined();
  });

  it('only updates non-empty values', () => {
    saveStripeKeys('sk_original', 'whsec_original', 'pk_original');
    saveStripeKeys('sk_updated'); // only update secretKey

    const config = getStripeConfig();
    expect(config!.secretKey).toBe('sk_updated');
    expect(config!.webhookSecret).toBe('whsec_original');
    expect(config!.publishableKey).toBe('pk_original');
  });

  it('publishable key is NOT encrypted (stored as-is)', () => {
    saveStripeKeys('sk_test', '', 'pk_test_plain');

    const safe = getStripeConfigSafe();
    expect(safe.publishableKey).toBe('pk_test_plain');
  });
});

// ── getStripeConfigSafe ──

describe('getStripeConfigSafe', () => {
  it('returns configured:false when no config exists', () => {
    const safe = getStripeConfigSafe();
    expect(safe.configured).toBe(false);
    expect(safe.hasSecretKey).toBe(false);
    expect(safe.hasWebhookSecret).toBe(false);
  });

  it('returns correct boolean flags when configured', () => {
    saveStripeKeys('sk_test', 'whsec_test');

    const safe = getStripeConfigSafe();
    expect(safe.configured).toBe(true);
    expect(safe.hasSecretKey).toBe(true);
    expect(safe.hasWebhookSecret).toBe(true);
    expect(safe.hasPublishableKey).toBe(false);
  });

  it('does not expose raw keys', () => {
    saveStripeKeys('sk_secret_key', 'whsec_secret');

    const safe = getStripeConfigSafe();
    // The safe response should not contain the actual secret values
    expect(JSON.stringify(safe)).not.toContain('sk_secret_key');
    expect(JSON.stringify(safe)).not.toContain('whsec_secret');
  });
});

// ── saveStripeProducts ──

describe('saveStripeProducts', () => {
  it('saves and retrieves product configurations', () => {
    saveStripeKeys('sk_test'); // Need config to exist first
    const products: StripeProductPrice[] = [
      { productType: 'brief_blog', stripePriceId: 'price_blog', displayName: 'Blog Brief', priceUsd: 125, enabled: true },
      { productType: 'post_draft', stripePriceId: 'price_draft', displayName: 'Draft Post', priceUsd: 350, enabled: false },
    ];

    saveStripeProducts(products);

    const config = getStripeConfig();
    expect(config!.products).toHaveLength(2);
    expect(config!.products[0].productType).toBe('brief_blog');
    expect(config!.products[1].enabled).toBe(false);
  });
});

// ── clearStripeConfig ──

describe('clearStripeConfig', () => {
  it('removes all config', () => {
    saveStripeKeys('sk_to_clear', 'whsec_to_clear');
    clearStripeConfig();

    const config = getStripeConfig();
    expect(config).toBeNull();
  });

  it('is idempotent (no error when config already cleared)', () => {
    clearStripeConfig();
    clearStripeConfig(); // should not throw
  });
});

// ── getStripePriceId ──

describe('getStripePriceId', () => {
  it('returns price ID from on-disk config', () => {
    saveStripeKeys('sk_test');
    saveStripeProducts([
      { productType: 'brief_blog', stripePriceId: 'price_from_disk', displayName: 'Blog', priceUsd: 125, enabled: true },
    ]);

    expect(getStripePriceId('brief_blog', 'STRIPE_PRICE_BRIEF')).toBe('price_from_disk');
  });

  it('skips disabled products', () => {
    saveStripeKeys('sk_test');
    saveStripeProducts([
      { productType: 'brief_blog', stripePriceId: 'price_disabled', displayName: 'Blog', priceUsd: 125, enabled: false },
    ]);

    // Should fall back to env var (empty in test)
    const result = getStripePriceId('brief_blog', 'STRIPE_PRICE_BRIEF_NONEXISTENT');
    expect(result).toBe('');
  });

  it('falls back to env var when no on-disk config', () => {
    const origEnv = process.env.STRIPE_PRICE_TEST;
    process.env.STRIPE_PRICE_TEST = 'price_from_env';

    const result = getStripePriceId('nonexistent_type', 'STRIPE_PRICE_TEST');
    expect(result).toBe('price_from_env');

    if (origEnv !== undefined) process.env.STRIPE_PRICE_TEST = origEnv;
    else delete process.env.STRIPE_PRICE_TEST;
  });
});

// ── Env var overrides ──

describe('env var overrides', () => {
  it('getStripeSecretKey prefers env var', () => {
    const orig = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = 'sk_env_override';

    expect(getStripeSecretKey()).toBe('sk_env_override');

    if (orig !== undefined) process.env.STRIPE_SECRET_KEY = orig;
    else delete process.env.STRIPE_SECRET_KEY;
  });

  it('getStripeWebhookSecret prefers env var', () => {
    const orig = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_env_override';

    expect(getStripeWebhookSecret()).toBe('whsec_env_override');

    if (orig !== undefined) process.env.STRIPE_WEBHOOK_SECRET = orig;
    else delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  it('getStripePublishableKey prefers env var', () => {
    const orig = process.env.STRIPE_PUBLISHABLE_KEY;
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_env_override';

    expect(getStripePublishableKey()).toBe('pk_env_override');

    if (orig !== undefined) process.env.STRIPE_PUBLISHABLE_KEY = orig;
    else delete process.env.STRIPE_PUBLISHABLE_KEY;
  });
});
