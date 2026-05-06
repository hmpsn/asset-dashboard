import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{
    workspaceId: string;
    event: string;
    payload: { batchId?: string; itemId?: string; status?: string; applied?: number };
  }>,
}));

const webflowState = vi.hoisted(() => ({
  calls: [] as Array<{ pageId: string; fields: unknown; token?: string }>,
  result: { success: true } as { success: boolean; error?: string },
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((
    workspaceId: string,
    event: string,
    payload: { batchId?: string; itemId?: string; status?: string; applied?: number },
  ) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/webflow.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../server/webflow.js')>();
  return {
    ...actual,
    updatePageSeo: async (pageId: string, fields: unknown, token?: string) => {
      webflowState.calls.push({ pageId, fields, token });
      return webflowState.result;
    },
  };
});

import { createBatch, getBatch, updateItem } from '../../server/approvals.js';
import db from '../../server/db/index.js';
import { getPageState } from '../../server/workspaces.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

let baseUrl = '';
let server: http.Server | undefined;
let wsId = '';
const siteId = `site_approval_broadcast_${randomUUID().slice(0, 8)}`;
const originalAppPassword = process.env.APP_PASSWORD;
const originalWebflowToken = process.env.WEBFLOW_API_TOKEN;

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  process.env.WEBFLOW_API_TOKEN = 'test-webflow-token-approval-broadcasts';
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

async function patchJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createApprovalBatch(name: string, field: 'seoTitle' | 'seoDescription' = 'seoTitle') {
  return createBatch(wsId, siteId, name, [
    {
      pageId: `page_${randomUUID().slice(0, 8)}`,
      pageTitle: `${name} Page`,
      pageSlug: '',
      field,
      currentValue: 'Current SEO value',
      proposedValue: 'Approved SEO value',
    },
  ]);
}

function createMultiItemPageBatch(name: string) {
  const pageId = `page_${randomUUID().slice(0, 8)}`;
  return createBatch(wsId, siteId, name, [
    {
      pageId,
      pageTitle: `${name} Page`,
      pageSlug: '',
      field: 'seoTitle',
      currentValue: 'Current SEO title',
      proposedValue: 'Approved SEO title',
    },
    {
      pageId,
      pageTitle: `${name} Page`,
      pageSlug: '',
      field: 'seoDescription',
      currentValue: 'Current SEO description',
      proposedValue: 'Approved SEO description',
    },
  ]);
}

function approvalUpdateBroadcasts() {
  return broadcastState.calls.filter(call => call.event === WS_EVENTS.APPROVAL_UPDATE);
}

function approvalAppliedBroadcasts() {
  return broadcastState.calls.filter(call => call.event === WS_EVENTS.APPROVAL_APPLIED);
}

function countActivities(type: string, metadataLike: string): number {
  const row = db.prepare(`
    SELECT COALESCE(COUNT(*), 0) AS count
    FROM activity_log
    WHERE workspace_id = ?
      AND type = ?
      AND metadata LIKE ?
  `).get(wsId, type, metadataLike) as { count: number };
  return row.count;
}

beforeAll(async () => {
  await startTestServer();
  const ws = createWorkspace('Public Approval Broadcasts', siteId);
  wsId = ws.id;
});

beforeEach(() => {
  broadcastState.calls = [];
  webflowState.calls = [];
  webflowState.result = { success: true };
});

afterAll(async () => {
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM page_edit_states WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM approval_batches WHERE workspace_id = ?').run(wsId);
  deleteWorkspace(wsId);
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
  if (originalWebflowToken === undefined) {
    delete process.env.WEBFLOW_API_TOKEN;
  } else {
    process.env.WEBFLOW_API_TOKEN = originalWebflowToken;
  }
});

describe('public approval broadcasts and workflow side effects', () => {
  it('broadcasts exactly once when a client approves an approval item', async () => {
    const batch = createApprovalBatch('Approve Broadcast');
    const item = batch.items[0];
    const beforeActivity = countActivities('approval_applied', `%"itemId":"${item.id}"%`);

    const res = await patchJson(`/api/public/approvals/${wsId}/${batch.id}/${item.id}`, {
      status: 'approved',
    });
    expect(res.status).toBe(200);

    expect(getBatch(wsId, batch.id)?.items[0].status).toBe('approved');
    expect(getPageState(wsId, item.pageId)?.status).toBe('approved');
    expect(approvalUpdateBroadcasts()).toEqual([
      {
        workspaceId: wsId,
        event: WS_EVENTS.APPROVAL_UPDATE,
        payload: { batchId: batch.id, itemId: item.id, status: 'approved' },
      },
    ]);
    expect(countActivities('approval_applied', `%"itemId":"${item.id}"%`)).toBe(beforeActivity + 1);
  });

  it('does not broadcast or mutate when public approval validation fails', async () => {
    const batch = createApprovalBatch('Invalid Status Broadcast Guard');
    const item = batch.items[0];
    const beforeUpdatedAt = item.updatedAt;

    const res = await patchJson(`/api/public/approvals/${wsId}/${batch.id}/${item.id}`, {
      status: 'applied',
      clientNote: 'Trying to skip the client approval state machine.',
    });
    expect(res.status).toBe(400);

    const stored = getBatch(wsId, batch.id)?.items[0];
    expect(stored?.status).toBe('pending');
    expect(stored?.clientNote).toBeUndefined();
    expect(stored?.updatedAt).toBe(beforeUpdatedAt);
    expect(getPageState(wsId, item.pageId)).toBeUndefined();
    expect(approvalUpdateBroadcasts()).toHaveLength(0);
    expect(countActivities('approval_applied', `%"itemId":"${item.id}"%`)).toBe(0);
  });

  it('resets approved page state when a client reverts an approval item', async () => {
    const batch = createApprovalBatch('Approve Revert Broadcast');
    const item = batch.items[0];

    const approveRes = await patchJson(`/api/public/approvals/${wsId}/${batch.id}/${item.id}`, {
      status: 'approved',
    });
    expect(approveRes.status).toBe(200);
    expect(getPageState(wsId, item.pageId)?.status).toBe('approved');
    broadcastState.calls = [];

    const res = await patchJson(`/api/public/approvals/${wsId}/${batch.id}/${item.id}`, {
      status: 'pending',
    });
    expect(res.status).toBe(200);

    expect(getBatch(wsId, batch.id)?.items[0].status).toBe('pending');
    expect(getPageState(wsId, item.pageId)?.status).toBe('in-review');
    expect(approvalUpdateBroadcasts()).toEqual([
      {
        workspaceId: wsId,
        event: WS_EVENTS.APPROVAL_UPDATE,
        payload: { batchId: batch.id, itemId: item.id, status: 'pending' },
      },
    ]);
    expect(countActivities('approval_reverted', `%"itemId":"${item.id}"%`)).toBe(1);
  });

  it('derives in-review page state when one item on a multi-field page is reverted', async () => {
    const batch = createMultiItemPageBatch('Multi Item Revert Broadcast');
    const [titleItem, descriptionItem] = batch.items;

    const approveTitleRes = await patchJson(`/api/public/approvals/${wsId}/${batch.id}/${titleItem.id}`, {
      status: 'approved',
    });
    expect(approveTitleRes.status).toBe(200);
    const approveDescriptionRes = await patchJson(`/api/public/approvals/${wsId}/${batch.id}/${descriptionItem.id}`, {
      status: 'approved',
    });
    expect(approveDescriptionRes.status).toBe(200);
    expect(getPageState(wsId, titleItem.pageId)?.status).toBe('approved');
    broadcastState.calls = [];

    const res = await patchJson(`/api/public/approvals/${wsId}/${batch.id}/${titleItem.id}`, {
      status: 'pending',
    });
    expect(res.status).toBe(200);

    const stored = getBatch(wsId, batch.id);
    expect(stored?.items.find(item => item.id === titleItem.id)?.status).toBe('pending');
    expect(stored?.items.find(item => item.id === descriptionItem.id)?.status).toBe('approved');
    expect(stored?.status).toBe('partial');
    expect(getPageState(wsId, titleItem.pageId)?.status).toBe('in-review');
    expect(approvalUpdateBroadcasts()).toEqual([
      {
        workspaceId: wsId,
        event: WS_EVENTS.APPROVAL_UPDATE,
        payload: { batchId: batch.id, itemId: titleItem.id, status: 'pending' },
      },
    ]);
    expect(countActivities('approval_reverted', `%"itemId":"${titleItem.id}"%`)).toBe(1);
  });

  it('broadcasts exactly once when a client rejects then reverts an approval item', async () => {
    const batch = createApprovalBatch('Reject Revert Broadcast');
    const item = batch.items[0];

    const rejectRes = await patchJson(`/api/public/approvals/${wsId}/${batch.id}/${item.id}`, {
      status: 'rejected',
      clientNote: 'Please keep the original value.',
    });
    expect(rejectRes.status).toBe(200);
    expect(getBatch(wsId, batch.id)?.items[0].status).toBe('rejected');
    expect(getPageState(wsId, item.pageId)?.status).toBe('rejected');
    expect(approvalUpdateBroadcasts()).toEqual([
      {
        workspaceId: wsId,
        event: WS_EVENTS.APPROVAL_UPDATE,
        payload: { batchId: batch.id, itemId: item.id, status: 'rejected' },
      },
    ]);
    expect(countActivities('changes_requested', `%"itemId":"${item.id}"%`)).toBe(1);

    broadcastState.calls = [];

    const revertRes = await patchJson(`/api/public/approvals/${wsId}/${batch.id}/${item.id}`, {
      status: 'pending',
      clientNote: '',
    });
    expect(revertRes.status).toBe(200);
    expect(getBatch(wsId, batch.id)?.items[0].status).toBe('pending');
    expect(getPageState(wsId, item.pageId)?.status).toBe('in-review');
    expect(approvalUpdateBroadcasts()).toEqual([
      {
        workspaceId: wsId,
        event: WS_EVENTS.APPROVAL_UPDATE,
        payload: { batchId: batch.id, itemId: item.id, status: 'pending' },
      },
    ]);
    expect(countActivities('approval_reverted', `%"itemId":"${item.id}"%`)).toBe(1);
  });

  it('broadcasts applied count and marks items applied after a successful client apply', async () => {
    const batch = createApprovalBatch('Apply Broadcast', 'seoDescription');
    const item = batch.items[0];
    updateItem(wsId, batch.id, item.id, { status: 'approved' });
    broadcastState.calls = [];

    const res = await postJson(`/api/public/approvals/${wsId}/${batch.id}/apply`, {});
    expect(res.status).toBe(200);
    const body = await res.json() as { applied: number; failed: number };
    expect(body).toMatchObject({ applied: 1, failed: 0 });

    expect(webflowState.calls).toEqual([
      {
        pageId: item.pageId,
        fields: { seo: { description: item.proposedValue } },
        token: 'test-webflow-token-approval-broadcasts',
      },
    ]);
    expect(getBatch(wsId, batch.id)?.items[0].status).toBe('applied');
    expect(getPageState(wsId, item.pageId)?.status).toBe('live');
    expect(approvalAppliedBroadcasts()).toEqual([
      {
        workspaceId: wsId,
        event: WS_EVENTS.APPROVAL_APPLIED,
        payload: { batchId: batch.id, applied: 1 },
      },
    ]);
    expect(countActivities('approval_applied', `%"batchId":"${batch.id}"%`)).toBe(1);
  });

  it('does not mark items applied when the Webflow apply path fails', async () => {
    const batch = createApprovalBatch('Apply Failure Broadcast');
    const item = batch.items[0];
    updateItem(wsId, batch.id, item.id, { status: 'approved' });
    webflowState.result = { success: false, error: 'Webflow rejected the update' };
    broadcastState.calls = [];

    const res = await postJson(`/api/public/approvals/${wsId}/${batch.id}/apply`, {});
    expect(res.status).toBe(200);
    const body = await res.json() as { applied: number; failed: number; results: Array<{ success: boolean; error?: string }> };
    expect(body.applied).toBe(0);
    expect(body.failed).toBe(1);
    expect(body.results[0]).toMatchObject({ success: false, error: 'Webflow rejected the update' });

    expect(getBatch(wsId, batch.id)?.items[0].status).toBe('approved');
    expect(getPageState(wsId, item.pageId)).toBeUndefined();
    expect(approvalAppliedBroadcasts()).toEqual([
      {
        workspaceId: wsId,
        event: WS_EVENTS.APPROVAL_APPLIED,
        payload: { batchId: batch.id, applied: 0 },
      },
    ]);
    expect(countActivities('approval_applied', `%"batchId":"${batch.id}"%`)).toBe(0);
  });
});
