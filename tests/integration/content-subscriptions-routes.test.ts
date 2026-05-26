/**
 * Integration tests for content-subscriptions API routes.
 *
 * Covers:
 * - GET  /api/public/content-plans
 * - GET  /api/content-subscriptions/:workspaceId
 * - POST /api/content-subscriptions/:workspaceId
 * - GET  /api/content-subscription/:id
 * - PATCH /api/content-subscription/:id
 * - DELETE /api/content-subscription/:id
 * - POST /api/content-subscription/:id/delivered
 * - GET  /api/public/content-subscription/:workspaceId
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import db from '../../server/db/index.js';
import { CONTENT_SUB_PLANS } from '../../shared/types/content.js';

const ctx = createTestContext(13561);
const { api, postJson, patchJson, del } = ctx;

// Admin-facing tests use a standard workspace (clientPassword is irrelevant for admin routes).
let workspaceId = '';
let cleanupWorkspace: () => void;

// Public client endpoint tests use a workspace without a clientPassword so
// the session-enforcement middleware does not gate the /api/public/ routes.
let publicWorkspaceId = '';
let cleanupPublicWorkspace: () => void;

beforeAll(async () => {
  await ctx.startServer();
  const ws = seedWorkspace();
  workspaceId = ws.workspaceId;
  cleanupWorkspace = ws.cleanup;

  const pubWs = seedWorkspace({ clientPassword: '' });
  publicWorkspaceId = pubWs.workspaceId;
  cleanupPublicWorkspace = pubWs.cleanup;
}, 25_000);

afterAll(async () => {
  db.prepare('DELETE FROM content_subscriptions WHERE workspace_id IN (?, ?)').run(workspaceId, publicWorkspaceId);
  cleanupWorkspace();
  cleanupPublicWorkspace();
  await ctx.stopServer();
});

// ── Public plans endpoint ──────────────────────────────────────────────────────

describe('GET /api/public/content-plans', () => {
  it('returns 200 with an array of all available plans', async () => {
    const res = await api('/api/public/content-plans');
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(CONTENT_SUB_PLANS.length);
  });

  it('each plan has required fields: plan, displayName, postsPerMonth, priceUsd, description', async () => {
    const res = await api('/api/public/content-plans');
    const plans = await res.json() as Array<Record<string, unknown>>;
    for (const plan of plans) {
      expect(typeof plan.plan).toBe('string');
      expect(typeof plan.displayName).toBe('string');
      expect(typeof plan.postsPerMonth).toBe('number');
      expect(typeof plan.priceUsd).toBe('number');
      expect(typeof plan.description).toBe('string');
    }
  });

  it('includes the expected plan identifiers', async () => {
    const res = await api('/api/public/content-plans');
    const plans = await res.json() as Array<{ plan: string }>;
    const planIds = plans.map(p => p.plan);
    expect(planIds).toContain('content_starter');
    expect(planIds).toContain('content_growth');
    expect(planIds).toContain('content_scale');
  });
});

// ── List subscriptions ─────────────────────────────────────────────────────────

describe('GET /api/content-subscriptions/:workspaceId', () => {
  it('returns empty array for a fresh workspace', async () => {
    const res = await api(`/api/content-subscriptions/${workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });
});

// ── Create subscription ────────────────────────────────────────────────────────

describe('POST /api/content-subscriptions/:workspaceId', () => {
  it('returns 400 when plan is missing', async () => {
    const res = await postJson(`/api/content-subscriptions/${workspaceId}`, {});
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBeTruthy();
  });

  it('returns 400 for an invalid plan name', async () => {
    const res = await postJson(`/api/content-subscriptions/${workspaceId}`, {
      plan: 'not_a_real_plan',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/invalid plan/i);
  });

  it('creates a subscription with a valid plan and returns it', async () => {
    const res = await postJson(`/api/content-subscriptions/${workspaceId}`, {
      plan: 'content_starter',
    });
    expect(res.status).toBe(200);
    const sub = await res.json() as Record<string, unknown>;
    expect(sub.id).toBeTruthy();
    expect(sub.workspaceId).toBe(workspaceId);
    expect(sub.plan).toBe('content_starter');
    expect(sub.postsPerMonth).toBe(2);
    expect(sub.priceUsd).toBe(500);
    expect(sub.status).toBe('active');
    expect(sub.postsDeliveredThisPeriod).toBe(0);
  });

  it('list endpoint returns the created subscription', async () => {
    const res = await api(`/api/content-subscriptions/${workspaceId}`);
    expect(res.status).toBe(200);
    const subs = await res.json() as Array<{ plan: string }>;
    expect(subs.some(s => s.plan === 'content_starter')).toBe(true);
  });
});

// ── Get single subscription ────────────────────────────────────────────────────

describe('GET /api/content-subscription/:id', () => {
  let subId = '';

  beforeAll(async () => {
    const res = await postJson(`/api/content-subscriptions/${workspaceId}`, {
      plan: 'content_growth',
      notes: 'test get subscription',
    });
    const body = await res.json() as { id: string };
    subId = body.id;
  });

  it('returns 404 for a nonexistent id', async () => {
    const res = await api('/api/content-subscription/csub-doesnotexist');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBeTruthy();
  });

  it('returns the subscription by id', async () => {
    const res = await api(`/api/content-subscription/${subId}`);
    expect(res.status).toBe(200);
    const sub = await res.json() as Record<string, unknown>;
    expect(sub.id).toBe(subId);
    expect(sub.plan).toBe('content_growth');
    expect(sub.notes).toBe('test get subscription');
    expect(sub.workspaceId).toBe(workspaceId);
  });
});

// ── Update subscription ────────────────────────────────────────────────────────

describe('PATCH /api/content-subscription/:id', () => {
  let subId = '';

  beforeAll(async () => {
    const res = await postJson(`/api/content-subscriptions/${workspaceId}`, {
      plan: 'content_starter',
      notes: 'initial notes',
    });
    const body = await res.json() as { id: string };
    subId = body.id;
  });

  it('can update notes', async () => {
    const res = await patchJson(`/api/content-subscription/${subId}`, {
      notes: 'updated notes',
    });
    expect(res.status).toBe(200);
    const sub = await res.json() as { notes: string };
    expect(sub.notes).toBe('updated notes');
  });

  it('can update status to paused', async () => {
    const res = await patchJson(`/api/content-subscription/${subId}`, {
      status: 'paused',
    });
    expect(res.status).toBe(200);
    const sub = await res.json() as { status: string };
    expect(sub.status).toBe('paused');
  });

  it('returns 400 for an invalid plan name', async () => {
    const res = await patchJson(`/api/content-subscription/${subId}`, {
      plan: 'bogus_plan',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/invalid plan/i);
  });

  it('can upgrade to a different valid plan', async () => {
    const res = await patchJson(`/api/content-subscription/${subId}`, {
      plan: 'content_scale',
    });
    expect(res.status).toBe(200);
    const sub = await res.json() as { plan: string; postsPerMonth: number; priceUsd: number };
    expect(sub.plan).toBe('content_scale');
    expect(sub.postsPerMonth).toBe(8);
    expect(sub.priceUsd).toBe(1600);
  });
});

// ── Increment delivered posts ──────────────────────────────────────────────────

describe('POST /api/content-subscription/:id/delivered', () => {
  let subId = '';
  let initialDelivered = 0;

  beforeAll(async () => {
    const res = await postJson(`/api/content-subscriptions/${workspaceId}`, {
      plan: 'content_growth',
    });
    const body = await res.json() as { id: string; postsDeliveredThisPeriod: number };
    subId = body.id;
    initialDelivered = body.postsDeliveredThisPeriod;
  });

  it('increments the count by 1 (default) and returns updated subscription', async () => {
    const res = await postJson(`/api/content-subscription/${subId}/delivered`, {});
    expect(res.status).toBe(200);
    const sub = await res.json() as { postsDeliveredThisPeriod: number };
    expect(sub.postsDeliveredThisPeriod).toBe(initialDelivered + 1);
  });

  it('increments by a custom positive integer count', async () => {
    const res = await postJson(`/api/content-subscription/${subId}/delivered`, { count: 3 });
    expect(res.status).toBe(200);
    const sub = await res.json() as { postsDeliveredThisPeriod: number };
    expect(sub.postsDeliveredThisPeriod).toBe(initialDelivered + 4); // 1 from previous test + 3
  });

  it('returns 400 when count is 0', async () => {
    const res = await postJson(`/api/content-subscription/${subId}/delivered`, { count: 0 });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/positive integer/i);
  });

  it('returns 400 when count is negative', async () => {
    const res = await postJson(`/api/content-subscription/${subId}/delivered`, { count: -1 });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/positive integer/i);
  });

  it('returns 400 when count is not an integer', async () => {
    const res = await postJson(`/api/content-subscription/${subId}/delivered`, { count: 1.5 });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/positive integer/i);
  });

  it('returns 404 for a nonexistent subscription id', async () => {
    const res = await postJson('/api/content-subscription/csub-nope/delivered', {});
    expect(res.status).toBe(404);
  });
});

// ── Delete subscription ────────────────────────────────────────────────────────

describe('DELETE /api/content-subscription/:id', () => {
  let subId = '';

  beforeAll(async () => {
    const res = await postJson(`/api/content-subscriptions/${workspaceId}`, {
      plan: 'content_scale',
      notes: 'to be deleted',
    });
    const body = await res.json() as { id: string };
    subId = body.id;
  });

  it('returns 404 when deleting a nonexistent subscription', async () => {
    const res = await del('/api/content-subscription/csub-gone');
    expect(res.status).toBe(404);
  });

  it('deletes an existing subscription and returns { ok: true }', async () => {
    const res = await del(`/api/content-subscription/${subId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('subsequent GET for the deleted id returns 404', async () => {
    const res = await api(`/api/content-subscription/${subId}`);
    expect(res.status).toBe(404);
  });
});

// ── Public client subscription endpoint ───────────────────────────────────────
//
// These tests use publicWorkspaceId (no clientPassword) so the session-
// enforcement middleware allows unauthenticated access to /api/public/ routes.

describe('GET /api/public/content-subscription/:workspaceId', () => {
  let activeSubId = '';

  beforeAll(async () => {
    // Create a subscription in the public (no-password) workspace
    const res = await postJson(`/api/content-subscriptions/${publicWorkspaceId}`, {
      plan: 'content_growth',
      notes: 'client facing test',
    });
    const body = await res.json() as { id: string };
    activeSubId = body.id;
  });

  afterAll(() => {
    db.prepare('DELETE FROM content_subscriptions WHERE id = ?').run(activeSubId);
  });

  it('returns subscription and plans when an active subscription exists', async () => {
    const res = await api(`/api/public/content-subscription/${publicWorkspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { subscription: Record<string, unknown> | null; plans: unknown[] };
    expect(body.subscription).not.toBeNull();
    expect(body.subscription?.id).toBe(activeSubId);
    expect(body.subscription?.plan).toBe('content_growth');
    expect(Array.isArray(body.plans)).toBe(true);
    expect(body.plans.length).toBeGreaterThan(0);
  });

  it('returns null subscription for a workspace with no active subscriptions', async () => {
    // Use a unique fresh workspace without a client password
    const ws2 = seedWorkspace({ clientPassword: '' });
    try {
      const res = await api(`/api/public/content-subscription/${ws2.workspaceId}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { subscription: null; plans: unknown[] };
      expect(body.subscription).toBeNull();
      expect(Array.isArray(body.plans)).toBe(true);
    } finally {
      ws2.cleanup();
    }
  });

  it('does not return cancelled subscriptions as the active subscription', async () => {
    // Cancel the active subscription via admin endpoint
    await patchJson(`/api/content-subscription/${activeSubId}`, { status: 'cancelled' });

    const res = await api(`/api/public/content-subscription/${publicWorkspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { subscription: null | Record<string, unknown> };
    // The cancelled sub should not appear — no other subs exist in this workspace
    expect(body.subscription).toBeNull();
  });
});
