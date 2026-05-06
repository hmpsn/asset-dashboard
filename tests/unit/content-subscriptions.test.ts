import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import {
  createContentSubscription,
  deleteContentSubscription,
  getContentSubscription,
  getContentSubscriptionByStripeId,
  incrementDeliveredPosts,
  listActiveContentSubscriptions,
  listContentSubscriptions,
  resetPeriod,
  updateContentSubscription,
} from '../../server/content-subscriptions.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';

let ws: SeededFullWorkspace;
let otherWs: SeededFullWorkspace;

function cleanup(workspaceId: string): void {
  db.prepare('DELETE FROM content_subscriptions WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(workspaceId);
}

function createSub(
  workspaceId = ws.workspaceId,
  overrides: Partial<Parameters<typeof createContentSubscription>[1]> = {},
) {
  return createContentSubscription(workspaceId, {
    plan: 'content_growth',
    postsPerMonth: 4,
    priceUsd: 900,
    status: 'active',
    stripeSubscriptionId: `sub_${workspaceId}_${Date.now()}_${Math.random()}`,
    stripePriceId: 'price_growth',
    currentPeriodStart: '2026-05-01T00:00:00.000Z',
    currentPeriodEnd: '2026-06-01T00:00:00.000Z',
    preferredPageTypes: ['blog', 'service'],
    topicSource: 'ai_recommended',
    notes: 'Prioritize conversion pages.',
    ...overrides,
  });
}

beforeAll(() => {
  ws = seedWorkspace();
  otherWs = seedWorkspace();
});

beforeEach(() => {
  cleanup(ws.workspaceId);
  cleanup(otherWs.workspaceId);
});

afterAll(() => {
  cleanup(ws.workspaceId);
  cleanup(otherWs.workspaceId);
  ws.cleanup();
  otherWs.cleanup();
});

describe('content-subscriptions store', () => {
  it('creates, retrieves, lists, and deletes subscriptions', () => {
    const sub = createSub();

    expect(sub.id).toMatch(/^csub-/);
    expect(sub.workspaceId).toBe(ws.workspaceId);
    expect(sub.status).toBe('active');
    expect(sub.topicSource).toBe('ai_recommended');
    expect(sub.preferredPageTypes).toEqual(['blog', 'service']);
    expect(getContentSubscription(sub.id)?.stripeSubscriptionId).toBe(sub.stripeSubscriptionId);
    expect(getContentSubscriptionByStripeId(sub.stripeSubscriptionId!)?.id).toBe(sub.id);
    expect(listContentSubscriptions(ws.workspaceId).map(item => item.id)).toEqual([sub.id]);

    expect(deleteContentSubscription(otherWs.workspaceId, sub.id)).toBe(false);
    expect(deleteContentSubscription(ws.workspaceId, sub.id)).toBe(true);
    expect(getContentSubscription(sub.id)).toBeNull();
  });

  it('updates only allowed fields and can clear optional values', () => {
    const sub = createSub();

    const updated = updateContentSubscription(ws.workspaceId, sub.id, {
      status: 'paused',
      plan: 'content_scale',
      postsPerMonth: 8,
      priceUsd: 1600,
      preferredPageTypes: [],
      notes: undefined,
      stripePriceId: undefined,
    });

    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('paused');
    expect(updated!.plan).toBe('content_scale');
    expect(updated!.postsPerMonth).toBe(8);
    expect(updated!.priceUsd).toBe(1600);
    expect(updated!.preferredPageTypes).toEqual([]);
    expect(updated!.notes).toBeUndefined();
    expect(updated!.stripePriceId).toBeUndefined();
    expect(updated!.stripeSubscriptionId).toBe(sub.stripeSubscriptionId);
    expect(updated!.updatedAt >= sub.updatedAt).toBe(true);

    const clearedTypes = updateContentSubscription(ws.workspaceId, sub.id, {
      preferredPageTypes: undefined,
    });
    expect(clearedTypes?.preferredPageTypes).toBeUndefined();
  });

  it('does not leak another workspace subscription when scoped updates miss', () => {
    const sub = createSub(ws.workspaceId, { status: 'active' });

    const wrongWorkspaceUpdate = updateContentSubscription(otherWs.workspaceId, sub.id, {
      status: 'paused',
    });
    const wrongWorkspaceNoop = updateContentSubscription(
      otherWs.workspaceId,
      sub.id,
      { unsupportedField: 'ignored' } as never,
    );

    expect(wrongWorkspaceUpdate).toBeNull();
    expect(wrongWorkspaceNoop).toBeNull();
    expect(getContentSubscription(sub.id)?.status).toBe('active');
  });

  it('increments deliveries and resets periods inside the workspace scope', () => {
    const sub = createSub();

    incrementDeliveredPosts(ws.workspaceId, sub.id, 3);
    expect(getContentSubscription(sub.id)?.postsDeliveredThisPeriod).toBe(3);

    incrementDeliveredPosts(otherWs.workspaceId, sub.id, 2);
    expect(getContentSubscription(sub.id)?.postsDeliveredThisPeriod).toBe(3);

    resetPeriod(ws.workspaceId, sub.id, '2026-06-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z');
    const reset = getContentSubscription(sub.id);

    expect(reset?.postsDeliveredThisPeriod).toBe(0);
    expect(reset?.currentPeriodStart).toBe('2026-06-01T00:00:00.000Z');
    expect(reset?.currentPeriodEnd).toBe('2026-07-01T00:00:00.000Z');
  });

  it('lists only active and past due subscriptions as active', () => {
    const active = createSub(ws.workspaceId, { status: 'active' });
    const pastDue = createSub(ws.workspaceId, { status: 'past_due' });
    const pending = createSub(ws.workspaceId, { status: 'pending' });
    const cancelled = createSub(ws.workspaceId, { status: 'cancelled' });

    const ids = listActiveContentSubscriptions().map(sub => sub.id);

    expect(ids).toContain(active.id);
    expect(ids).toContain(pastDue.id);
    expect(ids).not.toContain(pending.id);
    expect(ids).not.toContain(cancelled.id);
  });
});
