/**
 * Integration tests for content post lifecycle:
 * creation, listing, retrieval, deletion, and status transitions.
 *
 * Complements content-posts-workflow.test.ts (PATCH transitions + Webflow publish)
 * and content-posts-ai-fix.test.ts (AI fix/review endpoints).
 *
 * Architecture: in-process server with dynamic port (listen(0)) so vi.mock works.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// ── Module-level mocks (hoisted by Vitest) ────────────────────────────────────

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: unknown }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: unknown) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/email.js', () => ({
  isEmailConfigured: vi.fn(() => false),
  sendEmail: vi.fn(),
  notifyApprovalReady: vi.fn(),
  notifyTeamActionApproved: vi.fn(),
  notifyTeamChangesRequested: vi.fn(),
  notifyTeamNewRequest: vi.fn(),
  notifyClientBriefReady: vi.fn(),
  notifyClientContentPublished: vi.fn(),
  notifyClientPostReady: vi.fn(),
  notifyClientFixesApplied: vi.fn(),
  notifyClientStatusChange: vi.fn(),
  notifyTeamContentRequest: vi.fn(),
}));

// ── Imports (after mock declarations) ─────────────────────────────────────────

import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { savePost, getPost, listPosts } from '../../server/content-posts-db.js';
import db from '../../server/db/index.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import type {
  ContentCalendarDateSuggestionsResponse,
  GeneratedPost,
  PostSection,
} from '../../shared/types/content.js';
import {
  getUnresolvedContentPublishReconciliationForPost,
  recordContentPublishReconciliation,
  resolveContentPublishReconciliation,
} from '../../server/content-publish-reconciliation.js';

// ── Test server helpers ────────────────────────────────────────────────────────

let baseUrl = '';
let server: http.Server | undefined;
let wsId = '';
let otherWsId = '';

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close(err => (err ? reject(err) : resolve()));
  });
  server = undefined;
}

async function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, opts);
}

async function getJson(path: string): Promise<Response> {
  return api(path);
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function patchJson(path: string, body: unknown): Promise<Response> {
  const match = path.match(/^\/api\/content-posts\/([^/]+)\/([^/]+)/);
  const requestBody = match && body && typeof body === 'object' && !('expectedRevision' in body)
    ? {
        ...body,
        expectedRevision: getPost(match[1], match[2])?.generationRevision ?? 0,
      }
    : body;
  return api(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
}

async function del(path: string): Promise<Response> {
  const match = path.match(/^\/api\/content-posts\/([^/]+)\/([^/]+)$/);
  return api(path, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      expectedRevision: match ? getPost(match[1], match[2])?.generationRevision ?? 0 : 0,
    }),
  });
}

// ── Test data helpers ──────────────────────────────────────────────────────────

function makeSection(index: number, overrides: Partial<PostSection> = {}): PostSection {
  return {
    index,
    heading: `Section ${index + 1}`,
    content: `<p>Content for section ${index + 1}.</p>`,
    wordCount: 5,
    targetWordCount: 200,
    keywords: ['test-keyword'],
    status: 'done',
    ...overrides,
  };
}

let postCounter = 0;

function makePost(workspaceId: string, overrides: Partial<GeneratedPost> = {}): GeneratedPost {
  const now = new Date().toISOString();
  const uniqueSuffix = `${Date.now()}_${++postCounter}`;
  return {
    id: `post_lifecycle_${uniqueSuffix}`,
    workspaceId,
    briefId: 'brief_lifecycle_test',
    targetKeyword: 'lifecycle test keyword',
    title: 'Lifecycle Test Post',
    metaDescription: 'A lifecycle test post meta description.',
    introduction: '<p>Lifecycle intro.</p>',
    sections: [makeSection(0), makeSection(1)],
    conclusion: '<p>Lifecycle conclusion.</p>',
    seoTitle: 'Lifecycle Test Post SEO Title',
    seoMetaDescription: 'Lifecycle test SEO meta description.',
    totalWordCount: 15,
    targetWordCount: 900,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function seedPost(workspaceId: string, overrides: Partial<GeneratedPost> = {}): GeneratedPost {
  const post = makePost(workspaceId, overrides);
  savePost(workspaceId, post);
  return post;
}

describe('incomplete post delivery boundaries', () => {
  it.each(['markdown', 'html', 'pdf'] as const)('rejects %s export for a needs_attention post', async (format) => {
    const post = seedPost(wsId, {
      status: 'needs_attention',
      conclusion: '',
      sections: [makeSection(0, { status: 'error', content: '', error: 'Provider unavailable' })],
    });

    const res = await getJson(`/api/content-posts/${wsId}/${post.id}/export/${format}`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Post is incomplete and cannot be exported',
    });
  });

  it.each([
    ['introduction', { introduction: '<p></p>' }],
    ['section', { sections: [makeSection(0, { content: '<div><span></span></div>', wordCount: 0 })] }],
    ['conclusion', { conclusion: '<p>&nbsp;</p>' }],
  ] as const)('rejects a draft whose %s contains markup but no visible text', async (_stage, overrides) => {
    const post = seedPost(wsId, { status: 'draft', ...overrides });

    const res = await getJson(`/api/content-posts/${wsId}/${post.id}/export/html`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Post is incomplete and cannot be exported' });
  });
});

// ── Lifecycle setup / teardown ─────────────────────────────────────────────────

beforeAll(async () => {
  await startTestServer();
  const ws = createWorkspace('Lifecycle Test Workspace');
  wsId = ws.id;
  const otherWs = createWorkspace('Lifecycle Other Workspace');
  otherWsId = otherWs.id;
});

beforeEach(() => {
  broadcastState.calls = [];
});

afterAll(async () => {
  db.prepare('DELETE FROM content_post_versions WHERE workspace_id IN (?, ?)').run(wsId, otherWsId);
  db.prepare('DELETE FROM content_posts WHERE workspace_id IN (?, ?)').run(wsId, otherWsId);
  deleteWorkspace(wsId);
  deleteWorkspace(otherWsId);
  await stopTestServer();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/content-posts/:workspaceId — list posts', () => {
  it('returns 200 with an empty array for a fresh workspace', async () => {
    const freshWs = createWorkspace('Lifecycle Fresh Workspace');
    try {
      const res = await getJson(`/api/content-posts/${freshWs.id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(0);
    } finally {
      deleteWorkspace(freshWs.id);
    }
  });

  it('returns a seeded post in the list', async () => {
    const post = seedPost(wsId);
    const res = await getJson(`/api/content-posts/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as GeneratedPost[];
    const found = body.find(p => p.id === post.id);
    expect(found).toBeDefined();
  });

  it('returns list items that include key fields', async () => {
    const post = seedPost(wsId);
    const res = await getJson(`/api/content-posts/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as GeneratedPost[];
    const found = body.find(p => p.id === post.id);
    expect(found).toBeDefined();
    expect(found).toHaveProperty('id');
    expect(found).toHaveProperty('title');
    expect(found).toHaveProperty('status');
    expect(found).toHaveProperty('createdAt');
  });
});

describe('GET /api/content-posts/:workspaceId/:postId — get one', () => {
  it('returns 200 with full post data for an existing post', async () => {
    const post = seedPost(wsId);
    const res = await getJson(`/api/content-posts/${wsId}/${post.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as GeneratedPost;
    expect(body.id).toBe(post.id);
    expect(body.title).toBe(post.title);
    expect(body.workspaceId).toBe(wsId);
    expect(body.status).toBe('draft');
    expect(Array.isArray(body.sections)).toBe(true);
    expect(body.sections).toHaveLength(2);
  });

  it('returns 404 for a nonexistent postId', async () => {
    const res = await getJson(`/api/content-posts/${wsId}/post_does_not_exist_xyz`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 404 when a postId from workspace A is accessed via workspace B path (workspace isolation)', async () => {
    const post = seedPost(wsId);
    const res = await getJson(`/api/content-posts/${otherWsId}/${post.id}`);
    expect(res.status).toBe(404);
    // Original post must still exist in owning workspace
    expect(getPost(wsId, post.id)).toBeDefined();
  });
});

describe('DELETE /api/content-posts/:workspaceId/:postId', () => {
  it('deletes a post and returns 200 with { ok: true }', async () => {
    const post = seedPost(wsId);
    const res = await del(`/api/content-posts/${wsId}/${post.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it('deleted post returns 404 on subsequent GET', async () => {
    const post = seedPost(wsId);
    await del(`/api/content-posts/${wsId}/${post.id}`);
    const res = await getJson(`/api/content-posts/${wsId}/${post.id}`);
    expect(res.status).toBe(404);
  });

  it('deleted post does not appear in the list', async () => {
    const post = seedPost(wsId);
    await del(`/api/content-posts/${wsId}/${post.id}`);
    const res = await getJson(`/api/content-posts/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as GeneratedPost[];
    expect(body.find(p => p.id === post.id)).toBeUndefined();
  });

  it('returns 404 for a nonexistent postId', async () => {
    const res = await del(`/api/content-posts/${wsId}/post_nonexistent_delete_xyz`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns an actionable 409 and preserves the post when external publish reconciliation is unresolved', async () => {
    const post = seedPost(wsId);
    const persisted = getPost(wsId, post.id)!;
    const reconciliation = recordContentPublishReconciliation({
      workspaceId: wsId,
      postId: post.id,
      collectionId: 'collection-route-delete-guard',
      itemId: 'item-route-delete-guard',
      externalState: 'published',
      sourceGenerationRevision: persisted.generationRevision,
    });

    const blocked = await del(`/api/content-posts/${wsId}/${post.id}`);

    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toEqual({
      error: 'This post cannot be deleted because its external publish state is unresolved. '
        + 'Retry the publish reconciliation or resolve the external item, then try deleting again.',
      code: 'CONTENT_PUBLISH_RECONCILIATION_REQUIRED',
    });
    expect(getPost(wsId, post.id)).toBeDefined();
    expect(getUnresolvedContentPublishReconciliationForPost(wsId, post.id))
      .toMatchObject({ id: reconciliation.id });

    expect(resolveContentPublishReconciliation({
      workspaceId: wsId,
      postId: post.id,
      collectionId: 'collection-route-delete-guard',
      itemId: 'item-route-delete-guard',
    })).toBe(true);
    const deleted = await del(`/api/content-posts/${wsId}/${post.id}`);
    expect(deleted.status).toBe(200);
    expect(getPost(wsId, post.id)).toBeUndefined();
  });
});

describe('Broadcasts on delete', () => {
  it('DELETE fires a POST_UPDATED broadcast with the correct workspaceId', async () => {
    const post = seedPost(wsId);
    await del(`/api/content-posts/${wsId}/${post.id}`);
    const broadcast = broadcastState.calls.find(c => c.event === WS_EVENTS.POST_UPDATED);
    expect(broadcast).toBeDefined();
    expect(broadcast?.workspaceId).toBe(wsId);
  });

  it('DELETE broadcast payload contains the post id and deleted flag', async () => {
    const post = seedPost(wsId);
    await del(`/api/content-posts/${wsId}/${post.id}`);
    const broadcast = broadcastState.calls.find(
      c => c.event === WS_EVENTS.POST_UPDATED,
    );
    expect(broadcast).toBeDefined();
    expect((broadcast?.payload as Record<string, unknown>).postId).toBe(post.id);
    expect((broadcast?.payload as Record<string, unknown>).deleted).toBe(true);
  });
});

describe('Broadcasts on PATCH (status update)', () => {
  it('PATCH status update fires a POST_UPDATED broadcast with the correct workspaceId', async () => {
    // draft → review is a valid forward transition (not covered by workflow tests)
    const post = seedPost(wsId, { status: 'draft' });
    const res = await patchJson(`/api/content-posts/${wsId}/${post.id}`, { status: 'review' });
    expect(res.status).toBe(200);
    const broadcast = broadcastState.calls.find(c => c.event === WS_EVENTS.POST_UPDATED);
    expect(broadcast).toBeDefined();
    expect(broadcast?.workspaceId).toBe(wsId);
  });

  it('PATCH broadcast payload contains the post id', async () => {
    const post = seedPost(wsId, { status: 'draft' });
    await patchJson(`/api/content-posts/${wsId}/${post.id}`, { status: 'review' });
    const broadcast = broadcastState.calls.find(c => c.event === WS_EVENTS.POST_UPDATED);
    expect(broadcast).toBeDefined();
    expect((broadcast?.payload as Record<string, unknown>).postId).toBe(post.id);
  });
});

describe('Status transitions via PATCH', () => {
  it('draft → review transition returns 200 with updated status', async () => {
    const post = seedPost(wsId, { status: 'draft' });
    const res = await patchJson(`/api/content-posts/${wsId}/${post.id}`, { status: 'review' });
    expect(res.status).toBe(200);
    const body = await res.json() as GeneratedPost;
    expect(body.status).toBe('review');
  });

  it('GET returns the updated status after a PATCH status transition', async () => {
    const post = seedPost(wsId, { status: 'draft' });
    await patchJson(`/api/content-posts/${wsId}/${post.id}`, { status: 'review' });
    const res = await getJson(`/api/content-posts/${wsId}/${post.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as GeneratedPost;
    expect(body.status).toBe('review');
  });

  it('review → draft (send back for edits) transition returns 200', async () => {
    const post = seedPost(wsId, { status: 'review' });
    const res = await patchJson(`/api/content-posts/${wsId}/${post.id}`, { status: 'draft' });
    expect(res.status).toBe(200);
    const body = await res.json() as GeneratedPost;
    expect(body.status).toBe('draft');
  });

  it('invalid transition (draft → approved) returns 400 without mutating', async () => {
    const post = seedPost(wsId, { status: 'draft' });
    const res = await patchJson(`/api/content-posts/${wsId}/${post.id}`, { status: 'approved' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    // Post must remain unchanged
    const stored = getPost(wsId, post.id);
    expect(stored?.status).toBe('draft');
    expect(broadcastState.calls).toHaveLength(0);
  });
});

describe('PATCH field update — title', () => {
  it('updates the post title and broadcasts POST_UPDATED', async () => {
    const post = seedPost(wsId);
    const res = await patchJson(`/api/content-posts/${wsId}/${post.id}`, {
      title: 'Updated Lifecycle Title',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as GeneratedPost;
    expect(body.title).toBe('Updated Lifecycle Title');
    const broadcast = broadcastState.calls.find(c => c.event === WS_EVENTS.POST_UPDATED);
    expect(broadcast).toBeDefined();
  });

  it('PATCH to unknown postId returns 404', async () => {
    const res = await patchJson(`/api/content-posts/${wsId}/post_patch_nonexistent_xyz`, {
      title: 'Should Not Work',
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('cross-workspace PATCH is rejected (404) and does not mutate the owning workspace post', async () => {
    const post = seedPost(wsId, { title: 'Original Lifecycle Title' });
    const res = await patchJson(`/api/content-posts/${otherWsId}/${post.id}`, {
      title: 'Cross-Workspace Title',
    });
    expect(res.status).toBe(404);
    const stored = getPost(wsId, post.id);
    expect(stored?.title).toBe('Original Lifecycle Title');
    expect(broadcastState.calls).toHaveLength(0);
  });
});

describe('list isolation between workspaces', () => {
  it('posts seeded in wsA do not appear in wsB list', async () => {
    const postA = seedPost(wsId);
    const res = await getJson(`/api/content-posts/${otherWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as GeneratedPost[];
    expect(body.find(p => p.id === postA.id)).toBeUndefined();
  });
});

describe('direct DB write → read-back contract', () => {
  it('a post written via savePost is retrievable via GET', async () => {
    const post = seedPost(wsId, {
      title: 'Direct Write Post',
      status: 'draft',
    });
    const res = await getJson(`/api/content-posts/${wsId}/${post.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as GeneratedPost;
    expect(body.id).toBe(post.id);
    expect(body.title).toBe('Direct Write Post');
    expect(body.workspaceId).toBe(wsId);
  });

  it('a post written via savePost appears in the list', async () => {
    const post = seedPost(wsId, { title: 'Seeded List Post' });
    const res = await getJson(`/api/content-posts/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as GeneratedPost[];
    const found = body.find(p => p.id === post.id);
    expect(found).toBeDefined();
    expect(found?.title).toBe('Seeded List Post');
  });

  it('listPosts helper and GET list are consistent', async () => {
    const post = seedPost(wsId, { title: 'Consistency Check Post' });
    const helperList = listPosts(wsId);
    const res = await getJson(`/api/content-posts/${wsId}`);
    const apiList = await res.json() as GeneratedPost[];
    const helperIds = new Set(helperList.map(p => p.id));
    const apiIds = new Set(apiList.map(p => p.id));
    // Post seeded above must appear in both
    expect(helperIds.has(post.id)).toBe(true);
    expect(apiIds.has(post.id)).toBe(true);
  });
});

// ── W6.6: planned publish date (forward-planning calendar) ──────────────────────

describe('PATCH /api/content-posts/:workspaceId/:postId/planned-date', () => {
  it('sets a planned date and broadcasts POST_UPDATED', async () => {
    const post = seedPost(wsId, { title: 'Planned Date Post' });
    const planned = '2026-09-01T00:00:00.000Z';
    const res = await patchJson(`/api/content-posts/${wsId}/${post.id}/planned-date`, { plannedPublishAt: planned });
    expect(res.status).toBe(200);
    const body = await res.json() as GeneratedPost;
    expect(body.plannedPublishAt).toBe(planned);
    // Persisted
    expect(getPost(wsId, post.id)?.plannedPublishAt).toBe(planned);
    // Broadcast fired
    const evt = broadcastState.calls.find(c => c.event === WS_EVENTS.POST_UPDATED && (c.payload as { postId: string }).postId === post.id);
    expect(evt).toBeDefined();
  });

  it('clears a planned date when null is sent', async () => {
    const post = seedPost(wsId, { title: 'Clear Date Post', plannedPublishAt: '2026-09-01T00:00:00.000Z' });
    const res = await patchJson(`/api/content-posts/${wsId}/${post.id}/planned-date`, { plannedPublishAt: null });
    expect(res.status).toBe(200);
    const body = await res.json() as GeneratedPost;
    expect(body.plannedPublishAt).toBeUndefined();
    expect(getPost(wsId, post.id)?.plannedPublishAt).toBeUndefined();
  });

  it('rejects a non-ISO planned date with 400', async () => {
    const post = seedPost(wsId, { title: 'Bad Date Post' });
    const res = await patchJson(`/api/content-posts/${wsId}/${post.id}/planned-date`, { plannedPublishAt: 'not-a-date' });
    expect(res.status).toBe(400);
  });

  it('rejects a missing plannedPublishAt key (strict schema) with 400', async () => {
    const post = seedPost(wsId, { title: 'Missing Key Post' });
    const res = await patchJson(`/api/content-posts/${wsId}/${post.id}/planned-date`, {});
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown post', async () => {
    const res = await patchJson(`/api/content-posts/${wsId}/nonexistent-post/planned-date`, { plannedPublishAt: '2026-09-01T00:00:00.000Z' });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/content-posts/:workspaceId/suggest-dates', () => {
  it('returns empty suggestions when there are no unscheduled drafts', async () => {
    const freshWs = createWorkspace('Suggest Dates Empty Workspace');
    try {
      const res = await getJson(`/api/content-posts/${freshWs.id}/suggest-dates`);
      expect(res.status).toBe(200);
      const body = await res.json() as { suggestions: unknown[]; unscheduledCount: number };
      expect(body.suggestions).toHaveLength(0);
      expect(body.unscheduledCount).toBe(0);
    } finally {
      deleteWorkspace(freshWs.id);
    }
  });

  it('proposes one date per unscheduled draft and skips already-scheduled/published posts', async () => {
    const freshWs = createWorkspace('Suggest Dates Workspace');
    try {
      const draftA = makePost(freshWs.id, {
        title: 'Unscheduled A',
        status: 'draft',
        generationRevision: 7,
      });
      const draftB = makePost(freshWs.id, {
        title: 'Unscheduled B',
        status: 'draft',
        generationRevision: 12,
      });
      const scheduled = makePost(freshWs.id, { title: 'Already Scheduled', status: 'draft', plannedPublishAt: '2026-09-01T00:00:00.000Z' });
      savePost(freshWs.id, draftA);
      savePost(freshWs.id, draftB);
      savePost(freshWs.id, scheduled);

      const res = await getJson(`/api/content-posts/${freshWs.id}/suggest-dates`);
      expect(res.status).toBe(200);
      const body = await res.json() as ContentCalendarDateSuggestionsResponse;
      expect(body.unscheduledCount).toBe(2);
      const ids = body.suggestions.map(s => s.draftId);
      expect(ids).toContain(draftA.id);
      expect(ids).toContain(draftB.id);
      expect(ids).not.toContain(scheduled.id);
      expect(body.suggestions.find(suggestion => suggestion.draftId === draftA.id)?.generationRevision).toBe(7);
      expect(body.suggestions.find(suggestion => suggestion.draftId === draftB.id)?.generationRevision).toBe(12);
      // Each suggested date is a valid ISO string in the future.
      for (const s of body.suggestions) {
        expect(Number.isNaN(new Date(s.suggestedDate).getTime())).toBe(false);
        expect(new Date(s.suggestedDate).getTime()).toBeGreaterThan(Date.now());
      }
    } finally {
      db.prepare('DELETE FROM content_posts WHERE workspace_id = ?').run(freshWs.id);
      deleteWorkspace(freshWs.id);
    }
  });
});
