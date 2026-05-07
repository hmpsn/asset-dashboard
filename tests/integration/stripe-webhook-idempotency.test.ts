/**
 * Integration tests for Stripe webhook idempotency — FM-10 (Duplicate Processing).
 *
 * Verifies that replaying the same webhook event doesn't double-create payments,
 * work orders, or activity records. Documents current behavior gaps.
 *
 * Tested function: handleWebhookEvent (server/stripe.ts)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setupStripeMocks,
  createWebhookEvent,
  createDuplicateWebhookEvent,
  resetStripeMocks,
} from '../mocks/stripe.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import db from '../../server/db/index.js';

// ---------------------------------------------------------------------------
// Module-level mock setup
// ---------------------------------------------------------------------------

setupStripeMocks();

vi.mock('../../server/stripe-config.js', () => ({
  getStripeSecretKey: vi.fn(() => 'sk_test_fake'),
  getStripeWebhookSecret: vi.fn(() => 'whsec_test_fake'),
  getStripePriceId: vi.fn((_type: string, _envKey: string) => `price_test_${_envKey}`),
  getStripeConfigSafe: vi.fn(() => ({})),
  getStripePublishableKey: vi.fn(() => 'pk_test_fake'),
  saveStripeKeys: vi.fn(),
  saveStripeProducts: vi.fn(),
  clearStripeConfig: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports of modules under test (after mocks)
// ---------------------------------------------------------------------------

import { handleWebhookEvent, initStripeBroadcast } from '../../server/stripe.js';
import { createPayment, listPaymentsBySession, getPaymentByPaymentIntent, getPaymentBySession } from '../../server/payments.js';
import { getWorkspace, updateWorkspace } from '../../server/workspaces.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countPayments(workspaceId: string): number {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM payments WHERE workspace_id = ?').get(workspaceId) as { cnt: number };
  return row.cnt;
}

function countActivities(workspaceId: string, type?: string): number {
  if (type) {
    const row = db.prepare('SELECT COUNT(*) as cnt FROM activity_log WHERE workspace_id = ? AND type = ?').get(workspaceId, type) as { cnt: number };
    return row.cnt;
  }
  const row = db.prepare('SELECT COUNT(*) as cnt FROM activity_log WHERE workspace_id = ?').get(workspaceId) as { cnt: number };
  return row.cnt;
}

function countWorkOrders(workspaceId: string): number {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM work_orders WHERE workspace_id = ?').get(workspaceId) as { cnt: number };
  return row.cnt;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Stripe Webhook Idempotency — FM-10', () => {
  let ws: SeededFullWorkspace;
  const mockBroadcast = vi.fn();

  beforeEach(() => {
    resetStripeMocks();
    mockBroadcast.mockClear();
    initStripeBroadcast(mockBroadcast);
    ws = seedWorkspace();
  });

  afterEach(() => {
    db.prepare('DELETE FROM payments WHERE workspace_id = ?').run(ws.workspaceId);
    db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(ws.workspaceId);
    db.prepare('DELETE FROM work_orders WHERE workspace_id = ?').run(ws.workspaceId);
    ws.cleanup();
  });

  // ── checkout.session.completed replayed ──

  it('checkout.session.completed replayed — payment NOT double-created', async () => {
    const sessionId = 'cs_test_idemp_pay';

    // Create pending payment
    createPayment(ws.workspaceId, {
      workspaceId: ws.workspaceId,
      stripeSessionId: sessionId,
      productType: 'brief_blog',
      amount: 12500,
      currency: 'usd',
      status: 'pending',
    });

    const event = createWebhookEvent('checkout.session.completed', {
      id: sessionId,
      metadata: {
        workspaceId: ws.workspaceId,
        productType: 'brief_blog',
      },
      amount_total: 12500,
      payment_intent: 'pi_test_abc',
    });

    // Process the same event twice
    await handleWebhookEvent(event as never);
    const duplicate = createDuplicateWebhookEvent(event);
    await handleWebhookEvent(duplicate as never);

    // Only ONE payment record should exist (the original, now updated to 'paid')
    const paymentCount = countPayments(ws.workspaceId);
    expect(paymentCount).toBe(1);

    const payment = getPaymentBySession(ws.workspaceId, sessionId);
    expect(payment).toBeDefined();
    expect(payment!.status).toBe('paid');
  });

  it('checkout.session.completed replayed — activity is not double-logged', async () => {
    const sessionId = 'cs_test_idemp_act';

    createPayment(ws.workspaceId, {
      workspaceId: ws.workspaceId,
      stripeSessionId: sessionId,
      productType: 'brief_blog',
      amount: 12500,
      currency: 'usd',
      status: 'pending',
    });

    const event = createWebhookEvent('checkout.session.completed', {
      id: sessionId,
      metadata: {
        workspaceId: ws.workspaceId,
        productType: 'brief_blog',
      },
      amount_total: 12500,
    });

    await handleWebhookEvent(event as never);
    const activityCountAfterFirst = countActivities(ws.workspaceId, 'payment_received');

    const duplicate = createDuplicateWebhookEvent(event);
    await handleWebhookEvent(duplicate as never);
    const activityCountAfterSecond = countActivities(ws.workspaceId, 'payment_received');

    expect(activityCountAfterFirst).toBe(1);
    expect(activityCountAfterSecond).toBe(1);
  });

  it('checkout.session.completed replayed — work order is not double-created', async () => {
    const sessionId = 'cs_test_idemp_wo';

    createPayment(ws.workspaceId, {
      workspaceId: ws.workspaceId,
      stripeSessionId: sessionId,
      productType: 'fix_meta',
      amount: 2000,
      currency: 'usd',
      status: 'pending',
    });

    const event = createWebhookEvent('checkout.session.completed', {
      id: sessionId,
      metadata: {
        workspaceId: ws.workspaceId,
        productType: 'fix_meta',
        pageIds: JSON.stringify(['/page-1']),
      },
      amount_total: 2000,
    });

    await handleWebhookEvent(event as never);
    const woCountFirst = countWorkOrders(ws.workspaceId);

    const duplicate = createDuplicateWebhookEvent(event);
    await handleWebhookEvent(duplicate as never);
    const woCountSecond = countWorkOrders(ws.workspaceId);

    expect(woCountFirst).toBe(1);
    expect(woCountSecond).toBe(1);
  });

  it('checkout.session.completed cart replayed — marks all session payments paid and preserves cart work order payment ids', async () => {
    const sessionId = 'cs_test_idemp_cart';
    const fixPayment = createPayment(ws.workspaceId, {
      workspaceId: ws.workspaceId,
      stripeSessionId: sessionId,
      productType: 'fix_meta',
      amount: 2000,
      currency: 'usd',
      status: 'pending',
    });
    const schemaPayment = createPayment(ws.workspaceId, {
      workspaceId: ws.workspaceId,
      stripeSessionId: sessionId,
      productType: 'schema_page',
      amount: 3900,
      currency: 'usd',
      status: 'pending',
    });

    const event = createWebhookEvent('checkout.session.completed', {
      id: sessionId,
      metadata: {
        workspaceId: ws.workspaceId,
        cartItems: JSON.stringify([
          { productType: 'fix_meta', quantity: 1, pageIds: ['/page-1'] },
          { productType: 'schema_page', quantity: 1, pageIds: ['/page-2'] },
        ]),
      },
      amount_total: 5900,
      payment_intent: 'pi_test_cart',
    });

    await handleWebhookEvent(event as never);
    await handleWebhookEvent(createDuplicateWebhookEvent(event) as never);

    const payments = listPaymentsBySession(ws.workspaceId, sessionId);
    expect(payments).toHaveLength(2);
    expect(payments.map(payment => payment.status)).toEqual(['paid', 'paid']);
    expect(payments.map(payment => payment.stripePaymentIntentId)).toEqual(['pi_test_cart', 'pi_test_cart']);

    const orders = db.prepare('SELECT payment_id, product_type FROM work_orders WHERE workspace_id = ? ORDER BY product_type ASC').all(ws.workspaceId) as Array<{ payment_id: string; product_type: string }>;
    expect(orders).toHaveLength(2);
    expect(orders).toContainEqual({ payment_id: fixPayment.id, product_type: 'fix_meta' });
    expect(orders).toContainEqual({ payment_id: schemaPayment.id, product_type: 'schema_page' });
  });

  it('checkout.session.completed without payment records skips fulfillment side effects', async () => {
    const sessionId = 'cs_test_missing_payment_record';
    const event = createWebhookEvent('checkout.session.completed', {
      id: sessionId,
      metadata: {
        workspaceId: ws.workspaceId,
        productType: 'fix_meta',
        pageIds: JSON.stringify(['/page-1']),
      },
      amount_total: 2000,
    });

    await handleWebhookEvent(event as never);
    await handleWebhookEvent(createDuplicateWebhookEvent(event) as never);

    expect(countPayments(ws.workspaceId)).toBe(0);
    expect(countActivities(ws.workspaceId, 'payment_received')).toBe(0);
    expect(countWorkOrders(ws.workspaceId)).toBe(0);
  });

  it('checkout.session.completed with partial paid records skips duplicate fulfillment', async () => {
    const sessionId = 'cs_test_partial_paid';
    createPayment(ws.workspaceId, {
      workspaceId: ws.workspaceId,
      stripeSessionId: sessionId,
      productType: 'fix_meta',
      amount: 2000,
      currency: 'usd',
      status: 'paid',
      paidAt: new Date().toISOString(),
    });
    createPayment(ws.workspaceId, {
      workspaceId: ws.workspaceId,
      stripeSessionId: sessionId,
      productType: 'schema_page',
      amount: 3900,
      currency: 'usd',
      status: 'pending',
    });

    const event = createWebhookEvent('checkout.session.completed', {
      id: sessionId,
      metadata: {
        workspaceId: ws.workspaceId,
        cartItems: JSON.stringify([
          { productType: 'fix_meta', quantity: 1, pageIds: ['/page-1'] },
          { productType: 'schema_page', quantity: 1, pageIds: ['/page-2'] },
        ]),
      },
      amount_total: 5900,
    });

    await handleWebhookEvent(event as never);

    expect(countActivities(ws.workspaceId, 'payment_received')).toBe(0);
    expect(countWorkOrders(ws.workspaceId)).toBe(0);
    const payments = listPaymentsBySession(ws.workspaceId, sessionId);
    expect(payments.map(payment => payment.status)).toEqual(['paid', 'pending']);
  });

  // ── payment_intent.succeeded replayed ──

  it('payment_intent.succeeded replayed — payment updated idempotently', async () => {
    const piId = 'pi_test_idemp_pi';

    createPayment(ws.workspaceId, {
      workspaceId: ws.workspaceId,
      stripeSessionId: 'cs_test_idemp_pi',
      stripePaymentIntentId: piId,
      productType: 'brief_blog',
      amount: 12500,
      currency: 'usd',
      status: 'pending',
    });

    const event = createWebhookEvent('payment_intent.succeeded', {
      id: piId,
      metadata: {
        workspaceId: ws.workspaceId,
        productType: 'brief_blog',
      },
      amount: 12500,
    });

    await handleWebhookEvent(event as never);
    await handleWebhookEvent(createDuplicateWebhookEvent(event) as never);

    // Only one payment, updated to paid
    expect(countPayments(ws.workspaceId)).toBe(1);
    const payment = getPaymentByPaymentIntent(ws.workspaceId, piId);
    expect(payment!.status).toBe('paid');
  });

  it('payment_intent.succeeded without a pending payment skips side effects', async () => {
    const event = createWebhookEvent('payment_intent.succeeded', {
      id: 'pi_test_missing_payment',
      metadata: {
        workspaceId: ws.workspaceId,
        productType: 'fix_meta',
      },
      amount: 25000,
    });

    await handleWebhookEvent(event as never);
    await handleWebhookEvent(createDuplicateWebhookEvent(event) as never);

    expect(countPayments(ws.workspaceId)).toBe(0);
    expect(countActivities(ws.workspaceId, 'payment_received')).toBe(0);
    expect(countWorkOrders(ws.workspaceId)).toBe(0);
  });

  // ── subscription.deleted replayed ──

  it('subscription.deleted replayed — workspace stays at free (no crash)', async () => {
    updateWorkspace(ws.workspaceId, { tier: 'growth', stripeSubscriptionId: 'sub_test_idemp' });

    const event = createWebhookEvent('customer.subscription.deleted', {
      id: 'sub_test_idemp',
      metadata: {
        workspaceId: ws.workspaceId,
      },
      status: 'canceled',
    });

    await handleWebhookEvent(event as never);
    expect(getWorkspace(ws.workspaceId)?.tier).toBe('free');

    // Second call — workspace already at free, should not crash
    await handleWebhookEvent(createDuplicateWebhookEvent(event) as never);
    expect(getWorkspace(ws.workspaceId)?.tier).toBe('free');
  });

  // ── tier upgrade replayed ──

  it('checkout.session.completed with plan_growth replayed — tier stays growth', async () => {
    const sessionId = 'cs_test_idemp_tier';

    createPayment(ws.workspaceId, {
      workspaceId: ws.workspaceId,
      stripeSessionId: sessionId,
      productType: 'plan_growth',
      amount: 24900,
      currency: 'usd',
      status: 'pending',
    });

    const event = createWebhookEvent('checkout.session.completed', {
      id: sessionId,
      metadata: {
        workspaceId: ws.workspaceId,
        productType: 'plan_growth',
      },
      amount_total: 24900,
    });

    await handleWebhookEvent(event as never);
    expect(getWorkspace(ws.workspaceId)?.tier).toBe('growth');

    // Replay — tier should still be growth, not error
    await handleWebhookEvent(createDuplicateWebhookEvent(event) as never);
    expect(getWorkspace(ws.workspaceId)?.tier).toBe('growth');
  });
});
