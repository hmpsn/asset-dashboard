import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: { actionId?: string; action?: string } }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: { actionId?: string; action?: string }) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { getClientAction } from '../../server/client-actions.js';
import db from '../../server/db/index.js';
import { WS_EVENTS } from '../../server/ws-events.js';

let baseUrl = '';
let server: http.Server | undefined;
let wsId = '';
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

async function patchJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function countActivitiesForAction(actionId: string, type: string): number {
  const row = db.prepare(`
    SELECT COALESCE(COUNT(*), 0) AS count
    FROM activity_log
    WHERE workspace_id = ?
      AND type = ?
      AND metadata LIKE ?
  `).get(wsId, type, `%"actionId":"${actionId}"%`) as { count: number };
  return row.count;
}

function clientActionBroadcasts() {
  return broadcastState.calls.filter(call => call.event === WS_EVENTS.CLIENT_ACTION_UPDATE);
}

beforeAll(async () => {
  await startTestServer();
  const ws = createWorkspace('Client Actions Broadcasts');
  wsId = ws.id;
});

beforeEach(() => {
  broadcastState.calls = [];
});

afterAll(async () => {
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM client_actions WHERE workspace_id = ?').run(wsId);
  deleteWorkspace(wsId);
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
});

describe('client action broadcasts and workflow side effects', () => {
  it('broadcasts exactly one created event and activity for a new source action', async () => {
    const res = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'internal_link',
      sourceId: 'broadcast:create',
      title: 'Review broadcasted links',
      summary: 'Approve these internal link recommendations.',
      priority: 'high',
    });
    expect(res.status).toBe(200);
    const created = await res.json();

    expect(clientActionBroadcasts()).toEqual([
      {
        workspaceId: wsId,
        event: WS_EVENTS.CLIENT_ACTION_UPDATE,
        payload: { actionId: created.id, action: 'created' },
      },
    ]);
    expect(countActivitiesForAction(created.id, 'client_action_sent')).toBe(1);
  });

  it('returns an existing active source action without duplicate broadcast or activity', async () => {
    const sourceId = 'broadcast:dedupe';
    const firstRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'keyword_strategy',
      sourceId,
      title: 'Review keyword strategy',
      summary: 'Approve this keyword strategy.',
    });
    expect(firstRes.status).toBe(200);
    const first = await firstRes.json();
    expect(clientActionBroadcasts()).toHaveLength(1);

    const duplicateRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'keyword_strategy',
      sourceId,
      title: 'Review keyword strategy again',
      summary: 'This should reuse the active action.',
    });
    expect(duplicateRes.status).toBe(200);
    const duplicate = await duplicateRes.json();

    expect(duplicate.id).toBe(first.id);
    expect(clientActionBroadcasts()).toHaveLength(1);
    expect(countActivitiesForAction(first.id, 'client_action_sent')).toBe(1);
  });

  it('does not broadcast or mutate when an admin transition is rejected', async () => {
    const createRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'content_decay',
      sourceId: 'broadcast:invalid-transition',
      title: 'Refresh declining content',
      summary: 'Approve this content refresh.',
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json();

    const completeRes = await patchJson(`/api/client-actions/${wsId}/${created.id}`, { status: 'completed' });
    expect(completeRes.status).toBe(200);
    broadcastState.calls = [];

    const reopenRes = await patchJson(`/api/client-actions/${wsId}/${created.id}`, { status: 'pending' });
    expect(reopenRes.status).toBe(409);

    const stored = getClientAction(wsId, created.id);
    expect(stored?.status).toBe('completed');
    expect(clientActionBroadcasts()).toHaveLength(0);
  });

  it('does not duplicate completion activity when completed status is submitted again', async () => {
    const createRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'content_decay',
      sourceId: 'broadcast:duplicate-completion',
      title: 'Complete once',
      summary: 'Repeated completion patches should not create duplicate activity.',
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json();

    const completeRes = await patchJson(`/api/client-actions/${wsId}/${created.id}`, { status: 'completed' });
    expect(completeRes.status).toBe(200);
    expect(countActivitiesForAction(created.id, 'client_action_completed')).toBe(1);

    const repeatCompleteRes = await patchJson(`/api/client-actions/${wsId}/${created.id}`, { status: 'completed' });
    expect(repeatCompleteRes.status).toBe(200);

    const stored = getClientAction(wsId, created.id);
    expect(stored?.status).toBe('completed');
    expect(countActivitiesForAction(created.id, 'client_action_completed')).toBe(1);
  });

  it('does not broadcast or mutate when admin update validation fails', async () => {
    const createRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'internal_link',
      sourceId: 'broadcast:admin-validation',
      title: 'Admin validation guard',
      summary: 'Invalid update values should stop before storage.',
      priority: 'low',
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json();
    broadcastState.calls = [];

    const invalidRes = await patchJson(`/api/client-actions/${wsId}/${created.id}`, {
      status: 'not_a_status',
      priority: 'urgent',
    });
    expect(invalidRes.status).toBe(400);

    const stored = getClientAction(wsId, created.id);
    expect(stored).toMatchObject({ status: 'pending', priority: 'low' });
    expect(clientActionBroadcasts()).toHaveLength(0);
    expect(countActivitiesForAction(created.id, 'client_action_completed')).toBe(0);
  });

  it('broadcasts a public response once and blocks duplicate response broadcasts', async () => {
    const createRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'aeo_change',
      sourceId: 'broadcast:public-response',
      title: 'Approve AEO update',
      summary: 'Confirm this AEO recommendation.',
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json();
    broadcastState.calls = [];

    const approveRes = await patchJson(`/api/public/client-actions/${wsId}/${created.id}/respond`, {
      status: 'approved',
      clientNote: 'Approved.',
    });
    expect(approveRes.status).toBe(200);

    expect(clientActionBroadcasts()).toEqual([
      {
        workspaceId: wsId,
        event: WS_EVENTS.CLIENT_ACTION_UPDATE,
        payload: { actionId: created.id, action: 'responded' },
      },
    ]);
    expect(countActivitiesForAction(created.id, 'client_action_approved')).toBe(1);

    broadcastState.calls = [];
    const duplicateRes = await patchJson(`/api/public/client-actions/${wsId}/${created.id}/respond`, {
      status: 'changes_requested',
      clientNote: 'Actually, please change it.',
    });
    expect(duplicateRes.status).toBe(409);
    expect(clientActionBroadcasts()).toHaveLength(0);

    const stored = getClientAction(wsId, created.id);
    expect(stored?.status).toBe('approved');
    expect(stored?.clientNote).toBe('Approved.');
    expect(countActivitiesForAction(created.id, 'client_action_changes_requested')).toBe(0);
  });

  it('does not broadcast or mutate when public response validation fails', async () => {
    const createRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'redirect_proposal',
      sourceId: 'broadcast:public-validation',
      title: 'Public validation guard',
      summary: 'Invalid public response values should stop before storage.',
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json();
    broadcastState.calls = [];

    const invalidRes = await patchJson(`/api/public/client-actions/${wsId}/${created.id}/respond`, {
      status: 'completed',
      clientNote: 'Trying to skip the approval workflow.',
    });
    expect(invalidRes.status).toBe(400);

    const stored = getClientAction(wsId, created.id);
    expect(stored?.status).toBe('pending');
    expect(stored?.clientNote).toBeUndefined();
    expect(clientActionBroadcasts()).toHaveLength(0);
    expect(countActivitiesForAction(created.id, 'client_action_approved')).toBe(0);
    expect(countActivitiesForAction(created.id, 'client_action_changes_requested')).toBe(0);
  });
});
