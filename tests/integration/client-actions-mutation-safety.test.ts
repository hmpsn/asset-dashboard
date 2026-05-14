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
import { createClientUser, deleteClientUser, signClientToken } from '../../server/client-users.js';
import { getClientAction } from '../../server/client-actions.js';
import db from '../../server/db/index.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import type { ClientAction } from '../../shared/types/client-actions.js';

interface ActivityRow {
  type: string;
  actor_id: string | null;
  actor_name: string | null;
}

let baseUrl = '';
let server: http.Server | undefined;
let wsId = '';
let otherWsId = '';
let privateWsId = '';
let clientUserId = '';
let clientUserToken = '';
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

async function postJson(path: string, body: unknown, opts?: RequestInit): Promise<Response> {
  return api(path, {
    ...opts,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(opts?.headers as Record<string, string> | undefined) },
    body: JSON.stringify(body),
  });
}

async function patchJson(path: string, body: unknown, opts?: RequestInit): Promise<Response> {
  return api(path, {
    ...opts,
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(opts?.headers as Record<string, string> | undefined) },
    body: JSON.stringify(body),
  });
}

function clientUserCookie(): string {
  return `client_user_token_${privateWsId}=${clientUserToken}`;
}

function clientActionBroadcasts() {
  return broadcastState.calls.filter(call => call.event === WS_EVENTS.CLIENT_ACTION_UPDATE);
}

function activitiesForAction(workspaceId: string, actionId: string, type?: string): ActivityRow[] {
  const typeClause = type ? 'AND type = @type' : '';
  return db.prepare(`
    SELECT type, actor_id, actor_name
    FROM activity_log
    WHERE workspace_id = @workspaceId
      AND metadata LIKE @actionNeedle
      ${typeClause}
    ORDER BY created_at ASC
  `).all({
    workspaceId,
    actionNeedle: `%"actionId":"${actionId}"%`,
    type,
  }) as ActivityRow[];
}

async function listAdminActions(workspaceId: string): Promise<ClientAction[]> {
  const res = await api(`/api/client-actions/${workspaceId}`);
  expect(res.status).toBe(200);
  return await res.json() as ClientAction[];
}

async function listPublicActions(workspaceId: string, opts?: RequestInit): Promise<ClientAction[]> {
  const res = await api(`/api/public/client-actions/${workspaceId}`, opts);
  expect(res.status).toBe(200);
  return await res.json() as ClientAction[];
}

beforeAll(async () => {
  await startTestServer();
  const ws = createWorkspace('Client Action Mutation Safety');
  wsId = ws.id;
  const otherWs = createWorkspace('Client Action Mutation Other');
  otherWsId = otherWs.id;
  const privateWs = createWorkspace('Client Action Mutation Private');
  privateWsId = privateWs.id;
  const clientUser = await createClientUser(
    'client-action-safety@test.local',
    'ClientActionPass1!',
    'Pat Client',
    privateWsId,
  );
  clientUserId = clientUser.id;
  clientUserToken = signClientToken(clientUser);
});

beforeEach(() => {
  broadcastState.calls = [];
});

afterAll(async () => {
  if (clientUserId) deleteClientUser(clientUserId, privateWsId);
  db.prepare('DELETE FROM activity_log WHERE workspace_id IN (?, ?, ?)').run(wsId, otherWsId, privateWsId);
  db.prepare('DELETE FROM client_actions WHERE workspace_id IN (?, ?, ?)').run(wsId, otherWsId, privateWsId);
  deleteWorkspace(wsId);
  deleteWorkspace(otherWsId);
  deleteWorkspace(privateWsId);
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
});

describe('client action mutation safety', () => {
  it('preserves state, activity, broadcasts, and read paths across admin lifecycle mutations', async () => {
    const createRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'internal_link',
      sourceId: 'mutation-safety:admin-lifecycle',
      title: 'Review internal link recommendations',
      summary: 'Approve internal links before implementation.',
      priority: 'low',
      payload: { suggestions: [{ anchorText: 'Services', targetUrl: '/services' }] },
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json() as ClientAction;

    expect(getClientAction(wsId, created.id)?.status).toBe('pending');
    expect(clientActionBroadcasts()).toEqual([
      { workspaceId: wsId, event: WS_EVENTS.CLIENT_ACTION_UPDATE, payload: { actionId: created.id, action: 'created' } },
    ]);
    expect(activitiesForAction(wsId, created.id, 'client_action_sent')).toHaveLength(1);
    expect((await listAdminActions(wsId)).some(action => action.id === created.id)).toBe(true);
    expect((await listPublicActions(wsId)).some(action => action.id === created.id)).toBe(true);

    broadcastState.calls = [];
    const updateRes = await patchJson(`/api/client-actions/${wsId}/${created.id}`, {
      title: 'Review updated internal link recommendations',
      summary: 'Updated summary for the client.',
      priority: 'high',
      clientNote: 'Please review the updated link list.',
    });
    expect(updateRes.status).toBe(200);
    const updated = await updateRes.json() as ClientAction;
    expect(updated).toMatchObject({
      id: created.id,
      title: 'Review updated internal link recommendations',
      priority: 'high',
      status: 'pending',
      clientNote: 'Please review the updated link list.',
    });
    expect(clientActionBroadcasts()).toEqual([
      { workspaceId: wsId, event: WS_EVENTS.CLIENT_ACTION_UPDATE, payload: { actionId: created.id, action: 'updated' } },
    ]);
    expect(activitiesForAction(wsId, created.id, 'client_action_completed')).toHaveLength(0);
    expect((await listPublicActions(wsId)).find(action => action.id === created.id)?.title)
      .toBe('Review updated internal link recommendations');

    broadcastState.calls = [];
    const completeRes = await patchJson(`/api/client-actions/${wsId}/${created.id}`, { status: 'completed' });
    expect(completeRes.status).toBe(200);
    expect((await completeRes.json() as ClientAction).status).toBe('completed');
    expect(clientActionBroadcasts()).toEqual([
      { workspaceId: wsId, event: WS_EVENTS.CLIENT_ACTION_UPDATE, payload: { actionId: created.id, action: 'updated' } },
    ]);
    expect(activitiesForAction(wsId, created.id, 'client_action_completed')).toHaveLength(1);
    expect((await listAdminActions(wsId)).find(action => action.id === created.id)?.status).toBe('completed');
    expect((await listPublicActions(wsId)).find(action => action.id === created.id)?.status).toBe('completed');
  });

  it('keeps public decisions actor-attributed, scoped, and one-shot', async () => {
    const createRes = await postJson(`/api/client-actions/${privateWsId}`, {
      sourceType: 'aeo_change',
      sourceId: 'mutation-safety:actor-decision',
      title: 'Approve AEO copy changes',
      summary: 'Client should approve AEO copy changes.',
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json() as ClientAction;

    broadcastState.calls = [];
    const approveRes = await patchJson(
      `/api/public/client-actions/${privateWsId}/${created.id}/respond`,
      { status: 'approved', clientNote: 'Approved by the client user.' },
      { headers: { Cookie: clientUserCookie() } },
    );
    expect(approveRes.status).toBe(200);
    expect((await approveRes.json() as ClientAction).status).toBe('approved');
    expect(clientActionBroadcasts()).toEqual([
      { workspaceId: privateWsId, event: WS_EVENTS.CLIENT_ACTION_UPDATE, payload: { actionId: created.id, action: 'responded' } },
    ]);

    const approvalActivity = activitiesForAction(privateWsId, created.id, 'client_action_approved');
    expect(approvalActivity).toHaveLength(1);
    expect(approvalActivity[0]).toMatchObject({ actor_id: clientUserId, actor_name: 'Pat Client' });

    broadcastState.calls = [];
    const duplicateRes = await patchJson(
      `/api/public/client-actions/${privateWsId}/${created.id}/respond`,
      { status: 'changes_requested', clientNote: 'Second response must not persist.' },
      { headers: { Cookie: clientUserCookie() } },
    );
    expect(duplicateRes.status).toBe(409);
    expect(clientActionBroadcasts()).toHaveLength(0);
    expect(activitiesForAction(privateWsId, created.id, 'client_action_changes_requested')).toHaveLength(0);
    expect(getClientAction(privateWsId, created.id)).toMatchObject({
      status: 'approved',
      clientNote: 'Approved by the client user.',
    });

    const crossCreateRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'redirect_proposal',
      sourceId: 'mutation-safety:cross-workspace',
      title: 'Cross-workspace decision guard',
      summary: 'This action belongs to the primary workspace.',
    });
    expect(crossCreateRes.status).toBe(200);
    const crossAction = await crossCreateRes.json() as ClientAction;

    broadcastState.calls = [];
    const crossRespondRes = await patchJson(
      `/api/public/client-actions/${otherWsId}/${crossAction.id}/respond`,
      { status: 'approved', clientNote: 'Cross-workspace probe.' },
    );
    expect(crossRespondRes.status).toBe(404);
    expect(clientActionBroadcasts()).toHaveLength(0);
    expect(activitiesForAction(wsId, crossAction.id, 'client_action_approved')).toHaveLength(0);
    expect(getClientAction(wsId, crossAction.id)).toMatchObject({ status: 'pending', clientNote: undefined });
  });

  it('rejects malformed and invalid transitions before mutation side effects', async () => {
    const createRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'redirect_proposal',
      sourceId: 'mutation-safety:invalid-cases',
      title: 'Invalid response guard',
      summary: 'Invalid mutation attempts must leave this action unchanged.',
      priority: 'medium',
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json() as ClientAction;

    broadcastState.calls = [];
    const invalidPublicRes = await patchJson(`/api/public/client-actions/${wsId}/${created.id}/respond`, {
      status: 'completed',
      clientNote: 'Trying to skip approval.',
    });
    expect(invalidPublicRes.status).toBe(400);
    expect(clientActionBroadcasts()).toHaveLength(0);
    expect(activitiesForAction(wsId, created.id, 'client_action_approved')).toHaveLength(0);
    expect(getClientAction(wsId, created.id)).toMatchObject({ status: 'pending', priority: 'medium' });

    const completeRes = await patchJson(`/api/client-actions/${wsId}/${created.id}`, { status: 'completed' });
    expect(completeRes.status).toBe(200);

    broadcastState.calls = [];
    const invalidAdminRes = await patchJson(`/api/client-actions/${wsId}/${created.id}`, { status: 'pending' });
    expect(invalidAdminRes.status).toBe(409);
    expect(clientActionBroadcasts()).toHaveLength(0);
    expect(activitiesForAction(wsId, created.id, 'client_action_completed')).toHaveLength(1);
    expect(getClientAction(wsId, created.id)?.status).toBe('completed');
  });
});
