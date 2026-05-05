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
import { createPayment, getPaymentByPaymentIntent, getPaymentBySession, listPayments } from '../../server/payments.js';
import { getWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { listActivity } from '../../server/activity-log.js';
import { createContentRequest, getContentRequest, updateContentRequest } from '../../server/content-requests.js';
import { createContentSubscription, getContentSubscriptionByStripeId } from '../../server/content-subscriptions.js';

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
    db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(ws.workspaceId);
    db.prepare('DELETE FROM content_subscriptions WHERE workspace_id = ?').run(ws.workspaceId);
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

    createPayment(ws.workspaceId, {
      workspaceId: ws.workspaceId,
      stripeSessionId: 'cs_test_success_123',
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

    const payment = getPaymentByPaymentIntent(ws.workspaceId, piId);
    expect(payment).toBeDefined();
    expect(payment!.status).toBe('paid');
  });

  it('payment_intent.succeeded — supports legacy records keyed by payment intent as session', async () => {
    const piId = 'pi_test_legacy_session_lookup';

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
    expect(payment!.stripePaymentIntentId).toBe(piId);
  });

  it('payment_intent.succeeded — post_polished upgrades an approved brief request', async () => {
    const piId = 'pi_test_post_polished_upgrade';
    const request = createContentRequest(ws.workspaceId, {
      topic: 'Paid upgrade request',
      targetKeyword: `paid upgrade ${Date.now()}`,
      intent: 'informational',
      priority: 'medium',
      rationale: 'Stripe webhook regression',
      serviceType: 'brief_only',
      initialStatus: 'brief_generated',
      dedupe: false,
    });
    updateContentRequest(ws.workspaceId, request.id, { status: 'approved' });

    createPayment(ws.workspaceId, {
      workspaceId: ws.workspaceId,
      stripeSessionId: 'cs_test_post_polished_upgrade',
      stripePaymentIntentId: piId,
      productType: 'post_polished',
      amount: 50000,
      currency: 'usd',
      status: 'pending',
      contentRequestId: request.id,
    });

    const event = createWebhookEvent('payment_intent.succeeded', {
      id: piId,
      metadata: {
        workspaceId: ws.workspaceId,
        productType: 'post_polished',
        contentRequestId: request.id,
      },
      amount: 50000,
    });

    await handleWebhookEvent(event as never);

    const updated = getContentRequest(ws.workspaceId, request.id);
    expect(updated?.serviceType).toBe('full_post');
    expect(updated?.status).toBe('in_progress');
    expect(updated?.upgradedAt).toBeDefined();
    expect(mockBroadcast).toHaveBeenCalledWith(
      ws.workspaceId,
      'content-request:update',
      expect.objectContaining({ id: request.id, status: 'in_progress' }),
    );
  });

  // ── payment_intent.payment_failed ──

  it('payment_intent.payment_failed — marks payment failed and logs useful failure metadata', async () => {
    createPayment(ws.workspaceId, {
      workspaceId: ws.workspaceId,
      stripeSessionId: 'pi_test_failed',
      productType: 'brief_blog',
      amount: 12500,
      currency: 'usd',
      status: 'pending',
      metadata: { productType: 'brief_blog' },
    });

    const event = createWebhookEvent('payment_intent.payment_failed', {
      id: 'pi_test_failed',
      metadata: {
        workspaceId: ws.workspaceId,
        productType: 'brief_blog',
      },
      status: 'requires_payment_method',
      last_payment_error: {
        message: 'Your card was declined.',
        code: 'card_declined',
        decline_code: 'insufficient_funds',
        payment_method: { type: 'card' },
      },
    });

    await handleWebhookEvent(event as never);

    const payment = getPaymentBySession(ws.workspaceId, 'pi_test_failed');
    expect(payment?.status).toBe('failed');
    expect(payment?.stripePaymentIntentId).toBe('pi_test_failed');
    expect(payment?.metadata).toMatchObject({
      productType: 'brief_blog',
      stripePaymentIntentId: 'pi_test_failed',
      failureStatus: 'requires_payment_method',
      failureMessage: 'Your card was declined.',
      failureCode: 'card_declined',
      declineCode: 'insufficient_funds',
      paymentMethodType: 'card',
    });

    const activities = listActivity(ws.workspaceId);
    const failedActivity = activities.find(a => a.type === 'payment_failed');
    expect(failedActivity).toBeDefined();
    expect(failedActivity?.description).toBe('Your card was declined.');
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
    // Set workspace to 'growth' so the assertion proves the handler truly
    // no-op'd, rather than vacuously passing because the default is 'free'.
    updateWorkspace(ws.workspaceId, { tier: 'growth' });

    const event = createWebhookEvent('customer.subscription.deleted', {
      id: 'sub_test_no_ws',
      metadata: {},
      status: 'canceled',
    });

    await handleWebhookEvent(event as never);

    // Workspace unchanged — handler should not downgrade without workspaceId
    const wsCurrent = getWorkspace(ws.workspaceId);
    expect(wsCurrent?.tier).toBe('growth');
  });

  it('invoice.paid — renews content subscription when workspaceId is missing from invoice metadata', async () => {
    const sub = createContentSubscription(ws.workspaceId, {
      plan: 'content_growth',
      postsPerMonth: 4,
      priceUsd: 900,
      stripeSubscriptionId: 'sub_test_invoice_fallback',
      status: 'past_due',
      currentPeriodStart: '2026-01-01T00:00:00.000Z',
      currentPeriodEnd: '2026-02-01T00:00:00.000Z',
    });

    const event = createWebhookEvent('invoice.paid', {
      id: 'in_test_workspace_fallback',
      metadata: {},
      subscription: 'sub_test_invoice_fallback',
      amount_paid: 90000,
      period_start: 1772323200,
      period_end: 1775001600,
    });

    await handleWebhookEvent(event as never);

    const renewed = getContentSubscriptionByStripeId('sub_test_invoice_fallback');
    expect(renewed?.id).toBe(sub.id);
    expect(renewed?.workspaceId).toBe(ws.workspaceId);
    expect(renewed?.status).toBe('active');
    expect(renewed?.currentPeriodStart).toBe('2026-03-01T00:00:00.000Z');
    expect(renewed?.currentPeriodEnd).toBe('2026-04-01T00:00:00.000Z');

    const invoiceActivity = listActivity(ws.workspaceId).find(a => a.type === 'invoice_paid');
    expect(invoiceActivity).toBeDefined();
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
