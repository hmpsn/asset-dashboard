/**
 * Integration tests for Stripe checkout session creation — FM-2 (Phantom Success).
 *
 * FM-2 Phantom Success: Stripe API fails but a pending payment record gets
 * created without a valid session. These tests verify the code correctly avoids
 * that failure mode — no payment record must be created when the Stripe API
 * call fails, and the correct payment record must be created when it succeeds.
 *
 * Tested functions (server/stripe.ts):
 *   - createCheckoutSession
 *   - createCartCheckoutSession
 *   - createPaymentIntentForProduct
 *   - isStripeConfigured
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setupStripeMocks,
  mockCheckoutSession,
  mockCheckoutSessionError,
  mockCustomerCreate,
  mockCustomerRetrieve,
  mockCustomerRetrieveNotFound,
  mockPaymentIntentCreate,
  resetStripeMocks,
  mockCheckoutSessionsCreate,
  mockPaymentIntentsCreate,
} from '../mocks/stripe.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';

// ---------------------------------------------------------------------------
// Module-level mock setup — must be called before imports of the modules under test
// ---------------------------------------------------------------------------

setupStripeMocks();

vi.mock('../../server/stripe-config.js', () => ({
  getStripeSecretKey: vi.fn(() => 'sk_test_fake'),
  getStripeWebhookSecret: vi.fn(() => 'whsec_test_fake'),
  getStripePriceId: vi.fn((_productType: string, _envKey: string) => 'price_test_1234'),
  getStripeConfigSafe: vi.fn(() => ({})),
  getStripePublishableKey: vi.fn(() => 'pk_test_fake'),
  saveStripeKeys: vi.fn(),
  saveStripeProducts: vi.fn(),
  clearStripeConfig: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports of modules under test (after mocks are declared)
// ---------------------------------------------------------------------------

import {
  createCheckoutSession,
  createCartCheckoutSession,
  createPaymentIntentForProduct,
  isStripeConfigured,
} from '../../server/stripe.js';
import { listPayments, getPaymentBySession } from '../../server/payments.js';

// ---------------------------------------------------------------------------
// Describe block
// ---------------------------------------------------------------------------

describe('Stripe Checkout Flow — FM-2 Phantom Success', () => {
  let ws: SeededFullWorkspace;

  beforeEach(() => {
    resetStripeMocks();
    // Default customer mocks — seeded workspace has no stripeCustomerId,
    // so getOrCreateCustomer() will call customers.create() on first use.
    mockCustomerCreate();
    mockCustomerRetrieve();
    ws = seedWorkspace();
  });

  afterEach(() => {
    ws.cleanup();
  });

  // ── Test 1: Stripe API error — no payment record created ─────────────────

  it('checkout session API error — no payment record created', async () => {
    mockCheckoutSessionError('Stripe API unavailable');

    await expect(
      createCheckoutSession({
        workspaceId: ws.workspaceId,
        productType: 'brief_blog',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      }),
    ).rejects.toThrow('Stripe API unavailable');

    const payments = listPayments(ws.workspaceId);
    expect(payments.length).toBe(0);
  });

  // ── Test 2: Customer creation fails — checkout not attempted ─────────────

  it('customer creation fails — checkout sessions.create not called', async () => {
    // Customer not found in Stripe, then create also fails
    mockCustomerRetrieveNotFound();
    // mockCustomersCreate is not configured, so it will return undefined by default
    // We explicitly configure it to reject
    const { mockCustomersCreate } = await import('../mocks/stripe.js');
    mockCustomersCreate.mockRejectedValue(new Error('Failed to create customer'));

    await expect(
      createCheckoutSession({
        workspaceId: ws.workspaceId,
        productType: 'brief_blog',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      }),
    ).rejects.toThrow('Failed to create customer');

    // The checkout sessions.create call must never have been reached
    expect(mockCheckoutSessionsCreate).not.toHaveBeenCalled();

    // No payment record should exist
    const payments = listPayments(ws.workspaceId);
    expect(payments.length).toBe(0);
  });

  // ── Test 3: Successful checkout — payment record has correct session ID ───

  it('successful checkout — payment record created with matching stripeSessionId', async () => {
    mockCheckoutSession({ id: 'cs_test_success_001', url: 'https://checkout.stripe.com/session_001' });

    const result = await createCheckoutSession({
      workspaceId: ws.workspaceId,
      productType: 'brief_blog',
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
    });

    expect(result.sessionId).toBe('cs_test_success_001');
    expect(result.url).toBe('https://checkout.stripe.com/session_001');

    // Payment record must exist with the correct session ID
    const payment = getPaymentBySession(ws.workspaceId, 'cs_test_success_001');
    expect(payment).toBeDefined();
    expect(payment!.stripeSessionId).toBe('cs_test_success_001');
    expect(payment!.workspaceId).toBe(ws.workspaceId);
    expect(payment!.productType).toBe('brief_blog');
    expect(payment!.status).toBe('pending');
    expect(payment!.currency).toBe('usd');
    // brief_blog priceUsd is 125, stored in cents
    expect(payment!.amount).toBe(12500);
  });

  // ── Test 4: Cart checkout — Stripe API error, no payment records ─────────

  it('cart checkout session API error — no payment records created', async () => {
    mockCheckoutSessionError('Stripe network timeout');

    await expect(
      createCartCheckoutSession({
        workspaceId: ws.workspaceId,
        items: [
          { productType: 'brief_blog', quantity: 1 },
          { productType: 'schema_page', quantity: 2 },
        ],
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      }),
    ).rejects.toThrow('Stripe network timeout');

    const payments = listPayments(ws.workspaceId);
    expect(payments.length).toBe(0);
  });

  // ── Test 5: PaymentIntent creation — Stripe API error, no payment record ──

  it('paymentIntent API error — no payment record created', async () => {
    mockPaymentIntentsCreate.mockRejectedValue(new Error('PaymentIntent creation failed'));

    await expect(
      createPaymentIntentForProduct({
        workspaceId: ws.workspaceId,
        productType: 'brief_blog',
      }),
    ).rejects.toThrow('PaymentIntent creation failed');

    const payments = listPayments(ws.workspaceId);
    expect(payments.length).toBe(0);
  });

  // ── Test 6: Stripe not configured — throws before any API call ───────────

  it('isStripeConfigured returns true when secret key is mocked', () => {
    // Our vi.mock returns 'sk_test_fake' so Stripe is considered configured
    expect(isStripeConfigured()).toBe(true);
  });

  it('createCheckoutSession throws when Stripe key mock returns empty string', async () => {
    // Temporarily override the mock to return empty
    const stripeConfig = await import('../../server/stripe-config.js');
    const getStripeSecretKeySpy = vi.mocked(stripeConfig.getStripeSecretKey);
    getStripeSecretKeySpy.mockReturnValueOnce('');

    await expect(
      createCheckoutSession({
        workspaceId: ws.workspaceId,
        productType: 'brief_blog',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      }),
    ).rejects.toThrow(/Stripe is not configured/);

    // No Stripe API calls should have been made
    expect(mockCheckoutSessionsCreate).not.toHaveBeenCalled();

    // No payment record created
    const payments = listPayments(ws.workspaceId);
    expect(payments.length).toBe(0);
  });

  // ── Test 7: Successful cart checkout — per-product payment records ────────

  it('successful cart checkout — one payment record per product created', async () => {
    mockCheckoutSession({ id: 'cs_test_cart_001', url: 'https://checkout.stripe.com/cart_001' });

    const result = await createCartCheckoutSession({
      workspaceId: ws.workspaceId,
      items: [
        { productType: 'brief_blog', quantity: 1 },
        { productType: 'schema_page', quantity: 2 },
      ],
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
    });

    expect(result.sessionId).toBe('cs_test_cart_001');

    const payments = listPayments(ws.workspaceId);
    // One record per cart item
    expect(payments.length).toBe(2);

    // All records should share the same session ID
    expect(payments.length).toBeGreaterThan(0);
    expect(payments.every(p => p.stripeSessionId === 'cs_test_cart_001')).toBe(true);
    expect(payments.every(p => p.status === 'pending')).toBe(true);
    expect(payments.every(p => p.workspaceId === ws.workspaceId)).toBe(true);

    // Product types
    const productTypes = payments.map(p => p.productType).sort();
    expect(productTypes).toContain('brief_blog');
    expect(productTypes).toContain('schema_page');

    // schema_page (2 qty × $39 = $78 = 7800 cents)
    const schemaPayment = payments.find(p => p.productType === 'schema_page');
    expect(schemaPayment).toBeDefined();
    expect(schemaPayment!.amount).toBe(7800);

    // brief_blog (1 qty × $125 = $125 = 12500 cents)
    const briefPayment = payments.find(p => p.productType === 'brief_blog');
    expect(briefPayment).toBeDefined();
    expect(briefPayment!.amount).toBe(12500);
  });

  // ── Test 8: Successful PaymentIntent — record uses PI id as session id ────

  it('successful paymentIntent — record created with PI id as stripeSessionId', async () => {
    mockPaymentIntentCreate({ id: 'pi_test_intent_001', client_secret: 'pi_test_intent_001_secret_abc', amount: 12500 });

    const result = await createPaymentIntentForProduct({
      workspaceId: ws.workspaceId,
      productType: 'brief_blog',
    });

    expect(result.paymentIntentId).toBe('pi_test_intent_001');
    expect(result.clientSecret).toBe('pi_test_intent_001_secret_abc');
    expect(result.amount).toBe(12500);

    // Payment record uses PI id stored in the stripeSessionId field (per code comment)
    const payment = getPaymentBySession(ws.workspaceId, 'pi_test_intent_001');
    expect(payment).toBeDefined();
    expect(payment!.stripeSessionId).toBe('pi_test_intent_001');
    expect(payment!.productType).toBe('brief_blog');
    expect(payment!.status).toBe('pending');
    expect(payment!.amount).toBe(12500);
  });

  // ── Test 9: Cart checkout — empty cart throws before any API call ─────────

  it('empty cart throws before any Stripe API call', async () => {
    await expect(
      createCartCheckoutSession({
        workspaceId: ws.workspaceId,
        items: [],
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      }),
    ).rejects.toThrow('Cart is empty');

    expect(mockCheckoutSessionsCreate).not.toHaveBeenCalled();
    const payments = listPayments(ws.workspaceId);
    expect(payments.length).toBe(0);
  });
});
