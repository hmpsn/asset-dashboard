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
  getCapturedRequests,
  resetWebflowMocks,
} from '../mocks/webflow.js';

setupWebflowMocks();

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

import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { getPost, savePost } from '../../server/content-posts-db.js';
import db from '../../server/db/index.js';
import type { GeneratedPost, PostSection } from '../../shared/types/content.js';
import { WS_EVENTS } from '../../server/ws-events.js';

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

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for condition');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
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
        },
      },
    });
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
});
