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
import { createPayment, listPayments, getPaymentBySession } from '../../server/payments.js';
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

  it('checkout.session.completed replayed — activity IS double-logged (known gap)', async () => {
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

    // NOTE: Activity IS double-logged on webhook replay — there's no idempotency
    // guard on addActivity(). This documents the current behavior.
    // TODO: Add idempotency guard using event.id to prevent duplicate activity entries
    expect(activityCountAfterFirst).toBe(1);
    expect(activityCountAfterSecond).toBe(2); // double-logged
  });

  it('checkout.session.completed replayed — work order double-created (known gap)', async () => {
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

    // NOTE: Work orders ARE double-created on webhook replay — there's no
    // idempotency guard on createWorkOrder().
    // TODO: Add idempotency guard (e.g., check if work order for this payment already exists)
    expect(woCountFirst).toBe(1);
    expect(woCountSecond).toBe(2); // double-created
  });

  // ── payment_intent.succeeded replayed ──

  it('payment_intent.succeeded replayed — payment updated idempotently', async () => {
    const piId = 'pi_test_idemp_pi';

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
    await handleWebhookEvent(createDuplicateWebhookEvent(event) as never);

    // Only one payment, updated to paid
    expect(countPayments(ws.workspaceId)).toBe(1);
    const payment = getPaymentBySession(ws.workspaceId, piId);
    expect(payment!.status).toBe('paid');
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
