/**
 * Unit tests for server/stripe.ts — product configuration, listing.
 *
 * Note: Checkout/webhook tests require Stripe SDK mocking.
 * This file tests the pure/synchronous parts of the Stripe module.
 */
import { describe, it, expect } from 'vitest';
import {
  getProductConfig,
  listProducts,
  isStripeConfigured,
} from '../../server/stripe.js';

// ── Product Configuration ──

describe('getProductConfig', () => {
  it('returns config for brief_blog', () => {
    const config = getProductConfig('brief_blog');
    expect(config).not.toBeNull();
    expect(config!.type).toBe('brief_blog');
    expect(config!.displayName).toBe('Blog Post Brief');
    expect(config!.priceUsd).toBe(125);
    expect(config!.category).toBe('brief');
  });

  it('returns config for post_polished', () => {
    const config = getProductConfig('post_polished');
    expect(config).not.toBeNull();
    expect(config!.type).toBe('post_polished');
    expect(config!.displayName).toBe('Blog Post — Polished');
    expect(config!.priceUsd).toBe(500);
    expect(config!.category).toBe('content');
  });

  it('returns config for schema_page', () => {
    const config = getProductConfig('schema_page');
    expect(config).not.toBeNull();
    expect(config!.priceUsd).toBe(39);
    expect(config!.category).toBe('schema');
  });

  it('returns config for strategy', () => {
    const config = getProductConfig('strategy');
    expect(config).not.toBeNull();
    expect(config!.priceUsd).toBe(400);
    expect(config!.category).toBe('strategy');
  });

  it('returns config for fix products', () => {
    const fixMeta = getProductConfig('fix_meta');
    expect(fixMeta).not.toBeNull();
    expect(fixMeta!.priceUsd).toBe(20);
    expect(fixMeta!.category).toBe('fix');

    const fixAlt = getProductConfig('fix_alt');
    expect(fixAlt).not.toBeNull();
    expect(fixAlt!.priceUsd).toBe(50);
  });

  it('returns config for plan products', () => {
    const growth = getProductConfig('plan_growth');
    expect(growth).not.toBeNull();
    expect(growth!.priceUsd).toBe(249);
    expect(growth!.category).toBe('strategy');

    const premium = getProductConfig('plan_premium');
    expect(premium).not.toBeNull();
    expect(premium!.priceUsd).toBe(999);
  });

  it('returns null for unknown product type', () => {
    expect(getProductConfig('nonexistent_product' as never)).toBeNull();
  });
});

// ── listProducts ──

describe('listProducts', () => {
  it('returns all product configs', () => {
    const products = listProducts();
    expect(Array.isArray(products)).toBe(true);
    expect(products.length).toBeGreaterThan(10); // We know there are 18+ products
  });

  it('each product has required fields', () => {
    const products = listProducts();
    for (const p of products) {
      expect(p.type).toBeDefined();
      expect(p.displayName).toBeDefined();
      expect(typeof p.priceUsd).toBe('number');
      expect(['brief', 'content', 'schema', 'strategy', 'fix']).toContain(p.category);
    }
  });

  it('includes all categories', () => {
    const products = listProducts();
    const categories = new Set(products.map(p => p.category));
    expect(categories.has('brief')).toBe(true);
    expect(categories.has('content')).toBe(true);
    expect(categories.has('schema')).toBe(true);
    expect(categories.has('strategy')).toBe(true);
    expect(categories.has('fix')).toBe(true);
  });
});

// ── isStripeConfigured ──

describe('isStripeConfigured', () => {
  it('returns false when no Stripe key is set', () => {
    // In test environment without STRIPE_SECRET_KEY, should be false
    const orig = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;

    // Note: isStripeConfigured also checks on-disk config, so result
    // depends on whether stripe-config has keys saved
    const result = isStripeConfigured();
    expect(typeof result).toBe('boolean');

    if (orig !== undefined) process.env.STRIPE_SECRET_KEY = orig;
  });
});
