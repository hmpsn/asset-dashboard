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

import { getContentRequest, createContentRequest, updateContentRequest } from '../../server/content-requests.js';
import { savePost } from '../../server/content-posts-db.js';
import db from '../../server/db/index.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import type { GeneratedPost } from '../../shared/types/content.js';

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

function makeStubPost(workspaceId: string, briefId: string): GeneratedPost {
  const now = new Date().toISOString();
  return {
    id: `post_review_broadcast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    workspaceId,
    briefId,
    targetKeyword: 'broadcast review keyword',
    title: 'Broadcast Review Post',
    metaDescription: 'Broadcast review meta description',
    introduction: '<p>Broadcast review introduction.</p>',
    sections: [
      {
        index: 0,
        heading: 'Review Section',
        content: '<p>Review section content.</p>',
        wordCount: 3,
        targetWordCount: 200,
        keywords: [],
        status: 'done',
      },
    ],
    conclusion: '<p>Broadcast review conclusion.</p>',
    totalWordCount: 25,
    targetWordCount: 1200,
    status: 'review',
    createdAt: now,
    updatedAt: now,
  };
}

function createPostReviewRequest(topic: string): { requestId: string; postId: string } {
  const request = createContentRequest(wsId, {
    topic,
    targetKeyword: `${topic.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
    intent: 'informational',
    priority: 'medium',
    rationale: 'Post review broadcast regression guard',
    serviceType: 'full_post',
    dedupe: false,
  });
  const briefId = `brief_post_review_broadcast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  updateContentRequest(wsId, request.id, { briefId });
  const post = makeStubPost(wsId, briefId);
  savePost(wsId, post);
  updateContentRequest(wsId, request.id, { status: 'in_progress' });
  updateContentRequest(wsId, request.id, { status: 'post_review', postId: post.id });
  return { requestId: request.id, postId: post.id };
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

function contentRequestBroadcasts() {
  return broadcastState.calls.filter(call => call.event === WS_EVENTS.CONTENT_REQUEST_UPDATE);
}

beforeAll(async () => {
  await startTestServer();
  const ws = createWorkspace('Public Post Review Broadcasts');
  wsId = ws.id;
});

beforeEach(() => {
  broadcastState.calls = [];
});

afterAll(async () => {
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM content_posts WHERE workspace_id = ?').run(wsId);
  deleteWorkspace(wsId);
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
});

describe('public post review broadcasts and workflow side effects', () => {
  it('broadcasts exactly once when a client approves a post review', async () => {
    const { requestId } = createPostReviewRequest('Approve Broadcast');

    const res = await postJson(`/api/public/content-request/${wsId}/${requestId}/approve-post`, {});
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('delivered');

    expect(contentRequestBroadcasts()).toEqual([
      {
        workspaceId: wsId,
        event: WS_EVENTS.CONTENT_REQUEST_UPDATE,
        payload: { id: requestId, status: 'delivered' },
      },
    ]);
    expect(countActivitiesForRequest(requestId, 'post_approved')).toBe(1);
  });

  it('does not broadcast or mutate when approve-post validation fails', async () => {
    const { requestId } = createPostReviewRequest('Approve Validation Guard');
    broadcastState.calls = [];

    const res = await postJson(`/api/public/content-request/${wsId}/${requestId}/approve-post`, {
      status: 'delivered',
    });
    expect(res.status).toBe(400);

    expect(getContentRequest(wsId, requestId)?.status).toBe('post_review');
    expect(contentRequestBroadcasts()).toHaveLength(0);
    expect(countActivitiesForRequest(requestId, 'post_approved')).toBe(0);
  });

  it('does not broadcast or mutate when post change requests fail validation', async () => {
    const { requestId } = createPostReviewRequest('Changes Validation Guard');
    broadcastState.calls = [];

    const res = await postJson(`/api/public/content-request/${wsId}/${requestId}/request-post-changes`, {
      feedback: '',
    });
    expect(res.status).toBe(400);

    const stored = getContentRequest(wsId, requestId);
    expect(stored?.status).toBe('post_review');
    expect(stored?.clientFeedback).toBeUndefined();
    expect(contentRequestBroadcasts()).toHaveLength(0);
    expect(countActivitiesForRequest(requestId, 'post_changes_requested')).toBe(0);
  });
});
