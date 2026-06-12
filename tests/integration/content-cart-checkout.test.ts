/**
 * Integration tests for content-in-cart checkout (R2-E).
 *
 * Briefs/posts are cart-addable alongside the existing Buy-now flow. A single
 * cart can mix FIXES (work orders) and CONTENT (content requests). This suite
 * covers:
 *   - mixed basket (2 fixes + 1 brief) → correct line items, one work order +
 *     one content request after the webhook
 *   - Premium content discount math (content discounted 10%, fixes never enter a
 *     Premium cart so are absent)
 *   - Growth/non-Premium content → no discount
 *   - FM-2 per family: one family's fulfillment failure does not swallow the
 *     other's, and is recorded as a failure (not success)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setupStripeMocks,
  mockCheckoutSession,
  mockCheckoutSessionError,
  mockCustomerCreate,
  mockCustomerRetrieve,
  resetStripeMocks,
  mockCheckoutSessionsCreate,
  createWebhookEvent,
} from '../mocks/stripe.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { PREMIUM_CONTENT_DISCOUNT } from '../../shared/pricing.js';
import { WS_EVENTS } from '../../server/ws-events.js';

setupStripeMocks();

vi.mock('../../server/stripe-config.js', () => ({
  getStripeSecretKey: vi.fn(() => 'sk_test_fake'),
  getStripeWebhookSecret: vi.fn(() => 'whsec_test_fake'),
  getStripePriceId: vi.fn((productType: string) => `price_${productType}`),
  getStripeConfigSafe: vi.fn(() => ({})),
  getStripePublishableKey: vi.fn(() => 'pk_test_fake'),
  saveStripeKeys: vi.fn(),
  saveStripeProducts: vi.fn(),
  clearStripeConfig: vi.fn(),
}));

import { createCartCheckoutSession, handleWebhookEvent, initStripeBroadcast } from '../../server/stripe.js';
import { listPayments } from '../../server/payments.js';
import { listWorkOrders } from '../../server/work-orders.js';
import { listContentRequests } from '../../server/content-requests.js';
import db from '../../server/db/index.js';

/** Line items passed to the last Stripe checkout.sessions.create call. */
function lastLineItems(): Array<Record<string, unknown>> {
  const call = mockCheckoutSessionsCreate.mock.calls.at(-1);
  return (call?.[0]?.line_items ?? []) as Array<Record<string, unknown>>;
}

function briefContext(topic: string) {
  return {
    topic,
    targetKeyword: `${topic} keyword`,
    serviceType: 'brief_only' as const,
    pageType: 'blog' as const,
    source: 'strategy' as const,
  };
}

function cleanup(ws: SeededFullWorkspace) {
  db.prepare('DELETE FROM payments WHERE workspace_id = ?').run(ws.workspaceId);
  db.prepare('DELETE FROM work_orders WHERE workspace_id = ?').run(ws.workspaceId);
  db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(ws.workspaceId);
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(ws.workspaceId);
  ws.cleanup();
}

describe('Content-in-cart checkout — mixed baskets', () => {
  let ws: SeededFullWorkspace;

  beforeEach(() => {
    resetStripeMocks();
    mockCustomerCreate();
    mockCustomerRetrieve();
    mockCheckoutSession({ id: 'cs_mixed_001', url: 'https://checkout.stripe.com/mixed' });
    ws = seedWorkspace({ tier: 'growth' });
  });

  afterEach(() => cleanup(ws));

  it('mixes 2 fix pages + 1 brief into correct line items and one content request', async () => {
    await createCartCheckoutSession({
      workspaceId: ws.workspaceId,
      items: [
        { productType: 'fix_meta', quantity: 2, pageIds: ['/a', '/b'], issueChecks: ['title'] },
        { productType: 'brief_blog', quantity: 1, content: briefContext('Spring sale guide') },
      ],
      successUrl: 'https://x/s',
      cancelUrl: 'https://x/c',
    });

    // Two distinct families → at least one fix line + one brief line.
    const lineItems = lastLineItems();
    expect(lineItems.length).toBeGreaterThanOrEqual(2);

    // A content request was created in pending_payment for the brief.
    const reqs = listContentRequests(ws.workspaceId);
    expect(reqs.length).toBe(1);
    expect(reqs[0].topic).toBe('Spring sale guide');
    expect(reqs[0].status).toBe('pending_payment');
    expect(reqs[0].serviceType).toBe('brief_only');
  });

  it('webhook fulfills both families: one work order AND one content request advances, and broadcasts CONTENT_REQUEST_UPDATE', async () => {
    // Data Flow Rule 1: capture broadcasts so we can assert the cart content
    // fulfillment emits CONTENT_REQUEST_UPDATE per advanced item (mirrors the
    // single-purchase path). Register a spy and restore the prod fn afterward.
    const broadcasts: Array<{ event: string; data: unknown }> = [];
    initStripeBroadcast((_wsId, event, data) => { broadcasts.push({ event, data }); });

    try {
      await createCartCheckoutSession({
        workspaceId: ws.workspaceId,
        items: [
          { productType: 'fix_meta', quantity: 2, pageIds: ['/a', '/b'], issueChecks: ['title'] },
          { productType: 'brief_blog', quantity: 1, content: briefContext('Spring sale guide') },
        ],
        successUrl: 'https://x/s',
        cancelUrl: 'https://x/c',
      });

      const event = createWebhookEvent('checkout.session.completed', {
        id: 'cs_mixed_001',
        metadata: { workspaceId: ws.workspaceId, cartItemCount: '2', productTypes: 'fix_meta,brief_blog' },
        amount_total: 16500,
        payment_intent: 'pi_mixed_001',
      });
      await handleWebhookEvent(event as never);

      // Fix → exactly one metadata work order.
      const orders = listWorkOrders(ws.workspaceId);
      expect(orders.filter(o => o.productType === 'fix_meta').length).toBe(1);

      // Content → request advanced out of pending_payment.
      const reqs = listContentRequests(ws.workspaceId);
      expect(reqs.length).toBe(1);
      expect(reqs[0].status).toBe('requested');

      // Broadcast emitted for the advanced content request.
      const contentBroadcasts = broadcasts.filter(b => b.event === WS_EVENTS.CONTENT_REQUEST_UPDATE);
      expect(contentBroadcasts.length).toBe(1);
      expect(contentBroadcasts[0].data).toMatchObject({ id: reqs[0].id, status: 'requested' });
    } finally {
      // Restore a no-op broadcaster so the spy doesn't bleed into other tests.
      initStripeBroadcast(() => {});
    }
  });

  it('content-only cart creates no work orders', async () => {
    await createCartCheckoutSession({
      workspaceId: ws.workspaceId,
      items: [
        { productType: 'brief_blog', quantity: 1, content: briefContext('Topic one') },
        { productType: 'post_polished', quantity: 1, content: { ...briefContext('Topic two'), serviceType: 'full_post' } },
      ],
      successUrl: 'https://x/s',
      cancelUrl: 'https://x/c',
    });

    const event = createWebhookEvent('checkout.session.completed', {
      id: 'cs_mixed_001',
      metadata: { workspaceId: ws.workspaceId, cartItemCount: '2', productTypes: 'brief_blog,post_polished' },
      amount_total: 62500,
      payment_intent: 'pi_content_only',
    });
    await handleWebhookEvent(event as never);

    expect(listWorkOrders(ws.workspaceId).length).toBe(0);
    // Two distinct content requests, both advanced.
    const reqs = listContentRequests(ws.workspaceId);
    expect(reqs.length).toBe(2);
    expect(reqs.length).toBeGreaterThan(0);
    expect(reqs.every(r => r.status === 'requested')).toBe(true); // every-ok — length asserted on the previous line
  });

  it('two briefs with the same keyword create TWO distinct content requests (no dedupe)', async () => {
    await createCartCheckoutSession({
      workspaceId: ws.workspaceId,
      items: [
        { productType: 'brief_blog', quantity: 1, content: briefContext('Same') },
        { productType: 'brief_blog', quantity: 1, content: briefContext('Same') },
      ],
      successUrl: 'https://x/s',
      cancelUrl: 'https://x/c',
    });
    expect(listContentRequests(ws.workspaceId).length).toBe(2);
  });
});

describe('Content-in-cart checkout — Premium discount math', () => {
  let ws: SeededFullWorkspace;

  beforeEach(() => {
    resetStripeMocks();
    mockCustomerCreate();
    mockCustomerRetrieve();
    mockCheckoutSession({ id: 'cs_prem_001', url: 'https://checkout.stripe.com/prem' });
  });

  afterEach(() => cleanup(ws));

  it('Premium content line uses an inline discounted price_data (10% off) and a discounted payment amount', async () => {
    ws = seedWorkspace({ tier: 'premium' });
    await createCartCheckoutSession({
      workspaceId: ws.workspaceId,
      items: [{ productType: 'brief_blog', quantity: 1, content: briefContext('Premium brief') }],
      successUrl: 'https://x/s',
      cancelUrl: 'https://x/c',
    });

    // brief_blog is $125; 10% off → $112.50 = 11250 cents.
    const expectedCents = Math.round(125 * 100 * (1 - PREMIUM_CONTENT_DISCOUNT));
    expect(expectedCents).toBe(11250);

    const lineItems = lastLineItems();
    expect(lineItems.length).toBe(1);
    const priceData = lineItems[0].price_data as { unit_amount: number } | undefined;
    expect(priceData?.unit_amount).toBe(expectedCents);
    // No fixed price id on a discounted content line.
    expect(lineItems[0].price).toBeUndefined();

    // Payment record stores the discounted amount.
    const payment = listPayments(ws.workspaceId).find(p => p.productType === 'brief_blog');
    expect(payment?.amount).toBe(expectedCents);
  });

  it('Growth (non-Premium) content line uses the fixed price id at full price', async () => {
    ws = seedWorkspace({ tier: 'growth' });
    await createCartCheckoutSession({
      workspaceId: ws.workspaceId,
      items: [{ productType: 'brief_blog', quantity: 1, content: briefContext('Growth brief') }],
      successUrl: 'https://x/s',
      cancelUrl: 'https://x/c',
    });

    const lineItems = lastLineItems();
    expect(lineItems[0].price).toBe('price_brief_blog');
    expect(lineItems[0].price_data).toBeUndefined();

    const payment = listPayments(ws.workspaceId).find(p => p.productType === 'brief_blog');
    expect(payment?.amount).toBe(125 * 100);
  });

  it('Premium full-post content is discounted too', async () => {
    ws = seedWorkspace({ tier: 'premium' });
    await createCartCheckoutSession({
      workspaceId: ws.workspaceId,
      items: [{ productType: 'post_polished', quantity: 1, content: { ...briefContext('Premium post'), serviceType: 'full_post' } }],
      successUrl: 'https://x/s',
      cancelUrl: 'https://x/c',
    });
    // post_polished is $500; 10% off → $450 = 45000 cents.
    const payment = listPayments(ws.workspaceId).find(p => p.productType === 'post_polished');
    expect(payment?.amount).toBe(Math.round(500 * 100 * (1 - PREMIUM_CONTENT_DISCOUNT)));
  });
});

describe('Content-in-cart checkout — orphaned pending_payment guard (FM-2)', () => {
  let ws: SeededFullWorkspace;

  beforeEach(() => {
    resetStripeMocks();
    mockCustomerCreate();
    mockCustomerRetrieve();
    ws = seedWorkspace({ tier: 'growth' });
  });

  afterEach(() => cleanup(ws));

  it('cleans up just-created pending_payment requests when stripe.sessions.create fails (no stranded rows)', async () => {
    // Force the session creation to reject AFTER the content requests are created.
    mockCheckoutSessionError('stripe down');

    await expect(
      createCartCheckoutSession({
        workspaceId: ws.workspaceId,
        items: [
          { productType: 'brief_blog', quantity: 1, content: briefContext('Stranded brief one') },
          { productType: 'post_polished', quantity: 1, content: { ...briefContext('Stranded brief two'), serviceType: 'full_post' } },
        ],
        successUrl: 'https://x/s',
        cancelUrl: 'https://x/c',
      }),
    ).rejects.toThrow('stripe down');

    // No content requests should remain — the failed checkout must not leave the
    // client looking at "Awaiting Payment" rows for a checkout that never started.
    const reqs = listContentRequests(ws.workspaceId);
    expect(reqs.length).toBe(0);

    // Belt-and-suspenders: no pending_payment rows in the table either.
    const stranded = db.prepare(
      "SELECT COUNT(*) as n FROM content_topic_requests WHERE workspace_id = ? AND status = 'pending_payment'",
    ).get(ws.workspaceId) as { n: number };
    expect(stranded.n).toBe(0);
  });
});

describe('Content-in-cart checkout — paid-but-missing reconciliation (FM-2)', () => {
  let ws: SeededFullWorkspace;

  beforeEach(() => {
    resetStripeMocks();
    mockCustomerCreate();
    mockCustomerRetrieve();
    mockCheckoutSession({ id: 'cs_missing_001', url: 'https://checkout.stripe.com/missing' });
    ws = seedWorkspace({ tier: 'growth' });
  });

  afterEach(() => cleanup(ws));

  it('records a fulfillment failure when a paid cart content request has vanished before the webhook', async () => {
    await createCartCheckoutSession({
      workspaceId: ws.workspaceId,
      items: [{ productType: 'brief_blog', quantity: 1, content: briefContext('Vanishing brief') }],
      successUrl: 'https://x/s',
      cancelUrl: 'https://x/c',
    });

    // Simulate the request disappearing between checkout and webhook (e.g. deleted
    // out-of-band). The webhook must treat this as a paid-but-unfulfilled failure,
    // not a silent log.warn.
    db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(ws.workspaceId);

    const event = createWebhookEvent('checkout.session.completed', {
      id: 'cs_missing_001',
      metadata: { workspaceId: ws.workspaceId, cartItemCount: '1', productTypes: 'brief_blog' },
      amount_total: 12500,
      payment_intent: 'pi_missing_001',
    });
    await handleWebhookEvent(event as never);

    // A reconciliation activity must fire for the paid-but-missing item.
    const failures = db.prepare(
      "SELECT COUNT(*) as n FROM activity_log WHERE workspace_id = ? AND type = 'payment_failed'",
    ).get(ws.workspaceId) as { n: number };
    expect(failures.n).toBeGreaterThanOrEqual(1);
  });
});

