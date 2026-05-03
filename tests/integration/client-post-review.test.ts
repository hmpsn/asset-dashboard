/**
 * Integration tests for client post review flow.
 *
 * Tests the public API endpoints added in Task 4:
 * - POST /api/public/content-request/:wsId/:id/approve-post
 * - POST /api/public/content-request/:wsId/:id/request-post-changes
 *
 * And the state machine guard (via admin PATCH) for post_review transitions.
 *
 * Pattern follows tests/integration/content-requests-routes.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createContentRequest, updateContentRequest } from '../../server/content-requests.js';
import { savePost, getPost, listPostVersions } from '../../server/content-posts-db.js';
import type { GeneratedPost } from '../../shared/types/content.js';

const ctx = createTestContext(13328); // port-ok: 13201-13327 fully allocated; extending range
const { api, postJson, patchJson } = ctx;

let testWsId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Post Review Test Workspace');
  testWsId = ws.id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(testWsId);
  await ctx.stopServer();
});

// makeStubPost runs in the same process as the server (vitest), so direct DB calls work.
function makeStubPost(workspaceId: string, briefId: string): GeneratedPost {
  const now = new Date().toISOString();
  return {
    id: `post_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    workspaceId,
    briefId,
    targetKeyword: 'test-keyword',
    title: 'Test Post Title',
    metaDescription: 'Test meta description',
    introduction: '<p>Test introduction.</p>',
    sections: [
      {
        index: 0, heading: 'Section One', content: '<p>Original section content.</p>',
        wordCount: 3, targetWordCount: 200, keywords: [], status: 'done',
      },
    ],
    conclusion: '<p>Test conclusion.</p>',
    totalWordCount: 50,
    targetWordCount: 1500,
    status: 'review',
    createdAt: now,
    updatedAt: now,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function createRequest(topic: string, kw: string): Promise<{ id: string; status: string }> {
  // Use the public endpoint — there is no POST /api/content-requests/:wsId admin route.
  // Admin routes for content-requests only register GET, PATCH, DELETE, and POST .../generate-brief.
  const res = await postJson(`/api/public/content-request/${testWsId}`, {
    topic, targetKeyword: kw, intent: 'informational',
    priority: 'medium', rationale: '', serviceType: 'full_post',
  });
  expect(res.status).toBe(200);
  return res.json() as Promise<{ id: string; status: string }>;
}

/**
 * Create a request with a linked stub post so the server guard
 * (Fix 2: "No generated post found") allows the in_progress → post_review transition.
 */
async function createRequestWithPost(topic: string, kw: string): Promise<{ id: string; status: string; postId: string }> {
  const req = createContentRequest(testWsId, {
    topic, targetKeyword: kw, intent: 'informational', priority: 'medium',
    rationale: '', serviceType: 'full_post',
  });
  const briefId = `brief_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  updateContentRequest(testWsId, req.id, { briefId });
  const post = makeStubPost(testWsId, briefId);
  savePost(testWsId, post);
  return { id: req.id, status: req.status, postId: post.id };
}

async function setStatus(reqId: string, status: string): Promise<Response> {
  return patchJson(`/api/content-requests/${testWsId}/${reqId}`, { status });
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/public/content-request/:wsId/:id/approve-post', () => {
  it('transitions post_review → delivered', async () => {
    // createRequestWithPost links a stub post so the server guard allows the transition.
    const req = await createRequestWithPost('Approve Test', `approve-test-${Date.now()}`);

    // Walk to in_progress → post_review
    await setStatus(req.id, 'in_progress');
    const toPostReview = await setStatus(req.id, 'post_review');
    expect(toPostReview.status).toBe(200);

    // Client approves via public route (no auth required)
    const res = await postJson(`/api/public/content-request/${testWsId}/${req.id}/approve-post`, {});
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('delivered');
  });

  it('rejects approve-post from a non-post_review status (e.g. in_progress)', async () => {
    const req = await createRequest('Bad Approve Test', `bad-approve-${Date.now()}`);
    await setStatus(req.id, 'in_progress');
    // Do NOT advance to post_review

    const res = await postJson(`/api/public/content-request/${testWsId}/${req.id}/approve-post`, {});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/public/content-request/:wsId/:id/request-post-changes', () => {
  it('transitions post_review → changes_requested and stores clientFeedback', async () => {
    const req = await createRequestWithPost('Changes Test', `changes-test-${Date.now()}`);

    await setStatus(req.id, 'in_progress');
    await setStatus(req.id, 'post_review');

    const res = await postJson(
      `/api/public/content-request/${testWsId}/${req.id}/request-post-changes`,
      { feedback: 'Please make section 2 more detailed.' },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; clientFeedback: string };
    expect(body.status).toBe('changes_requested');
    expect(body.clientFeedback).toBe('Please make section 2 more detailed.');
  });

  it('rejects request-post-changes from non-post_review status', async () => {
    const req = await createRequest('Guard Test', `guard-test-${Date.now()}`);
    // Stays at 'requested' — does NOT advance to post_review

    const res = await postJson(
      `/api/public/content-request/${testWsId}/${req.id}/request-post-changes`,
      { feedback: 'Should be rejected.' },
    );
    expect(res.status).toBe(400);
  });

  it('rejects request-post-changes with empty feedback', async () => {
    const req = await createRequestWithPost('Empty Feedback Test', `empty-fb-${Date.now()}`);
    await setStatus(req.id, 'in_progress');
    await setStatus(req.id, 'post_review');

    const res = await postJson(
      `/api/public/content-request/${testWsId}/${req.id}/request-post-changes`,
      { feedback: '' },
    );
    expect(res.status).toBe(400); // Zod min(1) validation
  });
});

describe('State machine guard: in_progress → post_review', () => {
  it('allows in_progress → post_review', async () => {
    // createRequestWithPost links a stub post so the server guard allows the transition.
    const req = await createRequestWithPost('SM Allow Test', `sm-allow-${Date.now()}`);
    await setStatus(req.id, 'in_progress');
    const res = await setStatus(req.id, 'post_review');
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('post_review');
  });

  it('blocks requested → post_review directly (must go through in_progress)', async () => {
    const req = await createRequest('SM Block Test', `sm-block-${Date.now()}`);
    // 'requested' cannot jump to 'post_review' — must walk through in_progress
    const res = await setStatus(req.id, 'post_review');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/public/content-requests/:wsId — postId serialization', () => {
  it('exposes postId for post_review status, omits it for earlier statuses', async () => {
    // Setup: post_review request with linked post
    const briefId = `brief_get_test_${Date.now()}`;
    const ready = createContentRequest(testWsId, {
      topic: 'GET Test Ready', targetKeyword: `get-ready-${Date.now()}`,
      intent: 'informational', priority: 'medium', rationale: '', serviceType: 'full_post',
    });
    updateContentRequest(testWsId, ready.id, { briefId });
    const post = makeStubPost(testWsId, briefId);
    savePost(testWsId, post);
    await patchJson(`/api/content-requests/${testWsId}/${ready.id}`, { status: 'in_progress' });
    await patchJson(`/api/content-requests/${testWsId}/${ready.id}`, { status: 'post_review' });

    // Setup: requested-status request with no post
    const earlyReq = await createRequest('GET Test Early', `get-early-${Date.now()}`);

    // List via public endpoint
    const res = await api(`/api/public/content-requests/${testWsId}`);
    expect(res.status).toBe(200);
    const list = await res.json() as Array<{ id: string; status: string; postId?: string; clientFeedback?: string }>;

    const readyEntry = list.find(r => r.id === ready.id);
    expect(readyEntry).toBeDefined();
    expect(readyEntry!.postId).toBe(post.id);
    expect(readyEntry!.status).toBe('post_review');
    expect(readyEntry!.clientFeedback).toBeUndefined();

    const earlyEntry = list.find(r => r.id === earlyReq.id);
    expect(earlyEntry).toBeDefined();
    expect(earlyEntry!.postId).toBeUndefined();
  });
});

describe('PATCH /api/public/content-posts/:wsId/:postId/client-edit', () => {
  it('updates sections and snapshots the post version', async () => {
    // Set up in-process: create request, save a post, link them
    const briefId = `brief_test_${Date.now()}`;
    const req = createContentRequest(testWsId, {
      topic: 'Edit Test', targetKeyword: `edit-test-${Date.now()}`,
      intent: 'informational', priority: 'medium', rationale: '',
      serviceType: 'full_post',
    });
    // Set briefId so the post can be associated
    updateContentRequest(testWsId, req.id, { briefId });

    const post = makeStubPost(testWsId, briefId);
    savePost(testWsId, post);

    // Advance request to in_progress then post_review via HTTP
    // (admin PATCH auto-populates postId when transitioning to post_review)
    const toInProgress = await patchJson(`/api/content-requests/${testWsId}/${req.id}`, { status: 'in_progress' });
    expect(toInProgress.status).toBe(200);
    const toReview = await patchJson(`/api/content-requests/${testWsId}/${req.id}`, { status: 'post_review' });
    expect(toReview.status).toBe(200);

    // Client edits via public route — content is rich text now (TipTap output);
    // server sanitizes via sanitizeRichText() instead of stripping. Headings are
    // plain text (sanitizePlainText), so heading HTML is dropped but section
    // content keeps the allowlisted tags (<p>, <strong>, <a>, etc.).
    const editRes = await api(`/api/public/content-posts/${testWsId}/${post.id}/client-edit`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sections: [
          { index: 0, heading: 'Section One', content: '<p>Updated section content by client.</p>', wordCount: 5 },
        ],
      }),
    });
    expect(editRes.status).toBe(200);
    const updated = await editRes.json() as { sections: { content: string }[] };
    expect(updated.sections[0].content).toBe('<p>Updated section content by client.</p>');

    // Verify post is actually persisted (in-process check)
    const persisted = getPost(testWsId, post.id);
    expect(persisted?.sections[0].content).toBe('<p>Updated section content by client.</p>');

    // Verify totalWordCount was recomputed (Fix 1):
    // intro: "Test introduction" = 2 words
    // section: 5 words (edited from 3)
    // conclusion: "Test conclusion" = 2 words
    // Total: 2 + 5 + 2 = 9 words
    expect(persisted?.totalWordCount).toBe(9);
  });

  it('coalesces rapid client edits into a single snapshot within 60 s', async () => {
    // Set up: create request + post, advance to post_review
    const briefId = `brief_coalesce_${Date.now()}`;
    const req = createContentRequest(testWsId, {
      topic: 'Coalesce Test', targetKeyword: `coalesce-${Date.now()}`,
      intent: 'informational', priority: 'medium', rationale: '', serviceType: 'full_post',
    });
    updateContentRequest(testWsId, req.id, { briefId });
    const post = makeStubPost(testWsId, briefId);
    savePost(testWsId, post);

    await patchJson(`/api/content-requests/${testWsId}/${req.id}`, { status: 'in_progress' });
    await patchJson(`/api/content-requests/${testWsId}/${req.id}`, { status: 'post_review' });

    const edit = async (content: string) =>
      api(`/api/public/content-posts/${testWsId}/${post.id}/client-edit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sections: [{ index: 0, heading: 'Section One', content, wordCount: 4 }],
        }),
      });

    // First edit — should create a snapshot
    const r1 = await edit('First edit by client.');
    expect(r1.status).toBe(200);

    // Second edit within the same second — should be coalesced (no new snapshot)
    const r2 = await edit('Second rapid edit by client.');
    expect(r2.status).toBe(200);

    // Only one client_edit snapshot should exist
    const versions = listPostVersions(testWsId, post.id);
    const clientEditVersions = versions.filter(
      v => v.trigger === 'manual_edit' && v.triggerDetail === 'client_edit',
    );
    expect(clientEditVersions).toHaveLength(1);
  });

  it('rejects edit when request is not in post_review', async () => {
    const briefId = `brief_guard_${Date.now()}`;
    const req = createContentRequest(testWsId, {
      topic: 'Guard Edit', targetKeyword: `guard-edit-${Date.now()}`,
      intent: 'informational', priority: 'medium', rationale: '', serviceType: 'full_post',
    });
    updateContentRequest(testWsId, req.id, { briefId });
    const post = makeStubPost(testWsId, briefId);
    savePost(testWsId, post);
    // Request stays at 'requested' — not in post_review

    const editRes = await api(`/api/public/content-posts/${testWsId}/${post.id}/client-edit`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sections: [{ index: 0, heading: 'H', content: '<p>No.</p>', wordCount: 1 }] }),
    });
    expect(editRes.status).toBe(403);
  });
});
