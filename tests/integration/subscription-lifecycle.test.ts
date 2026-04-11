/**
 * Integration tests for the content subscription lifecycle.
 *
 * Covers:
 * 1. Subscription creation — new subscription for a workspace
 * 2. Active → renewal flow (invoice.paid webhook resets period)
 * 3. Subscription cancellation (customer.subscription.deleted)
 * 4. Subscription expiration / past_due handling
 * 5. State transitions via CONTENT_SUB_TRANSITIONS — valid and invalid paths
 * 6. Stripe webhook handling for subscription events
 *
 * Uses in-process DB calls (no HTTP server).
 * Stripe SDK is mocked via tests/mocks/stripe.ts.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
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
// Module-level mock setup — must be called before imports of the modules under test
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
// Imports of modules under test (after mocks are declared)
// ---------------------------------------------------------------------------

import {
  createContentSubscription,
  getContentSubscription,
  getContentSubscriptionByStripeId,
  listContentSubscriptions,
  listActiveContentSubscriptions,
  updateContentSubscription,
  deleteContentSubscription,
  incrementDeliveredPosts,
  resetPeriod,
} from '../../server/content-subscriptions.js';
import { handleWebhookEvent, initStripeBroadcast } from '../../server/stripe.js';
import {
  CONTENT_SUB_TRANSITIONS,
  validateTransition,
  InvalidTransitionError,
} from '../../server/state-machines.js';
import type { ContentSubscription } from '../../shared/types/content.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countContentSubs(workspaceId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) as cnt FROM content_subscriptions WHERE workspace_id = ?')
    .get(workspaceId) as { cnt: number };
  return row.cnt;
}

function cleanupContentSubs(workspaceId: string): void {
  db.prepare('DELETE FROM content_subscriptions WHERE workspace_id = ?').run(workspaceId);
}

function cleanupActivity(workspaceId: string): void {
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(workspaceId);
}

/** Seed a content subscription for a workspace in the given status. */
function seedSubscription(
  workspaceId: string,
  opts: {
    status?: ContentSubscription['status'];
    stripeSubscriptionId?: string;
    plan?: ContentSubscription['plan'];
    postsPerMonth?: number;
    priceUsd?: number;
    currentPeriodStart?: string;
    currentPeriodEnd?: string;
  } = {},
): ContentSubscription {
  const now = new Date().toISOString();
  const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  return createContentSubscription(workspaceId, {
    plan: opts.plan ?? 'content_starter',
    postsPerMonth: opts.postsPerMonth ?? 2,
    priceUsd: opts.priceUsd ?? 500,
    status: opts.status ?? 'pending',
    stripeSubscriptionId: opts.stripeSubscriptionId,
    currentPeriodStart: opts.currentPeriodStart ?? now,
    currentPeriodEnd: opts.currentPeriodEnd ?? periodEnd,
  });
}

// ============================================================================
// 1. Subscription Creation
// ============================================================================

describe('Content Subscription — creation', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace();
  });

  afterAll(() => {
    cleanupContentSubs(ws.workspaceId);
    cleanupActivity(ws.workspaceId);
    ws.cleanup();
  });

  it('creates a new subscription with default pending status', () => {
    const sub = seedSubscription(ws.workspaceId);

    expect(sub.id).toBeTruthy();
    expect(sub.id).toMatch(/^csub-/);
    expect(sub.workspaceId).toBe(ws.workspaceId);
    expect(sub.plan).toBe('content_starter');
    expect(sub.postsPerMonth).toBe(2);
    expect(sub.priceUsd).toBe(500);
    expect(sub.status).toBe('pending');
    expect(sub.postsDeliveredThisPeriod).toBe(0);
    expect(sub.topicSource).toBe('strategy_gaps');
    expect(sub.createdAt).toBeTruthy();
    expect(sub.updatedAt).toBeTruthy();
  });

  it('creates subscription with explicit active status', () => {
    const sub = seedSubscription(ws.workspaceId, { status: 'active' });
    expect(sub.status).toBe('active');
  });

  it('creates subscription with Stripe IDs', () => {
    const sub = createContentSubscription(ws.workspaceId, {
      plan: 'content_growth',
      postsPerMonth: 4,
      priceUsd: 900,
      stripeSubscriptionId: 'sub_test_create_001',
      stripePriceId: 'price_test_create_001',
      status: 'active',
    });

    expect(sub.stripeSubscriptionId).toBe('sub_test_create_001');
    expect(sub.stripePriceId).toBe('price_test_create_001');
  });

  it('creates subscription with preferred page types', () => {
    const sub = createContentSubscription(ws.workspaceId, {
      plan: 'content_scale',
      postsPerMonth: 8,
      priceUsd: 1600,
      preferredPageTypes: ['blog', 'landing'],
      topicSource: 'manual',
      notes: 'Focus on top-funnel content',
    });

    expect(sub.preferredPageTypes).toEqual(['blog', 'landing']);
    expect(sub.topicSource).toBe('manual');
    expect(sub.notes).toBe('Focus on top-funnel content');
  });

  it('persists the subscription to the database', () => {
    const sub = seedSubscription(ws.workspaceId);
    const fetched = getContentSubscription(sub.id);

    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(sub.id);
    expect(fetched!.workspaceId).toBe(ws.workspaceId);
    expect(fetched!.plan).toBe('content_starter');
  });

  it('lists subscriptions for a workspace', () => {
    const initialCount = listContentSubscriptions(ws.workspaceId).length;
    seedSubscription(ws.workspaceId);
    const subs = listContentSubscriptions(ws.workspaceId);
    expect(subs.length).toBe(initialCount + 1);
  });

  it('returns null for a non-existent subscription id', () => {
    const result = getContentSubscription('csub-does-not-exist');
    expect(result).toBeNull();
  });
});

// ============================================================================
// 2. Active → Renewal Flow (invoice.paid webhook)
// ============================================================================

describe('Content Subscription — active → renewal flow', () => {
  let ws: SeededFullWorkspace;
  const mockBroadcast = vi.fn();
  const STRIPE_SUB_ID = 'sub_test_renewal_001';

  beforeAll(() => {
    ws = seedWorkspace();
    initStripeBroadcast(mockBroadcast);
  });

  beforeEach(() => {
    resetStripeMocks();
    mockBroadcast.mockClear();
  });

  afterAll(() => {
    cleanupContentSubs(ws.workspaceId);
    cleanupActivity(ws.workspaceId);
    ws.cleanup();
  });

  it('invoice.paid resets period and marks subscription active', async () => {
    const sub = seedSubscription(ws.workspaceId, {
      status: 'active',
      stripeSubscriptionId: STRIPE_SUB_ID,
    });

    // Advance some posts to simulate a mid-period state
    incrementDeliveredPosts(ws.workspaceId, sub.id, 1);
    const beforeRenewal = getContentSubscription(sub.id);
    expect(beforeRenewal!.postsDeliveredThisPeriod).toBe(1);

    const event = createWebhookEvent('invoice.paid', {
      id: 'inv_test_renewal_001',
      subscription: STRIPE_SUB_ID,
      metadata: { workspaceId: ws.workspaceId },
      amount_paid: 50000, // $500 in cents
    });

    await handleWebhookEvent(event as never);

    const afterRenewal = getContentSubscription(sub.id);
    expect(afterRenewal).toBeDefined();
    expect(afterRenewal!.status).toBe('active');
    expect(afterRenewal!.postsDeliveredThisPeriod).toBe(0); // reset to 0
    expect(afterRenewal!.currentPeriodStart).toBeTruthy();
    expect(afterRenewal!.currentPeriodEnd).toBeTruthy();
  });

  it('invoice.paid broadcasts content-subscription:renewed', async () => {
    const sub = seedSubscription(ws.workspaceId, {
      status: 'active',
      stripeSubscriptionId: 'sub_test_renewal_broadcast',
    });

    const event = createWebhookEvent('invoice.paid', {
      id: 'inv_test_broadcast',
      subscription: 'sub_test_renewal_broadcast',
      metadata: { workspaceId: ws.workspaceId },
      amount_paid: 50000,
    });

    await handleWebhookEvent(event as never);

    expect(mockBroadcast).toHaveBeenCalledWith(
      ws.workspaceId,
      'content-subscription:renewed',
      expect.objectContaining({ id: sub.id }),
    );
  });

  it('invoice.paid with no matching content subscription does not crash', async () => {
    const event = createWebhookEvent('invoice.paid', {
      id: 'inv_test_no_match',
      subscription: 'sub_test_does_not_exist',
      metadata: { workspaceId: ws.workspaceId },
      amount_paid: 50000,
    });

    // Should not throw even if no content sub is linked
    await expect(handleWebhookEvent(event as never)).resolves.toBeUndefined();
  });

  it('invoice.paid missing workspaceId silently returns', async () => {
    const event = createWebhookEvent('invoice.paid', {
      id: 'inv_test_no_ws',
      subscription: STRIPE_SUB_ID,
      metadata: {},
      amount_paid: 50000,
    });

    await expect(handleWebhookEvent(event as never)).resolves.toBeUndefined();
  });

  it('invoice.paid with no subscription field silently returns', async () => {
    const event = createWebhookEvent('invoice.paid', {
      id: 'inv_test_no_sub_field',
      // no subscription field
      metadata: { workspaceId: ws.workspaceId },
      amount_paid: 50000,
    });

    await expect(handleWebhookEvent(event as never)).resolves.toBeUndefined();
  });

  it('renewal period end is ~30 days after period start', async () => {
    seedSubscription(ws.workspaceId, {
      status: 'active',
      stripeSubscriptionId: 'sub_test_period_check',
    });

    const before = Date.now();

    const event = createWebhookEvent('invoice.paid', {
      id: 'inv_test_period',
      subscription: 'sub_test_period_check',
      metadata: { workspaceId: ws.workspaceId },
      amount_paid: 50000,
    });

    await handleWebhookEvent(event as never);

    const sub = getContentSubscriptionByStripeId('sub_test_period_check');
    expect(sub).toBeDefined();

    const periodStartMs = new Date(sub!.currentPeriodStart!).getTime();
    const periodEndMs = new Date(sub!.currentPeriodEnd!).getTime();

    // Period start should be at or after when we called handleWebhookEvent
    expect(periodStartMs).toBeGreaterThanOrEqual(before);

    // Period end should be ~30 days (within ±1 second tolerance)
    const expectedEnd = periodStartMs + 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(periodEndMs - expectedEnd)).toBeLessThan(1000);
  });
});

// ============================================================================
// 3. Subscription Cancellation
// ============================================================================

describe('Content Subscription — cancellation', () => {
  let ws: SeededFullWorkspace;
  const mockBroadcast = vi.fn();

  beforeAll(() => {
    ws = seedWorkspace();
    initStripeBroadcast(mockBroadcast);
  });

  beforeEach(() => {
    resetStripeMocks();
    mockBroadcast.mockClear();
  });

  afterAll(() => {
    cleanupContentSubs(ws.workspaceId);
    cleanupActivity(ws.workspaceId);
    ws.cleanup();
  });

  it('customer.subscription.deleted cancels an active content subscription', async () => {
    const sub = seedSubscription(ws.workspaceId, {
      status: 'active',
      stripeSubscriptionId: 'sub_test_cancel_active',
    });

    const event = createWebhookEvent('customer.subscription.deleted', {
      id: 'sub_test_cancel_active',
      metadata: { workspaceId: ws.workspaceId },
      status: 'canceled',
    });

    await handleWebhookEvent(event as never);

    const updated = getContentSubscription(sub.id);
    expect(updated).toBeDefined();
    expect(updated!.status).toBe('cancelled');
  });

  it('customer.subscription.deleted cancels a past_due content subscription', async () => {
    const sub = seedSubscription(ws.workspaceId, {
      status: 'past_due',
      stripeSubscriptionId: 'sub_test_cancel_pastdue',
    });

    const event = createWebhookEvent('customer.subscription.deleted', {
      id: 'sub_test_cancel_pastdue',
      metadata: { workspaceId: ws.workspaceId },
      status: 'canceled',
    });

    await handleWebhookEvent(event as never);

    const updated = getContentSubscription(sub.id);
    expect(updated!.status).toBe('cancelled');
  });

  it('customer.subscription.deleted broadcasts content-subscription:updated with cancelled status', async () => {
    const sub = seedSubscription(ws.workspaceId, {
      status: 'active',
      stripeSubscriptionId: 'sub_test_cancel_broadcast',
    });

    const event = createWebhookEvent('customer.subscription.deleted', {
      id: 'sub_test_cancel_broadcast',
      metadata: { workspaceId: ws.workspaceId },
      status: 'canceled',
    });

    await handleWebhookEvent(event as never);

    expect(mockBroadcast).toHaveBeenCalledWith(
      ws.workspaceId,
      'content-subscription:updated',
      expect.objectContaining({ id: sub.id, status: 'cancelled' }),
    );
  });

  it('customer.subscription.deleted for non-content sub downgrades workspace to free', async () => {
    const { updateWorkspace, getWorkspace } = await import('../../server/workspaces.js');
    updateWorkspace(ws.workspaceId, { tier: 'growth', stripeSubscriptionId: 'sub_test_plan_cancel' });

    const event = createWebhookEvent('customer.subscription.deleted', {
      id: 'sub_test_plan_cancel',
      metadata: { workspaceId: ws.workspaceId },
      status: 'canceled',
    });

    await handleWebhookEvent(event as never);

    const workspace = getWorkspace(ws.workspaceId);
    expect(workspace?.tier).toBe('free');
  });

  it('deleteContentSubscription removes the record', () => {
    const sub = seedSubscription(ws.workspaceId);
    expect(getContentSubscription(sub.id)).not.toBeNull();

    const deleted = deleteContentSubscription(ws.workspaceId, sub.id);
    expect(deleted).toBe(true);
    expect(getContentSubscription(sub.id)).toBeNull();
  });

  it('deleteContentSubscription returns false for non-existent id', () => {
    const result = deleteContentSubscription(ws.workspaceId, 'csub-does-not-exist');
    expect(result).toBe(false);
  });
});

// ============================================================================
// 4. Subscription Expiration / Past-Due Handling
// ============================================================================

describe('Content Subscription — past_due and expiration', () => {
  let ws: SeededFullWorkspace;
  const mockBroadcast = vi.fn();

  beforeAll(() => {
    ws = seedWorkspace();
    initStripeBroadcast(mockBroadcast);
  });

  beforeEach(() => {
    resetStripeMocks();
    mockBroadcast.mockClear();
  });

  afterAll(() => {
    cleanupContentSubs(ws.workspaceId);
    cleanupActivity(ws.workspaceId);
    ws.cleanup();
  });

  it('customer.subscription.updated with past_due status syncs content sub to past_due', async () => {
    const sub = seedSubscription(ws.workspaceId, {
      status: 'active',
      stripeSubscriptionId: 'sub_test_pastdue_sync',
    });

    const event = createWebhookEvent('customer.subscription.updated', {
      id: 'sub_test_pastdue_sync',
      metadata: { workspaceId: ws.workspaceId },
      status: 'past_due',
    });

    await handleWebhookEvent(event as never);

    const updated = getContentSubscription(sub.id);
    expect(updated).toBeDefined();
    expect(updated!.status).toBe('past_due');
  });

  it('customer.subscription.updated with unpaid status syncs content sub to past_due', async () => {
    const sub = seedSubscription(ws.workspaceId, {
      status: 'active',
      stripeSubscriptionId: 'sub_test_unpaid_sync',
    });

    const event = createWebhookEvent('customer.subscription.updated', {
      id: 'sub_test_unpaid_sync',
      metadata: { workspaceId: ws.workspaceId },
      status: 'unpaid',
    });

    await handleWebhookEvent(event as never);

    const updated = getContentSubscription(sub.id);
    expect(updated!.status).toBe('past_due');
  });

  it('customer.subscription.updated with canceled status syncs content sub to cancelled', async () => {
    const sub = seedSubscription(ws.workspaceId, {
      status: 'active',
      stripeSubscriptionId: 'sub_test_canceled_sync',
    });

    const event = createWebhookEvent('customer.subscription.updated', {
      id: 'sub_test_canceled_sync',
      metadata: { workspaceId: ws.workspaceId },
      status: 'canceled',
    });

    await handleWebhookEvent(event as never);

    const updated = getContentSubscription(sub.id);
    expect(updated!.status).toBe('cancelled');
  });

  it('customer.subscription.updated with active status reactivates a past_due subscription', async () => {
    const sub = seedSubscription(ws.workspaceId, {
      status: 'past_due',
      stripeSubscriptionId: 'sub_test_reactivate',
    });

    const event = createWebhookEvent('customer.subscription.updated', {
      id: 'sub_test_reactivate',
      metadata: { workspaceId: ws.workspaceId },
      status: 'active',
    });

    await handleWebhookEvent(event as never);

    const updated = getContentSubscription(sub.id);
    expect(updated!.status).toBe('active');
  });

  it('customer.subscription.updated broadcasts content-subscription:updated on status change', async () => {
    const sub = seedSubscription(ws.workspaceId, {
      status: 'active',
      stripeSubscriptionId: 'sub_test_pastdue_broadcast',
    });

    const event = createWebhookEvent('customer.subscription.updated', {
      id: 'sub_test_pastdue_broadcast',
      metadata: { workspaceId: ws.workspaceId },
      status: 'past_due',
    });

    await handleWebhookEvent(event as never);

    expect(mockBroadcast).toHaveBeenCalledWith(
      ws.workspaceId,
      'content-subscription:updated',
      expect.objectContaining({ id: sub.id, status: 'past_due' }),
    );
  });

  it('customer.subscription.updated does not broadcast when status is unchanged', async () => {
    seedSubscription(ws.workspaceId, {
      status: 'active',
      stripeSubscriptionId: 'sub_test_no_change',
    });

    const event = createWebhookEvent('customer.subscription.updated', {
      id: 'sub_test_no_change',
      metadata: { workspaceId: ws.workspaceId },
      status: 'active',
    });

    await handleWebhookEvent(event as never);

    // Status unchanged (active → active) — no broadcast for content sub update
    const contentSubUpdates = mockBroadcast.mock.calls.filter(
      call => call[1] === 'content-subscription:updated',
    );
    expect(contentSubUpdates).toHaveLength(0);
  });

  it('listActiveContentSubscriptions only returns active and past_due', () => {
    const active = seedSubscription(ws.workspaceId, { status: 'active', stripeSubscriptionId: 'sub_list_active' });
    const pastDue = seedSubscription(ws.workspaceId, { status: 'past_due', stripeSubscriptionId: 'sub_list_pastdue' });
    const pending = seedSubscription(ws.workspaceId, { status: 'pending' });
    const cancelled = seedSubscription(ws.workspaceId, { status: 'cancelled' });

    const activeSubs = listActiveContentSubscriptions();

    const ids = activeSubs.map(s => s.id);
    expect(ids).toContain(active.id);
    expect(ids).toContain(pastDue.id);
    expect(ids).not.toContain(pending.id);
    expect(ids).not.toContain(cancelled.id);

    // All returned subs must have active or past_due status
    expect(activeSubs.length > 0 && activeSubs.every(s => s.status === 'active' || s.status === 'past_due')).toBe(true);
  });
});

// ============================================================================
// 5. State Transition Validation — CONTENT_SUB_TRANSITIONS
// ============================================================================

describe('Content Subscription — state machine transitions', () => {
  // These tests exercise the validateTransition() function directly against
  // CONTENT_SUB_TRANSITIONS, since updateContentSubscription() does not enforce
  // the state machine (it's a direct DB update). The state machine is the source
  // of truth for what transitions are valid.
  //
  // Valid transitions (from CONTENT_SUB_TRANSITIONS):
  //   pending   → active, cancelled
  //   active    → paused, cancelled, past_due
  //   paused    → active, cancelled
  //   past_due  → active, cancelled
  //   cancelled → (terminal — no exits)

  it('defines the correct allowed transitions from pending', () => {
    expect(CONTENT_SUB_TRANSITIONS['pending']).toContain('active');
    expect(CONTENT_SUB_TRANSITIONS['pending']).toContain('cancelled');
    expect(CONTENT_SUB_TRANSITIONS['pending']).not.toContain('past_due');
    expect(CONTENT_SUB_TRANSITIONS['pending']).not.toContain('paused');
  });

  it('defines the correct allowed transitions from active', () => {
    expect(CONTENT_SUB_TRANSITIONS['active']).toContain('paused');
    expect(CONTENT_SUB_TRANSITIONS['active']).toContain('cancelled');
    expect(CONTENT_SUB_TRANSITIONS['active']).toContain('past_due');
  });

  it('defines the correct allowed transitions from paused', () => {
    expect(CONTENT_SUB_TRANSITIONS['paused']).toContain('active');
    expect(CONTENT_SUB_TRANSITIONS['paused']).toContain('cancelled');
    expect(CONTENT_SUB_TRANSITIONS['paused']).not.toContain('past_due');
  });

  it('defines the correct allowed transitions from past_due', () => {
    expect(CONTENT_SUB_TRANSITIONS['past_due']).toContain('active');
    expect(CONTENT_SUB_TRANSITIONS['past_due']).toContain('cancelled');
  });

  it('defines cancelled as a terminal state with no exits', () => {
    const exits = CONTENT_SUB_TRANSITIONS['cancelled'];
    expect(exits).toBeDefined();
    expect(exits).toHaveLength(0);
  });

  // ── Valid transitions ──

  it('validateTransition accepts pending → active', () => {
    expect(() =>
      validateTransition('content_subscription', CONTENT_SUB_TRANSITIONS, 'pending', 'active'),
    ).not.toThrow();
    const result = validateTransition('content_subscription', CONTENT_SUB_TRANSITIONS, 'pending', 'active');
    expect(result).toBe('active');
  });

  it('validateTransition accepts pending → cancelled', () => {
    expect(() =>
      validateTransition('content_subscription', CONTENT_SUB_TRANSITIONS, 'pending', 'cancelled'),
    ).not.toThrow();
  });

  it('validateTransition accepts active → paused', () => {
    expect(() =>
      validateTransition('content_subscription', CONTENT_SUB_TRANSITIONS, 'active', 'paused'),
    ).not.toThrow();
  });

  it('validateTransition accepts active → cancelled', () => {
    expect(() =>
      validateTransition('content_subscription', CONTENT_SUB_TRANSITIONS, 'active', 'cancelled'),
    ).not.toThrow();
  });

  it('validateTransition accepts active → past_due', () => {
    expect(() =>
      validateTransition('content_subscription', CONTENT_SUB_TRANSITIONS, 'active', 'past_due'),
    ).not.toThrow();
  });

  it('validateTransition accepts past_due → active (recovery)', () => {
    expect(() =>
      validateTransition('content_subscription', CONTENT_SUB_TRANSITIONS, 'past_due', 'active'),
    ).not.toThrow();
  });

  it('validateTransition accepts past_due → cancelled', () => {
    expect(() =>
      validateTransition('content_subscription', CONTENT_SUB_TRANSITIONS, 'past_due', 'cancelled'),
    ).not.toThrow();
  });

  it('validateTransition accepts paused → active (resume)', () => {
    expect(() =>
      validateTransition('content_subscription', CONTENT_SUB_TRANSITIONS, 'paused', 'active'),
    ).not.toThrow();
  });

  it('validateTransition accepts paused → cancelled', () => {
    expect(() =>
      validateTransition('content_subscription', CONTENT_SUB_TRANSITIONS, 'paused', 'cancelled'),
    ).not.toThrow();
  });

  // ── Invalid transitions ──

  it('validateTransition rejects cancelled → active (terminal)', () => {
    expect(() =>
      validateTransition('content_subscription', CONTENT_SUB_TRANSITIONS, 'cancelled', 'active'),
    ).toThrow(InvalidTransitionError);
  });

  it('validateTransition rejects cancelled → pending (terminal)', () => {
    expect(() =>
      validateTransition('content_subscription', CONTENT_SUB_TRANSITIONS, 'cancelled', 'pending'),
    ).toThrow(InvalidTransitionError);
  });

  it('validateTransition rejects cancelled → past_due (terminal)', () => {
    expect(() =>
      validateTransition('content_subscription', CONTENT_SUB_TRANSITIONS, 'cancelled', 'past_due'),
    ).toThrow(InvalidTransitionError);
  });

  it('validateTransition rejects pending → past_due (not allowed)', () => {
    expect(() =>
      validateTransition('content_subscription', CONTENT_SUB_TRANSITIONS, 'pending', 'past_due'),
    ).toThrow(InvalidTransitionError);
  });

  it('validateTransition rejects pending → paused (not allowed)', () => {
    expect(() =>
      validateTransition('content_subscription', CONTENT_SUB_TRANSITIONS, 'pending', 'paused'),
    ).toThrow(InvalidTransitionError);
  });

  it('validateTransition rejects paused → past_due (not allowed)', () => {
    expect(() =>
      validateTransition('content_subscription', CONTENT_SUB_TRANSITIONS, 'paused', 'past_due'),
    ).toThrow(InvalidTransitionError);
  });

  it('InvalidTransitionError carries entity, from, and to', () => {
    let caught: unknown;
    try {
      validateTransition('content_subscription', CONTENT_SUB_TRANSITIONS, 'cancelled', 'active');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(InvalidTransitionError);
    const err = caught as InvalidTransitionError;
    expect(err.entity).toBe('content_subscription');
    expect(err.from).toBe('cancelled');
    expect(err.to).toBe('active');
    expect(err.message).toMatch(/cancelled.*active/);
  });
});

// ============================================================================
// 6. Stripe Webhook — Subscription Events (end-to-end flows)
// ============================================================================

describe('Content Subscription — Stripe webhook lifecycle flows', () => {
  let ws: SeededFullWorkspace;
  const mockBroadcast = vi.fn();

  beforeAll(() => {
    ws = seedWorkspace();
    initStripeBroadcast(mockBroadcast);
  });

  beforeEach(() => {
    resetStripeMocks();
    mockBroadcast.mockClear();
  });

  afterAll(() => {
    cleanupContentSubs(ws.workspaceId);
    cleanupActivity(ws.workspaceId);
    ws.cleanup();
  });

  it('checkout.session.completed creates a content subscription for content_starter', async () => {
    const sessionId = 'cs_test_sub_create_starter';

    const { createPayment } = await import('../../server/payments.js');
    createPayment(ws.workspaceId, {
      workspaceId: ws.workspaceId,
      stripeSessionId: sessionId,
      productType: 'content_starter',
      amount: 50000,
      currency: 'usd',
      status: 'pending',
    });

    const event = createWebhookEvent('checkout.session.completed', {
      id: sessionId,
      metadata: {
        workspaceId: ws.workspaceId,
        productType: 'content_starter',
      },
      amount_total: 50000,
      subscription: 'sub_test_checkout_starter',
    });

    await handleWebhookEvent(event as never);

    const sub = getContentSubscriptionByStripeId('sub_test_checkout_starter');
    expect(sub).toBeDefined();
    expect(sub!.workspaceId).toBe(ws.workspaceId);
    expect(sub!.plan).toBe('content_starter');
    expect(sub!.status).toBe('active');
    expect(sub!.postsPerMonth).toBe(2);
    expect(sub!.priceUsd).toBe(500);
    expect(sub!.currentPeriodStart).toBeTruthy();
    expect(sub!.currentPeriodEnd).toBeTruthy();

    // Cleanup payment
    db.prepare('DELETE FROM payments WHERE workspace_id = ?').run(ws.workspaceId);
  });

  it('checkout.session.completed creates a content subscription for content_growth', async () => {
    const sessionId = 'cs_test_sub_create_growth';

    const { createPayment } = await import('../../server/payments.js');
    createPayment(ws.workspaceId, {
      workspaceId: ws.workspaceId,
      stripeSessionId: sessionId,
      productType: 'content_growth',
      amount: 90000,
      currency: 'usd',
      status: 'pending',
    });

    const event = createWebhookEvent('checkout.session.completed', {
      id: sessionId,
      metadata: {
        workspaceId: ws.workspaceId,
        productType: 'content_growth',
      },
      amount_total: 90000,
      subscription: 'sub_test_checkout_growth',
    });

    await handleWebhookEvent(event as never);

    const sub = getContentSubscriptionByStripeId('sub_test_checkout_growth');
    expect(sub).toBeDefined();
    expect(sub!.plan).toBe('content_growth');
    expect(sub!.postsPerMonth).toBe(4);
    expect(sub!.priceUsd).toBe(900);
    expect(sub!.status).toBe('active');

    db.prepare('DELETE FROM payments WHERE workspace_id = ?').run(ws.workspaceId);
  });

  it('checkout.session.completed without a subscription field skips content sub creation', async () => {
    const sessionId = 'cs_test_no_sub_field';
    const preCount = countContentSubs(ws.workspaceId);

    const { createPayment } = await import('../../server/payments.js');
    createPayment(ws.workspaceId, {
      workspaceId: ws.workspaceId,
      stripeSessionId: sessionId,
      productType: 'content_starter',
      amount: 50000,
      currency: 'usd',
      status: 'pending',
    });

    const event = createWebhookEvent('checkout.session.completed', {
      id: sessionId,
      metadata: {
        workspaceId: ws.workspaceId,
        productType: 'content_starter',
      },
      amount_total: 50000,
      // no subscription field — shouldn't create a content subscription
    });

    await handleWebhookEvent(event as never);

    expect(countContentSubs(ws.workspaceId)).toBe(preCount);
    db.prepare('DELETE FROM payments WHERE workspace_id = ?').run(ws.workspaceId);
  });

  it('customer.subscription.created with active status syncs content sub', async () => {
    const sub = seedSubscription(ws.workspaceId, {
      status: 'pending',
      stripeSubscriptionId: 'sub_test_created_event',
    });

    const event = createWebhookEvent('customer.subscription.created', {
      id: 'sub_test_created_event',
      metadata: { workspaceId: ws.workspaceId },
      status: 'active',
    });

    await handleWebhookEvent(event as never);

    const updated = getContentSubscription(sub.id);
    expect(updated!.status).toBe('active');
  });

  it('customer.subscription.created with trialing status syncs content sub to active', async () => {
    const sub = seedSubscription(ws.workspaceId, {
      status: 'pending',
      stripeSubscriptionId: 'sub_test_trialing_event',
    });

    const event = createWebhookEvent('customer.subscription.created', {
      id: 'sub_test_trialing_event',
      metadata: { workspaceId: ws.workspaceId },
      status: 'trialing',
    });

    await handleWebhookEvent(event as never);

    // trialing maps to 'active' in statusMap
    const updated = getContentSubscription(sub.id);
    expect(updated!.status).toBe('active');
  });

  it('full lifecycle: pending → active (checkout) → past_due → active (payment recovery) → cancelled', async () => {
    const STRIPE_ID = 'sub_test_full_lifecycle';

    // Step 1: Create in pending state
    const sub = seedSubscription(ws.workspaceId, {
      status: 'pending',
      stripeSubscriptionId: STRIPE_ID,
    });
    expect(sub.status).toBe('pending');

    // Step 2: Activate via subscription.created
    await handleWebhookEvent(createWebhookEvent('customer.subscription.created', {
      id: STRIPE_ID,
      metadata: { workspaceId: ws.workspaceId },
      status: 'active',
    }) as never);
    expect(getContentSubscription(sub.id)!.status).toBe('active');

    // Step 3: Renewal — invoice.paid resets period
    await handleWebhookEvent(createWebhookEvent('invoice.paid', {
      id: 'inv_lifecycle_001',
      subscription: STRIPE_ID,
      metadata: { workspaceId: ws.workspaceId },
      amount_paid: 50000,
    }) as never);
    const afterRenewal = getContentSubscription(sub.id)!;
    expect(afterRenewal.status).toBe('active');
    expect(afterRenewal.postsDeliveredThisPeriod).toBe(0);

    // Step 4: Payment fails → past_due
    await handleWebhookEvent(createWebhookEvent('customer.subscription.updated', {
      id: STRIPE_ID,
      metadata: { workspaceId: ws.workspaceId },
      status: 'past_due',
    }) as never);
    expect(getContentSubscription(sub.id)!.status).toBe('past_due');

    // Step 5: Payment recovered → active again
    await handleWebhookEvent(createWebhookEvent('customer.subscription.updated', {
      id: STRIPE_ID,
      metadata: { workspaceId: ws.workspaceId },
      status: 'active',
    }) as never);
    expect(getContentSubscription(sub.id)!.status).toBe('active');

    // Step 6: Explicit cancellation → terminal
    await handleWebhookEvent(createWebhookEvent('customer.subscription.deleted', {
      id: STRIPE_ID,
      metadata: { workspaceId: ws.workspaceId },
      status: 'canceled',
    }) as never);
    expect(getContentSubscription(sub.id)!.status).toBe('cancelled');
  });

  it('replaying subscription.deleted does not crash (idempotent cancellation)', async () => {
    const STRIPE_ID = 'sub_test_idemp_cancel';
    seedSubscription(ws.workspaceId, {
      status: 'active',
      stripeSubscriptionId: STRIPE_ID,
    });

    const event = createWebhookEvent('customer.subscription.deleted', {
      id: STRIPE_ID,
      metadata: { workspaceId: ws.workspaceId },
      status: 'canceled',
    });

    await handleWebhookEvent(event as never);
    const afterFirst = getContentSubscriptionByStripeId(STRIPE_ID);
    expect(afterFirst!.status).toBe('cancelled');

    // Replay — should not crash or corrupt state
    await handleWebhookEvent(createDuplicateWebhookEvent(event) as never);
    const afterSecond = getContentSubscriptionByStripeId(STRIPE_ID);
    expect(afterSecond!.status).toBe('cancelled');
  });

  it('replaying invoice.paid is idempotent — subscription stays active', async () => {
    const STRIPE_ID = 'sub_test_idemp_renew';
    seedSubscription(ws.workspaceId, {
      status: 'active',
      stripeSubscriptionId: STRIPE_ID,
    });

    const event = createWebhookEvent('invoice.paid', {
      id: 'inv_idemp_001',
      subscription: STRIPE_ID,
      metadata: { workspaceId: ws.workspaceId },
      amount_paid: 50000,
    });

    await handleWebhookEvent(event as never);
    await handleWebhookEvent(createDuplicateWebhookEvent(event) as never);

    const sub = getContentSubscriptionByStripeId(STRIPE_ID);
    expect(sub!.status).toBe('active');
    // postsDeliveredThisPeriod should still be 0 (reset on each invoice)
    expect(sub!.postsDeliveredThisPeriod).toBe(0);
  });
});

// ============================================================================
// 7. Period Management and Delivered Post Tracking
// ============================================================================

describe('Content Subscription — period management', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace();
  });

  afterAll(() => {
    cleanupContentSubs(ws.workspaceId);
    cleanupActivity(ws.workspaceId);
    ws.cleanup();
  });

  it('incrementDeliveredPosts increments by 1 by default', () => {
    const sub = seedSubscription(ws.workspaceId, { status: 'active' });
    expect(sub.postsDeliveredThisPeriod).toBe(0);

    incrementDeliveredPosts(ws.workspaceId, sub.id);

    const updated = getContentSubscription(sub.id);
    expect(updated!.postsDeliveredThisPeriod).toBe(1);
  });

  it('incrementDeliveredPosts increments by custom count', () => {
    const sub = seedSubscription(ws.workspaceId, { status: 'active' });
    incrementDeliveredPosts(ws.workspaceId, sub.id, 3);

    const updated = getContentSubscription(sub.id);
    expect(updated!.postsDeliveredThisPeriod).toBe(3);
  });

  it('incrementDeliveredPosts accumulates across multiple calls', () => {
    const sub = seedSubscription(ws.workspaceId, { status: 'active' });
    incrementDeliveredPosts(ws.workspaceId, sub.id, 1);
    incrementDeliveredPosts(ws.workspaceId, sub.id, 2);

    const updated = getContentSubscription(sub.id);
    expect(updated!.postsDeliveredThisPeriod).toBe(3);
  });

  it('resetPeriod zeroes postsDeliveredThisPeriod and updates period dates', () => {
    const sub = seedSubscription(ws.workspaceId, { status: 'active' });
    incrementDeliveredPosts(ws.workspaceId, sub.id, 2);

    const newStart = '2026-05-01T00:00:00.000Z';
    const newEnd = '2026-05-31T00:00:00.000Z';
    resetPeriod(ws.workspaceId, sub.id, newStart, newEnd);

    const updated = getContentSubscription(sub.id);
    expect(updated!.postsDeliveredThisPeriod).toBe(0);
    expect(updated!.currentPeriodStart).toBe(newStart);
    expect(updated!.currentPeriodEnd).toBe(newEnd);
  });

  it('updateContentSubscription updates plan fields', () => {
    const sub = seedSubscription(ws.workspaceId, { status: 'active' });

    const updated = updateContentSubscription(ws.workspaceId, sub.id, {
      plan: 'content_growth',
      postsPerMonth: 4,
      priceUsd: 900,
    });

    expect(updated).toBeDefined();
    expect(updated!.plan).toBe('content_growth');
    expect(updated!.postsPerMonth).toBe(4);
    expect(updated!.priceUsd).toBe(900);
  });

  it('updateContentSubscription returns null for a non-existent id', () => {
    const updated = updateContentSubscription(ws.workspaceId, 'csub-does-not-exist', { status: 'active' });
    expect(updated).toBeNull();
  });

  it('getContentSubscriptionByStripeId looks up by Stripe subscription id', () => {
    const sub = createContentSubscription(ws.workspaceId, {
      plan: 'content_starter',
      postsPerMonth: 2,
      priceUsd: 500,
      stripeSubscriptionId: 'sub_test_lookup',
      status: 'active',
    });

    const found = getContentSubscriptionByStripeId('sub_test_lookup');
    expect(found).toBeDefined();
    expect(found!.id).toBe(sub.id);
  });

  it('getContentSubscriptionByStripeId returns null for unknown Stripe id', () => {
    const result = getContentSubscriptionByStripeId('sub_test_nonexistent_xyz');
    expect(result).toBeNull();
  });
});
