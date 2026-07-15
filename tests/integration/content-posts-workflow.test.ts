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
  mockWebflowDeferred,
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
import { getPost, savePost, updatePostField } from '../../server/content-posts-db.js';
import { getBrief, updateBriefAtRevision, upsertBrief } from '../../server/content-brief.js';
import {
  createResourceScopedJob,
  getJobResourceClaims,
  listJobs,
  updateJob,
} from '../../server/jobs.js';
import * as jobsModule from '../../server/jobs.js';
import { initActivityBroadcast, listActivity } from '../../server/activity-log.js';
import {
  createContentPublishJob,
  runContentPublishJob,
} from '../../server/content-publish-job.js';
import { captureContentPublishAuthority } from '../../server/domains/content/publish-post-to-webflow.js';
import {
  getUnresolvedContentPublishReconciliation,
  recordContentPublishReconciliation,
} from '../../server/content-publish-reconciliation.js';
import { broadcastToWorkspace } from '../../server/broadcast.js';
import { queueKeywordStrategyPostUpdateFollowOns } from '../../server/keyword-strategy-follow-ons.js';
import { handleContentActionTool } from '../../server/mcp/tools/content-actions.js';
import db from '../../server/db/index.js';
import type { ContentBrief, GeneratedPost, PostSection } from '../../shared/types/content.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { BACKGROUND_JOB_TYPES, JOB_RESOURCE_TYPES } from '../../shared/types/background-jobs.js';

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
  const match = path.match(/^\/api\/content-posts\/([^/]+)\/([^/]+)/);
  const requestBody = match && body && typeof body === 'object' && !('expectedRevision' in body)
    ? { ...body, expectedRevision: getPost(match[1], match[2])?.generationRevision ?? 0 }
    : body;
  return api(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
}

async function postJson(path: string, body: unknown): Promise<Response> {
  const match = path.match(/^\/api\/content-posts\/([^/]+)\/([^/]+)\/publish-to-webflow$/);
  const requestBody = match && body && typeof body === 'object' && !('expectedRevision' in body)
    ? { ...body, expectedRevision: getPost(match[1], match[2])?.generationRevision ?? 0 }
    : body;
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
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

function configurePublishTarget(options: {
  featuredImage?: boolean;
  summary?: boolean;
  collectionId?: string;
  bodyField?: string;
  siteId?: string;
  token?: string;
} = {}): void {
  updateWorkspace(wsId, {
    webflowSiteId: options.siteId ?? 'site_content_posts_workflow',
    webflowToken: options.token ?? 'wf-token-content-posts',
    publishTarget: {
      collectionId: options.collectionId ?? 'collection_content_posts',
      collectionName: 'Blog Posts',
      fieldMap: {
        title: 'name',
        slug: 'slug',
        body: options.bodyField ?? 'post-body',
        metaTitle: 'seo-title',
        metaDescription: 'seo-description',
        publishDate: 'published-on',
        ...(options.summary ? { summary: 'excerpt' } : {}),
        ...(options.featuredImage ? { featuredImage: 'featured-image' } : {}),
      },
    },
  });
}

function seedWorkflowBrief(briefId: string, executiveSummary: string): void {
  const brief: ContentBrief = {
    id: briefId,
    workspaceId: wsId,
    targetKeyword: 'workflow coverage',
    secondaryKeywords: [],
    suggestedTitle: 'Workflow Brief',
    suggestedMetaDesc: 'Workflow brief meta.',
    outline: [],
    wordCountTarget: 900,
    intent: 'informational',
    audience: 'general',
    competitorInsights: '',
    internalLinkSuggestions: [],
    createdAt: new Date().toISOString(),
    executiveSummary,
  };
  upsertBrief(wsId, brief);
}

function publishAuthorityFor(postId: string) {
  const post = getPost(wsId, postId);
  if (!post) throw new Error(`Missing publish test post ${postId}`);
  return captureContentPublishAuthority(wsId, post);
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
  initActivityBroadcast(() => {});
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

  it('treats an identical edit as a semantic no-op with no revision, version, activity, or broadcast', async () => {
    const post = seedPost({ title: 'Already Current Title' });
    const before = getPost(wsId, post.id);
    const activitiesBefore = listActivity(wsId).length;
    const versionsBefore = (db.prepare(
      'SELECT COUNT(*) AS count FROM content_post_versions WHERE workspace_id = ? AND post_id = ?',
    ).get(wsId, post.id) as { count: number }).count;

    const res = await patchJson(`/api/content-posts/${wsId}/${post.id}`, {
      title: 'Already Current Title',
      expectedRevision: before!.generationRevision,
    });

    expect(res.status).toBe(200);
    const body = await res.json() as GeneratedPost;
    expect(body.generationRevision).toBe(before!.generationRevision);
    expect(getPost(wsId, post.id)?.generationRevision).toBe(before!.generationRevision);
    expect(listActivity(wsId)).toHaveLength(activitiesBefore);
    const versionsAfter = (db.prepare(
      'SELECT COUNT(*) AS count FROM content_post_versions WHERE workspace_id = ? AND post_id = ?',
    ).get(wsId, post.id) as { count: number }).count;
    expect(versionsAfter).toBe(versionsBefore);
    expect(broadcastState.calls).toHaveLength(0);
  });

  it('rejects a stale edit without mutation, activity, or broadcast', async () => {
    const post = seedPost({ title: 'Revision Owner Title' });
    const before = getPost(wsId, post.id);
    const activitiesBefore = listActivity(wsId).length;

    const res = await patchJson(`/api/content-posts/${wsId}/${post.id}`, {
      title: 'Stale Writer Title',
      expectedRevision: before!.generationRevision + 1,
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: 'generation_revision_conflict' });
    expect(getPost(wsId, post.id)).toMatchObject({
      title: 'Revision Owner Title',
      generationRevision: before!.generationRevision,
    });
    expect(listActivity(wsId)).toHaveLength(activitiesBefore);
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

  it('keeps the terminal error truthful when failure-activity broadcasting throws', async () => {
    configurePublishTarget();
    mockWebflowError(/\/collections\/collection_content_posts\/items$/, 500, 'Injected create failure');
    const post = seedPost({ status: 'approved', title: 'Truthful Publish Failure' });
    const expectedRevision = getPost(wsId, post.id)!.generationRevision;
    const started = createResourceScopedJob(BACKGROUND_JOB_TYPES.CONTENT_PUBLISH, {
      workspaceId: wsId,
      resources: [{ resourceType: JOB_RESOURCE_TYPES.CONTENT_POST, resourceId: post.id }],
    });
    let activityBroadcastCalls = 0;
    initActivityBroadcast((_workspaceId, event) => {
      if (event !== WS_EVENTS.ACTIVITY_NEW) return;
      activityBroadcastCalls += 1;
      throw new Error('injected activity broadcast failure');
    });

    let runnerError: unknown;
    try {
      await runContentPublishJob({
        jobId: started.job.id,
        workspaceId: wsId,
        postId: post.id,
        expectedRevision,
        authority: publishAuthorityFor(post.id),
      });
    } catch (err) {
      runnerError = err;
    } finally {
      initActivityBroadcast(() => {});
    }

    expect(runnerError).toBeUndefined();
    expect(activityBroadcastCalls).toBe(1);
    expect(listJobs(wsId).find(job => job.id === started.job.id)).toMatchObject({
      status: 'error',
      result: {
        postId: post.id,
        status: 'error',
        code: 'create_failed',
      },
    });
    expect(getPost(wsId, post.id)).toMatchObject({
      webflowItemId: undefined,
      publishedAt: undefined,
    });
    expect(listActivity(wsId)).toContainEqual(expect.objectContaining({
      type: 'content_publish_failed',
      metadata: expect.objectContaining({ postId: post.id, code: 'create_failed' }),
    }));
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

  it('withholds publish success effects when the committed artifact cannot persist a done terminal', async () => {
    configurePublishTarget();
    vi.mocked(queueKeywordStrategyPostUpdateFollowOns).mockClear();
    const post = seedPost({ status: 'approved', title: 'Terminal Truth Publish' });
    const expectedRevision = getPost(wsId, post.id)!.generationRevision;
    recordContentPublishReconciliation({
      workspaceId: wsId,
      postId: post.id,
      collectionId: 'collection_content_posts',
      itemId: 'wf_terminal_truth',
      externalState: 'draft',
      sourceGenerationRevision: expectedRevision,
    });
    mockWebflowSuccess('/collections/collection_content_posts/items/wf_terminal_truth', {});
    mockWebflowSuccess('/collections/collection_content_posts/items/publish', {
      publishedItemIds: ['wf_terminal_truth'],
    });
    const started = createResourceScopedJob(BACKGROUND_JOB_TYPES.CONTENT_PUBLISH, {
      workspaceId: wsId,
      resources: [{ resourceType: JOB_RESOURCE_TYPES.CONTENT_POST, resourceId: post.id }],
    });
    const realUpdateJob = jobsModule.updateJob;
    const terminalWrite = vi.spyOn(jobsModule, 'updateJob').mockImplementation((id, update) => {
      if (update.status === 'done') throw new Error('Injected done persistence failure');
      return realUpdateJob(id, update);
    });

    try {
      await expect(runContentPublishJob({
        jobId: started.job.id,
        workspaceId: wsId,
        postId: post.id,
        expectedRevision,
        authority: publishAuthorityFor(post.id),
      })).resolves.toBeUndefined();
    } finally {
      terminalWrite.mockRestore();
    }

    // The external publish and local CAS stamp are authoritative even though
    // the generic worker finalizer records an infrastructure terminal error.
    expect(getPost(wsId, post.id)).toMatchObject({
      webflowItemId: 'wf_terminal_truth',
      webflowCollectionId: 'collection_content_posts',
      publishedAt: expect.any(String),
      publishedSlug: 'terminal-truth-publish',
    });
    expect(listJobs(wsId).find(job => job.id === started.job.id)).toMatchObject({
      status: 'error',
      error: 'Injected done persistence failure',
      message: 'Post published, but completion tracking failed',
      result: {
        postId: post.id,
        itemId: 'wf_terminal_truth',
        code: 'completion_tracking_failed',
        artifactCommitted: true,
      },
    });

    // Reconciliation cleanup and every downstream success effect wait for a
    // verified `done`; no false publish-failure activity is emitted either.
    expect(getUnresolvedContentPublishReconciliation(
      wsId,
      post.id,
      'collection_content_posts',
    )).toMatchObject({ itemId: 'wf_terminal_truth', externalState: 'draft' });
    const activities = listActivity(wsId).filter(activity =>
      (activity.metadata as { postId?: string } | undefined)?.postId === post.id,
    );
    expect(activities.some(activity => activity.type === 'content_published')).toBe(false);
    expect(activities.some(activity => activity.type === 'content_publish_failed')).toBe(false);
    expect(broadcastState.calls.some(call => call.event === WS_EVENTS.CONTENT_PUBLISHED)).toBe(false);
    expect(queueKeywordStrategyPostUpdateFollowOns).not.toHaveBeenCalled();
  });

  it('keeps a publish job done when independently guarded success effects throw', async () => {
    configurePublishTarget();
    vi.mocked(queueKeywordStrategyPostUpdateFollowOns).mockClear();
    mockWebflowSuccess(/\/collections\/collection_content_posts\/items$/, { id: 'wf_effect_failure' });
    mockWebflowSuccess(/\/collections\/collection_content_posts\/items\/publish$/, {});
    const post = seedPost({ status: 'approved', title: 'Guarded Publish Effects' });
    const expectedRevision = getPost(wsId, post.id)!.generationRevision;
    const started = createResourceScopedJob(BACKGROUND_JOB_TYPES.CONTENT_PUBLISH, {
      workspaceId: wsId,
      resources: [{ resourceType: JOB_RESOURCE_TYPES.CONTENT_POST, resourceId: post.id }],
    });
    vi.mocked(broadcastToWorkspace).mockImplementationOnce(() => {
      throw new Error('Injected published broadcast failure');
    });
    vi.mocked(queueKeywordStrategyPostUpdateFollowOns).mockImplementationOnce(() => {
      throw new Error('Injected follow-on failure');
    });

    await runContentPublishJob({
      jobId: started.job.id,
      workspaceId: wsId,
      postId: post.id,
      expectedRevision,
      authority: publishAuthorityFor(post.id),
    });

    expect(listJobs(wsId).find(job => job.id === started.job.id)).toMatchObject({
      status: 'done',
      result: { postId: post.id, itemId: 'wf_effect_failure' },
    });
    expect(getPost(wsId, post.id)).toMatchObject({
      webflowItemId: 'wf_effect_failure',
      publishedAt: expect.any(String),
    });
    expect(listActivity(wsId)).toContainEqual(expect.objectContaining({
      type: 'content_published',
      metadata: expect.objectContaining({ postId: post.id }),
    }));
    expect(listActivity(wsId).some(activity =>
      activity.type === 'content_publish_failed'
      && (activity.metadata as { postId?: string } | undefined)?.postId === post.id,
    )).toBe(false);
    expect(queueKeywordStrategyPostUpdateFollowOns).toHaveBeenCalledWith({ workspaceId: wsId });
  });

  it('records a deterministic reconciliation failure when an auto-publish job loses revision authority', async () => {
    configurePublishTarget();
    const post = seedPost({ status: 'approved', title: 'Stale Auto Publish' });
    const acceptedRevision = getPost(wsId, post.id)!.generationRevision;
    const started = createResourceScopedJob(BACKGROUND_JOB_TYPES.CONTENT_PUBLISH, {
      workspaceId: wsId,
      resources: [{ resourceType: JOB_RESOURCE_TYPES.CONTENT_POST, resourceId: post.id }],
    });
    updatePostField(wsId, post.id, { title: 'Newer Operator Edit' }, acceptedRevision);

    await runContentPublishJob({
      jobId: started.job.id,
      workspaceId: wsId,
      postId: post.id,
      expectedRevision: acceptedRevision,
      authority: publishAuthorityFor(post.id),
    });

    const job = listJobs(wsId).find(candidate => candidate.id === started.job.id);
    expect(job).toMatchObject({
      status: 'error',
      result: {
        postId: post.id,
        status: 'error',
        code: 'local_revision_conflict',
      },
    });
    expect(getCapturedRequests()).toHaveLength(0);
    expect(getPost(wsId, post.id)).toMatchObject({
      title: 'Newer Operator Edit',
      webflowItemId: undefined,
      publishedAt: undefined,
    });
    expect(broadcastState.calls.some(call => call.event === WS_EVENTS.CONTENT_PUBLISHED)).toBe(false);
    const activities = listActivity(wsId).filter(activity =>
      (activity.metadata as { postId?: string } | undefined)?.postId === post.id,
    );
    expect(activities.some(activity => activity.type === 'content_published')).toBe(false);
    expect(activities).toContainEqual(expect.objectContaining({
      type: 'content_publish_failed',
      metadata: expect.objectContaining({ code: 'local_revision_conflict' }),
    }));
  });

  it('retries a retained draft Webflow item instead of reporting it as already published', async () => {
    configurePublishTarget();
    const post = seedPost({ status: 'approved', title: 'Retry Draft Publish' });
    const retained = updatePostField(wsId, post.id, {
      webflowItemId: 'wf_retained_draft',
      webflowCollectionId: 'collection_content_posts',
    }, getPost(wsId, post.id)!.generationRevision)!;
    mockWebflowSuccess('/collections/collection_content_posts/items/wf_retained_draft', {});
    mockWebflowSuccess('/collections/collection_content_posts/items/publish', {
      publishedItemIds: ['wf_retained_draft'],
    });
    const started = createResourceScopedJob(BACKGROUND_JOB_TYPES.CONTENT_PUBLISH, {
      workspaceId: wsId,
      resources: [{ resourceType: JOB_RESOURCE_TYPES.CONTENT_POST, resourceId: post.id }],
    });

    await runContentPublishJob({
      jobId: started.job.id,
      workspaceId: wsId,
      postId: post.id,
      expectedRevision: retained.generationRevision,
      authority: publishAuthorityFor(post.id),
    });

    const requests = getCapturedRequests();
    expect(requests).toContainEqual(expect.objectContaining({
      endpoint: '/collections/collection_content_posts/items/wf_retained_draft',
      method: 'PATCH',
    }));
    expect(requests).toContainEqual(expect.objectContaining({
      endpoint: '/collections/collection_content_posts/items/publish',
      method: 'POST',
    }));
    expect(getPost(wsId, post.id)).toMatchObject({
      webflowItemId: 'wf_retained_draft',
      webflowCollectionId: 'collection_content_posts',
      publishedAt: expect.any(String),
    });
    const job = listJobs(wsId).find(candidate => candidate.id === started.job.id);
    expect(job).toMatchObject({
      status: 'done',
      result: { postId: post.id, itemId: 'wf_retained_draft', isUpdate: true },
    });
  });

  it('does not report an older publish as success after a newer local edit', async () => {
    configurePublishTarget();
    const post = seedPost({ status: 'approved', title: 'Published Then Edited' });
    const acceptedRevision = getPost(wsId, post.id)!.generationRevision;
    const published = updatePostField(wsId, post.id, {
      webflowItemId: 'wf_already_live',
      webflowCollectionId: 'collection_content_posts',
      publishedAt: '2026-07-13T12:00:00.000Z',
      publishedSlug: 'published-then-edited',
    }, acceptedRevision)!;
    updatePostField(wsId, post.id, { title: 'Newer Unpublished Edit' }, published.generationRevision);
    const started = createResourceScopedJob(BACKGROUND_JOB_TYPES.CONTENT_PUBLISH, {
      workspaceId: wsId,
      resources: [{ resourceType: JOB_RESOURCE_TYPES.CONTENT_POST, resourceId: post.id }],
    });

    await runContentPublishJob({
      jobId: started.job.id,
      workspaceId: wsId,
      postId: post.id,
      expectedRevision: acceptedRevision,
      authority: publishAuthorityFor(post.id),
    });

    expect(getCapturedRequests()).toHaveLength(0);
    expect(getPost(wsId, post.id)).toMatchObject({
      title: 'Newer Unpublished Edit',
      webflowItemId: 'wf_already_live',
      publishedAt: '2026-07-13T12:00:00.000Z',
    });
    const job = listJobs(wsId).find(candidate => candidate.id === started.job.id);
    expect(job).toMatchObject({
      status: 'error',
      result: {
        postId: post.id,
        status: 'error',
        code: 'local_revision_conflict',
      },
    });
  });
});

describe('POST /api/content-posts/:workspaceId/:postId/publish-to-webflow', () => {
  it('keeps generateImage optional when a revision token is provided', async () => {
    configurePublishTarget();
    mockWebflowSuccess(/\/collections\/collection_content_posts\/items$/, { id: 'wf_no_body_item' });
    mockWebflowSuccess(/\/collections\/collection_content_posts\/items\/publish$/, {});
    const post = seedPost({ status: 'approved' });

    const res = await postJson(`/api/content-posts/${wsId}/${post.id}/publish-to-webflow`, {});
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

  it('returns a deterministic conflict code for a stale manual publish without success side effects', async () => {
    configurePublishTarget();
    const post = seedPost({ status: 'approved' });
    const before = getPost(wsId, post.id)!;

    const res = await postJson(`/api/content-posts/${wsId}/${post.id}/publish-to-webflow`, {
      expectedRevision: before.generationRevision + 1,
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: 'local_revision_conflict' });
    expect(getCapturedRequests()).toHaveLength(0);
    expect(getPost(wsId, post.id)).toMatchObject({
      generationRevision: before.generationRevision,
      webflowItemId: undefined,
      publishedAt: undefined,
    });
    expect(broadcastState.calls.some(call => call.event === WS_EVENTS.CONTENT_PUBLISHED)).toBe(false);
    expect(listActivity(wsId).some(activity =>
      activity.type === 'content_published'
      && (activity.metadata as { postId?: string } | undefined)?.postId === post.id,
    )).toBe(false);
  });

  it('rejects an incomplete artifact even when its stored status is publishable', async () => {
    configurePublishTarget();
    const post = seedPost({ status: 'approved' });
    db.prepare('UPDATE content_posts SET conclusion = ? WHERE workspace_id = ? AND id = ?')
      .run('', wsId, post.id);

    const res = await postJson(`/api/content-posts/${wsId}/${post.id}/publish-to-webflow`, {});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Post is incomplete and cannot be published',
      code: 'invalid_status',
    });
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

  it('permits only one manual publish owner and makes exactly one Webflow create/publish pair', async () => {
    configurePublishTarget();
    const createGate = mockWebflowDeferred(
      /\/collections\/collection_content_posts\/items$/,
      { id: 'wf_manual_owner' },
    );
    mockWebflowSuccess(/\/collections\/collection_content_posts\/items\/publish$/, {});
    const post = seedPost({ status: 'approved' });
    const revision = getPost(wsId, post.id)!.generationRevision;

    const ownerResponse = postJson(
      `/api/content-posts/${wsId}/${post.id}/publish-to-webflow`,
      { expectedRevision: revision },
    );
    await createGate.entered;
    const loserResponse = await postJson(
      `/api/content-posts/${wsId}/${post.id}/publish-to-webflow`,
      { expectedRevision: revision },
    );
    expect(loserResponse.status).toBe(409);
    await expect(loserResponse.json()).resolves.toMatchObject({
      code: 'active_job_resource_conflict',
      jobId: expect.any(String),
    });

    createGate.release();
    expect((await ownerResponse).status).toBe(200);
    const requests = getCapturedRequests();
    expect(requests.filter(request => request.method === 'POST'
      && request.endpoint === '/collections/collection_content_posts/items')).toHaveLength(1);
    expect(requests.filter(request => request.method === 'POST'
      && request.endpoint === '/collections/collection_content_posts/items/publish')).toHaveLength(1);
  });

  it('shares the same publish owner between HTTP and MCP', async () => {
    configurePublishTarget();
    const createGate = mockWebflowDeferred(
      /\/collections\/collection_content_posts\/items$/,
      { id: 'wf_http_mcp_owner' },
    );
    mockWebflowSuccess(/\/collections\/collection_content_posts\/items\/publish$/, {});
    const post = seedPost({ status: 'approved' });
    const revision = getPost(wsId, post.id)!.generationRevision;

    const ownerResponse = postJson(
      `/api/content-posts/${wsId}/${post.id}/publish-to-webflow`,
      { expectedRevision: revision },
    );
    await createGate.entered;
    const mcpResponse = await handleContentActionTool('publish_post', {
      workspace_id: wsId,
      post_id: post.id,
      expected_revision: revision,
    });
    expect(mcpResponse.isError).toBe(true);
    expect(mcpResponse.content[0].text).toContain('active_job_resource_conflict');

    createGate.release();
    expect((await ownerResponse).status).toBe(200);
    const requests = getCapturedRequests();
    expect(requests.filter(request => request.method === 'POST'
      && request.endpoint === '/collections/collection_content_posts/items')).toHaveLength(1);
    expect(requests.filter(request => request.method === 'POST'
      && request.endpoint === '/collections/collection_content_posts/items/publish')).toHaveLength(1);
  });

  it('fails an accepted deferred publish closed when canonical Webflow config drifts before execution', async () => {
    configurePublishTarget();
    const post = seedPost({ status: 'approved', title: 'Deferred config authority' });
    const expectedRevision = getPost(wsId, post.id)!.generationRevision;
    const started = createContentPublishJob({
      workspaceId: wsId,
      postId: post.id,
      expectedRevision,
    });

    configurePublishTarget({ bodyField: 'replacement-post-body' });
    await runContentPublishJob({
      jobId: started.job.id,
      workspaceId: wsId,
      postId: post.id,
      expectedRevision,
      authority: started.accepted.authority,
    });

    expect(getCapturedRequests()).toHaveLength(0);
    expect(listJobs(wsId).find(job => job.id === started.job.id)).toMatchObject({
      status: 'error',
      result: {
        postId: post.id,
        status: 'error',
        code: 'publish_config_conflict',
      },
    });
    expect(getPost(wsId, post.id)).toMatchObject({
      webflowItemId: undefined,
      publishedAt: undefined,
    });
  });

  it('records draft reconciliation when Webflow config drifts during create', async () => {
    configurePublishTarget();
    const createGate = mockWebflowDeferred(
      '/collections/collection_content_posts/items',
      { id: 'wf_config_drift_draft' },
    );
    const post = seedPost({ status: 'approved', title: 'Config drift during create' });
    const sourceRevision = getPost(wsId, post.id)!.generationRevision;

    const responsePromise = postJson(
      `/api/content-posts/${wsId}/${post.id}/publish-to-webflow`,
      { expectedRevision: sourceRevision },
    );
    await createGate.entered;
    configurePublishTarget({ token: 'replacement-webflow-token' });
    createGate.release();

    const response = await responsePromise;
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'publish_config_conflict',
      reconciliation: {
        itemId: 'wf_config_drift_draft',
        collectionId: 'collection_content_posts',
        externalState: 'draft',
        sourceRevision,
      },
    });
    expect(getCapturedRequests().filter(request =>
      request.endpoint.endsWith('/items/publish'),
    )).toHaveLength(0);
    expect(getPost(wsId, post.id)).toMatchObject({
      webflowItemId: undefined,
      publishedAt: undefined,
    });
    expect(getUnresolvedContentPublishReconciliation(
      wsId,
      post.id,
      'collection_content_posts',
    )).toMatchObject({ itemId: 'wf_config_drift_draft', externalState: 'draft' });
  });

  it('records live reconciliation instead of local success when site authority drifts during publish-live', async () => {
    configurePublishTarget();
    mockWebflowSuccess(
      '/collections/collection_content_posts/items',
      { id: 'wf_config_drift_live' },
    );
    const publishGate = mockWebflowDeferred(
      '/collections/collection_content_posts/items/publish',
      { publishedItemIds: ['wf_config_drift_live'] },
    );
    const post = seedPost({ status: 'approved', title: 'Config drift during publish-live' });
    const sourceRevision = getPost(wsId, post.id)!.generationRevision;

    const responsePromise = postJson(
      `/api/content-posts/${wsId}/${post.id}/publish-to-webflow`,
      { expectedRevision: sourceRevision },
    );
    await publishGate.entered;
    configurePublishTarget({
      siteId: 'replacement_webflow_site',
      token: 'replacement-site-token',
    });
    publishGate.release();

    const response = await responsePromise;
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'publish_config_conflict',
      reconciliation: {
        itemId: 'wf_config_drift_live',
        collectionId: 'collection_content_posts',
        externalState: 'published',
        sourceRevision,
      },
    });
    expect(getPost(wsId, post.id)).toMatchObject({
      webflowItemId: undefined,
      publishedAt: undefined,
    });
    expect(getUnresolvedContentPublishReconciliation(
      wsId,
      post.id,
      'collection_content_posts',
    )).toMatchObject({ itemId: 'wf_config_drift_live', externalState: 'published' });
  });

  it('pins the CMS summary to its claimed brief revision and reconciles a post-publish brief edit', async () => {
    configurePublishTarget({ summary: true });
    const briefId = `brief_publish_authority_${Date.now()}`;
    const originalSummary = 'The exact summary captured by the publish claim.';
    seedWorkflowBrief(briefId, originalSummary);
    mockWebflowSuccess('/collections/collection_content_posts/items', { id: 'wf_brief_drift_live' });
    const publishGate = mockWebflowDeferred(
      '/collections/collection_content_posts/items/publish',
      { publishedItemIds: ['wf_brief_drift_live'] },
    );
    const post = seedPost({ briefId, status: 'approved', title: 'Brief authority publish' });
    const sourceRevision = getPost(wsId, post.id)!.generationRevision;

    const responsePromise = postJson(
      `/api/content-posts/${wsId}/${post.id}/publish-to-webflow`,
      { expectedRevision: sourceRevision },
    );
    await publishGate.entered;
    const publishJob = latestPublishJob();
    expect(getJobResourceClaims(publishJob.id)).toContainEqual(expect.objectContaining({
      resourceType: JOB_RESOURCE_TYPES.CONTENT_BRIEF,
      resourceId: briefId,
      active: true,
    }));
    const briefRevision = getBrief(wsId, briefId)!.generationRevision;
    updateBriefAtRevision(wsId, briefId, briefRevision, {
      executiveSummary: 'A newer operator-authored summary.',
    });
    publishGate.release();

    const response = await responsePromise;
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'brief_revision_conflict',
      reconciliation: {
        itemId: 'wf_brief_drift_live',
        externalState: 'published',
        sourceRevision,
      },
    });
    const createRequest = getCapturedRequests().find(request =>
      request.endpoint === '/collections/collection_content_posts/items',
    );
    expect(createRequest?.body).toMatchObject({
      fieldData: { excerpt: originalSummary },
    });
    expect(getPost(wsId, post.id)).toMatchObject({
      webflowItemId: undefined,
      publishedAt: undefined,
    });
    expect(getUnresolvedContentPublishReconciliation(
      wsId,
      post.id,
      'collection_content_posts',
    )).toMatchObject({ itemId: 'wf_brief_drift_live', externalState: 'published' });
  });

  it('never creates in a new target while another collection has unresolved external identity', async () => {
    configurePublishTarget({ collectionId: 'collection_new_target' });
    const post = seedPost({ status: 'approved', title: 'Unresolved collection switch' });
    const sourceRevision = getPost(wsId, post.id)!.generationRevision;
    recordContentPublishReconciliation({
      workspaceId: wsId,
      postId: post.id,
      collectionId: 'collection_old_target',
      itemId: 'wf_old_unresolved',
      externalState: 'draft',
      sourceGenerationRevision: sourceRevision,
    });

    const response = await postJson(
      `/api/content-posts/${wsId}/${post.id}/publish-to-webflow`,
      { expectedRevision: sourceRevision },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'publish_target_conflict' });
    expect(getCapturedRequests()).toHaveLength(0);
  });

  it.each([
    ['a different collection', 'wf_stamped_old_target', 'collection_old_target'],
    ['a missing collection stamp', 'wf_partial_target', null],
    ['a missing item stamp', null, 'collection_old_target'],
  ])('never creates when local Webflow identity has %s', async (_case, itemId, collectionId) => {
    configurePublishTarget({ collectionId: 'collection_new_target' });
    const post = seedPost({ status: 'approved', title: `Target identity ${_case}` });
    db.prepare(`
      UPDATE content_posts
      SET webflow_item_id = ?, webflow_collection_id = ?
      WHERE workspace_id = ? AND id = ?
    `).run(itemId, collectionId, wsId, post.id);
    const sourceRevision = getPost(wsId, post.id)!.generationRevision;

    const response = await postJson(
      `/api/content-posts/${wsId}/${post.id}/publish-to-webflow`,
      { expectedRevision: sourceRevision },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'publish_target_conflict' });
    expect(getCapturedRequests()).toHaveLength(0);
  });

  it('commits approval while another post claimant is active and permits a later honest publish retry', async () => {
    configurePublishTarget();
    const postClaimTypes = [
      BACKGROUND_JOB_TYPES.CONTENT_POST_REVIEW,
      BACKGROUND_JOB_TYPES.CONTENT_POST_FIX,
      BACKGROUND_JOB_TYPES.CONTENT_POST_VOICE_SCORE,
    ] as const;

    for (const [index, type] of postClaimTypes.entries()) {
      const post = seedPost({ status: 'review', title: `Busy approval ${index}` });
      const before = getPost(wsId, post.id)!;
      const owner = createResourceScopedJob(type, {
        workspaceId: wsId,
        resources: [{ resourceType: JOB_RESOURCE_TYPES.CONTENT_POST, resourceId: post.id }],
      });
      const response = await patchJson(`/api/content-posts/${wsId}/${post.id}`, {
        status: 'approved',
        expectedRevision: before.generationRevision,
      });
      expect(response.status).toBe(200);
      expect(getPost(wsId, post.id)).toMatchObject({
        status: 'approved',
        generationRevision: before.generationRevision + 1,
      });
      expect(getCapturedRequests()).toHaveLength(0);
      updateJob(owner.job.id, { status: 'error', error: 'provider work lost to approval' });

      mockWebflowSuccess(/\/collections\/collection_content_posts\/items$/, { id: `wf_retry_${index}` });
      mockWebflowSuccess(/\/collections\/collection_content_posts\/items\/publish$/, {});
      const retry = await postJson(`/api/content-posts/${wsId}/${post.id}/publish-to-webflow`, {
        expectedRevision: getPost(wsId, post.id)!.generationRevision,
      });
      expect(retry.status).toBe(200);
      setupWebflowMocks();
    }
  });

  it('retains a draft Webflow identity after a create/edit race and reuses it on retry', async () => {
    configurePublishTarget();
    const createGate = mockWebflowDeferred(
      /\/collections\/collection_content_posts\/items$/,
      { id: 'wf_reconcile_draft' },
    );
    const post = seedPost({ status: 'approved', title: 'Draft reconciliation source' });
    const sourceRevision = getPost(wsId, post.id)!.generationRevision;

    const publishResponse = postJson(
      `/api/content-posts/${wsId}/${post.id}/publish-to-webflow`,
      { expectedRevision: sourceRevision },
    );
    await createGate.entered;
    updatePostField(wsId, post.id, { title: 'Newer local title' }, sourceRevision);
    createGate.release();

    const conflicted = await publishResponse;
    expect(conflicted.status).toBe(409);
    await expect(conflicted.json()).resolves.toMatchObject({
      code: 'local_revision_conflict',
      reconciliation: {
        itemId: 'wf_reconcile_draft',
        externalState: 'draft',
        sourceRevision,
      },
    });
    expect(getUnresolvedContentPublishReconciliation(
      wsId,
      post.id,
      'collection_content_posts',
    )).toMatchObject({ itemId: 'wf_reconcile_draft', externalState: 'draft' });
    expect(listActivity(wsId).some(activity =>
      activity.type === 'content_published'
      && (activity.metadata as { postId?: string } | undefined)?.postId === post.id,
    )).toBe(false);

    mockWebflowSuccess('/collections/collection_content_posts/items/wf_reconcile_draft', {});
    mockWebflowSuccess('/collections/collection_content_posts/items/publish', {});
    const retry = await postJson(`/api/content-posts/${wsId}/${post.id}/publish-to-webflow`, {
      expectedRevision: getPost(wsId, post.id)!.generationRevision,
    });
    expect(retry.status).toBe(200);
    const requests = getCapturedRequests();
    expect(requests.filter(request => request.method === 'POST'
      && request.endpoint === '/collections/collection_content_posts/items')).toHaveLength(1);
    expect(requests).toContainEqual(expect.objectContaining({
      method: 'PATCH',
      endpoint: '/collections/collection_content_posts/items/wf_reconcile_draft',
    }));
    expect(getUnresolvedContentPublishReconciliation(
      wsId,
      post.id,
      'collection_content_posts',
    )).toBeNull();
  });

  it('retains a live Webflow identity after a publish/edit race and never creates a duplicate', async () => {
    configurePublishTarget();
    mockWebflowSuccess(/\/collections\/collection_content_posts\/items$/, { id: 'wf_reconcile_live' });
    const publishGate = mockWebflowDeferred(
      /\/collections\/collection_content_posts\/items\/publish$/,
      {},
    );
    const post = seedPost({ status: 'approved', title: 'Live reconciliation source' });
    const sourceRevision = getPost(wsId, post.id)!.generationRevision;

    const publishResponse = postJson(
      `/api/content-posts/${wsId}/${post.id}/publish-to-webflow`,
      { expectedRevision: sourceRevision },
    );
    await publishGate.entered;
    updatePostField(wsId, post.id, { title: 'Newer title during publish' }, sourceRevision);
    publishGate.release();

    const conflicted = await publishResponse;
    expect(conflicted.status).toBe(409);
    await expect(conflicted.json()).resolves.toMatchObject({
      code: 'local_revision_conflict',
      reconciliation: { itemId: 'wf_reconcile_live', externalState: 'published' },
    });
    expect(getUnresolvedContentPublishReconciliation(
      wsId,
      post.id,
      'collection_content_posts',
    )).toMatchObject({ itemId: 'wf_reconcile_live', externalState: 'published' });

    mockWebflowSuccess('/collections/collection_content_posts/items/wf_reconcile_live', {});
    mockWebflowSuccess('/collections/collection_content_posts/items/publish', {});
    const retry = await postJson(`/api/content-posts/${wsId}/${post.id}/publish-to-webflow`, {
      expectedRevision: getPost(wsId, post.id)!.generationRevision,
    });
    expect(retry.status).toBe(200);
    const requests = getCapturedRequests();
    expect(requests.filter(request => request.method === 'POST'
      && request.endpoint === '/collections/collection_content_posts/items')).toHaveLength(1);
    expect(requests).toContainEqual(expect.objectContaining({
      method: 'PATCH',
      endpoint: '/collections/collection_content_posts/items/wf_reconcile_live',
    }));
    expect(getUnresolvedContentPublishReconciliation(
      wsId,
      post.id,
      'collection_content_posts',
    )).toBeNull();
  });

  it('retains a draft Webflow identity when the local partial stamp throws and reuses it on retry', async () => {
    configurePublishTarget();
    mockWebflowSuccess(/\/collections\/collection_content_posts\/items$/, { id: 'wf_stamp_failure_draft' });
    mockWebflowError(
      /\/collections\/collection_content_posts\/items\/publish$/,
      500,
      'Injected Webflow publish failure',
    );
    const post = seedPost({ status: 'approved', title: 'Draft stamp failure source' });
    const sourceRevision = getPost(wsId, post.id)!.generationRevision;
    const escapedPostId = post.id.replaceAll("'", "''");
    db.exec(`
      DROP TRIGGER IF EXISTS test_fail_content_post_publish_stamp;
      CREATE TEMP TRIGGER test_fail_content_post_publish_stamp
      BEFORE UPDATE ON content_posts
      WHEN OLD.id = '${escapedPostId}'
      BEGIN
        SELECT RAISE(ABORT, 'injected local publish stamp failure');
      END;
    `);

    let response: Response;
    try {
      response = await postJson(
        `/api/content-posts/${wsId}/${post.id}/publish-to-webflow`,
        { expectedRevision: sourceRevision },
      );
    } finally {
      db.exec('DROP TRIGGER IF EXISTS test_fail_content_post_publish_stamp');
    }

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: 'local_stamp_failed',
      reconciliation: {
        itemId: 'wf_stamp_failure_draft',
        externalState: 'draft',
        sourceRevision,
      },
    });
    expect(getPost(wsId, post.id)).toMatchObject({
      webflowItemId: undefined,
      publishedAt: undefined,
      generationRevision: sourceRevision,
    });
    expect(getUnresolvedContentPublishReconciliation(
      wsId,
      post.id,
      'collection_content_posts',
    )).toMatchObject({ itemId: 'wf_stamp_failure_draft', externalState: 'draft' });
    expect(broadcastState.calls.some(call => call.event === WS_EVENTS.CONTENT_PUBLISHED)).toBe(false);

    mockWebflowSuccess('/collections/collection_content_posts/items/wf_stamp_failure_draft', {});
    mockWebflowSuccess('/collections/collection_content_posts/items/publish', {});
    const retry = await postJson(`/api/content-posts/${wsId}/${post.id}/publish-to-webflow`, {
      expectedRevision: getPost(wsId, post.id)!.generationRevision,
    });

    expect(retry.status).toBe(200);
    const requests = getCapturedRequests();
    expect(requests.filter(request => request.method === 'POST'
      && request.endpoint === '/collections/collection_content_posts/items')).toHaveLength(1);
    expect(requests).toContainEqual(expect.objectContaining({
      method: 'PATCH',
      endpoint: '/collections/collection_content_posts/items/wf_stamp_failure_draft',
    }));
    expect(getUnresolvedContentPublishReconciliation(
      wsId,
      post.id,
      'collection_content_posts',
    )).toBeNull();
  });

  it('retains a live Webflow identity when the local final stamp throws and never creates a duplicate', async () => {
    configurePublishTarget();
    mockWebflowSuccess(/\/collections\/collection_content_posts\/items$/, { id: 'wf_stamp_failure_live' });
    mockWebflowSuccess(/\/collections\/collection_content_posts\/items\/publish$/, {});
    const post = seedPost({ status: 'approved', title: 'Live stamp failure source' });
    const sourceRevision = getPost(wsId, post.id)!.generationRevision;
    const escapedPostId = post.id.replaceAll("'", "''");
    db.exec(`
      DROP TRIGGER IF EXISTS test_fail_content_post_publish_stamp;
      CREATE TEMP TRIGGER test_fail_content_post_publish_stamp
      BEFORE UPDATE ON content_posts
      WHEN OLD.id = '${escapedPostId}'
      BEGIN
        SELECT RAISE(ABORT, 'injected local publish stamp failure');
      END;
    `);

    let response: Response;
    try {
      response = await postJson(
        `/api/content-posts/${wsId}/${post.id}/publish-to-webflow`,
        { expectedRevision: sourceRevision },
      );
    } finally {
      db.exec('DROP TRIGGER IF EXISTS test_fail_content_post_publish_stamp');
    }

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: 'local_stamp_failed',
      reconciliation: {
        itemId: 'wf_stamp_failure_live',
        externalState: 'published',
        sourceRevision,
      },
    });
    expect(getPost(wsId, post.id)).toMatchObject({
      webflowItemId: undefined,
      publishedAt: undefined,
      generationRevision: sourceRevision,
    });
    expect(getUnresolvedContentPublishReconciliation(
      wsId,
      post.id,
      'collection_content_posts',
    )).toMatchObject({ itemId: 'wf_stamp_failure_live', externalState: 'published' });
    expect(broadcastState.calls.some(call => call.event === WS_EVENTS.CONTENT_PUBLISHED)).toBe(false);

    mockWebflowSuccess('/collections/collection_content_posts/items/wf_stamp_failure_live', {});
    const retry = await postJson(`/api/content-posts/${wsId}/${post.id}/publish-to-webflow`, {
      expectedRevision: getPost(wsId, post.id)!.generationRevision,
    });

    expect(retry.status).toBe(200);
    const requests = getCapturedRequests();
    expect(requests.filter(request => request.method === 'POST'
      && request.endpoint === '/collections/collection_content_posts/items')).toHaveLength(1);
    expect(requests).toContainEqual(expect.objectContaining({
      method: 'PATCH',
      endpoint: '/collections/collection_content_posts/items/wf_stamp_failure_live',
    }));
    expect(getUnresolvedContentPublishReconciliation(
      wsId,
      post.id,
      'collection_content_posts',
    )).toBeNull();
  });

  it('rejects deletion while a claimed Webflow publish is in flight', async () => {
    configurePublishTarget();
    const createGate = mockWebflowDeferred(
      /\/collections\/collection_content_posts\/items$/,
      { id: 'wf_delete_race_guard' },
    );
    mockWebflowSuccess(/\/collections\/collection_content_posts\/items\/publish$/, {});
    const post = seedPost({ status: 'approved', title: 'Publish delete race guard' });
    const sourceRevision = getPost(wsId, post.id)!.generationRevision;

    const publishResponse = postJson(
      `/api/content-posts/${wsId}/${post.id}/publish-to-webflow`,
      { expectedRevision: sourceRevision },
    );
    await createGate.entered;

    const deleteResponse = await api(`/api/content-posts/${wsId}/${post.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: sourceRevision }),
    });
    expect(deleteResponse.status).toBe(409);
    await expect(deleteResponse.json()).resolves.toMatchObject({
      code: 'active_job_resource_conflict',
      jobId: expect.any(String),
    });
    expect(getPost(wsId, post.id)).toBeDefined();

    createGate.release();
    const published = await publishResponse;
    expect(published.status).toBe(200);
    expect(getPost(wsId, post.id)).toMatchObject({
      webflowItemId: 'wf_delete_race_guard',
      publishedAt: expect.any(String),
    });
  });
});
