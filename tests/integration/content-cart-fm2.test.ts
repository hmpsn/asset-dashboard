/**
 * FM-2 per-family isolation for mixed (fix + content) cart fulfillment (R2-E).
 *
 * One family's fulfillment failure must NOT swallow the other's, and must be
 * RECORDED as a failure (not silently treated as success). This file mocks the
 * work-orders module so the FIX family throws on fulfillment; the CONTENT family
 * must still advance, and the failure must be logged.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setupStripeMocks,
  mockCheckoutSession,
  mockCustomerCreate,
  mockCustomerRetrieve,
  resetStripeMocks,
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

// FIX family fails: createWorkOrder throws. listWorkOrders passes through to the
// real implementation so we can still assert the lack of fix fulfillment.
vi.mock('../../server/work-orders.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/work-orders.js')>();
  return {
    ...actual,
    createWorkOrder: vi.fn(() => { throw new Error('simulated work-order failure'); }),
  };
});

import { createCartCheckoutSession, handleWebhookEvent } from '../../server/stripe.js';
import { listContentRequests } from '../../server/content-requests.js';
import db from '../../server/db/index.js';

describe('Mixed cart FM-2 — fix failure does not swallow content', () => {
  let ws: SeededFullWorkspace;

  beforeEach(() => {
    resetStripeMocks();
    mockCustomerCreate();
    mockCustomerRetrieve();
    mockCheckoutSession({ id: 'cs_fm2_mix', url: 'https://checkout.stripe.com/fm2' });
    ws = seedWorkspace({ tier: 'growth' });
  });

  afterEach(() => {
    db.prepare('DELETE FROM payments WHERE workspace_id = ?').run(ws.workspaceId);
    db.prepare('DELETE FROM work_orders WHERE workspace_id = ?').run(ws.workspaceId);
    db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(ws.workspaceId);
    db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(ws.workspaceId);
    ws.cleanup();
  });

  it('content request still advances when the fix work order throws, and the failure is recorded', async () => {
    await createCartCheckoutSession({
      workspaceId: ws.workspaceId,
      items: [
        { productType: 'fix_meta', quantity: 1, pageIds: ['/a'], issueChecks: ['title'] },
        {
          productType: 'brief_blog',
          quantity: 1,
          content: { topic: 'Survives', targetKeyword: 'survives kw', serviceType: 'brief_only', pageType: 'blog', source: 'strategy' },
        },
      ],
      successUrl: 'https://x/s',
      cancelUrl: 'https://x/c',
    });

    const event = createWebhookEvent('checkout.session.completed', {
      id: 'cs_fm2_mix',
      metadata: { workspaceId: ws.workspaceId, cartItemCount: '2', productTypes: 'fix_meta,brief_blog' },
      amount_total: 14500,
      payment_intent: 'pi_fm2_mix',
    });
    // The fix family throws internally, but the webhook must NOT throw — content
    // must still be fulfilled.
    await handleWebhookEvent(event as never);

    // Content advanced despite the fix failure.
    const reqs = listContentRequests(ws.workspaceId);
    expect(reqs.length).toBe(1);
    expect(reqs[0].status).toBe('requested');

    // Failure recorded (not silently swallowed).
    const failures = db.prepare(
      "SELECT COUNT(*) as n FROM activity_log WHERE workspace_id = ? AND type = 'payment_failed'",
    ).get(ws.workspaceId) as { n: number };
    expect(failures.n).toBeGreaterThanOrEqual(1);
  });
});
