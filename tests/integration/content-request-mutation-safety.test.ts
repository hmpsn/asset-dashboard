import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: Record<string, unknown> }>,
}));

const emailState = vi.hoisted(() => ({
  teamContentRequests: [] as unknown[],
  teamChangesRequested: [] as unknown[],
  clientBriefReady: [] as unknown[],
  clientPostReady: [] as unknown[],
  clientContentPublished: [] as unknown[],
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: Record<string, unknown>) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/email.js', () => ({
  notifyApprovalReady: vi.fn(),
  notifyClientAuditComplete: vi.fn(),
  notifyClientBriefingReady: vi.fn(),
  notifyClientBriefReady: vi.fn((payload: unknown) => emailState.clientBriefReady.push(payload)),
  notifyClientContentPublished: vi.fn((payload: unknown) => emailState.clientContentPublished.push(payload)),
  notifyClientFixesApplied: vi.fn(),
  notifyClientPostReady: vi.fn((payload: unknown) => emailState.clientPostReady.push(payload)),
  notifyClientRecommendationsReady: vi.fn(),
  notifyClientStatusChange: vi.fn(),
  notifyClientTeamResponse: vi.fn(),
  notifyClientWelcome: vi.fn(),
  notifyTeamActionApproved: vi.fn(),
  notifyTeamChangesRequested: vi.fn((payload: unknown) => emailState.teamChangesRequested.push(payload)),
  notifyTeamChurnSignal: vi.fn(),
  notifyTeamClientSignal: vi.fn(),
  notifyTeamContentRequest: vi.fn((payload: unknown) => emailState.teamContentRequests.push(payload)),
  notifyTeamNewRequest: vi.fn(),
  notifyTeamPaymentReceived: vi.fn(),
  isEmailConfigured: vi.fn(() => false),
  sendEmail: vi.fn(),
}));

import {
  createContentRequest,
  getContentRequest,
  listContentRequests,
  updateContentRequest,
} from '../../server/content-requests.js';
import { savePost } from '../../server/content-posts-db.js';
import db from '../../server/db/index.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { createWorkspace, deleteWorkspace, getPageState } from '../../server/workspaces.js';
import type { GeneratedPost } from '../../shared/types/content.js';

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

async function patchJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function deleteJson(path: string): Promise<Response> {
  return api(path, { method: 'DELETE' });
}

function unique(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function createRequest(
  workspaceId: string,
  status: 'requested' | 'client_review' | 'approved' | 'published' = 'requested',
  options: { serviceType?: 'brief_only' | 'full_post'; targetPageId?: string } = {},
) {
  const request = createContentRequest(workspaceId, {
    topic: `Mutation Safety ${unique(status)}`,
    targetKeyword: unique(`keyword-${status}`),
    intent: 'informational',
    priority: 'medium',
    rationale: 'Mutation safety regression guard',
    serviceType: options.serviceType ?? 'brief_only',
    targetPageId: options.targetPageId,
    targetPageSlug: options.targetPageId ? '/mutation-safety-page' : undefined,
    initialStatus: status === 'requested' ? 'requested' : 'brief_generated',
    dedupe: false,
  });
  if (status === 'requested') return request;
  const review = updateContentRequest(workspaceId, request.id, {
    status: status === 'published' ? 'published' : 'client_review',
    briefId: `brief_mutation_${unique('brief')}`,
  })!;
  if (status === 'client_review' || status === 'published') return review;
  return updateContentRequest(workspaceId, request.id, { status: 'approved' })!;
}

function makeStubPost(workspaceId: string, briefId: string): GeneratedPost {
  const now = new Date().toISOString();
  return {
    id: `post_mutation_${unique('post')}`,
    workspaceId,
    briefId,
    targetKeyword: 'mutation safety post keyword',
    title: 'Mutation Safety Post',
    metaDescription: 'Mutation safety post meta description',
    introduction: '<p>Mutation safety introduction.</p>',
    sections: [
      {
        index: 0,
        heading: 'Safety Section',
        content: '<p>Safety section content.</p>',
        wordCount: 4,
        targetWordCount: 200,
        keywords: [],
        status: 'done',
      },
    ],
    conclusion: '<p>Mutation safety conclusion.</p>',
    totalWordCount: 30,
    targetWordCount: 1200,
    status: 'review',
    createdAt: now,
    updatedAt: now,
  };
}

function createPostReviewRequest(workspaceId: string) {
  const request = createRequest(workspaceId, 'requested', { serviceType: 'full_post' });
  const briefId = `brief_post_review_${unique('brief')}`;
  updateContentRequest(workspaceId, request.id, { briefId });
  const post = makeStubPost(workspaceId, briefId);
  savePost(workspaceId, post);
  updateContentRequest(workspaceId, request.id, { status: 'in_progress' });
  updateContentRequest(workspaceId, request.id, { status: 'post_review', postId: post.id });
  return { requestId: request.id, postId: post.id };
}

function contentRequestBroadcasts() {
  return broadcastState.calls.filter(call =>
    call.event === WS_EVENTS.CONTENT_REQUEST_CREATED || call.event === WS_EVENTS.CONTENT_REQUEST_UPDATE,
  );
}

function countActivities(workspaceId: string, type: string, requestId?: string): number {
  const metadataClause = requestId ? 'AND metadata LIKE ?' : '';
  const params = requestId ? [workspaceId, type, `%"requestId":"${requestId}"%`] : [workspaceId, type];
  const row = db.prepare(`
    SELECT COALESCE(COUNT(*), 0) AS count
    FROM activity_log
    WHERE workspace_id = ?
      AND type = ?
      ${metadataClause}
  `).get(...params) as { count: number };
  return row.count;
}

async function publicRequest(workspaceId: string, requestId: string) {
  const res = await api(`/api/public/content-requests/${workspaceId}`);
  expect(res.status).toBe(200);
  const requests = await res.json() as Array<{ id: string; status: string; postId?: string; deliveryUrl?: string }>;
  return requests.find(request => request.id === requestId);
}

async function adminRequest(workspaceId: string, requestId: string) {
  const res = await api(`/api/content-requests/${workspaceId}/${requestId}`);
  expect(res.status).toBe(200);
  return await res.json() as { id: string; status: string; postId?: string; deliveryUrl?: string };
}

async function publicActivity(workspaceId: string) {
  const res = await api(`/api/public/activity/${workspaceId}?limit=10`);
  expect(res.status).toBe(200);
  return await res.json() as Array<{ type: string; title: string; metadata?: unknown }>;
}

beforeAll(async () => {
  await startTestServer();
  wsAId = createWorkspace('Content Request Mutation Safety A').id;
  wsBId = createWorkspace('Content Request Mutation Safety B').id;
}, 25_000);

beforeEach(() => {
  broadcastState.calls = [];
  emailState.teamContentRequests = [];
  emailState.teamChangesRequested = [];
  emailState.clientBriefReady = [];
  emailState.clientPostReady = [];
  emailState.clientContentPublished = [];
  db.prepare('DELETE FROM activity_log WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  db.prepare('DELETE FROM page_edit_states WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  db.prepare('DELETE FROM content_post_versions WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  db.prepare('DELETE FROM content_posts WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  db.prepare('DELETE FROM content_topic_requests WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
});

afterAll(async () => {
  db.prepare('DELETE FROM activity_log WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  db.prepare('DELETE FROM page_edit_states WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  db.prepare('DELETE FROM content_post_versions WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  db.prepare('DELETE FROM content_posts WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  db.prepare('DELETE FROM content_topic_requests WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  deleteWorkspace(wsAId);
  deleteWorkspace(wsBId);
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
});

describe('content request mutation safety', () => {
  it('creates public recommended content requests with DB, activity, broadcast, and read-path coverage', async () => {
    const topic = `Recommended Topic ${unique('topic')}`;
    const res = await postJson(`/api/public/content-request/${wsAId}`, {
      topic,
      targetKeyword: 'recommended mutation keyword',
      intent: 'commercial',
      priority: 'high',
      rationale: 'Client selected a recommended topic.',
      serviceType: 'brief_only',
      pageType: 'blog',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; status: string };
    expect(body.status).toBe('requested');
    expect(getContentRequest(wsAId, body.id)).toMatchObject({ topic, status: 'requested' });
    expect(countActivities(wsAId, 'content_requested', body.id)).toBe(1);
    expect(contentRequestBroadcasts()).toEqual([
      {
        workspaceId: wsAId,
        event: WS_EVENTS.CONTENT_REQUEST_CREATED,
        payload: { id: body.id, topic },
      },
    ]);

    expect((await adminRequest(wsAId, body.id)).id).toBe(body.id);
    expect(await publicRequest(wsAId, body.id)).toMatchObject({ id: body.id, status: 'requested' });
    expect(emailState.teamContentRequests).toHaveLength(1);
  });

  it('submits client-authored content requests with DB, activity, broadcast, and read-path coverage', async () => {
    const topic = `Submitted Topic ${unique('topic')}`;
    const res = await postJson(`/api/public/content-request/${wsAId}/submit`, {
      topic,
      targetKeyword: 'submitted mutation keyword',
      notes: 'Please prioritize this next.',
      serviceType: 'full_post',
      pageType: 'resource',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; status: string; source: string; serviceType: string };
    expect(body).toMatchObject({ status: 'requested', source: 'client', serviceType: 'full_post' });
    expect(getContentRequest(wsAId, body.id)).toMatchObject({
      topic,
      clientNote: 'Please prioritize this next.',
      serviceType: 'full_post',
    });
    expect(countActivities(wsAId, 'content_requested', body.id)).toBe(1);
    expect(contentRequestBroadcasts()).toEqual([
      {
        workspaceId: wsAId,
        event: WS_EVENTS.CONTENT_REQUEST_CREATED,
        payload: { id: body.id, topic },
      },
    ]);
    expect(await publicRequest(wsAId, body.id)).toMatchObject({ id: body.id, status: 'requested' });
  });

  it('admin patch sends a full post for review, then delivery updates page state and read paths', async () => {
    const pageId = 'page_content_request_mutation_safety';
    const request = createRequest(wsAId, 'requested', { serviceType: 'full_post', targetPageId: pageId });
    const briefId = `brief_admin_patch_${unique('brief')}`;
    updateContentRequest(wsAId, request.id, { briefId });
    const post = makeStubPost(wsAId, briefId);
    savePost(wsAId, post);

    const progressRes = await patchJson(`/api/content-requests/${wsAId}/${request.id}`, { status: 'in_progress' });
    expect(progressRes.status).toBe(200);
    broadcastState.calls = [];

    const reviewRes = await patchJson(`/api/content-requests/${wsAId}/${request.id}`, { status: 'post_review' });
    expect(reviewRes.status).toBe(200);
    expect(getContentRequest(wsAId, request.id)).toMatchObject({ status: 'post_review', postId: post.id });
    expect(countActivities(wsAId, 'post_sent_for_review', request.id)).toBe(1);
    expect(contentRequestBroadcasts()).toEqual([
      {
        workspaceId: wsAId,
        event: WS_EVENTS.CONTENT_REQUEST_UPDATE,
        payload: { id: request.id, status: 'post_review' },
      },
    ]);
    expect(await publicRequest(wsAId, request.id)).toMatchObject({ id: request.id, status: 'post_review', postId: post.id });

    broadcastState.calls = [];
    const deliveryRes = await patchJson(`/api/content-requests/${wsAId}/${request.id}`, {
      status: 'delivered',
      deliveryUrl: 'https://example.com/delivery/content-request-mutation',
      deliveryNotes: 'Delivered for review.',
    });
    expect(deliveryRes.status).toBe(200);
    expect(getPageState(wsAId, pageId)).toMatchObject({
      status: 'live',
      source: 'content-delivery',
      contentRequestId: request.id,
    });
    expect(contentRequestBroadcasts()).toEqual([
      {
        workspaceId: wsAId,
        event: WS_EVENTS.CONTENT_REQUEST_UPDATE,
        payload: { id: request.id, status: 'delivered' },
      },
    ]);
    expect(await adminRequest(wsAId, request.id)).toMatchObject({ status: 'delivered' });
    expect(await publicRequest(wsAId, request.id)).toMatchObject({
      status: 'delivered',
      deliveryUrl: 'https://example.com/delivery/content-request-mutation',
    });
  });

  it('admin delete removes the request with context activity, broadcast, and read-path cleanup', async () => {
    const request = createRequest(wsAId);

    const res = await deleteJson(`/api/content-requests/${wsAId}/${request.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(getContentRequest(wsAId, request.id)).toBeUndefined();
    expect(countActivities(wsAId, 'content_request_deleted', request.id)).toBe(1);
    expect(contentRequestBroadcasts()).toEqual([
      {
        workspaceId: wsAId,
        event: WS_EVENTS.CONTENT_REQUEST_UPDATE,
        payload: { id: request.id, deleted: true },
      },
    ]);
    expect(listContentRequests(wsAId).some(stored => stored.id === request.id)).toBe(false);
    expect(await publicRequest(wsAId, request.id)).toBeUndefined();
    expect((await publicActivity(wsAId)).some(entry => entry.type === 'content_request_deleted')).toBe(false);
  });

  it('client brief actions mutate once with activity, broadcasts, and read-path coverage', async () => {
    const approveReq = createRequest(wsAId, 'client_review');
    let res = await postJson(`/api/public/content-request/${wsAId}/${approveReq.id}/approve`, {});
    expect(res.status).toBe(200);
    expect(getContentRequest(wsAId, approveReq.id)?.status).toBe('approved');
    expect(countActivities(wsAId, 'brief_approved', approveReq.id)).toBe(1);
    expect(contentRequestBroadcasts()).toEqual([
      {
        workspaceId: wsAId,
        event: WS_EVENTS.CONTENT_REQUEST_UPDATE,
        payload: { id: approveReq.id, status: 'approved' },
      },
    ]);
    expect(await publicRequest(wsAId, approveReq.id)).toMatchObject({ status: 'approved' });

    broadcastState.calls = [];
    const changesReq = createRequest(wsAId, 'client_review');
    res = await postJson(`/api/public/content-request/${wsAId}/${changesReq.id}/request-changes`, {
      feedback: 'Please make the examples more concrete.',
    });
    expect(res.status).toBe(200);
    expect(getContentRequest(wsAId, changesReq.id)).toMatchObject({
      status: 'changes_requested',
      clientFeedback: 'Please make the examples more concrete.',
    });
    expect(countActivities(wsAId, 'changes_requested', changesReq.id)).toBe(1);
    expect(contentRequestBroadcasts()).toEqual([
      {
        workspaceId: wsAId,
        event: WS_EVENTS.CONTENT_REQUEST_UPDATE,
        payload: { id: changesReq.id, status: 'changes_requested' },
      },
    ]);
    expect(emailState.teamChangesRequested).toHaveLength(1);

    broadcastState.calls = [];
    const declineReq = createRequest(wsAId);
    res = await postJson(`/api/public/content-request/${wsAId}/${declineReq.id}/decline`, {
      reason: 'Not relevant this quarter.',
    });
    expect(res.status).toBe(200);
    expect(getContentRequest(wsAId, declineReq.id)).toMatchObject({
      status: 'declined',
      declineReason: 'Not relevant this quarter.',
    });
    expect(countActivities(wsAId, 'content_declined', declineReq.id)).toBe(1);
    expect(contentRequestBroadcasts()).toEqual([
      {
        workspaceId: wsAId,
        event: WS_EVENTS.CONTENT_REQUEST_UPDATE,
        payload: { id: declineReq.id, status: 'declined' },
      },
    ]);

    broadcastState.calls = [];
    const upgradeReq = createRequest(wsAId, 'approved');
    res = await postJson(`/api/public/content-request/${wsAId}/${upgradeReq.id}/upgrade`, {});
    expect(res.status).toBe(200);
    expect(getContentRequest(wsAId, upgradeReq.id)).toMatchObject({ serviceType: 'full_post', status: 'in_progress' });
    expect(getContentRequest(wsAId, upgradeReq.id)?.upgradedAt).toBeDefined();
    expect(countActivities(wsAId, 'content_upgraded', upgradeReq.id)).toBe(1);
    expect(contentRequestBroadcasts()).toEqual([
      {
        workspaceId: wsAId,
        event: WS_EVENTS.CONTENT_REQUEST_UPDATE,
        payload: { id: upgradeReq.id, status: 'in_progress' },
      },
    ]);

    broadcastState.calls = [];
    const commentReq = createRequest(wsAId, 'client_review');
    res = await postJson(`/api/public/content-request/${wsAId}/${commentReq.id}/comment`, {
      content: 'Looks solid. Please include the pricing angle.',
    });
    expect(res.status).toBe(200);
    expect(getContentRequest(wsAId, commentReq.id)?.comments).toHaveLength(1);
    expect(getContentRequest(wsAId, commentReq.id)?.comments?.[0]).toMatchObject({
      author: 'client',
      content: 'Looks solid. Please include the pricing angle.',
    });
    expect(countActivities(wsAId, 'content_request_commented', commentReq.id)).toBe(1);
    expect(contentRequestBroadcasts()).toEqual([
      {
        workspaceId: wsAId,
        event: WS_EVENTS.CONTENT_REQUEST_UPDATE,
        payload: { id: commentReq.id, status: 'client_review' },
      },
    ]);
  });

  it('client post review actions mutate once with activity, broadcasts, and read-path coverage', async () => {
    const approve = createPostReviewRequest(wsAId);

    let res = await postJson(`/api/public/content-request/${wsAId}/${approve.requestId}/approve-post`, {});
    expect(res.status).toBe(200);
    expect(getContentRequest(wsAId, approve.requestId)?.status).toBe('delivered');
    expect(countActivities(wsAId, 'post_approved', approve.requestId)).toBe(1);
    expect(contentRequestBroadcasts()).toEqual([
      {
        workspaceId: wsAId,
        event: WS_EVENTS.CONTENT_REQUEST_UPDATE,
        payload: { id: approve.requestId, status: 'delivered' },
      },
    ]);
    expect(await publicRequest(wsAId, approve.requestId)).toMatchObject({ status: 'delivered', postId: approve.postId });

    broadcastState.calls = [];
    const changes = createPostReviewRequest(wsAId);
    res = await postJson(`/api/public/content-request/${wsAId}/${changes.requestId}/request-post-changes`, {
      feedback: 'Please expand the implementation section.',
    });
    expect(res.status).toBe(200);
    expect(getContentRequest(wsAId, changes.requestId)).toMatchObject({
      status: 'changes_requested',
      clientFeedback: 'Please expand the implementation section.',
    });
    expect(countActivities(wsAId, 'post_changes_requested', changes.requestId)).toBe(1);
    expect(contentRequestBroadcasts()).toEqual([
      {
        workspaceId: wsAId,
        event: WS_EVENTS.CONTENT_REQUEST_UPDATE,
        payload: { id: changes.requestId, status: 'changes_requested' },
      },
    ]);
    expect(await adminRequest(wsAId, changes.requestId)).toMatchObject({ status: 'changes_requested' });
  });

  it('rejects malformed and missing public mutations without DB, activity, or broadcast side effects', async () => {
    let res = await postJson(`/api/public/content-request/${wsAId}`, {
      topic: 'Malformed missing keyword',
    });
    expect(res.status).toBe(400);
    expect(listContentRequests(wsAId)).toHaveLength(0);
    expect(countActivities(wsAId, 'content_requested')).toBe(0);
    expect(contentRequestBroadcasts()).toHaveLength(0);

    const commentReq = createRequest(wsAId, 'client_review');
    res = await postJson(`/api/public/content-request/${wsAId}/${commentReq.id}/comment`, {
      author: 'team',
      content: 'Try to smuggle a team-authored comment.',
    });
    expect(res.status).toBe(400);
    expect(getContentRequest(wsAId, commentReq.id)?.comments).toEqual([]);
    expect(countActivities(wsAId, 'content_request_commented', commentReq.id)).toBe(0);
    expect(contentRequestBroadcasts()).toHaveLength(0);

    res = await postJson(`/api/public/content-request/${wsAId}/missing_request/approve`, {});
    expect(res.status).toBe(404);
    expect(countActivities(wsAId, 'brief_approved')).toBe(0);
    expect(contentRequestBroadcasts()).toHaveLength(0);
  });

  it('rejects invalid transitions without mutating, broadcasting, logging, or page-state writes', async () => {
    const request = createRequest(wsAId, 'published', { targetPageId: 'page_invalid_transition' });

    const res = await patchJson(`/api/content-requests/${wsAId}/${request.id}`, {
      status: 'in_progress',
    });
    expect(res.status).toBe(400);

    expect(getContentRequest(wsAId, request.id)?.status).toBe('published');
    expect(countActivities(wsAId, 'post_sent_for_review', request.id)).toBe(0);
    expect(countActivities(wsAId, 'content_upgraded', request.id)).toBe(0);
    expect(contentRequestBroadcasts()).toHaveLength(0);
    expect(getPageState(wsAId, 'page_invalid_transition')).toBeUndefined();
  });

  it('rejects cross-workspace admin and client mutations without mutating, broadcasting, or logging', async () => {
    const request = createRequest(wsAId, 'client_review');

    let res = await postJson(`/api/public/content-request/${wsBId}/${request.id}/approve`, {});
    expect(res.status).toBe(404);
    expect(getContentRequest(wsAId, request.id)?.status).toBe('client_review');
    expect(countActivities(wsAId, 'brief_approved', request.id)).toBe(0);
    expect(countActivities(wsBId, 'brief_approved')).toBe(0);
    expect(contentRequestBroadcasts()).toHaveLength(0);

    res = await deleteJson(`/api/content-requests/${wsBId}/${request.id}`);
    expect(res.status).toBe(404);
    expect(getContentRequest(wsAId, request.id)).toBeDefined();
    expect(countActivities(wsAId, 'content_request_deleted', request.id)).toBe(0);
    expect(countActivities(wsBId, 'content_request_deleted')).toBe(0);
    expect(contentRequestBroadcasts()).toHaveLength(0);
  });
});
