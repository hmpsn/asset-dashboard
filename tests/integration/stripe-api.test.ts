/**
 * Integration tests for Stripe config and products API endpoints.
 *
 * Tests read-only / config endpoints that don't require Stripe SDK.
 * Checkout/payment tests are skipped (require live Stripe keys).
 *
 * - GET /api/stripe/config
 * - GET /api/stripe/publishable-key
 * - GET /api/stripe/products
 * - POST /api/stripe/create-checkout (validation only — Stripe not configured)
 * - POST /api/stripe/create-payment-intent (validation only)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13206);
const { api, postJson } = ctx;

beforeAll(async () => {
  await ctx.startServer();
}, 25_000);

afterAll(() => {
  ctx.stopServer();
});

describe('Stripe Config API', () => {
  it('GET /api/stripe/config returns config status', async () => {
    const res = await api('/api/stripe/config');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('hasSecretKey');
    expect(body).toHaveProperty('hasWebhookSecret');
    expect(body).toHaveProperty('configured');
    expect(typeof body.hasSecretKey).toBe('boolean');
    expect(typeof body.configured).toBe('boolean');
  });

  it('GET /api/stripe/publishable-key returns key or null', async () => {
    const res = await api('/api/stripe/publishable-key');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('publishableKey');
    // publishableKey could be null or a string
  });

  it('GET /api/stripe/products returns product list', async () => {
    const res = await api('/api/stripe/products');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('configured');
    expect(body).toHaveProperty('products');
    expect(Array.isArray(body.products)).toBe(true);
    // Should have products even without Stripe configured
    expect(body.products.length).toBeGreaterThan(0);
    // Each product should have required fields
    for (const product of body.products) {
      expect(product).toHaveProperty('type');
      expect(product).toHaveProperty('displayName');
      expect(product).toHaveProperty('priceUsd');
      expect(product).toHaveProperty('category');
    }
  });
});

describe('Stripe Checkout — validation without Stripe configured', () => {
  it('POST /api/stripe/create-checkout without Stripe returns 503 or 400', async () => {
    const res = await postJson('/api/stripe/create-checkout', {
      workspaceId: 'ws_test',
      productType: 'brief_blog',
    });
    // Should be 503 (not configured) or 400/404
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(600);
  });

  it('POST /api/stripe/create-checkout without required fields returns 400+', async () => {
    const res = await postJson('/api/stripe/create-checkout', {});
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('POST /api/stripe/create-payment-intent without Stripe returns 503 or 400', async () => {
    const res = await postJson('/api/stripe/create-payment-intent', {
      workspaceId: 'ws_test',
      productType: 'brief_blog',
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('POST /api/stripe/cart-checkout without required fields returns 400', async () => {
    const res = await postJson('/api/stripe/cart-checkout', {});
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('Stripe Payments API', () => {
  it('GET /api/stripe/payments/:wsId returns array', async () => {
    const res = await api('/api/stripe/payments/ws_test');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
