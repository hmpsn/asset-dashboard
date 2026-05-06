import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: { id?: string; status?: string } }>,
}));

const emailState = vi.hoisted(() => ({
  contentRequests: [] as unknown[],
  changesRequested: [] as unknown[],
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: { id?: string; status?: string }) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/email.js', () => ({
  notifyTeamContentRequest: vi.fn((payload: unknown) => {
    emailState.contentRequests.push(payload);
  }),
  notifyTeamChangesRequested: vi.fn((payload: unknown) => {
    emailState.changesRequested.push(payload);
  }),
}));

import { createContentRequest, getContentRequest, updateContentRequest } from '../../server/content-requests.js';
import db from '../../server/db/index.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

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

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createRequest(status: 'requested' | 'client_review' | 'approved') {
  const request = createContentRequest(wsId, {
    topic: `Client Review ${Date.now()} ${Math.random().toString(36).slice(2, 6)}`,
    targetKeyword: `client-review-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    intent: 'informational',
    priority: 'medium',
    rationale: 'Public content request workflow regression guard',
    serviceType: 'brief_only',
    initialStatus: status === 'requested' ? 'requested' : 'brief_generated',
    dedupe: false,
  });
  if (status === 'requested') return request;
  const reviewRequest = updateContentRequest(wsId, request.id, {
    status: 'client_review',
    briefId: `brief_public_content_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  })!;
  if (status === 'client_review') return reviewRequest;
  return updateContentRequest(wsId, request.id, { status: 'approved' })!;
}

function contentRequestBroadcasts() {
  return broadcastState.calls.filter(call => call.event === WS_EVENTS.CONTENT_REQUEST_UPDATE);
}

function countActivitiesForRequest(requestId: string, type: string): number {
  const row = db.prepare(`
    SELECT COALESCE(COUNT(*), 0) AS count
    FROM activity_log
    WHERE workspace_id = ?
      AND type = ?
      AND metadata LIKE ?
  `).get(wsId, type, `%"requestId":"${requestId}"%`) as { count: number };
  return row.count;
}

function latestActivityDescriptionForRequest(requestId: string, type: string): string | null | undefined {
  const row = db.prepare(`
    SELECT description
    FROM activity_log
    WHERE workspace_id = ?
      AND type = ?
      AND metadata LIKE ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(wsId, type, `%"requestId":"${requestId}"%`) as { description: string | null } | undefined;
  return row?.description;
}

beforeAll(async () => {
  await startTestServer();
  const ws = createWorkspace('Public Content Request Workflow Broadcasts');
  wsId = ws.id;
});

beforeEach(() => {
  broadcastState.calls = [];
  emailState.contentRequests = [];
  emailState.changesRequested = [];
});

afterAll(async () => {
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(wsId);
  deleteWorkspace(wsId);
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
});

describe('public content request workflow broadcasts and side effects', () => {
  it('broadcasts exactly once when a client approves a brief', async () => {
    const request = createRequest('client_review');

    const res = await postJson(`/api/public/content-request/${wsId}/${request.id}/approve`, {});
    expect(res.status).toBe(200);

    expect(getContentRequest(wsId, request.id)?.status).toBe('approved');
    expect(contentRequestBroadcasts()).toEqual([
      {
        workspaceId: wsId,
        event: WS_EVENTS.CONTENT_REQUEST_UPDATE,
        payload: { id: request.id, status: 'approved' },
      },
    ]);
    expect(countActivitiesForRequest(request.id, 'brief_approved')).toBe(1);
  });

  it('broadcasts exactly once and notifies the team when a client requests brief changes', async () => {
    const request = createRequest('client_review');

    const res = await postJson(`/api/public/content-request/${wsId}/${request.id}/request-changes`, {
      feedback: 'Please make the outline more practical.',
    });
    expect(res.status).toBe(200);

    const stored = getContentRequest(wsId, request.id);
    expect(stored?.status).toBe('changes_requested');
    expect(stored?.clientFeedback).toBe('Please make the outline more practical.');
    expect(contentRequestBroadcasts()).toEqual([
      {
        workspaceId: wsId,
        event: WS_EVENTS.CONTENT_REQUEST_UPDATE,
        payload: { id: request.id, status: 'changes_requested' },
      },
    ]);
    expect(countActivitiesForRequest(request.id, 'changes_requested')).toBe(1);
    expect(emailState.changesRequested).toHaveLength(1);
  });

  it('broadcasts exactly once when a client declines a request', async () => {
    const request = createRequest('requested');

    const res = await postJson(`/api/public/content-request/${wsId}/${request.id}/decline`, {
      reason: 'This topic is not a priority right now.',
    });
    expect(res.status).toBe(200);

    const stored = getContentRequest(wsId, request.id);
    expect(stored?.status).toBe('declined');
    expect(stored?.declineReason).toBe('This topic is not a priority right now.');
    expect(contentRequestBroadcasts()).toEqual([
      {
        workspaceId: wsId,
        event: WS_EVENTS.CONTENT_REQUEST_UPDATE,
        payload: { id: request.id, status: 'declined' },
      },
    ]);
    expect(countActivitiesForRequest(request.id, 'content_declined')).toBe(1);
  });

  it('broadcasts exactly once when a client upgrades an approved brief to a full post', async () => {
    const request = createRequest('approved');

    const res = await postJson(`/api/public/content-request/${wsId}/${request.id}/upgrade`, {});
    expect(res.status).toBe(200);

    const stored = getContentRequest(wsId, request.id);
    expect(stored?.serviceType).toBe('full_post');
    expect(stored?.status).toBe('in_progress');
    expect(stored?.upgradedAt).toBeDefined();
    expect(contentRequestBroadcasts()).toEqual([
      {
        workspaceId: wsId,
        event: WS_EVENTS.CONTENT_REQUEST_UPDATE,
        payload: { id: request.id, status: 'in_progress' },
      },
    ]);
    expect(countActivitiesForRequest(request.id, 'content_upgraded')).toBe(1);
  });

  it('stores public comments as client-authored and broadcasts the request update', async () => {
    const request = createRequest('client_review');
    const content = `Looks good overall, but please mention pricing. ${'Additional context. '.repeat(12)}`;
    const sanitizedContent = content.trim();

    const res = await postJson(`/api/public/content-request/${wsId}/${request.id}/comment`, {
      content,
    });
    expect(res.status).toBe(200);

    const stored = getContentRequest(wsId, request.id);
    expect(stored?.comments).toHaveLength(1);
    expect(stored?.comments?.[0]).toMatchObject({
      author: 'client',
      content: sanitizedContent,
    });
    expect(contentRequestBroadcasts()).toEqual([
      {
        workspaceId: wsId,
        event: WS_EVENTS.CONTENT_REQUEST_UPDATE,
        payload: { id: request.id, status: 'client_review' },
      },
    ]);
    expect(countActivitiesForRequest(request.id, 'content_request_commented')).toBe(1);
    expect(latestActivityDescriptionForRequest(request.id, 'content_request_commented')).toBe(
      `${sanitizedContent.slice(0, 197)}...`,
    );
  });

  it('rejects unsupported public comment fields before mutating or broadcasting', async () => {
    const request = createRequest('client_review');

    const res = await postJson(`/api/public/content-request/${wsId}/${request.id}/comment`, {
      author: 'team',
      content: 'Please record this as a team comment.',
    });
    expect(res.status).toBe(400);

    expect(getContentRequest(wsId, request.id)?.comments).toEqual([]);
    expect(contentRequestBroadcasts()).toHaveLength(0);
  });
});
