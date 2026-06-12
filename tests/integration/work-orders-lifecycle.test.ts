/**
 * Integration tests: work-orders full lifecycle.
 *
 * Covers list, status transitions, invalid transitions, field updates, and
 * the completed-path side effects: activity logging, broadcast, and
 * notifyClientFixesApplied.
 *
 * The existing work-orders-routes.test.ts has only 4 shape-only tests;
 * this file covers the full lifecycle.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// ── Hoisted state ─────────────────────────────────────────────────────────────

const emailState = vi.hoisted(() => ({
  fixesApplied: [] as Array<{
    clientEmail: string;
    workspaceName: string;
    workspaceId: string;
    productType: string;
    pageCount: number;
    dashboardUrl?: string;
  }>,
}));

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: unknown }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: unknown) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/email.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../server/email.js')>();
  return {
    ...actual,
    notifyClientFixesApplied: vi.fn((p: (typeof emailState.fixesApplied)[0]) => {
      emailState.fixesApplied.push(p);
    }),
  };
});

import { createClientUser } from '../../server/client-users.js';
import db from '../../server/db/index.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { createWorkOrder } from '../../server/work-orders.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { withPublicTestAuth } from './public-auth-test-helpers.js';

// ── Server setup ──────────────────────────────────────────────────────────────

let baseUrl = '';
let server: http.Server | undefined;
let wsId = '';
let wsIdOther = '';
const wsName = 'WorkOrderLifecycle-Test';
const originalAppPassword = process.env.APP_PASSWORD;

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

async function patchJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function getJson(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, withPublicTestAuth(path));
}

// ── Seed helper ───────────────────────────────────────────────────────────────

function makeWorkOrder(
  workspaceId: string,
  opts: { status?: 'pending' | 'in_progress' | 'completed' | 'cancelled'; pageIds?: string[] } = {},
) {
  return createWorkOrder(workspaceId, {
    paymentId: `pay_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    productType: 'fix_meta_tags',
    status: opts.status ?? 'pending',
    pageIds: opts.pageIds ?? [`page_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`],
  });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await startTestServer();
  wsId = createWorkspace(wsName).id;
  wsIdOther = createWorkspace('WorkOrderOther-Test').id;
}, 30_000);

beforeEach(() => {
  emailState.fixesApplied = [];
  broadcastState.calls = [];
});

afterAll(async () => {
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(wsIdOther);
  db.prepare('DELETE FROM work_orders WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM work_orders WHERE workspace_id = ?').run(wsIdOther);
  db.prepare('DELETE FROM client_users WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM client_users WHERE workspace_id = ?').run(wsIdOther);
  deleteWorkspace(wsId);
  deleteWorkspace(wsIdOther);
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
}, 30_000);

// ── GET list ──────────────────────────────────────────────────────────────────

describe('GET /api/work-orders/:workspaceId — list', () => {
  it('returns empty array for a fresh workspace', async () => {
    const freshWsId = createWorkspace('WorkOrderFresh-Test').id;
    try {
      const res = await getJson(`/api/work-orders/${freshWsId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(0);
    } finally {
      db.prepare('DELETE FROM work_orders WHERE workspace_id = ?').run(freshWsId);
      deleteWorkspace(freshWsId);
    }
  });

  it('returns created work orders after seeding with correct shape', async () => {
    const order = makeWorkOrder(wsId);
    const res = await getJson(`/api/work-orders/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string; status: string; productType: string }>;
    const found = body.find(o => o.id === order.id);
    expect(found).toBeDefined();
    expect(found?.status).toBe('pending');
    expect(found?.productType).toBe('fix_meta_tags');
  });

  it('returns only orders for the scoped workspace, not from another workspace', async () => {
    const orderA = makeWorkOrder(wsId);
    const orderB = makeWorkOrder(wsIdOther);

    const [resA, resB] = await Promise.all([
      getJson(`/api/work-orders/${wsId}`),
      getJson(`/api/work-orders/${wsIdOther}`),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const idsA = ((await resA.json()) as Array<{ id: string }>).map(o => o.id);
    const idsB = ((await resB.json()) as Array<{ id: string }>).map(o => o.id);

    expect(idsA).toContain(orderA.id);
    expect(idsA).not.toContain(orderB.id);
    expect(idsB).toContain(orderB.id);
    expect(idsB).not.toContain(orderA.id);
  });
});

// ── PATCH status transitions ──────────────────────────────────────────────────

describe('PATCH /api/work-orders/:workspaceId/:orderId — status transitions', () => {
  it('pending → in_progress: returns updated order with new status', async () => {
    const order = makeWorkOrder(wsId);
    const res = await patchJson(`/api/work-orders/${wsId}/${order.id}`, { status: 'in_progress' });
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; status: string };
    expect(body.id).toBe(order.id);
    expect(body.status).toBe('in_progress');
  });

  it('in_progress → completed: returns order with completedAt set', async () => {
    const order = makeWorkOrder(wsId, { status: 'in_progress' });
    const res = await patchJson(`/api/work-orders/${wsId}/${order.id}`, { status: 'completed' });
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; completedAt?: string };
    expect(body.status).toBe('completed');
    expect(typeof body.completedAt).toBe('string');
    expect(body.completedAt).toBeTruthy();
  });

  it('pending → cancelled: returns cancelled order', async () => {
    const order = makeWorkOrder(wsId);
    const res = await patchJson(`/api/work-orders/${wsId}/${order.id}`, { status: 'cancelled' });
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('cancelled');
  });

  it('invalid transition completed → pending: returns 400 with error mentioning the transition', async () => {
    const order = makeWorkOrder(wsId, { status: 'in_progress' });
    // First complete it
    await patchJson(`/api/work-orders/${wsId}/${order.id}`, { status: 'completed' });
    // Now try to go backwards
    const res = await patchJson(`/api/work-orders/${wsId}/${order.id}`, { status: 'pending' });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBeTruthy();
    expect(typeof body.error).toBe('string');
  });

  it('invalid transition pending → completed directly: returns 400', async () => {
    const order = makeWorkOrder(wsId);
    const res = await patchJson(`/api/work-orders/${wsId}/${order.id}`, { status: 'completed' });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBeTruthy();
  });

  it('unknown order id returns 404', async () => {
    const res = await patchJson(`/api/work-orders/${wsId}/wo_nonexistent_9999`, { status: 'in_progress' });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Work order not found');
  });

  it('can update assignedTo field', async () => {
    const order = makeWorkOrder(wsId);
    const res = await patchJson(`/api/work-orders/${wsId}/${order.id}`, { assignedTo: 'alice@example.com' });
    expect(res.status).toBe(200);
    const body = await res.json() as { assignedTo?: string };
    expect(body.assignedTo).toBe('alice@example.com');
  });

  it('can update notes field', async () => {
    const order = makeWorkOrder(wsId);
    const res = await patchJson(`/api/work-orders/${wsId}/${order.id}`, { notes: 'Fix applied to home and about pages.' });
    expect(res.status).toBe(200);
    const body = await res.json() as { notes?: string };
    expect(body.notes).toBe('Fix applied to home and about pages.');
  });
});

// ── Completed side effects ────────────────────────────────────────────────────

describe('PATCH .../completed — side effects', () => {
  it('logs activity with type fix_completed and correct workspaceId after completing', async () => {
    const order = makeWorkOrder(wsId, { status: 'in_progress' });
    const res = await patchJson(`/api/work-orders/${wsId}/${order.id}`, { status: 'completed' });
    expect(res.status).toBe(200);

    const row = db
      .prepare(
        `SELECT * FROM activity_log WHERE workspace_id = ? AND type = 'fix_completed' AND metadata LIKE ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(wsId, `%${order.id}%`) as { type: string; workspace_id: string } | undefined;

    expect(row).toBeDefined();
    expect(row?.type).toBe('fix_completed');
    expect(row?.workspace_id).toBe(wsId);
  });

  it('broadcasts WORK_ORDER_UPDATE with { id, status: "completed" } after completing', async () => {
    const order = makeWorkOrder(wsId, { status: 'in_progress' });
    const res = await patchJson(`/api/work-orders/${wsId}/${order.id}`, { status: 'completed' });
    expect(res.status).toBe(200);

    const workOrderBroadcasts = broadcastState.calls.filter(
      c =>
        c.event === WS_EVENTS.WORK_ORDER_UPDATE &&
        c.workspaceId === wsId &&
        (c.payload as { id?: string })?.id === order.id,
    );
    expect(workOrderBroadcasts).toHaveLength(1);
    expect(workOrderBroadcasts[0].payload).toMatchObject({ id: order.id, status: 'completed' });
  });

  it('does NOT fire notifyClientFixesApplied when no client users have email', async () => {
    // No client users exist for wsId at this point
    const order = makeWorkOrder(wsId, { status: 'in_progress' });
    const res = await patchJson(`/api/work-orders/${wsId}/${order.id}`, { status: 'completed' });
    expect(res.status).toBe(200);
    expect(emailState.fixesApplied).toHaveLength(0);
  });

  it('fires notifyClientFixesApplied with correct payload when a client user has email', async () => {
    const testEmail = `client_${Date.now()}@example.com`;
    await createClientUser(testEmail, 'TestPassword123!', 'Test Client', wsId);

    const pageIds = [`page_A_${Date.now()}`, `page_B_${Date.now()}`];
    const order = makeWorkOrder(wsId, { status: 'in_progress', pageIds });

    const res = await patchJson(`/api/work-orders/${wsId}/${order.id}`, { status: 'completed' });
    expect(res.status).toBe(200);

    expect(emailState.fixesApplied).toHaveLength(1);
    const n = emailState.fixesApplied[0];
    expect(n.clientEmail).toBe(testEmail);
    expect(n.workspaceId).toBe(wsId);
    expect(n.workspaceName).toBe(wsName);
    expect(n.productType).toBe('fix meta tags');
    expect(n.pageCount).toBe(2);
  });
});

// ── Public endpoint ───────────────────────────────────────────────────────────

describe('GET /api/public/work-orders/:workspaceId — public', () => {
  it('returns same list as admin endpoint', async () => {
    const order = makeWorkOrder(wsId);

    const [adminRes, publicRes] = await Promise.all([
      getJson(`/api/work-orders/${wsId}`),
      getJson(`/api/public/work-orders/${wsId}`),
    ]);

    expect(adminRes.status).toBe(200);
    expect(publicRes.status).toBe(200);

    const adminBody = (await adminRes.json()) as Array<{ id: string }>;
    const publicBody = (await publicRes.json()) as Array<{ id: string }>;

    const adminIds = adminBody.map(o => o.id);
    const publicIds = publicBody.map(o => o.id);

    expect(publicIds).toContain(order.id);
    // Same set of IDs
    expect(new Set(publicIds)).toEqual(new Set(adminIds));
  });

  it('includes only orders for the requested workspace', async () => {
    const orderA = makeWorkOrder(wsId);
    const orderB = makeWorkOrder(wsIdOther);

    const [resA, resB] = await Promise.all([
      getJson(`/api/public/work-orders/${wsId}`),
      getJson(`/api/public/work-orders/${wsIdOther}`),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const idsA = ((await resA.json()) as Array<{ id: string }>).map(o => o.id);
    const idsB = ((await resB.json()) as Array<{ id: string }>).map(o => o.id);

    expect(idsA).toContain(orderA.id);
    expect(idsA).not.toContain(orderB.id);
    expect(idsB).toContain(orderB.id);
    expect(idsB).not.toContain(orderA.id);
  });
});
