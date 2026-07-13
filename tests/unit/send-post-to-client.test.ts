/**
 * Unit tests for the shared `sendPostToClientForReview` service (POST-C1).
 *
 * Verifies the contract:
 *  - find-or-create a content_request and transition it to `post_review`
 *  - set postId/briefId
 *  - email the client (notifyClientPostReady) when a clientEmail is configured
 *  - broadcast CONTENT_REQUEST_CREATED (created) / CONTENT_REQUEST_UPDATE (reused)
 *  - log a `post_sent_for_review` activity
 *  - throw PostNotFoundError for a missing post
 *  - the sent post then projects into listClientFacingDeliverables as `awaiting_client`
 *    (i.e. it reaches the unified inbox)
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
  notifyClientPostReady: vi.fn((opts: Record<string, unknown>) => {
    emailState.clientPostReady.push(opts);
  }),
  isEmailConfigured: vi.fn(() => true),
}));

// ── Server imports (after mocks) ────────────────────────────────────────────
import db from '../../server/db/index.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { savePost } from '../../server/content-posts-db.js';
import {
  createContentRequest,
  getContentRequest,
  listContentRequests,
} from '../../server/content-requests.js';
import { listClientFacingDeliverables } from '../../server/domains/inbox/unified-inbox-read.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import {
  sendPostToClientForReview,
  PostNotFoundError,
} from '../../server/domains/content/send-post-to-client.js';
import { IncompleteContentPostError } from '../../server/domains/content/generation-integrity.js';
import type { GeneratedPost } from '../../shared/types/content.js';

let wsId = '';

function unique(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function seedPost(workspaceId: string, overrides: Partial<GeneratedPost> = {}): GeneratedPost {
  const now = new Date().toISOString();
  const post: GeneratedPost = {
    id: unique('post'),
    workspaceId,
    briefId: unique('brief'),
    targetKeyword: 'send to client keyword',
    title: 'Send To Client Post',
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

function activityCount(workspaceId: string, type: string, requestId?: string): number {
  const clause = requestId ? 'AND metadata LIKE ?' : '';
  const params = requestId ? [workspaceId, type, `%"requestId":"${requestId}"%`] : [workspaceId, type];
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM activity_log WHERE workspace_id = ? AND type = ? ${clause}`)
    .get(...params) as { count: number };
  return row.count;
}

beforeEach(() => {
  // Fresh workspace per test so find-or-create has a clean slate.
  if (wsId) {
    db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(wsId);
    db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(wsId);
    deleteWorkspace(wsId);
  }
  wsId = createWorkspace(`Send Post To Client ${unique('ws')}`).id;
  updateWorkspace(wsId, { clientEmail: 'client@example.com' });
  broadcastState.calls = [];
  emailState.clientPostReady = [];
});

afterAll(() => {
  if (wsId) {
    db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(wsId);
    db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(wsId);
    deleteWorkspace(wsId);
  }
});

describe('sendPostToClientForReview', () => {
  it('creates a content_request in post_review with postId/briefId set', () => {
    const post = seedPost(wsId);

    const { request, created } = sendPostToClientForReview(wsId, post.id);

    expect(created).toBe(true);
    expect(request.status).toBe('post_review');
    expect(request.postId).toBe(post.id);
    expect(request.briefId).toBe(post.briefId);
    // Persisted, not just returned
    expect(getContentRequest(wsId, request.id)?.status).toBe('post_review');
  });

  it('emails the client via notifyClientPostReady', () => {
    const post = seedPost(wsId);

    sendPostToClientForReview(wsId, post.id);

    expect(emailState.clientPostReady).toHaveLength(1);
    expect(emailState.clientPostReady[0]).toMatchObject({
      clientEmail: 'client@example.com',
      workspaceId: wsId,
      topic: post.title,
      targetKeyword: post.targetKeyword,
    });
  });

  it('does not email when no clientEmail is configured', () => {
    updateWorkspace(wsId, { clientEmail: '' });
    const post = seedPost(wsId);

    sendPostToClientForReview(wsId, post.id);

    expect(emailState.clientPostReady).toHaveLength(0);
  });

  it('broadcasts CONTENT_REQUEST_CREATED when a request is created', () => {
    const post = seedPost(wsId);

    const { request } = sendPostToClientForReview(wsId, post.id);

    const created = broadcastState.calls.filter((c) => c.event === WS_EVENTS.CONTENT_REQUEST_CREATED);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ workspaceId: wsId, payload: { id: request.id, status: 'post_review' } });
  });

  it('reuses an existing request linked to the post and broadcasts CONTENT_REQUEST_UPDATE', () => {
    const post = seedPost(wsId);
    // Pre-existing request that owns the post's brief.
    const existing = createContentRequest(wsId, {
      topic: 'Existing request',
      targetKeyword: 'existing keyword',
      intent: 'informational',
      priority: 'medium',
      rationale: 'existing',
      serviceType: 'full_post',
      initialStatus: 'in_progress',
      dedupe: false,
    });
    // Link the brief so findRequestForPost matches by briefId.
    db.prepare('UPDATE content_topic_requests SET brief_id = ? WHERE id = ?').run(post.briefId, existing.id);
    broadcastState.calls = [];

    const { request, created } = sendPostToClientForReview(wsId, post.id);

    expect(created).toBe(false);
    expect(request.id).toBe(existing.id);
    expect(request.status).toBe('post_review');
    const updates = broadcastState.calls.filter((c) => c.event === WS_EVENTS.CONTENT_REQUEST_UPDATE);
    expect(updates).toHaveLength(1);
    // No duplicate request created
    expect(listContentRequests(wsId).filter((r) => r.postId === post.id)).toHaveLength(1);
  });

  it('reuses an explicit requestId (MCP parentRequestId path)', () => {
    const post = seedPost(wsId);
    const parent = createContentRequest(wsId, {
      topic: 'Parent request',
      targetKeyword: 'parent keyword',
      intent: 'informational',
      priority: 'medium',
      rationale: 'parent',
      serviceType: 'full_post',
      initialStatus: 'in_progress',
      dedupe: false,
    });

    const { request, created } = sendPostToClientForReview(wsId, post.id, { requestId: parent.id });

    expect(created).toBe(false);
    expect(request.id).toBe(parent.id);
    expect(request.status).toBe('post_review');
    expect(request.postId).toBe(post.id);
  });

  it('logs a post_sent_for_review activity with the requestId', () => {
    const post = seedPost(wsId);

    const { request } = sendPostToClientForReview(wsId, post.id);

    expect(activityCount(wsId, 'post_sent_for_review', request.id)).toBe(1);
  });

  it('records the activity source when provided (MCP)', () => {
    const post = seedPost(wsId);

    const { request } = sendPostToClientForReview(wsId, post.id, { activitySource: 'mcp-chat' });

    const row = db
      .prepare('SELECT metadata FROM activity_log WHERE workspace_id = ? AND type = ? AND metadata LIKE ?')
      .get(wsId, 'post_sent_for_review', `%"requestId":"${request.id}"%`) as { metadata: string } | undefined;
    expect(row?.metadata).toContain('"source":"mcp-chat"');
  });

  it('throws PostNotFoundError for a missing post', () => {
    expect(() => sendPostToClientForReview(wsId, 'post_does_not_exist')).toThrow(PostNotFoundError);
  });

  it('rejects an incomplete post before creating client-facing side effects', () => {
    const post = seedPost(wsId, {
      status: 'needs_attention',
      conclusion: '',
      generationDiagnostics: [{
        stage: 'conclusion',
        code: 'provider_error',
        message: 'Provider unavailable',
        occurredAt: new Date().toISOString(),
      }],
    });

    expect(() => sendPostToClientForReview(wsId, post.id)).toThrow(IncompleteContentPostError);
    expect(listContentRequests(wsId)).toHaveLength(0);
    expect(emailState.clientPostReady).toHaveLength(0);
    expect(broadcastState.calls).toHaveLength(0);
    expect(activityCount(wsId, 'post_sent_for_review')).toBe(0);
  });

  it('makes the sent post reach the unified inbox as awaiting_client', () => {
    const post = seedPost(wsId);

    const { request } = sendPostToClientForReview(wsId, post.id);

    const deliverables = listClientFacingDeliverables(wsId);
    const projected = deliverables.find((d) => d.externalRef === request.id);
    expect(projected).toBeDefined();
    expect(projected?.status).toBe('awaiting_client');
    expect(projected?.type).toBe('content_request');
    expect((projected?.payload as { postId?: string }).postId).toBe(post.id);
  });
});
