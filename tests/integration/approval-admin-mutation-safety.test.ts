import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: { batchId?: string; action?: string } }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: { batchId?: string; action?: string }) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/email.js', () => ({
  notifyApprovalReady: vi.fn(),
}));

import db from '../../server/db/index.js';
import { getBatch, listBatches } from '../../server/approvals.js';
import { createWorkspace, deleteWorkspace, getPageState } from '../../server/workspaces.js';
import { WS_EVENTS } from '../../server/ws-events.js';

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

async function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, opts);
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function deleteJson(path: string): Promise<Response> {
  return api(path, { method: 'DELETE' });
}

function approvalPayload() {
  return {
    siteId: 'site_admin_approval_safety',
    name: 'Admin Approval Safety',
    note: 'Please review these page changes.',
    items: [
      {
        pageId: 'page_admin_approval_safety',
        pageSlug: '/services',
        pageTitle: 'Services',
        field: 'seoTitle',
        currentValue: 'Services',
        proposedValue: 'Growth Services',
      },
    ],
  };
}

function approvalBroadcasts() {
  return broadcastState.calls.filter(call => call.event === WS_EVENTS.APPROVAL_UPDATE);
}

function countActivities(workspaceId: string, type: string, metadataLike = '%'): number {
  const row = db.prepare(`
    SELECT COALESCE(COUNT(*), 0) AS count
    FROM activity_log
    WHERE workspace_id = ?
      AND type = ?
      AND metadata LIKE ?
  `).get(workspaceId, type, metadataLike) as { count: number };
  return row.count;
}

async function publicActivity(workspaceId: string) {
  const res = await api(`/api/public/activity/${workspaceId}?limit=10`);
  expect(res.status).toBe(200);
  return await res.json() as Array<{ type: string; title: string; metadata?: unknown }>;
}

beforeAll(async () => {
  await startTestServer();
  wsAId = createWorkspace('Approval Admin Mutation Safety A').id;
  wsBId = createWorkspace('Approval Admin Mutation Safety B').id;
}, 25_000);

beforeEach(() => {
  broadcastState.calls = [];
  db.prepare('DELETE FROM activity_log WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  db.prepare('DELETE FROM page_edit_states WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  db.prepare('DELETE FROM approval_batches WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
});

afterAll(async () => {
  db.prepare('DELETE FROM activity_log WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  db.prepare('DELETE FROM page_edit_states WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  db.prepare('DELETE FROM approval_batches WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  deleteWorkspace(wsAId);
  deleteWorkspace(wsBId);
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
});

describe('admin approval mutation safety', () => {
  it('creates an approval batch with page state, activity, broadcast, and public/admin read paths', async () => {
    const res = await postJson(`/api/approvals/${wsAId}`, approvalPayload());

    expect(res.status).toBe(200);
    const batch = await res.json();
    expect(batch.id).toMatch(/^ab_/);
    expect(batch.items).toHaveLength(1);

    expect(getBatch(wsAId, batch.id)).toBeDefined();
    expect(getPageState(wsAId, 'page_admin_approval_safety')).toMatchObject({
      status: 'in-review',
      fields: ['seoTitle'],
      approvalBatchId: batch.id,
      updatedBy: 'admin',
    });
    expect(countActivities(wsAId, 'approval_sent', `%"batchId":"${batch.id}"%`)).toBe(1);
    expect(approvalBroadcasts()).toEqual([
      {
        workspaceId: wsAId,
        event: WS_EVENTS.APPROVAL_UPDATE,
        payload: { batchId: batch.id, action: 'created' },
      },
    ]);

    const adminRead = await api(`/api/approvals/${wsAId}/${batch.id}`);
    expect(adminRead.status).toBe(200);
    expect((await adminRead.json()).id).toBe(batch.id);

    const publicRead = await api(`/api/public/approvals/${wsAId}`);
    expect(publicRead.status).toBe(200);
    const publicBatches = await publicRead.json() as Array<{ id: string }>;
    expect(publicBatches.some(publicBatch => publicBatch.id === batch.id)).toBe(true);

    const clientActivity = await publicActivity(wsAId);
    expect(clientActivity.some(entry => entry.type === 'approval_sent' && entry.title.includes('Admin Approval Safety'))).toBe(true);
  });

  it('deletes an approval batch with page-state cleanup, admin-only activity, and broadcast', async () => {
    const createRes = await postJson(`/api/approvals/${wsAId}`, approvalPayload());
    const batch = await createRes.json();
    broadcastState.calls = [];

    const deleteRes = await deleteJson(`/api/approvals/${wsAId}/${batch.id}`);
    expect(deleteRes.status).toBe(200);
    expect(await deleteRes.json()).toEqual({ ok: true });

    expect(getBatch(wsAId, batch.id)).toBeUndefined();
    expect(getPageState(wsAId, 'page_admin_approval_safety')).toBeUndefined();
    expect(countActivities(wsAId, 'approval_deleted', `%"batchId":"${batch.id}"%`)).toBe(1);
    expect(approvalBroadcasts()).toEqual([
      {
        workspaceId: wsAId,
        event: WS_EVENTS.APPROVAL_UPDATE,
        payload: { batchId: batch.id, action: 'deleted' },
      },
    ]);

    const clientActivity = await publicActivity(wsAId);
    expect(clientActivity.some(entry => entry.type === 'approval_deleted')).toBe(false);
  });

  it('rejects malformed create input before batch, page-state, activity, or broadcast side effects', async () => {
    const res = await postJson(`/api/approvals/${wsAId}`, {
      siteId: 'site_admin_approval_safety',
      name: 'Malformed Approval',
      items: [],
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBeDefined();
    expect(listBatches(wsAId)).toHaveLength(0);
    expect(getPageState(wsAId, 'page_admin_approval_safety')).toBeUndefined();
    expect(countActivities(wsAId, 'approval_sent')).toBe(0);
    expect(approvalBroadcasts()).toHaveLength(0);
  });

  it('does not mutate or broadcast when deleting a missing batch', async () => {
    const res = await deleteJson(`/api/approvals/${wsAId}/batch_missing_mutation_safety`);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Batch not found');
    expect(listBatches(wsAId)).toHaveLength(0);
    expect(countActivities(wsAId, 'approval_deleted')).toBe(0);
    expect(approvalBroadcasts()).toHaveLength(0);
  });

  it('does not delete a batch through another workspace route', async () => {
    const createRes = await postJson(`/api/approvals/${wsAId}`, approvalPayload());
    const batch = await createRes.json();
    broadcastState.calls = [];

    const crossDelete = await deleteJson(`/api/approvals/${wsBId}/${batch.id}`);
    const body = await crossDelete.json();

    expect(crossDelete.status).toBe(404);
    expect(body.error).toBe('Batch not found');
    expect(getBatch(wsAId, batch.id)).toBeDefined();
    expect(countActivities(wsAId, 'approval_deleted', `%"batchId":"${batch.id}"%`)).toBe(0);
    expect(countActivities(wsBId, 'approval_deleted')).toBe(0);
    expect(approvalBroadcasts()).toHaveLength(0);
  });
});
