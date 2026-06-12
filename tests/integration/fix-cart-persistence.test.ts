/**
 * Integration tests for out-of-band cart persistence (feat/client-revenue-r1 §3).
 *
 * Stripe checkout-session metadata values are capped at 500 chars. A large cart
 * (15+ pages) whose normalized line items + merged pageIds were stuffed into
 * `metadata.cartItems` would exceed that cap and make Stripe throw opaquely.
 *
 * The fix: persist the full normalized cart on the payment record (cart_items
 * column), keep metadata to a compact reference (cartItemCount + productTypes),
 * and have the webhook read the persisted cart for work-order fulfillment.
 *
 * Covers:
 *  - large cart does not stuff the full cart JSON into metadata
 *  - every metadata value stays within Stripe's 500-char limit
 *  - the persisted cart_items round-trips with all pageIds
 *  - the webhook builds work orders from the persisted cart (not metadata)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setupStripeMocks,
  mockCheckoutSession,
  mockCustomerCreate,
  mockCustomerRetrieve,
  resetStripeMocks,
  mockCheckoutSessionsCreate,
  createWebhookEvent,
} from '../mocks/stripe.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';

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

import { createCartCheckoutSession, handleWebhookEvent } from '../../server/stripe.js';
import { getCartItemsBySession, listPaymentsBySession } from '../../server/payments.js';
import db from '../../server/db/index.js';

/** Metadata passed to Stripe checkout.sessions.create on the last call. */
function lastMetadata(): Record<string, string> {
  const call = mockCheckoutSessionsCreate.mock.calls.at(-1);
  return (call?.[0]?.metadata ?? {}) as Record<string, string>;
}

describe('Fix cart out-of-band persistence (§3 — 500-char metadata limit)', () => {
  let ws: SeededFullWorkspace;

  beforeEach(() => {
    resetStripeMocks();
    mockCustomerCreate();
    mockCustomerRetrieve();
    mockCheckoutSession({ id: 'cs_persist_001', url: 'https://checkout.stripe.com/persist' });
    ws = seedWorkspace();
  });

  afterEach(() => {
    db.prepare('DELETE FROM payments WHERE workspace_id = ?').run(ws.workspaceId);
    db.prepare('DELETE FROM work_orders WHERE workspace_id = ?').run(ws.workspaceId);
    db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(ws.workspaceId);
    ws.cleanup();
  });

  /** Build a 15-page metadata cart whose serialized form would blow past 500 chars. */
  function bigPageIds(n: number): string[] {
    return Array.from({ length: n }, (_, i) => `/some/reasonably-long-page-path/segment-${i}`);
  }

  it('large cart succeeds and keeps every metadata value under 500 chars', async () => {
    const pageIds = bigPageIds(15);
    await createCartCheckoutSession({
      workspaceId: ws.workspaceId,
      items: [{ productType: 'fix_meta', quantity: 15, pageIds, issueChecks: ['title'] }],
      successUrl: 'https://x/s',
      cancelUrl: 'https://x/c',
    });

    const metadata = lastMetadata();
    // No oversized value
    for (const [key, value] of Object.entries(metadata)) {
      expect(String(value).length, `metadata.${key} exceeds Stripe 500-char limit`).toBeLessThanOrEqual(500);
    }
    // The full cart JSON must NOT be inlined into metadata
    expect(metadata.cartItems).toBeUndefined();
    // Compact reference is present
    expect(Number(metadata.cartItemCount)).toBeGreaterThan(0);
  });

  it('persists the full normalized cart (all pageIds) on the payment records', async () => {
    const pageIds = bigPageIds(15);
    await createCartCheckoutSession({
      workspaceId: ws.workspaceId,
      items: [{ productType: 'fix_meta', quantity: 15, pageIds, issueChecks: ['title'] }],
      successUrl: 'https://x/s',
      cancelUrl: 'https://x/c',
    });

    const persisted = getCartItemsBySession(ws.workspaceId, 'cs_persist_001');
    expect(persisted).not.toBeNull();
    // All 15 pages survive across the pack(s) + per-page split
    const allPages = persisted!.flatMap(i => i.pageIds ?? []);
    for (const id of pageIds) expect(allPages).toContain(id);
    // The check context survives too
    const allChecks = persisted!.flatMap(i => i.issueChecks ?? []);
    expect(allChecks).toContain('title');
  });

  it('webhook builds work orders from the persisted cart, not metadata', async () => {
    const pageIds = bigPageIds(15);
    await createCartCheckoutSession({
      workspaceId: ws.workspaceId,
      items: [{ productType: 'fix_meta', quantity: 15, pageIds, issueChecks: ['title'] }],
      successUrl: 'https://x/s',
      cancelUrl: 'https://x/c',
    });

    // The webhook event carries ONLY the compact metadata Stripe would echo back.
    const sessionPayments = listPaymentsBySession(ws.workspaceId, 'cs_persist_001');
    expect(sessionPayments.length).toBeGreaterThan(0);

    const event = createWebhookEvent('checkout.session.completed', {
      id: 'cs_persist_001',
      metadata: {
        workspaceId: ws.workspaceId,
        cartItemCount: String(sessionPayments.length),
        productTypes: 'fix_meta_10,fix_meta',
        // deliberately NO cartItems blob here — fulfillment must use the persisted record
      },
      amount_total: 35800,
      payment_intent: 'pi_persist_001',
    });

    await handleWebhookEvent(event as never);

    const orders = db
      .prepare('SELECT * FROM work_orders WHERE workspace_id = ?')
      .all(ws.workspaceId) as Array<{ page_ids: string }>;
    expect(orders.length).toBeGreaterThan(0);
    // All 15 pages reach work orders
    const workOrderPages = orders.flatMap(o => JSON.parse(o.page_ids) as string[]);
    for (const id of pageIds) expect(workOrderPages).toContain(id);
  });
});
