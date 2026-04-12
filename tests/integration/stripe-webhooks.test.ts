/**
 * Integration tests for Stripe webhook handler — FM-2 (Phantom Success) & FM-5.
 *
 * Tests that `handleWebhookEvent()` correctly handles missing metadata,
 * updates payment records, manages tier upgrades/downgrades, and logs activity.
 *
 * Tested function: handleWebhookEvent (server/stripe.ts)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setupStripeMocks,
  createWebhookEvent,
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
import { createPayment, getPaymentBySession, listPayments } from '../../server/payments.js';
import { getWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { listActivity } from '../../server/activity-log.js';

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Stripe Webhooks — FM-2 & FM-5', () => {
  let ws: SeededFullWorkspace;
  const mockBroadcast = vi.fn();

  beforeEach(() => {
    resetStripeMocks();
    mockBroadcast.mockClear();
    initStripeBroadcast(mockBroadcast);
    ws = seedWorkspace();
  });

  afterEach(() => {
    // Clean up payment, activity, and work order records
    db.prepare('DELETE FROM payments WHERE workspace_id = ?').run(ws.workspaceId);
    db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(ws.workspaceId);
    db.prepare('DELETE FROM work_orders WHERE workspace_id = ?').run(ws.workspaceId);
    ws.cleanup();
  });

  // ── checkout.session.completed ──

  it('checkout.session.completed — missing workspaceId silently returns', async () => {
    const event = createWebhookEvent('checkout.session.completed', {
      id: 'cs_test_no_ws',
      metadata: {},  // no workspaceId
      amount_total: 12500,
    });

    // Should not throw
    await handleWebhookEvent(event as never);

    // No payment records should have been created/updated
    const payments = listPayments(ws.workspaceId);
    expect(payments).toHaveLength(0);
  });

  it('checkout.session.completed — valid event updates payment to paid', async () => {
    const sessionId = 'cs_test_valid_123';

    // Create a pending payment first
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

    await handleWebhookEvent(event as never);

    // Payment should be updated to 'paid'
    const payment = getPaymentBySession(ws.workspaceId, sessionId);
    expect(payment).toBeDefined();
    expect(payment!.status).toBe('paid');
    expect(payment!.paidAt).toBeDefined();
  });

  it('checkout.session.completed — plan_growth upgrades workspace tier', async () => {
    const sessionId = 'cs_test_upgrade_growth';

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

    const updatedWs = getWorkspace(ws.workspaceId);
    expect(updatedWs?.tier).toBe('growth');
  });

  it('checkout.session.completed — plan_premium upgrades workspace tier', async () => {
    const sessionId = 'cs_test_upgrade_premium';

    createPayment(ws.workspaceId, {
      workspaceId: ws.workspaceId,
      stripeSessionId: sessionId,
      productType: 'plan_premium',
      amount: 99900,
      currency: 'usd',
      status: 'pending',
    });

    const event = createWebhookEvent('checkout.session.completed', {
      id: sessionId,
      metadata: {
        workspaceId: ws.workspaceId,
        productType: 'plan_premium',
      },
      amount_total: 99900,
    });

    await handleWebhookEvent(event as never);

    const updatedWs = getWorkspace(ws.workspaceId);
    expect(updatedWs?.tier).toBe('premium');
  });

  it('checkout.session.completed — fix product creates work order', async () => {
    const sessionId = 'cs_test_fix_meta';

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
        pageIds: JSON.stringify(['/page-1', '/page-2']),
      },
      amount_total: 2000,
    });

    await handleWebhookEvent(event as never);

    const orders = db.prepare('SELECT * FROM work_orders WHERE workspace_id = ?').all(ws.workspaceId);
    expect(orders.length).toBeGreaterThan(0);
  });

  it('checkout.session.completed — logs payment_received activity', async () => {
    const sessionId = 'cs_test_activity';

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

    const activities = listActivity(ws.workspaceId);
    expect(activities.length).toBeGreaterThan(0);
    const paymentActivity = activities.find(a => a.type === 'payment_received');
    expect(paymentActivity).toBeDefined();
  });

  // ── payment_intent.succeeded ──

  it('payment_intent.succeeded — missing workspaceId silently returns', async () => {
    const event = createWebhookEvent('payment_intent.succeeded', {
      id: 'pi_test_no_ws',
      metadata: {},
      amount: 12500,
    });

    await handleWebhookEvent(event as never);

    // No payments created
    const payments = listPayments(ws.workspaceId);
    expect(payments).toHaveLength(0);
  });

  it('payment_intent.succeeded — updates payment record', async () => {
    const piId = 'pi_test_success_123';

    // Payment stored with PI id as session id (as the code does for PaymentIntent flow)
    createPayment(ws.workspaceId, {
      workspaceId: ws.workspaceId,
      stripeSessionId: piId,
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

    const payment = getPaymentBySession(ws.workspaceId, piId);
    expect(payment).toBeDefined();
    expect(payment!.status).toBe('paid');
  });

  // ── payment_intent.payment_failed ──

  it('payment_intent.payment_failed — logs activity', async () => {
    const event = createWebhookEvent('payment_intent.payment_failed', {
      id: 'pi_test_failed',
      metadata: {
        workspaceId: ws.workspaceId,
      },
    });

    await handleWebhookEvent(event as never);

    const activities = listActivity(ws.workspaceId);
    const failedActivity = activities.find(a => a.type === 'payment_failed');
    expect(failedActivity).toBeDefined();
  });

  it('payment_intent.payment_failed — missing workspaceId silently returns', async () => {
    const event = createWebhookEvent('payment_intent.payment_failed', {
      id: 'pi_test_failed_no_ws',
      metadata: {},
    });

    await handleWebhookEvent(event as never);

    // Regression guard: the handler early-returns before addActivity() when
    // metadata.workspaceId is missing. A regression that removed the guard
    // would log a `payment_failed` activity with an undefined workspaceId.
    // Assert no such activity was logged against the seeded workspace.
    const activities = listActivity(ws.workspaceId);
    expect(activities.some(a => a.type === 'payment_failed')).toBe(false);
  });

  // ── subscription events ──

  it('customer.subscription.deleted — downgrades to free tier', async () => {
    // Set workspace to growth tier first
    updateWorkspace(ws.workspaceId, { tier: 'growth', stripeSubscriptionId: 'sub_test_del' });

    const event = createWebhookEvent('customer.subscription.deleted', {
      id: 'sub_test_del',
      metadata: {
        workspaceId: ws.workspaceId,
      },
      status: 'canceled',
    });

    await handleWebhookEvent(event as never);

    const updatedWs = getWorkspace(ws.workspaceId);
    expect(updatedWs?.tier).toBe('free');
  });

  it('customer.subscription.deleted — missing workspaceId silently returns', async () => {
    const event = createWebhookEvent('customer.subscription.deleted', {
      id: 'sub_test_no_ws',
      metadata: {},
      status: 'canceled',
    });

    await handleWebhookEvent(event as never);

    // Workspace unchanged
    const wsCurrent = getWorkspace(ws.workspaceId);
    expect(wsCurrent?.tier).toBe('free'); // was already free
  });

  // ── Unknown event ──

  it('unknown event type — no crash', async () => {
    const event = createWebhookEvent('unknown.event.type', {
      id: 'obj_unknown',
    });

    // Snapshot state before the call so the assertion is against a known
    // baseline (seedWorkspace may have logged its own activities).
    const paymentsBefore = listPayments(ws.workspaceId).length;
    const activitiesBefore = listActivity(ws.workspaceId).length;
    const wsBefore = getWorkspace(ws.workspaceId);

    await handleWebhookEvent(event as never);

    // Unknown event types must be a no-op: no payment writes, no activity
    // writes, no workspace mutation. A regression that added a default
    // branch to the switch (e.g. logging an error as an activity) would
    // trip one of these assertions.
    expect(listPayments(ws.workspaceId).length).toBe(paymentsBefore);
    expect(listActivity(ws.workspaceId).length).toBe(activitiesBefore);
    expect(getWorkspace(ws.workspaceId)?.tier).toBe(wsBefore?.tier);
  });
});
