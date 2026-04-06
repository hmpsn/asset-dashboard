/**
 * Journey test: Payment → Tier Upgrade — full checkout-to-access chain.
 *
 * Failure modes covered:
 *   FM-10 — Duplicate webhook processing
 *   FM-11 — Tier state mismatch after payment
 *   FM-12 — Broken chain (checkout succeeds but webhook fails to upgrade)
 *
 * Journey flow:
 *   1. Workspace starts at tier='free'
 *   2. createCheckoutSession() creates pending payment + Stripe session
 *   3. Stripe sends checkout.session.completed webhook → handleWebhookEvent()
 *   4. Webhook handler marks payment 'paid', upgrades workspace tier
 *   5. Workspace tier is now 'growth' (or 'premium')
 *   6. Duplicate webhook → no duplicate payments, tier unchanged
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setupStripeMocks,
  mockCheckoutSession,
  mockCheckoutSessionError,
  mockCustomerCreate,
  mockCustomerRetrieve,
  resetStripeMocks,
  createWebhookEvent,
  createDuplicateWebhookEvent,
} from '../mocks/stripe.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import db from '../../server/db/index.js';

// ---------------------------------------------------------------------------
// Module-level mock setup — must precede imports of modules under test
// ---------------------------------------------------------------------------

setupStripeMocks();

vi.mock('../../server/stripe-config.js', () => ({
  getStripeSecretKey: vi.fn(() => 'sk_test_fake'),
  getStripeWebhookSecret: vi.fn(() => 'whsec_test_fake'),
  getStripePriceId: vi.fn((_type: string, _envKey: string) => 'price_test_1234'),
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
  handleWebhookEvent,
  initStripeBroadcast,
} from '../../server/stripe.js';
import {
  listPayments,
  getPaymentBySession,
} from '../../server/payments.js';
import { getWorkspace } from '../../server/workspaces.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countPayments(workspaceId: string): number {
  const row = db.prepare(
    'SELECT COUNT(*) as cnt FROM payments WHERE workspace_id = ?',
  ).get(workspaceId) as { cnt: number };
  return row.cnt;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Journey: Payment → Tier Upgrade', () => {
  let ws: SeededFullWorkspace;
  const mockBroadcast = vi.fn();

  beforeEach(() => {
    resetStripeMocks();
    mockBroadcast.mockClear();
    initStripeBroadcast(mockBroadcast);

    // Default customer mocks — workspace has no stripeCustomerId on creation,
    // so getOrCreateCustomer() will call customers.create().
    mockCustomerCreate();
    mockCustomerRetrieve();

    ws = seedWorkspace({ tier: 'free' });
  });

  afterEach(() => {
    db.prepare('DELETE FROM payments WHERE workspace_id = ?').run(ws.workspaceId);
    db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(ws.workspaceId);
    db.prepare('DELETE FROM work_orders WHERE workspace_id = ?').run(ws.workspaceId);
    ws.cleanup();
  });

  // ── 1. Happy path: checkout → webhook → tier upgraded (free → growth) ────

  it('full journey: checkout creates pending payment, webhook upgrades tier to growth', async () => {
    const sessionId = 'cs_test_journey_growth';
    mockCheckoutSession({ id: sessionId, url: 'https://checkout.stripe.com/journey_growth' });

    // Verify workspace starts at free
    const wsBefore = getWorkspace(ws.workspaceId);
    expect(wsBefore?.tier).toBe('free');

    // Step 1: createCheckoutSession — creates pending payment + returns session
    const result = await createCheckoutSession({
      workspaceId: ws.workspaceId,
      productType: 'plan_growth',
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
    });
    expect(result.sessionId).toBe(sessionId);

    // Step 2: Verify pending payment exists
    const pendingPayment = getPaymentBySession(ws.workspaceId, sessionId);
    expect(pendingPayment).toBeDefined();
    expect(pendingPayment!.status).toBe('pending');
    expect(pendingPayment!.productType).toBe('plan_growth');
    // plan_growth is $249 → 24900 cents
    expect(pendingPayment!.amount).toBe(24900);

    // Workspace tier should still be free — payment is pending
    const wsStillFree = getWorkspace(ws.workspaceId);
    expect(wsStillFree?.tier).toBe('free');

    // Step 3: Simulate Stripe webhook (checkout.session.completed)
    const event = createWebhookEvent('checkout.session.completed', {
      id: sessionId,
      metadata: {
        workspaceId: ws.workspaceId,
        productType: 'plan_growth',
      },
      amount_total: 24900,
      payment_intent: 'pi_test_journey_growth',
    });
    await handleWebhookEvent(event as never);

    // Step 4: Verify payment is now 'paid'
    const paidPayment = getPaymentBySession(ws.workspaceId, sessionId);
    expect(paidPayment).toBeDefined();
    expect(paidPayment!.status).toBe('paid');
    expect(paidPayment!.paidAt).toBeDefined();

    // Step 5: Verify workspace tier upgraded to 'growth'
    const wsAfter = getWorkspace(ws.workspaceId);
    expect(wsAfter?.tier).toBe('growth');

    // Step 6: Verify broadcast was called with the tier update
    expect(mockBroadcast).toHaveBeenCalledWith(
      ws.workspaceId,
      'workspace:updated',
      { tier: 'growth' },
    );
  });

  // ── 2. Webhook with orphan session ID (no matching payment record) ───────

  it('orphan webhook: session ID has no payment record — no crash, tier unchanged', async () => {
    const orphanSessionId = 'cs_test_orphan_no_payment';

    // No checkout was called — no payment record for this session
    const event = createWebhookEvent('checkout.session.completed', {
      id: orphanSessionId,
      metadata: {
        workspaceId: ws.workspaceId,
        productType: 'brief_blog', // not a tier-upgrade product
      },
      amount_total: 12500,
    });

    // Should not throw
    await handleWebhookEvent(event as never);

    // No payment records should have been created by the webhook handler
    // (handleWebhookEvent only _updates_ existing payments, never creates new ones)
    const payment = getPaymentBySession(ws.workspaceId, orphanSessionId);
    expect(payment).toBeUndefined();

    // Workspace tier should remain unchanged
    const wsAfter = getWorkspace(ws.workspaceId);
    expect(wsAfter?.tier).toBe('free');
  });

  // ── 3. Duplicate webhook — FM-10 (no duplicate payments, tier stable) ────

  it('duplicate webhook (FM-10): replay does not create duplicate payments, tier stays growth', async () => {
    const sessionId = 'cs_test_journey_dup';
    mockCheckoutSession({ id: sessionId, url: 'https://checkout.stripe.com/journey_dup' });

    // Full happy path: checkout → webhook
    await createCheckoutSession({
      workspaceId: ws.workspaceId,
      productType: 'plan_growth',
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
    });

    const event = createWebhookEvent('checkout.session.completed', {
      id: sessionId,
      metadata: {
        workspaceId: ws.workspaceId,
        productType: 'plan_growth',
      },
      amount_total: 24900,
      payment_intent: 'pi_test_journey_dup',
    });

    await handleWebhookEvent(event as never);

    // Verify initial state after first webhook
    expect(countPayments(ws.workspaceId)).toBe(1);
    expect(getWorkspace(ws.workspaceId)?.tier).toBe('growth');

    // Replay the same event (duplicate webhook delivery)
    const duplicate = createDuplicateWebhookEvent(event);
    await handleWebhookEvent(duplicate as never);

    // No duplicate payment records
    expect(countPayments(ws.workspaceId)).toBe(1);

    // Payment is still 'paid' (not double-updated to something weird)
    const payment = getPaymentBySession(ws.workspaceId, sessionId);
    expect(payment).toBeDefined();
    expect(payment!.status).toBe('paid');

    // Tier stays growth
    expect(getWorkspace(ws.workspaceId)?.tier).toBe('growth');
  });

  // ── 4. Free → growth tier upgrade with correct metadata ──────────────────

  it('free → growth: productType plan_growth in metadata triggers tier upgrade', async () => {
    const sessionId = 'cs_test_tier_growth_meta';
    mockCheckoutSession({ id: sessionId, url: 'https://checkout.stripe.com/tier_growth' });

    // Confirm starting tier
    expect(getWorkspace(ws.workspaceId)?.tier).toBe('free');

    // Create checkout with plan_growth
    await createCheckoutSession({
      workspaceId: ws.workspaceId,
      productType: 'plan_growth',
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
    });

    // Webhook with plan_growth metadata
    const event = createWebhookEvent('checkout.session.completed', {
      id: sessionId,
      metadata: {
        workspaceId: ws.workspaceId,
        productType: 'plan_growth',
      },
      amount_total: 24900,
    });
    await handleWebhookEvent(event as never);

    // Tier must be 'growth'
    const wsAfter = getWorkspace(ws.workspaceId);
    expect(wsAfter?.tier).toBe('growth');

    // trialEndsAt should be cleared on upgrade (set to undefined by the handler)
    // The handler calls: updateWorkspace(workspaceId, { tier: newTier, trialEndsAt: undefined })
    // After this, trialEndsAt should be null/undefined
    expect(wsAfter?.trialEndsAt).toBeFalsy();
  });

  // ── 5. Free → premium tier upgrade ──────────────────────────────────────

  it('free → premium: productType plan_premium in metadata triggers premium upgrade', async () => {
    const sessionId = 'cs_test_tier_premium';
    mockCheckoutSession({ id: sessionId, url: 'https://checkout.stripe.com/tier_premium' });

    expect(getWorkspace(ws.workspaceId)?.tier).toBe('free');

    await createCheckoutSession({
      workspaceId: ws.workspaceId,
      productType: 'plan_premium',
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
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

    const wsAfter = getWorkspace(ws.workspaceId);
    expect(wsAfter?.tier).toBe('premium');
  });

  // ── 6. Checkout API failure → no stale payment record ───────────────────

  it('checkout API failure: no stale payment record created (FM-2 for Stripe)', async () => {
    mockCheckoutSessionError('Stripe API rate limited');

    await expect(
      createCheckoutSession({
        workspaceId: ws.workspaceId,
        productType: 'plan_growth',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      }),
    ).rejects.toThrow('Stripe API rate limited');

    // No payment records should exist — createCheckoutSession calls Stripe
    // before creating the payment record, so a Stripe failure means
    // no record is written.
    const payments = listPayments(ws.workspaceId);
    expect(payments).toHaveLength(0);

    // Workspace tier must remain free
    expect(getWorkspace(ws.workspaceId)?.tier).toBe('free');
  });

  // ── 7. Webhook with unknown event type — no-op ─────────────────────────

  it('webhook with unknown event type: no-op, no crash', async () => {
    const event = createWebhookEvent('unknown.future.event', {
      id: 'obj_unknown_123',
      metadata: { workspaceId: ws.workspaceId },
    });

    // Should not throw
    await handleWebhookEvent(event as never);

    // No side effects — no payments created, tier unchanged
    expect(listPayments(ws.workspaceId)).toHaveLength(0);
    expect(getWorkspace(ws.workspaceId)?.tier).toBe('free');
  });

  // ── 8. Non-plan product does NOT trigger tier upgrade (FM-11) ───────────

  it('non-plan product checkout + webhook: no tier change (FM-11)', async () => {
    const sessionId = 'cs_test_no_tier_change';
    mockCheckoutSession({ id: sessionId, url: 'https://checkout.stripe.com/no_tier' });

    await createCheckoutSession({
      workspaceId: ws.workspaceId,
      productType: 'brief_blog',
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
    });

    const event = createWebhookEvent('checkout.session.completed', {
      id: sessionId,
      metadata: {
        workspaceId: ws.workspaceId,
        productType: 'brief_blog',
      },
      amount_total: 12500,
      payment_intent: 'pi_test_no_tier',
    });
    await handleWebhookEvent(event as never);

    // Payment should be marked paid
    const payment = getPaymentBySession(ws.workspaceId, sessionId);
    expect(payment).toBeDefined();
    expect(payment!.status).toBe('paid');

    // But tier must remain 'free' — brief_blog is not a plan product
    expect(getWorkspace(ws.workspaceId)?.tier).toBe('free');
  });
});
