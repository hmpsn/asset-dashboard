import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: { id?: string; status?: string } }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: { id?: string; status?: string }) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/email.js', () => ({
  notifyClientFixesApplied: vi.fn(),
}));

import db from '../../server/db/index.js';
import { createPayment } from '../../server/payments.js';
import { createWorkOrder, getWorkOrder } from '../../server/work-orders.js';
import { createWorkspace, deleteWorkspace, getPageState } from '../../server/workspaces.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import type { ProductType } from '../../shared/types/payments.js';

let baseUrl = '';
let server: http.Server | undefined;
let wsAId = '';
let wsBId = '';
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
    server!.close(err => err ? reject(err) : resolve());
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

function createOrder(workspaceId: string, productType: ProductType = 'fix_meta') {
  const payment = createPayment(workspaceId, {
    workspaceId,
    stripeSessionId: `cs_mutation_${workspaceId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    productType,
    amount: 12500,
    currency: 'usd',
    status: 'paid',
  });
  return createWorkOrder(workspaceId, {
    paymentId: payment.id,
    productType,
    pageIds: ['page_mutation_a', 'page_mutation_b'],
    issueChecks: ['metadata'],
    quantity: 2,
  });
}

function workOrderBroadcasts() {
  return broadcastState.calls.filter(call => call.event === WS_EVENTS.WORK_ORDER_UPDATE);
}

function countFixCompletedActivities(orderId: string): number {
  const row = db.prepare(`
    SELECT COALESCE(COUNT(*), 0) AS count
    FROM activity_log
    WHERE workspace_id = ?
      AND type = 'fix_completed'
      AND metadata LIKE ?
  `).get(wsAId, `%"workOrderId":"${orderId}"%`) as { count: number };
  return row.count;
}

beforeAll(async () => {
  await startTestServer();
  wsAId = createWorkspace('Work Order Mutation Safety A').id;
  wsBId = createWorkspace('Work Order Mutation Safety B').id;
}, 25_000);

beforeEach(() => {
  broadcastState.calls = [];
  db.prepare('DELETE FROM activity_log WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  db.prepare('DELETE FROM page_edit_states WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  db.prepare('DELETE FROM work_orders WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  db.prepare('DELETE FROM payments WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
});

afterAll(async () => {
  db.prepare('DELETE FROM activity_log WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  db.prepare('DELETE FROM page_edit_states WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  db.prepare('DELETE FROM work_orders WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  db.prepare('DELETE FROM payments WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  deleteWorkspace(wsAId);
  deleteWorkspace(wsBId);
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
});

describe('work-order mutation safety', () => {
  it('updates work order fields and broadcasts exactly once without completion activity', async () => {
    const order = createOrder(wsAId);

    const res = await patchJson(`/api/work-orders/${wsAId}/${order.id}`, {
      status: 'in_progress',
      assignedTo: 'Ops lead',
      notes: 'Started fulfillment.',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id: order.id,
      status: 'in_progress',
      assignedTo: 'Ops lead',
      notes: 'Started fulfillment.',
    });

    const stored = getWorkOrder(wsAId, order.id);
    expect(stored).toMatchObject({
      status: 'in_progress',
      assignedTo: 'Ops lead',
      notes: 'Started fulfillment.',
    });
    expect(workOrderBroadcasts()).toEqual([
      {
        workspaceId: wsAId,
        event: WS_EVENTS.WORK_ORDER_UPDATE,
        payload: { id: order.id, status: 'in_progress' },
      },
    ]);
    expect(countFixCompletedActivities(order.id)).toBe(0);
  });

  it('completes an in-progress order with activity and live page states', async () => {
    const order = createOrder(wsAId, 'fix_meta_10');
    const progressRes = await patchJson(`/api/work-orders/${wsAId}/${order.id}`, {
      status: 'in_progress',
    });
    expect(progressRes.status).toBe(200);
    broadcastState.calls = [];

    const completeRes = await patchJson(`/api/work-orders/${wsAId}/${order.id}`, {
      status: 'completed',
    });

    expect(completeRes.status).toBe(200);
    const completed = await completeRes.json();
    expect(completed.status).toBe('completed');
    expect(completed.completedAt).toBeDefined();

    for (const pageId of order.pageIds) {
      expect(getPageState(wsAId, pageId)).toMatchObject({
        status: 'live',
        source: 'cart-fix',
        workOrderId: order.id,
        updatedBy: 'admin',
      });
    }
    expect(countFixCompletedActivities(order.id)).toBe(1);
    expect(workOrderBroadcasts()).toEqual([
      {
        workspaceId: wsAId,
        event: WS_EVENTS.WORK_ORDER_UPDATE,
        payload: { id: order.id, status: 'completed' },
      },
    ]);
  });

  it('rejects invalid transitions without mutating, broadcasting, activity, or page-state writes', async () => {
    const order = createOrder(wsAId);

    const res = await patchJson(`/api/work-orders/${wsAId}/${order.id}`, {
      status: 'completed',
    });

    expect(res.status).toBe(400);
    expect(getWorkOrder(wsAId, order.id)?.status).toBe('pending');
    expect(workOrderBroadcasts()).toHaveLength(0);
    expect(countFixCompletedActivities(order.id)).toBe(0);
    for (const pageId of order.pageIds) {
      expect(getPageState(wsAId, pageId)).toBeUndefined();
    }
  });

  it('does not mutate or broadcast when the order id belongs to another workspace', async () => {
    const order = createOrder(wsAId);

    const res = await patchJson(`/api/work-orders/${wsBId}/${order.id}`, {
      status: 'in_progress',
      assignedTo: 'Cross workspace probe',
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Work order not found');
    expect(getWorkOrder(wsAId, order.id)).toMatchObject({
      status: 'pending',
      assignedTo: undefined,
    });
    expect(workOrderBroadcasts()).toHaveLength(0);
    expect(countFixCompletedActivities(order.id)).toBe(0);
  });
});
