/**
 * Integration tests — Content Subscriptions full lifecycle.
 *
 * Covers: create, list, get by id, PATCH status transitions, DELETE,
 * delivered endpoint, public endpoint, and broadcast payload verification
 * after each mutation.
 *
 * Uses an ephemeral in-process server port.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// ── Broadcast capture (hoisted so vi.mock works before imports) ──

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: Record<string, unknown> }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: Record<string, unknown>) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { withPublicTestAuth } from './public-auth-test-helpers.js';

// ── Server helpers ──

let baseUrl = '';
let server: http.Server | undefined;
let workspaceId = '';

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close(err => (err ? reject(err) : resolve()));
  });
  server = undefined;
}

async function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, withPublicTestAuth(path, opts));
}

async function getJson(path: string): Promise<Response> {
  return api(path);
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function patchJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function del(path: string): Promise<Response> {
  return api(path, { method: 'DELETE' });
}

// ── Lifecycle ──

beforeAll(async () => {
  await startTestServer();
  workspaceId = createWorkspace('Content Subs Lifecycle WS 13857').id;
}, 60_000);

beforeEach(() => {
  broadcastState.calls = [];
});

afterAll(async () => {
  db.prepare('DELETE FROM content_subscriptions WHERE workspace_id = ?').run(workspaceId);
  deleteWorkspace(workspaceId);
  await stopTestServer();
});

// ── Helpers ──

function subscriptionBroadcasts(event: string) {
  return broadcastState.calls.filter(c => c.event === event);
}

// ── Tests ──

describe('POST /api/content-subscriptions/:workspaceId — create', () => {
  it('creates subscription and returns id, plan, status, workspaceId', async () => {
    const res = await postJson(`/api/content-subscriptions/${workspaceId}`, {
      plan: 'content_starter',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.id).toBe('string');
    expect(body.id).toMatch(/^csub-/);
    expect(body.plan).toBe('content_starter');
    expect(body.status).toBe('active');
    expect(body.workspaceId).toBe(workspaceId);
  });

  it('second subscription for same workspace is allowed with distinct id', async () => {
    const res1 = await postJson(`/api/content-subscriptions/${workspaceId}`, {
      plan: 'content_growth',
    });
    expect(res1.status).toBe(200);
    const body1 = await res1.json() as Record<string, unknown>;

    const res2 = await postJson(`/api/content-subscriptions/${workspaceId}`, {
      plan: 'content_scale',
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json() as Record<string, unknown>;

    expect(body1.id).not.toBe(body2.id);
    expect(body1.plan).toBe('content_growth');
    expect(body2.plan).toBe('content_scale');
  });

  it('returns 400 for missing plan', async () => {
    const res = await postJson(`/api/content-subscriptions/${workspaceId}`, {});
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
  });

  it('returns 400 for invalid plan value', async () => {
    const res = await postJson(`/api/content-subscriptions/${workspaceId}`, {
      plan: 'not_a_real_plan',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
  });

  it('broadcasts CONTENT_SUBSCRIPTION_CREATED after creation', async () => {
    broadcastState.calls = [];
    const res = await postJson(`/api/content-subscriptions/${workspaceId}`, {
      plan: 'content_starter',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;

    const created = subscriptionBroadcasts(WS_EVENTS.CONTENT_SUBSCRIPTION_CREATED);
    expect(created).toHaveLength(1);
    expect(created[0].workspaceId).toBe(workspaceId);
    expect(created[0].payload.id).toBe(body.id);
    expect(created[0].payload.plan).toBe('content_starter');
  });
});

describe('GET /api/content-subscriptions/:workspaceId — list', () => {
  it('returns array including the created subscription', async () => {
    // Create one to ensure the list is non-empty for this workspace
    const createRes = await postJson(`/api/content-subscriptions/${workspaceId}`, {
      plan: 'content_starter',
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json() as Record<string, unknown>;

    const res = await getJson(`/api/content-subscriptions/${workspaceId}`);
    expect(res.status).toBe(200);
    const list = await res.json() as Array<Record<string, unknown>>;
    expect(Array.isArray(list)).toBe(true);
    expect(list.some(s => s.id === created.id)).toBe(true);
  });

  it('returns empty array for fresh workspace', async () => {
    const freshWs = createWorkspace('Content Subs Empty WS');
    try {
      const res = await getJson(`/api/content-subscriptions/${freshWs.id}`);
      expect(res.status).toBe(200);
      const list = await res.json() as unknown[];
      expect(Array.isArray(list)).toBe(true);
      expect(list).toHaveLength(0);
    } finally {
      deleteWorkspace(freshWs.id);
    }
  });

  it('GET /api/content-subscription/:id returns the subscription by id', async () => {
    const createRes = await postJson(`/api/content-subscriptions/${workspaceId}`, {
      plan: 'content_growth',
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json() as Record<string, unknown>;

    const res = await getJson(`/api/content-subscription/${created.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.id).toBe(created.id);
    expect(body.plan).toBe('content_growth');
    expect(body.workspaceId).toBe(workspaceId);
  });

  it('GET /api/content-subscription/:nonexistent returns 404', async () => {
    const res = await getJson('/api/content-subscription/csub-nonexistent-xyz');
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
  });
});

describe('PATCH /api/content-subscription/:id — status transitions', () => {
  async function createSub(plan = 'content_starter'): Promise<string> {
    const res = await postJson(`/api/content-subscriptions/${workspaceId}`, { plan });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    return body.id as string;
  }

  it('pending → active: returns updated subscription with status active', async () => {
    // Create with status active (default from route), then patch to pending first
    // The route always creates with status: 'active', so we need to transition active → pending → active
    // Instead create via DB directly at 'pending' status to test pending→active
    const createRes = await postJson(`/api/content-subscriptions/${workspaceId}`, {
      plan: 'content_starter',
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json() as Record<string, unknown>;
    const id = created.id as string;

    // Move to pending first (active → pending is allowed)
    const toPendingRes = await patchJson(`/api/content-subscription/${id}`, { status: 'pending' });
    expect(toPendingRes.status).toBe(200);

    broadcastState.calls = [];

    // Now pending → active
    const toActiveRes = await patchJson(`/api/content-subscription/${id}`, { status: 'active' });
    expect(toActiveRes.status).toBe(200);
    const body = await toActiveRes.json() as Record<string, unknown>;
    expect(body.status).toBe('active');
    expect(body.id).toBe(id);
  });

  it('active → paused: returns 200 with status paused', async () => {
    const id = await createSub();

    const res = await patchJson(`/api/content-subscription/${id}`, { status: 'paused' });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('paused');
    expect(body.id).toBe(id);
  });

  it('active → cancelled: returns 200 with status cancelled', async () => {
    const id = await createSub();

    const res = await patchJson(`/api/content-subscription/${id}`, { status: 'cancelled' });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('cancelled');
    expect(body.id).toBe(id);
  });

  it('invalid transition (cancelled → active): returns 400', async () => {
    const id = await createSub();

    // Move to cancelled first
    const cancelRes = await patchJson(`/api/content-subscription/${id}`, { status: 'cancelled' });
    expect(cancelRes.status).toBe(200);

    // Attempt cancelled → active (not in CONTENT_SUB_TRANSITIONS)
    const res = await patchJson(`/api/content-subscription/${id}`, { status: 'active' });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
  });

  it('broadcasts CONTENT_SUBSCRIPTION_UPDATED after status change', async () => {
    const id = await createSub();
    broadcastState.calls = [];

    const res = await patchJson(`/api/content-subscription/${id}`, { status: 'paused' });
    expect(res.status).toBe(200);

    const updates = subscriptionBroadcasts(WS_EVENTS.CONTENT_SUBSCRIPTION_UPDATED);
    expect(updates).toHaveLength(1);
    expect(updates[0].workspaceId).toBe(workspaceId);
    expect(updates[0].payload.id).toBe(id);
    expect(updates[0].payload.status).toBe('paused');
  });
});

describe('DELETE /api/content-subscription/:id', () => {
  it('returns 200 and subscription is gone from list', async () => {
    const createRes = await postJson(`/api/content-subscriptions/${workspaceId}`, {
      plan: 'content_starter',
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json() as Record<string, unknown>;
    const id = created.id as string;

    const deleteRes = await del(`/api/content-subscription/${id}`);
    expect(deleteRes.status).toBe(200);
    const deleteBody = await deleteRes.json() as Record<string, unknown>;
    expect(deleteBody.ok).toBe(true);

    // Verify gone from list
    const listRes = await getJson(`/api/content-subscriptions/${workspaceId}`);
    expect(listRes.status).toBe(200);
    const list = await listRes.json() as Array<Record<string, unknown>>;
    expect(list.some(s => s.id === id)).toBe(false);

    // Verify 404 on direct get
    const getRes = await getJson(`/api/content-subscription/${id}`);
    expect(getRes.status).toBe(404);
  });

  it('returns 404 for unknown id', async () => {
    const res = await del('/api/content-subscription/csub-does-not-exist');
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
  });
});

describe('POST /api/content-subscription/:id/delivered', () => {
  it('increments postsDeliveredThisPeriod and returns updated subscription', async () => {
    const createRes = await postJson(`/api/content-subscriptions/${workspaceId}`, {
      plan: 'content_starter',
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json() as Record<string, unknown>;
    const id = created.id as string;

    const res = await postJson(`/api/content-subscription/${id}/delivered`, { count: 1 });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.postsDeliveredThisPeriod).toBe(1);

    // Second delivery increments further
    const res2 = await postJson(`/api/content-subscription/${id}/delivered`, { count: 2 });
    expect(res2.status).toBe(200);
    const body2 = await res2.json() as Record<string, unknown>;
    expect(body2.postsDeliveredThisPeriod).toBe(3);
  });

  it('returns 400 when count is not a positive integer', async () => {
    const createRes = await postJson(`/api/content-subscriptions/${workspaceId}`, {
      plan: 'content_starter',
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json() as Record<string, unknown>;
    const id = created.id as string;

    const negativeRes = await postJson(`/api/content-subscription/${id}/delivered`, { count: -1 });
    expect(negativeRes.status).toBe(400);

    const zeroRes = await postJson(`/api/content-subscription/${id}/delivered`, { count: 0 });
    expect(zeroRes.status).toBe(400);
  });

  it('broadcasts CONTENT_SUBSCRIPTION_UPDATED after delivered increment', async () => {
    const createRes = await postJson(`/api/content-subscriptions/${workspaceId}`, {
      plan: 'content_growth',
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json() as Record<string, unknown>;
    const id = created.id as string;
    broadcastState.calls = [];

    const res = await postJson(`/api/content-subscription/${id}/delivered`, { count: 1 });
    expect(res.status).toBe(200);

    const updates = subscriptionBroadcasts(WS_EVENTS.CONTENT_SUBSCRIPTION_UPDATED);
    expect(updates).toHaveLength(1);
    expect(updates[0].workspaceId).toBe(workspaceId);
    expect(updates[0].payload.id).toBe(id);
    expect(updates[0].payload.deliveredCountChanged).toBe(1);
  });
});

describe('GET /api/public/content-subscription/:workspaceId — public endpoint', () => {
  it('returns active subscription and available plans', async () => {
    // Create an active subscription first
    const createRes = await postJson(`/api/content-subscriptions/${workspaceId}`, {
      plan: 'content_starter',
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json() as Record<string, unknown>;

    const res = await getJson(`/api/public/content-subscription/${workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { subscription: Record<string, unknown> | null; plans: unknown[] };
    expect(Array.isArray(body.plans)).toBe(true);
    expect(body.plans.length).toBeGreaterThan(0);
    // The active subscription should be surfaced
    expect(body.subscription).not.toBeNull();
    expect(body.subscription!.id).toBe(created.id);
  });

  it('returns null subscription for workspace with no active subscriptions', async () => {
    const freshWs = createWorkspace('Content Subs Public Empty WS');
    try {
      const res = await getJson(`/api/public/content-subscription/${freshWs.id}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { subscription: unknown; plans: unknown[] };
      expect(body.subscription).toBeNull();
      expect(Array.isArray(body.plans)).toBe(true);
    } finally {
      deleteWorkspace(freshWs.id);
    }
  });
});
