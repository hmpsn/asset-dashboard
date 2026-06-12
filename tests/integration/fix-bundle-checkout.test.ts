/**
 * Integration tests for SERVER-AUTHORITATIVE fix bundle pricing through the
 * Stripe cart-checkout builder (server/stripe.ts createCartCheckoutSession).
 *
 * The server — not the client — decides pack vs per-page splits. A client may
 * send `fix_meta ×23`; the server must re-bundle that into 2 packs + 3 per-page
 * line items and create payment records whose amounts match the authoritative
 * total ($179×2 + $20×3 = $418). This prevents price-display drift from ever
 * becoming a charge mismatch.
 *
 * Also covers FM-2: a Stripe API failure creates NO payment records.
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

import { createCartCheckoutSession } from '../../server/stripe.js';
import { listPayments } from '../../server/payments.js';

/** Sum of payment-record amounts (cents) for a session. */
function totalCents(ws: SeededFullWorkspace): number {
  return listPayments(ws.workspaceId).reduce((sum, p) => sum + p.amount, 0);
}

/** Line items passed to Stripe checkout.sessions.create on the last call. */
function lastLineItems(): Array<{ price: string; quantity: number }> {
  const call = mockCheckoutSessionsCreate.mock.calls.at(-1);
  return call?.[0]?.line_items ?? [];
}

describe('Fix bundle checkout — server-authoritative pricing', () => {
  let ws: SeededFullWorkspace;

  beforeEach(() => {
    resetStripeMocks();
    mockCustomerCreate();
    mockCustomerRetrieve();
    mockCheckoutSession({ id: 'cs_bundle_001', url: 'https://checkout.stripe.com/bundle' });
    ws = seedWorkspace();
  });

  afterEach(() => ws.cleanup());

  it('metadata ×23 re-bundles to 2 packs + 3 per-page = $418', async () => {
    await createCartCheckoutSession({
      workspaceId: ws.workspaceId,
      items: [{ productType: 'fix_meta', quantity: 23 }],
      successUrl: 'https://x/s',
      cancelUrl: 'https://x/c',
    });

    // Authoritative total: $179×2 + $20×3 = $41800 cents
    expect(totalCents(ws)).toBe(41800);

    const items = lastLineItems();
    const pack = items.find(i => i.price === 'price_fix_meta_10');
    const per = items.find(i => i.price === 'price_fix_meta');
    expect(pack?.quantity).toBe(2);
    expect(per?.quantity).toBe(3);
  });

  it('schema ×10 collapses to exactly one pack ($299), no per-page line', async () => {
    await createCartCheckoutSession({
      workspaceId: ws.workspaceId,
      items: [{ productType: 'schema_page', quantity: 10 }],
      successUrl: 'https://x/s',
      cancelUrl: 'https://x/c',
    });
    expect(totalCents(ws)).toBe(29900);
    const items = lastLineItems();
    expect(items.find(i => i.price === 'price_schema_10')?.quantity).toBe(1);
    expect(items.find(i => i.price === 'price_schema_page')).toBeUndefined();
  });

  it('metadata ×9 stays per-page (no pack) = $180', async () => {
    await createCartCheckoutSession({
      workspaceId: ws.workspaceId,
      items: [{ productType: 'fix_meta', quantity: 9 }],
      successUrl: 'https://x/s',
      cancelUrl: 'https://x/c',
    });
    expect(totalCents(ws)).toBe(18000);
    const items = lastLineItems();
    expect(items.find(i => i.price === 'price_fix_meta')?.quantity).toBe(9);
    expect(items.find(i => i.price === 'price_fix_meta_10')).toBeUndefined();
  });

  it('alt-text is always flat $50 regardless of quantity', async () => {
    await createCartCheckoutSession({
      workspaceId: ws.workspaceId,
      items: [{ productType: 'fix_alt', quantity: 40 }],
      successUrl: 'https://x/s',
      cancelUrl: 'https://x/c',
    });
    expect(totalCents(ws)).toBe(5000);
    const items = lastLineItems();
    expect(items.find(i => i.price === 'price_fix_alt')?.quantity).toBe(1);
  });

  it('client-supplied pack split is normalized — fix_meta_10 ×1 + fix_meta ×13 → 2 packs + 3', async () => {
    // The client tries to game the split; the server re-aggregates the family to
    // 23 metadata items and re-bundles authoritatively.
    await createCartCheckoutSession({
      workspaceId: ws.workspaceId,
      items: [
        { productType: 'fix_meta_10', quantity: 1 },
        { productType: 'fix_meta', quantity: 13 },
      ],
      successUrl: 'https://x/s',
      cancelUrl: 'https://x/c',
    });
    expect(totalCents(ws)).toBe(41800); // same as 23 metadata items
  });

  it('mixed families price independently — metadata ×10 + redirect ×3', async () => {
    await createCartCheckoutSession({
      workspaceId: ws.workspaceId,
      items: [
        { productType: 'fix_meta', quantity: 10 },
        { productType: 'fix_redirect', quantity: 3 },
      ],
      successUrl: 'https://x/s',
      cancelUrl: 'https://x/c',
    });
    // $179 (1 meta pack) + $19×3 (redirects) = $236
    expect(totalCents(ws)).toBe(23600);
  });

  it('non-fix products pass through unchanged — brief_blog ×1 + schema ×10', async () => {
    await createCartCheckoutSession({
      workspaceId: ws.workspaceId,
      items: [
        { productType: 'brief_blog', quantity: 1 },
        { productType: 'schema_page', quantity: 10 },
      ],
      successUrl: 'https://x/s',
      cancelUrl: 'https://x/c',
    });
    // $125 (brief) + $299 (schema pack) = $424
    expect(totalCents(ws)).toBe(42400);
  });

  it('FM-2: Stripe API error creates no payment records', async () => {
    mockCheckoutSessionError('Stripe unavailable');
    await expect(
      createCartCheckoutSession({
        workspaceId: ws.workspaceId,
        items: [{ productType: 'fix_meta', quantity: 23 }],
        successUrl: 'https://x/s',
        cancelUrl: 'https://x/c',
      }),
    ).rejects.toThrow('Stripe unavailable');
    expect(listPayments(ws.workspaceId).length).toBe(0);
  });
});
