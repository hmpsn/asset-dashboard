/**
 * Field-map parity contract (C3, audit item #12).
 *
 * Before C3 the auto-publish-on-approval path wrote a STRICT SUBSET of the Webflow field map
 * (missing `summary` from the brief and `featuredImage`), while the manual publish route wrote the
 * superset. Both paths now route through the SAME `publishPostToWebflow()` service, so the
 * `fieldData` sent to Webflow is identical for identical inputs.
 *
 * This test exercises BOTH publish entry points against an identical post + publish target (with
 * `summary` + `featuredImage` mapped) and asserts the captured Webflow create payload's `fieldData`
 * carries the full superset — proving the auto-publish subset drift is gone.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

import {
  setupWebflowMocks,
  mockWebflowSuccess,
  getCapturedRequests,
  resetWebflowMocks,
} from '../mocks/webflow.js';

setupWebflowMocks();

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

// Stub follow-on jobs so they don't fire extra Webflow calls that pollute the captured-request set.
vi.mock('../../server/keyword-strategy-follow-ons.js', () => ({
  queueKeywordStrategyPostUpdateFollowOns: vi.fn(),
}));

vi.mock('../../server/content-image.js', () => ({
  generateFeaturedImage: vi.fn(async () => ({
    success: true,
    hostedUrl: 'https://cdn.example.com/featured.jpg',
  })),
}));

// Outcome baseline capture hits GSC — stub it so publish doesn't make live network calls.
vi.mock('../../server/outcome-measurement.js', () => ({
  captureBaselineFromGsc: vi.fn(async () => undefined),
}));

import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { savePost } from '../../server/content-posts-db.js';
import { upsertBrief } from '../../server/content-brief.js';
import db from '../../server/db/index.js';
import type { ContentBrief, GeneratedPost, PostSection } from '../../shared/types/content.js';

let baseUrl = '';
let server: http.Server | undefined;
let wsId = '';

const COLLECTION_ID = 'collection_parity';
const CREATE_ENDPOINT = /\/collections\/collection_parity\/items$/;
const PUBLISH_ENDPOINT = /\/collections\/collection_parity\/items\/publish$/;

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

function section(index: number): PostSection {
  return {
    index,
    heading: `Section ${index + 1}`,
    content: `<p>Body ${index + 1}.</p>`,
    wordCount: 4,
    targetWordCount: 200,
    keywords: ['parity'],
    status: 'done',
  };
}

const BRIEF_SUMMARY = 'This is the brief executive summary used as the CMS excerpt.';

function seedBrief(briefId: string): void {
  const brief: ContentBrief = {
    id: briefId,
    workspaceId: wsId,
    targetKeyword: 'parity keyword',
    secondaryKeywords: [],
    suggestedTitle: 'Parity Brief',
    suggestedMetaDesc: 'Parity brief meta.',
    outline: [],
    wordCountTarget: 900,
    intent: 'informational',
    audience: 'general',
    competitorInsights: '',
    internalLinkSuggestions: [],
    createdAt: new Date().toISOString(),
    executiveSummary: BRIEF_SUMMARY,
  };
  upsertBrief(wsId, brief);
}

function seedPost(briefId: string, status: GeneratedPost['status']): GeneratedPost {
  const now = new Date().toISOString();
  const post: GeneratedPost = {
    id: `post_parity_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    workspaceId: wsId,
    briefId,
    targetKeyword: 'parity keyword',
    title: 'Parity Coverage Post',
    metaDescription: 'Parity meta description.',
    introduction: '<p>Intro.</p>',
    sections: [section(0), section(1)],
    conclusion: '<p>Conclusion.</p>',
    seoTitle: 'Parity SEO Title',
    seoMetaDescription: 'Parity SEO meta description.',
    totalWordCount: 12,
    targetWordCount: 900,
    status,
    createdAt: now,
    updatedAt: now,
  };
  savePost(wsId, post);
  return post;
}

function configurePublishTarget(): void {
  updateWorkspace(wsId, {
    webflowSiteId: 'site_parity',
    webflowToken: 'wf-token-parity',
    publishTarget: {
      collectionId: COLLECTION_ID,
      collectionName: 'Parity Blog',
      fieldMap: {
        title: 'name',
        slug: 'slug',
        body: 'post-body',
        metaTitle: 'seo-title',
        metaDescription: 'seo-description',
        summary: 'excerpt',
        featuredImage: 'featured-image',
        publishDate: 'published-on',
      },
    },
  });
}

async function patchJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for condition');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function capturedCreateFieldData(): Record<string, unknown> {
  const create = getCapturedRequests().find(r => CREATE_ENDPOINT.test(r.endpoint) && r.method === 'POST');
  expect(create, 'expected a Webflow create request').toBeTruthy();
  const body = create!.body as { fieldData?: Record<string, unknown> };
  expect(body.fieldData, 'create body must carry fieldData').toBeTruthy();
  return body.fieldData!;
}

beforeAll(async () => {
  await startTestServer();
  wsId = createWorkspace('Publish Parity Workspace').id;
});

beforeEach(() => {
  setupWebflowMocks();
  mockWebflowSuccess(CREATE_ENDPOINT, { id: 'wf_parity_item' });
  mockWebflowSuccess(PUBLISH_ENDPOINT, {});
});

afterAll(async () => {
  resetWebflowMocks();
  db.prepare('DELETE FROM content_post_versions WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM content_posts WHERE workspace_id = ?').run(wsId);
  deleteWorkspace(wsId);
  await stopTestServer();
});

describe('publish field-map parity', () => {
  it('manual publish sends the full superset field map (summary + featuredImage)', async () => {
    configurePublishTarget();
    const briefId = `brief_parity_manual_${Date.now()}`;
    seedBrief(briefId);
    const post = seedPost(briefId, 'approved');

    const res = await postJson(`/api/content-posts/${wsId}/${post.id}/publish-to-webflow`, { generateImage: true });
    expect(res.status).toBe(200);

    const fieldData = capturedCreateFieldData();
    // Superset fields — summary (from brief) + featuredImage are the ones auto-publish used to drop.
    expect(fieldData['name']).toBe('Parity Coverage Post');
    expect(fieldData['slug']).toBeTruthy();
    expect(fieldData['post-body']).toBeTruthy();
    expect(fieldData['seo-title']).toBe('Parity SEO Title');
    expect(fieldData['seo-description']).toBe('Parity SEO meta description.');
    expect(fieldData['published-on']).toBeTruthy();
    expect(fieldData['excerpt']).toBe(BRIEF_SUMMARY);
    expect(fieldData['featured-image']).toEqual({ url: 'https://cdn.example.com/featured.jpg' });
  });

  it('auto-publish-on-approval sends the SAME superset field map via the shared service', async () => {
    configurePublishTarget();
    const briefId = `brief_parity_auto_${Date.now()}`;
    seedBrief(briefId);
    const post = seedPost(briefId, 'review');

    const res = await patchJson(`/api/content-posts/${wsId}/${post.id}`, { status: 'approved' });
    expect(res.status).toBe(200);

    // Auto-publish runs as a background job — wait for the Webflow create to land.
    await waitFor(() => getCapturedRequests().some(r => CREATE_ENDPOINT.test(r.endpoint)));

    const fieldData = capturedCreateFieldData();
    // The brief summary is the proof: the OLD auto-publish path never populated it.
    expect(fieldData['excerpt']).toBe(BRIEF_SUMMARY);
    expect(fieldData['name']).toBe('Parity Coverage Post');
    expect(fieldData['slug']).toBeTruthy();
    expect(fieldData['post-body']).toBeTruthy();
    expect(fieldData['seo-title']).toBe('Parity SEO Title');
    expect(fieldData['seo-description']).toBe('Parity SEO meta description.');
    expect(fieldData['published-on']).toBeTruthy();
  });
});
