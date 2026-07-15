/**
 * Integration tests for POST /api/content-requests/:workspaceId/posts/:postId/send-to-client
 *
 * The SEPARATE "Send to client" action (POST-C1) — distinct from ContentManager's internal "Review"
 * button. Covers:
 *  - happy path: 200, returns a content_request in post_review with postId/briefId set
 *  - optional note is stored on the client-facing request field (`clientNote`)
 *  - client email + broadcast + activity side-effects
 *  - 404 for a missing post
 *  - workspace isolation
 *  - the sent post reaches the unified inbox (listClientFacingDeliverables → awaiting_client)
 *
 * Uses an ephemeral listen(0) port (matches the sibling content-request route tests) so it never
 * collides with the 13xxx createTestContext allocations.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// ── Mock broadcast & email before any server import ────────────────────────
const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: Record<string, unknown> }>,
}));
const emailState = vi.hoisted(() => ({
  clientPostReady: [] as Array<Record<string, unknown>>,
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
  notifyClientBriefingReady: vi.fn(),
  notifyClientBriefReady: vi.fn(),
  notifyClientContentPublished: vi.fn(),
  notifyClientPostReady: vi.fn((opts: Record<string, unknown>) => { emailState.clientPostReady.push(opts); }),
  isEmailConfigured: vi.fn(() => true),
  sendEmail: vi.fn(),
}));

// ── Server imports (after mocks) ────────────────────────────────────────────
import db from '../../server/db/index.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { getPost, savePost, updatePostField } from '../../server/content-posts-db.js';
import { listClientFacingDeliverables } from '../../server/domains/inbox/unified-inbox-read.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import type { GeneratedPost } from '../../shared/types/content.js';

let baseUrl = '';
let server: http.Server | undefined;
let wsAId = '';
let wsBId = '';
const originalAppPassword = process.env.APP_PASSWORD;
const originalAppUrl = process.env.APP_URL;

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => server!.close((err) => (err ? reject(err) : resolve())));
  server = undefined;
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

function unique(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function seedPost(workspaceId: string, overrides: Partial<GeneratedPost> = {}): GeneratedPost {
  const now = new Date().toISOString();
  const post: GeneratedPost = {
    id: unique('post'),
    workspaceId,
    briefId: unique('brief'),
    targetKeyword: 'route send keyword',
    title: 'Route Send Post',
    metaDescription: 'meta',
    introduction: '<p>intro</p>',
    sections: [
      { index: 0, heading: 'Section', content: '<p>body</p>', wordCount: 2, targetWordCount: 100, keywords: [], status: 'done' },
    ],
    conclusion: '<p>conclusion</p>',
    totalWordCount: 50,
    targetWordCount: 1000,
    status: 'review',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  savePost(workspaceId, post);
  return post;
}

function activityCount(workspaceId: string, type: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM activity_log WHERE workspace_id = ? AND type = ?')
    .get(workspaceId, type) as { count: number };
  return row.count;
}

function observedRevision(workspaceId: string, postId: string): number {
  return getPost(workspaceId, postId)!.generationRevision;
}

beforeAll(async () => {
  process.env.APP_URL = 'https://dashboard.example.test';
  await startTestServer();
  wsAId = createWorkspace('Send Post Route A').id;
  wsBId = createWorkspace('Send Post Route B').id;
  updateWorkspace(wsAId, { clientEmail: 'client-a@example.com' });
}, 25_000);

beforeEach(() => {
  broadcastState.calls = [];
  emailState.clientPostReady = [];
  db.prepare('DELETE FROM activity_log WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  db.prepare('DELETE FROM content_topic_requests WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  db.prepare('DELETE FROM content_posts WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
});

afterAll(async () => {
  db.prepare('DELETE FROM activity_log WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  db.prepare('DELETE FROM content_topic_requests WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  db.prepare('DELETE FROM content_posts WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  deleteWorkspace(wsAId);
  deleteWorkspace(wsBId);
  await stopTestServer();
  if (originalAppPassword === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = originalAppPassword;
  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
});

describe('POST /api/content-requests/:workspaceId/posts/:postId/send-to-client', () => {
  it('returns 200 with a content_request in post_review linked to the post', async () => {
    const post = seedPost(wsAId);

    const res = await postJson(`/api/content-requests/${wsAId}/posts/${post.id}/send-to-client`, {
      expectedRevision: observedRevision(wsAId, post.id),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; status: string; postId?: string; briefId?: string };
    expect(body.status).toBe('post_review');
    expect(body.postId).toBe(post.id);
    expect(body.briefId).toBe(post.briefId);
  });

  it('stores the optional note on the request', async () => {
    const post = seedPost(wsAId);

    const res = await postJson(`/api/content-requests/${wsAId}/posts/${post.id}/send-to-client`, {
      expectedRevision: observedRevision(wsAId, post.id),
      note: 'Take a look at the intro please.',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { clientNote?: string; internalNote?: string };
    expect(body.clientNote).toBe('Take a look at the intro please.');
    expect(body.internalNote).toBeUndefined();
  });

  it('emails the client, broadcasts, and logs an activity', async () => {
    const post = seedPost(wsAId);

    await postJson(`/api/content-requests/${wsAId}/posts/${post.id}/send-to-client`, {
      expectedRevision: observedRevision(wsAId, post.id),
    });

    expect(emailState.clientPostReady).toHaveLength(1);
    expect(emailState.clientPostReady[0]).toMatchObject({ clientEmail: 'client-a@example.com', topic: post.title });
    expect(emailState.clientPostReady[0].dashboardUrl).toBe(`https://dashboard.example.test/client/${wsAId}/inbox?tab=reviews`);
    expect(broadcastState.calls.some((c) => c.event === WS_EVENTS.CONTENT_REQUEST_CREATED)).toBe(true);
    expect(activityCount(wsAId, 'post_sent_for_review')).toBe(1);
  });

  it('returns 404 for a missing post', async () => {
    const res = await postJson(`/api/content-requests/${wsAId}/posts/post_missing/send-to-client`, {
      expectedRevision: 0,
    });

    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/not found/i);
  });

  it('cannot send a post from another workspace (404, no side-effects)', async () => {
    const post = seedPost(wsAId);

    // wsB does not own this post — the service looks it up under wsB and finds nothing.
    const res = await postJson(`/api/content-requests/${wsBId}/posts/${post.id}/send-to-client`, {
      expectedRevision: 0,
    });

    expect(res.status).toBe(404);
    expect(emailState.clientPostReady).toHaveLength(0);
    expect(broadcastState.calls.filter((c) => c.event === WS_EVENTS.CONTENT_REQUEST_CREATED)).toHaveLength(0);
  });

  it('makes the sent post reach the unified inbox as awaiting_client', async () => {
    const post = seedPost(wsAId);

    const res = await postJson(`/api/content-requests/${wsAId}/posts/${post.id}/send-to-client`, {
      expectedRevision: observedRevision(wsAId, post.id),
    });
    const body = await res.json() as { id: string };

    const deliverables = listClientFacingDeliverables(wsAId);
    const projected = deliverables.find((d) => d.externalRef === body.id);
    expect(projected).toBeDefined();
    expect(projected?.status).toBe('awaiting_client');
    expect(projected?.type).toBe('content_request');
  });

  it('rejects a stale send without creating a request or emitting side effects', async () => {
    const post = seedPost(wsAId);
    const staleRevision = observedRevision(wsAId, post.id);
    updatePostField(wsAId, post.id, { title: 'Newer operator title' }, staleRevision);

    const res = await postJson(`/api/content-requests/${wsAId}/posts/${post.id}/send-to-client`, {
      expectedRevision: staleRevision,
    });

    expect(res.status).toBe(409);
    expect(db.prepare(
      'SELECT COUNT(*) AS count FROM content_topic_requests WHERE workspace_id = ?',
    ).get(wsAId)).toEqual({ count: 0 });
    expect(emailState.clientPostReady).toHaveLength(0);
    expect(broadcastState.calls).toHaveLength(0);
    expect(activityCount(wsAId, 'post_sent_for_review')).toBe(0);
    expect(getPost(wsAId, post.id)?.title).toBe('Newer operator title');
  });
});
