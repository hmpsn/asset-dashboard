/**
 * Journey Test — Content Publishing Pipeline
 *
 * Tests the full content publishing journey: draft post exists → publish to
 * Webflow CMS → post marked published → verifiable state.
 *
 * Failure modes covered:
 *   FM-2  — Phantom success: CMS publish step fails but post is still marked published
 *   FM-12 — Broken chain: publish succeeds but local state not updated
 *
 * Architecture: in-process HTTP via createApp() + http.createServer() so that
 * vi.mock interceptors apply to the Webflow client and broadcast modules.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import db from '../../server/db/index.js';
import {
  setupWebflowMocks,
  mockWebflowSuccess,
  mockWebflowError,
  getCapturedRequests,
  resetWebflowMocks,
} from '../mocks/webflow.js';
import { seedContentData } from '../fixtures/content-seed.js';
import type { SeededContent } from '../fixtures/content-seed.js';
import { getPost } from '../../server/content-posts.js';

// ── Module-scope mock setup (hoisted by Vitest) ───────────────────────────
setupWebflowMocks();

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

// ── Constants ─────────────────────────────────────────────────────────────
const TEST_SITE_ID = 'site_journey_pub';
const TEST_COLLECTION_ID = 'col_journey_pub';
const TEST_ITEM_ID = 'item_journey_001';
const TEST_TOKEN = 'test-webflow-token';

const PUBLISH_TARGET = JSON.stringify({
  collectionId: TEST_COLLECTION_ID,
  collectionName: 'Blog',
  fieldMap: { title: 'name', slug: 'slug', body: 'post-body' },
});

// ── In-process server helper ──────────────────────────────────────────────

async function startTestServer(): Promise<{
  server: http.Server;
  baseUrl: string;
  stop: () => void;
}> {
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}`, stop: () => server.close() };
}

async function postJson(
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const responseBody = await res.json().catch(() => ({}));
  return { status: res.status, body: responseBody };
}

// ── Seed helpers ──────────────────────────────────────────────────────────

/**
 * Create a workspace fully configured for publishing:
 * webflow_site_id, webflow_token, publish_target all set.
 */
function seedPublishableContent(): SeededContent {
  const seeded = seedContentData();
  db.prepare(
    `UPDATE workspaces
     SET webflow_site_id = ?, webflow_token = ?, publish_target = ?
     WHERE id = ?`,
  ).run(TEST_SITE_ID, TEST_TOKEN, PUBLISH_TARGET, seeded.workspaceId);
  // Ensure post is in draft status (seedContentData already does this, but be explicit)
  db.prepare(`UPDATE content_posts SET status = 'draft' WHERE id = ?`).run(seeded.postId);
  return seeded;
}

// ── Journey test suite ────────────────────────────────────────────────────

describe('Journey: Content Publish Pipeline', () => {
  let content: SeededContent;
  let baseUrl: string;
  let stopServer: () => void;

  beforeEach(async () => {
    resetWebflowMocks();
    content = seedPublishableContent();
    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    stopServer = srv.stop;
  });

  afterEach(() => {
    stopServer();
    content.cleanup();
  });

  // ── 1. Happy path: draft → published with all state correctly written ───

  it('happy path: draft post is published with all state fields written', async () => {
    // Arrange: Webflow CMS create + publish both succeed
    mockWebflowSuccess(`/collections/${TEST_COLLECTION_ID}/items`, { id: TEST_ITEM_ID });
    mockWebflowSuccess(`/collections/${TEST_COLLECTION_ID}/items/publish`, {
      publishedItemIds: [TEST_ITEM_ID],
    });

    // Act: publish the post
    const { status, body } = await postJson(
      baseUrl,
      `/api/content-posts/${content.workspaceId}/${content.postId}/publish-to-webflow`,
      {},
    );

    // Assert: route returns success
    expect(status).toBe(200);
    const resp = body as {
      success: boolean;
      itemId: string;
      slug: string;
      isUpdate: boolean;
      post: { webflowItemId: string; publishedAt: string; publishedSlug: string };
    };
    expect(resp.success).toBe(true);
    expect(resp.itemId).toBe(TEST_ITEM_ID);
    expect(resp.isUpdate).toBe(false);
    expect(resp.slug).toBeDefined();
    expect(resp.slug.length).toBeGreaterThan(0);

    // Assert: post record has all publish fields set

    const post = getPost(content.workspaceId, content.postId);
    expect(post).toBeDefined();
    expect(post!.webflowItemId).toBe(TEST_ITEM_ID);
    expect(post!.publishedAt).toBeDefined();
    expect(() => new Date(post!.publishedAt!).toISOString()).not.toThrow();
    expect(post!.publishedSlug).toBeDefined();
    expect(post!.publishedSlug!.length).toBeGreaterThan(0);

    // Assert: Webflow received correct field data via the fieldMap
    const requests = getCapturedRequests();
    const createReq = requests.find(
      (r) => r.endpoint === `/collections/${TEST_COLLECTION_ID}/items` && r.method === 'POST',
    );
    expect(createReq).toBeDefined();
    const fieldData = (createReq!.body as { fieldData: Record<string, unknown> }).fieldData;
    // fieldMap maps title→'name', slug→'slug', body→'post-body'
    expect(fieldData['name']).toBe(post!.title);
    expect(fieldData['slug']).toBe(resp.slug);
    expect(typeof fieldData['post-body']).toBe('string');
    expect((fieldData['post-body'] as string).length).toBeGreaterThan(0);
  });

  // ── 2. Chain integrity: CMS create fails → post NOT published (FM-2) ────

  it('FM-2 guard: CMS item creation failure prevents post from being marked published', async () => {
    // Arrange: Webflow CMS create fails
    mockWebflowError(`/collections/${TEST_COLLECTION_ID}/items`, 500, 'Internal Server Error');

    // Act
    const { status, body } = await postJson(
      baseUrl,
      `/api/content-posts/${content.workspaceId}/${content.postId}/publish-to-webflow`,
      {},
    );

    // Assert: route returns 500
    expect(status).toBe(500);
    expect((body as { error: string }).error).toContain('Failed to create CMS item');

    // Assert: post is NOT marked as published — no phantom success

    const post = getPost(content.workspaceId, content.postId);
    expect(post).toBeDefined();
    expect(post!.webflowItemId).toBeUndefined();
    expect(post!.publishedAt).toBeUndefined();
    expect(post!.publishedSlug).toBeUndefined();
  });

  // ── 3. Partial chain: CMS create OK, publish fails (FM-2 soft failure) ──

  it('FM-2 soft failure: post IS marked published even when publish step fails', async () => {
    // Arrange: CMS create succeeds, publish fails
    mockWebflowSuccess(`/collections/${TEST_COLLECTION_ID}/items`, { id: TEST_ITEM_ID });
    mockWebflowError(`/collections/${TEST_COLLECTION_ID}/items/publish`, 500, 'Publish service unavailable');

    // Act
    const { status, body } = await postJson(
      baseUrl,
      `/api/content-posts/${content.workspaceId}/${content.postId}/publish-to-webflow`,
      {},
    );

    // Assert: route returns 200 despite publish failure — this IS the FM-2 behaviour
    expect(status).toBe(200);
    const resp = body as { success: boolean; itemId: string };
    expect(resp.success).toBe(true);
    expect(resp.itemId).toBe(TEST_ITEM_ID);

    // Assert: post IS marked published (documenting the known FM-2 soft failure)

    const post = getPost(content.workspaceId, content.postId);
    expect(post).toBeDefined();
    expect(post!.webflowItemId).toBe(TEST_ITEM_ID);
    expect(post!.publishedAt).toBeDefined();

    // Assert: the publish endpoint WAS called (attempt was made)
    const requests = getCapturedRequests();
    const publishReq = requests.find(
      (r) => r.endpoint === `/collections/${TEST_COLLECTION_ID}/items/publish` && r.method === 'POST',
    );
    expect(publishReq).toBeDefined();
  });

  // ── 4. Re-publish (update path): existing webflowItemId → update called ─

  it('re-publish: existing webflowItemId triggers update path instead of create', async () => {
    // Arrange: pre-set webflowItemId + webflowCollectionId to trigger update path
    db.prepare(
      `UPDATE content_posts
       SET webflow_item_id = ?, webflow_collection_id = ?
       WHERE id = ?`,
    ).run(TEST_ITEM_ID, TEST_COLLECTION_ID, content.postId);

    // Mock: update (PATCH) succeeds, publish succeeds
    mockWebflowSuccess(`/collections/${TEST_COLLECTION_ID}/items/${TEST_ITEM_ID}`, {});
    mockWebflowSuccess(`/collections/${TEST_COLLECTION_ID}/items/publish`, {
      publishedItemIds: [TEST_ITEM_ID],
    });

    // Act
    const { status, body } = await postJson(
      baseUrl,
      `/api/content-posts/${content.workspaceId}/${content.postId}/publish-to-webflow`,
      {},
    );

    // Assert: route returns success with isUpdate === true
    expect(status).toBe(200);
    const resp = body as { success: boolean; isUpdate: boolean; itemId: string };
    expect(resp.success).toBe(true);
    expect(resp.isUpdate).toBe(true);
    expect(resp.itemId).toBe(TEST_ITEM_ID);

    // Assert: update (PATCH) was called, NOT create (POST to /items)
    const requests = getCapturedRequests();
    const updateReq = requests.find(
      (r) =>
        r.endpoint === `/collections/${TEST_COLLECTION_ID}/items/${TEST_ITEM_ID}` &&
        r.method === 'PATCH',
    );
    expect(updateReq).toBeDefined();

    // No create call should have been made
    const createReq = requests.find(
      (r) => r.endpoint === `/collections/${TEST_COLLECTION_ID}/items` && r.method === 'POST',
    );
    expect(createReq).toBeUndefined();
  });

  // ── 5. Missing configuration: no publish target → 400 ──────────────────

  it('returns 400 when workspace has no publish target configured', async () => {
    // Arrange: remove publish_target from workspace
    db.prepare(
      `UPDATE workspaces SET publish_target = NULL WHERE id = ?`,
    ).run(content.workspaceId);

    // Act
    const { status, body } = await postJson(
      baseUrl,
      `/api/content-posts/${content.workspaceId}/${content.postId}/publish-to-webflow`,
      {},
    );

    // Assert
    expect(status).toBe(400);
    expect((body as { error: string }).error).toMatch(/publish target|Publish Settings/i);
  });

  // ── 6. Missing post → 404 ──────────────────────────────────────────────

  it('returns 404 when post does not exist', async () => {
    const { status, body } = await postJson(
      baseUrl,
      `/api/content-posts/${content.workspaceId}/nonexistent-post-id/publish-to-webflow`,
      {},
    );

    expect(status).toBe(404);
    expect((body as { error: string }).error).toContain('Post not found');
  });

  // ── 7. End-to-end verification: re-read post has complete state ─────────

  it('end-to-end: re-read post after publish has all publish fields populated', async () => {
    // Arrange: full success path
    mockWebflowSuccess(`/collections/${TEST_COLLECTION_ID}/items`, { id: TEST_ITEM_ID });
    mockWebflowSuccess(`/collections/${TEST_COLLECTION_ID}/items/publish`, {
      publishedItemIds: [TEST_ITEM_ID],
    });

    // Act: publish
    const { status } = await postJson(
      baseUrl,
      `/api/content-posts/${content.workspaceId}/${content.postId}/publish-to-webflow`,
      {},
    );
    expect(status).toBe(200);

    // Assert: re-read the post from the DB via getPost and verify ALL fields

    const post = getPost(content.workspaceId, content.postId);
    expect(post).toBeDefined();

    // Publish tracking fields
    expect(post!.webflowItemId).toBe(TEST_ITEM_ID);
    expect(post!.webflowCollectionId).toBe(TEST_COLLECTION_ID);
    expect(post!.publishedAt).toBeDefined();
    expect(typeof post!.publishedAt).toBe('string');
    // Verify publishedAt is a valid ISO date
    const pubDate = new Date(post!.publishedAt!);
    expect(pubDate.getTime()).toBeGreaterThan(0);
    expect(pubDate.toISOString()).toBe(post!.publishedAt);

    // publishedSlug should be a URL-friendly version of the title
    expect(post!.publishedSlug).toBeDefined();
    expect(post!.publishedSlug).toMatch(/^[a-z0-9-]+$/);

    // Original content fields should still be intact (no data loss from publish)
    expect(post!.title).toBeDefined();
    expect(post!.title.length).toBeGreaterThan(0);
    expect(post!.briefId).toBe(content.briefId);
    expect(post!.status).toBe('draft'); // status is not changed by publish route
  });
});
