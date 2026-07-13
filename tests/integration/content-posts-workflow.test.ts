/**
 * Integration coverage for content post HTTP workflow routes.
 *
 * Focus: PATCH editor/state transitions, workspace scoping, and auto-publish
 * failure handling. Uses createApp() in-process so Webflow calls can be mocked.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

import {
  setupWebflowMocks,
  mockWebflowError,
  mockWebflowSuccess,
  getCapturedRequests,
  resetWebflowMocks,
} from '../mocks/webflow.js';

setupWebflowMocks();

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: unknown }>,
}));

const imageState = vi.hoisted(() => ({
  calls: [] as Array<{ postId?: string; siteId?: string }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: unknown) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/content-image.js', () => ({
  generateFeaturedImage: vi.fn(async (post: { id?: string }, siteId: string, _tokenOverride?: string) => {
    imageState.calls.push({ postId: post.id, siteId });
    return { success: true, hostedUrl: 'https://cdn.example.com/generated-featured-image.jpg' };
  }),
}));

// Stub out background follow-on jobs (llms.txt regen + rec regen) so they don't
// fire extra Webflow calls that interfere with the captured-request count assertions.
vi.mock('../../server/keyword-strategy-follow-ons.js', () => ({
  queueKeywordStrategyPostUpdateFollowOns: vi.fn(),
}));

import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { getPost, savePost } from '../../server/content-posts-db.js';
import { listJobs } from '../../server/jobs.js';
import { listActivity } from '../../server/activity-log.js';
import db from '../../server/db/index.js';
import type { GeneratedPost, PostSection } from '../../shared/types/content.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';

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

async function patchJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function postWithoutBody(path: string): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeSection(index: number, overrides: Partial<PostSection> = {}): PostSection {
  return {
    index,
    heading: `Section ${index + 1}`,
    content: `<p>Original section ${index + 1} copy.</p>`,
    wordCount: 4,
    targetWordCount: 200,
    keywords: ['workflow'],
    status: 'done',
    ...overrides,
  };
}

function makePost(overrides: Partial<GeneratedPost> = {}): GeneratedPost {
  const now = new Date().toISOString();
  const id = `post_workflow_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    workspaceId: wsId,
    briefId: 'brief_workflow',
    targetKeyword: 'workflow coverage',
    title: 'Workflow Coverage Post',
    metaDescription: 'Workflow coverage meta description.',
    introduction: '<p>Intro words here.</p>',
    sections: [makeSection(0), makeSection(1)],
    conclusion: '<p>Closing words.</p>',
    seoTitle: 'Workflow Coverage Post',
    seoMetaDescription: 'Workflow coverage meta description.',
    totalWordCount: 10,
    targetWordCount: 900,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function seedPost(overrides: Partial<GeneratedPost> = {}): GeneratedPost {
  const post = makePost(overrides);
  savePost(post.workspaceId, post);
  return post;
}

function configurePublishTarget(options: { featuredImage?: boolean } = {}): void {
  updateWorkspace(wsId, {
    webflowSiteId: 'site_content_posts_workflow',
    webflowToken: 'wf-token-content-posts',
    publishTarget: {
      collectionId: 'collection_content_posts',
      collectionName: 'Blog Posts',
      fieldMap: {
        title: 'name',
        slug: 'slug',
        body: 'post-body',
        metaTitle: 'seo-title',
        metaDescription: 'seo-description',
        publishDate: 'published-on',
        ...(options.featuredImage ? { featuredImage: 'featured-image' } : {}),
      },
    },
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for condition');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

// Jobs accumulate in-memory across tests — always pick the most recent CONTENT_PUBLISH job for wsId.
function latestPublishJob() {
  return listJobs(wsId)
    .filter(j => j.type === BACKGROUND_JOB_TYPES.CONTENT_PUBLISH)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
}

beforeAll(async () => {
  await startTestServer();
  const ws = createWorkspace('Content Posts Workflow Workspace');
  wsId = ws.id;
  const otherWs = createWorkspace('Content Posts Workflow Other Workspace');
  otherWsId = otherWs.id;
});

beforeEach(() => {
  setupWebflowMocks();
  broadcastState.calls = [];
  imageState.calls = [];
});

afterAll(async () => {
  resetWebflowMocks();
  db.prepare('DELETE FROM content_post_versions WHERE workspace_id IN (?, ?)').run(wsId, otherWsId);
  db.prepare('DELETE FROM content_posts WHERE workspace_id IN (?, ?)').run(wsId, otherWsId);
  deleteWorkspace(wsId);
  deleteWorkspace(otherWsId);
  await stopTestServer();
});

describe('PATCH /api/content-posts/:workspaceId/:postId', () => {
  it('rejects invalid status transitions without mutating the post', async () => {
    const post = seedPost({ status: 'draft' });

    const res = await patchJson(`/api/content-posts/${wsId}/${post.id}`, { status: 'approved' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid post transition/);

    const stored = getPost(wsId, post.id);
    expect(stored?.status).toBe('draft');
    expect(stored?.webflowItemId).toBeUndefined();
    expect(broadcastState.calls).toHaveLength(0);
  });

  it('rejects malformed section updates without mutating existing sections', async () => {
    const post = seedPost();
    const before = getPost(wsId, post.id);

    const duplicateRes = await patchJson(`/api/content-posts/${wsId}/${post.id}`, {
      sections: [
        { index: 0, heading: 'First duplicate', content: '<p>One.</p>', wordCount: 1 },
        { index: 0, heading: 'Second duplicate', content: '<p>Two.</p>', wordCount: 1 },
      ],
    });
    expect(duplicateRes.status).toBe(400);

    const incompleteNewSectionRes = await patchJson(`/api/content-posts/${wsId}/${post.id}`, {
      sections: [
        { index: 2, heading: 'Incomplete New Section', content: '<p>Missing metadata.</p>', wordCount: 2 },
      ],
    });
    expect(incompleteNewSectionRes.status).toBe(400);

    const after = getPost(wsId, post.id);
    expect(after?.sections).toEqual(before?.sections);
    expect(after?.totalWordCount).toBe(before?.totalWordCount);
    expect(broadcastState.calls).toHaveLength(0);
  });

  it('merges partial section edits, strips frontend-only fields, and recomputes total word count', async () => {
    const post = seedPost({
      introduction: '<p>Intro words here.</p>',
      sections: [
        makeSection(0, { wordCount: 4 }),
        makeSection(1, { wordCount: 4 }),
      ],
      conclusion: '<p>Closing words.</p>',
      totalWordCount: 10,
    });

    const res = await patchJson(`/api/content-posts/${wsId}/${post.id}`, {
      sections: [
        {
          index: 1,
          heading: 'Updated Section',
          content: '<p>Updated section body with five words.</p>',
          wordCount: 6,
          uiExpanded: true,
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sections).toHaveLength(2);
    expect(body.sections[0].heading).toBe('Section 1');
    expect(body.sections[1]).toMatchObject({
      index: 1,
      heading: 'Updated Section',
      wordCount: 6,
      targetWordCount: 200,
      keywords: ['workflow'],
      status: 'done',
    });
    expect(body.sections[1].uiExpanded).toBeUndefined();
    expect(body.totalWordCount).toBe(15);
    expect(broadcastState.calls.some(call => call.event === WS_EVENTS.POST_UPDATED)).toBe(true);
  });

  it('does not let a wrong workspace update an existing post id', async () => {
    const post = seedPost({ title: 'Owner Workspace Title' });

    const res = await patchJson(`/api/content-posts/${otherWsId}/${post.id}`, {
      title: 'Cross Workspace Title',
    });
    expect(res.status).toBe(404);

    const stored = getPost(wsId, post.id);
    expect(stored?.title).toBe('Owner Workspace Title');
    expect(getPost(otherWsId, post.id)).toBeUndefined();
    expect(broadcastState.calls).toHaveLength(0);
  });

  it('does not stamp Webflow publish metadata when auto-publish item creation fails', async () => {
    configurePublishTarget();
    mockWebflowError(/\/collections\/collection_content_posts\/items$/, 500, 'Webflow create failed');
    const post = seedPost({ status: 'review' });

    const res = await patchJson(`/api/content-posts/${wsId}/${post.id}`, { status: 'approved' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('approved');

    await waitFor(() => getCapturedRequests().length > 0);
    const requests = getCapturedRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      endpoint: '/collections/collection_content_posts/items',
      method: 'POST',
      token: 'wf-token-content-posts',
    });

    const stored = getPost(wsId, post.id);
    expect(stored?.status).toBe('approved');
    expect(stored?.webflowItemId).toBeUndefined();
    expect(stored?.webflowCollectionId).toBeUndefined();
    expect(stored?.publishedAt).toBeUndefined();
    expect(stored?.publishedSlug).toBeUndefined();
    expect(broadcastState.calls.some(call => call.event === WS_EVENTS.CONTENT_PUBLISHED)).toBe(false);
  });

  // C3 (audit item #12): auto-publish-on-approval now runs as a background CONTENT_PUBLISH job
  // instead of a silent fire-and-forget. Failures surface as job `error`; success stamps the post,
  // broadcasts CONTENT_PUBLISHED, and logs a content_published activity.

  it('auto-publish runs as a CONTENT_PUBLISH job and surfaces failures as job error (not silent)', async () => {
    configurePublishTarget();
    mockWebflowError(/\/collections\/collection_content_posts\/items$/, 500, 'Webflow create failed');
    const post = seedPost({ status: 'review' });

    const res = await patchJson(`/api/content-posts/${wsId}/${post.id}`, { status: 'approved' });
    expect(res.status).toBe(200);

    // Wait for the background job to reach a terminal error state.
    await waitFor(() => latestPublishJob()?.status === 'error');

    const job = latestPublishJob();
    expect(job?.status).toBe('error');
    expect(job?.error).toMatch(/create CMS item|Webflow create failed/i);

    // FM-2: no partial stamp on create failure.
    const stored = getPost(wsId, post.id);
    expect(stored?.webflowItemId).toBeUndefined();
    expect(stored?.publishedAt).toBeUndefined();
    expect(broadcastState.calls.some(call => call.event === WS_EVENTS.CONTENT_PUBLISHED)).toBe(false);

    // The failure must leave a durable activity record (the job expires with its TTL).
    expect(listActivity(wsId).some(a =>
      a.type === 'content_publish_failed'
      && (a.metadata as { postId?: string } | undefined)?.postId === post.id,
    )).toBe(true);
  });

  it('back-to-back approvals of two different posts each get their own publish job (no silent drop)', async () => {
    configurePublishTarget();
    mockWebflowSuccess(/\/collections\/collection_content_posts\/items$/, { id: 'wf_concurrent_item' });
    mockWebflowSuccess(/\/collections\/collection_content_posts\/items\/publish$/, {});
    const postA = seedPost({ status: 'review', title: 'Concurrent A' });
    const postB = seedPost({ status: 'review', title: 'Concurrent B' });

    // Approve both before either background job has a chance to finish — a
    // workspace-scoped hasActiveJob guard here would silently skip post B's publish.
    const [resA, resB] = await Promise.all([
      patchJson(`/api/content-posts/${wsId}/${postA.id}`, { status: 'approved' }),
      patchJson(`/api/content-posts/${wsId}/${postB.id}`, { status: 'approved' }),
    ]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    await waitFor(() => {
      const a = getPost(wsId, postA.id);
      const b = getPost(wsId, postB.id);
      return Boolean(a?.webflowItemId && b?.webflowItemId);
    });

    // Two Webflow creates — one per post.
    const creates = getCapturedRequests().filter(r =>
      r.method === 'POST' && r.endpoint === '/collections/collection_content_posts/items',
    );
    expect(creates).toHaveLength(2);

    const publishJobs = listJobs(wsId)
      .filter(j => j.type === BACKGROUND_JOB_TYPES.CONTENT_PUBLISH)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 2);
    expect(publishJobs.length).toBe(2);
    expect(publishJobs.every(j => j.status === 'done')).toBe(true); // every-ok: length asserted to be 2 on the previous line
  });

  it('auto-publish job success stamps the post, broadcasts CONTENT_PUBLISHED, and logs activity', async () => {
    configurePublishTarget();
    mockWebflowSuccess(/\/collections\/collection_content_posts\/items$/, { id: 'wf_auto_item' });
    mockWebflowSuccess(/\/collections\/collection_content_posts\/items\/publish$/, {});
    const post = seedPost({ status: 'review' });

    const res = await patchJson(`/api/content-posts/${wsId}/${post.id}`, { status: 'approved' });
    expect(res.status).toBe(200);

    await waitFor(() => {
      const stored = getPost(wsId, post.id);
      return stored?.webflowItemId === 'wf_auto_item';
    });

    const stored = getPost(wsId, post.id);
    expect(stored?.webflowItemId).toBe('wf_auto_item');
    expect(stored?.webflowCollectionId).toBe('collection_content_posts');
    expect(stored?.publishedAt).toBeTruthy();
    expect(stored?.publishedSlug).toBeTruthy();

    expect(latestPublishJob()?.status).toBe('done');

    expect(broadcastState.calls.some(call =>
      call.event === WS_EVENTS.CONTENT_PUBLISHED
      && (call.payload as { itemId?: string }).itemId === 'wf_auto_item',
    )).toBe(true);

    expect(listActivity(wsId).some(a => a.type === 'content_published')).toBe(true);
  });
});

describe('POST /api/content-posts/:workspaceId/:postId/publish-to-webflow', () => {
  it('keeps the optional body contract for default publish requests', async () => {
    configurePublishTarget();
    mockWebflowSuccess(/\/collections\/collection_content_posts\/items$/, { id: 'wf_no_body_item' });
    mockWebflowSuccess(/\/collections\/collection_content_posts\/items\/publish$/, {});
    const post = seedPost({ status: 'approved' });

    const res = await postWithoutBody(`/api/content-posts/${wsId}/${post.id}/publish-to-webflow`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.itemId).toBe('wf_no_body_item');

    expect(imageState.calls).toHaveLength(0);
    const requests = getCapturedRequests();
    expect(requests).toHaveLength(2);
    const stored = getPost(wsId, post.id);
    expect(stored?.webflowItemId).toBe('wf_no_body_item');
    expect(stored?.webflowCollectionId).toBe('collection_content_posts');
    expect(stored?.publishedAt).toBeDefined();
    expect(stored?.publishedSlug).toBe('workflow-coverage-post');
    expect(broadcastState.calls.some(call => call.event === WS_EVENTS.CONTENT_PUBLISHED)).toBe(true);
  });

  it('rejects malformed publish options before image generation, Webflow calls, or metadata mutation', async () => {
    configurePublishTarget({ featuredImage: true });
    const post = seedPost({ status: 'approved' });

    const res = await postJson(`/api/content-posts/${wsId}/${post.id}/publish-to-webflow`, {
      generateImage: 'false',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();

    expect(imageState.calls).toHaveLength(0);
    expect(getCapturedRequests()).toHaveLength(0);
    const stored = getPost(wsId, post.id);
    expect(stored?.status).toBe('approved');
    expect(stored?.webflowItemId).toBeUndefined();
    expect(stored?.webflowCollectionId).toBeUndefined();
    expect(stored?.publishedAt).toBeUndefined();
    expect(stored?.publishedSlug).toBeUndefined();
    expect(broadcastState.calls.some(call => call.event === WS_EVENTS.CONTENT_PUBLISHED)).toBe(false);
  });

  it('rejects unsupported post statuses before calling Webflow or mutating publish metadata', async () => {
    configurePublishTarget();
    const post = seedPost({ status: 'generating' });

    const res = await postJson(`/api/content-posts/${wsId}/${post.id}/publish-to-webflow`, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('cannot be published');

    expect(getCapturedRequests()).toHaveLength(0);
    const stored = getPost(wsId, post.id);
    expect(stored?.status).toBe('generating');
    expect(stored?.webflowItemId).toBeUndefined();
    expect(stored?.webflowCollectionId).toBeUndefined();
    expect(stored?.publishedAt).toBeUndefined();
    expect(stored?.publishedSlug).toBeUndefined();
    expect(broadcastState.calls.some(call => call.event === WS_EVENTS.CONTENT_PUBLISHED)).toBe(false);
  });

  it('rejects an incomplete artifact even when its stored status is publishable', async () => {
    configurePublishTarget();
    const post = seedPost({ status: 'approved' });
    db.prepare('UPDATE content_posts SET conclusion = ? WHERE workspace_id = ? AND id = ?')
      .run('', wsId, post.id);

    const res = await postJson(`/api/content-posts/${wsId}/${post.id}/publish-to-webflow`, {});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Post is incomplete and cannot be published' });
    expect(getCapturedRequests()).toHaveLength(0);
    expect(getPost(wsId, post.id)?.publishedAt).toBeUndefined();
  });

  it('does not stamp Webflow publish metadata when manual item creation fails', async () => {
    configurePublishTarget();
    mockWebflowError(/\/collections\/collection_content_posts\/items$/, 500, 'Webflow create failed');
    const post = seedPost({ status: 'approved' });

    const res = await postJson(`/api/content-posts/${wsId}/${post.id}/publish-to-webflow`, {});
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('Failed to create CMS item');

    const requests = getCapturedRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      endpoint: '/collections/collection_content_posts/items',
      method: 'POST',
      token: 'wf-token-content-posts',
    });

    const stored = getPost(wsId, post.id);
    expect(stored?.status).toBe('approved');
    expect(stored?.webflowItemId).toBeUndefined();
    expect(stored?.webflowCollectionId).toBeUndefined();
    expect(stored?.publishedAt).toBeUndefined();
    expect(stored?.publishedSlug).toBeUndefined();
    expect(broadcastState.calls.some(call => call.event === WS_EVENTS.CONTENT_PUBLISHED)).toBe(false);
  });

  it('keeps draft Webflow item metadata but does not mark a post live when manual publish fails', async () => {
    configurePublishTarget();
    mockWebflowSuccess(/\/collections\/collection_content_posts\/items$/, { id: 'wf_manual_draft_item' });
    mockWebflowError(/\/collections\/collection_content_posts\/items\/publish$/, 500, 'Webflow publish failed');
    const post = seedPost({ status: 'approved' });

    const res = await postJson(`/api/content-posts/${wsId}/${post.id}/publish-to-webflow`, {});
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('Failed to publish CMS item');

    const requests = getCapturedRequests();
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      endpoint: '/collections/collection_content_posts/items',
      method: 'POST',
      token: 'wf-token-content-posts',
    });
    expect(requests[1]).toMatchObject({
      endpoint: '/collections/collection_content_posts/items/publish',
      method: 'POST',
      token: 'wf-token-content-posts',
      body: { itemIds: ['wf_manual_draft_item'] },
    });

    const stored = getPost(wsId, post.id);
    expect(stored?.status).toBe('approved');
    expect(stored?.webflowItemId).toBe('wf_manual_draft_item');
    expect(stored?.webflowCollectionId).toBe('collection_content_posts');
    expect(stored?.publishedAt).toBeUndefined();
    expect(stored?.publishedSlug).toBeUndefined();
    expect(broadcastState.calls.some(call => call.event === WS_EVENTS.CONTENT_PUBLISHED)).toBe(false);
  });
});
