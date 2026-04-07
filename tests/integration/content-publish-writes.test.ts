/**
 * Integration tests — Content Publish Writes (FM-2 Phantom Success)
 *
 * FM-2 risk: the Webflow publish step (step 6 of the route) only logs a warning
 * on failure and continues. The post is marked as published (`publishedAt` set)
 * even though the CMS item was never made live. These tests document and guard
 * that known behaviour, and verify that earlier failures (CMS create/update) DO
 * abort the route with a 500 before any local state is written.
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

// ── Mock setup ─────────────────────────────────────────────────────────────
// setupWebflowMocks() calls vi.mock() which Vitest hoists to the top of the
// file. It must be called at module scope, not inside beforeEach.
setupWebflowMocks();

// Mock broadcast so broadcastToWorkspace() is a no-op (not initialized by createApp)
vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

// ── Constants used across tests ────────────────────────────────────────────
const TEST_SITE_ID = 'site_test_publish';
const TEST_COLLECTION_ID = 'col_test_publish';
const TEST_ITEM_ID = 'item_test_123';
const TEST_TOKEN = 'test-webflow-token';

/** Publish target JSON stored in the workspaces table. */
const PUBLISH_TARGET = JSON.stringify({
  collectionId: TEST_COLLECTION_ID,
  collectionName: 'Blog',
  fieldMap: { title: 'name', slug: 'slug', body: 'post-body' },
});

// ── In-process server helper ──────────────────────────────────────────────
// Uses createApp() so vi.mock interceptors work (unlike createTestContext
// which spawns a child process where mocks don't apply).

async function startTestServer(): Promise<{ server: http.Server; baseUrl: string; stop: () => void }> {
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  return { server, baseUrl, stop: () => server.close() };
}

async function postJson(baseUrl: string, path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const responseBody = await res.json().catch(() => ({}));
  return { status: res.status, body: responseBody };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Seed a content workspace that is fully configured for publishing:
 * - webflow_site_id set
 * - webflow_token set (so getTokenForSite() returns a token without env fallback)
 * - publish_target configured with a collectionId + fieldMap
 */
function seedPublishableContent(): SeededContent {
  const seeded = seedContentData();
  db.prepare(
    `UPDATE workspaces
     SET webflow_site_id = ?, webflow_token = ?, publish_target = ?
     WHERE id = ?`,
  ).run(TEST_SITE_ID, TEST_TOKEN, PUBLISH_TARGET, seeded.workspaceId);
  // Also update the seeded post status to 'draft' so the route allows it
  db.prepare(`UPDATE content_posts SET status = 'draft' WHERE id = ?`).run(seeded.postId);
  return seeded;
}

// ── Test suite ─────────────────────────────────────────────────────────────

describe('Content Publish Writes — FM-2 Phantom Success', () => {
  let content: SeededContent;

  beforeEach(() => {
    resetWebflowMocks();
    content = seedContentData();
  });

  afterEach(() => {
    content.cleanup();
  });

  // ── Unit-level: createCollectionItem ──────────────────────────────────────

  describe('createCollectionItem — Webflow API failures', () => {
    it('returns success:false when Webflow responds with 500', async () => {
      mockWebflowError(`/collections/${TEST_COLLECTION_ID}/items`, 500, 'Internal Server Error');

      // Dynamic import so the mocked webflow-client.js is used
      const { createCollectionItem } = await import('../../server/webflow-cms.js');

      const result = await createCollectionItem(
        TEST_COLLECTION_ID,
        { name: 'Test Post', slug: 'test-post' },
        false,
        TEST_TOKEN,
      );

      expect(result.success).toBe(false);
      expect(result.itemId).toBeUndefined();
      expect(result.error).toBeDefined();
      expect(result.error).toContain('500');
    });

    it('returns success:false when Webflow responds with 401 (unauthorized)', async () => {
      mockWebflowError(`/collections/${TEST_COLLECTION_ID}/items`, 401, 'Unauthorized');

      const { createCollectionItem } = await import('../../server/webflow-cms.js');

      const result = await createCollectionItem(
        TEST_COLLECTION_ID,
        { name: 'Test Post', slug: 'test-post' },
        false,
        'bad-token',
      );

      expect(result.success).toBe(false);
      expect(result.itemId).toBeUndefined();
      expect(result.error).toBeDefined();
      expect(result.error).toContain('401');
    });

    it('returns success:true with itemId when Webflow responds with 200', async () => {
      mockWebflowSuccess(`/collections/${TEST_COLLECTION_ID}/items`, { id: TEST_ITEM_ID });

      const { createCollectionItem } = await import('../../server/webflow-cms.js');

      const result = await createCollectionItem(
        TEST_COLLECTION_ID,
        { name: 'Test Post', slug: 'test-post' },
        false,
        TEST_TOKEN,
      );

      expect(result.success).toBe(true);
      expect(result.itemId).toBe(TEST_ITEM_ID);
      expect(result.error).toBeUndefined();
    });
  });

  // ── Unit-level: updateCollectionItem ─────────────────────────────────────

  describe('updateCollectionItem — Webflow API failures', () => {
    it('returns success:false when Webflow PATCH responds with 500', async () => {
      mockWebflowError(
        `/collections/${TEST_COLLECTION_ID}/items/${TEST_ITEM_ID}`,
        500,
        'Server error',
      );

      const { updateCollectionItem } = await import('../../server/webflow-cms.js');

      const result = await updateCollectionItem(
        TEST_COLLECTION_ID,
        TEST_ITEM_ID,
        { name: 'Updated Title' },
        TEST_TOKEN,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('500');
    });

    it('returns success:true when Webflow PATCH responds with 200', async () => {
      mockWebflowSuccess(`/collections/${TEST_COLLECTION_ID}/items/${TEST_ITEM_ID}`, {});

      const { updateCollectionItem } = await import('../../server/webflow-cms.js');

      const result = await updateCollectionItem(
        TEST_COLLECTION_ID,
        TEST_ITEM_ID,
        { name: 'Updated Title' },
        TEST_TOKEN,
      );

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  // ── Unit-level: publishCollectionItems ───────────────────────────────────

  describe('publishCollectionItems — Webflow API failures', () => {
    it('returns success:false when Webflow publish endpoint responds with 500', async () => {
      mockWebflowError(
        `/collections/${TEST_COLLECTION_ID}/items/publish`,
        500,
        'Publish service unavailable',
      );

      const { publishCollectionItems } = await import('../../server/webflow-cms.js');

      const result = await publishCollectionItems(
        TEST_COLLECTION_ID,
        [TEST_ITEM_ID],
        TEST_TOKEN,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('500');
    });

    it('returns success:true when Webflow publish endpoint responds with 200', async () => {
      mockWebflowSuccess(`/collections/${TEST_COLLECTION_ID}/items/publish`, { publishedItemIds: [TEST_ITEM_ID] });

      const { publishCollectionItems } = await import('../../server/webflow-cms.js');

      const result = await publishCollectionItems(
        TEST_COLLECTION_ID,
        [TEST_ITEM_ID],
        TEST_TOKEN,
      );

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  // ── Route-level: CMS create failure aborts before local state write ───────
  //
  // Route-level tests use createApp() (in-process) so vi.mock interceptors
  // work correctly. The createTestContext helper spawns a child process where
  // mocks don't apply.

  describe('POST /api/content-posts/:workspaceId/:postId/publish-to-webflow', () => {
    let baseUrl: string;
    let stopServer: () => void;

    beforeEach(async () => {
      const server = await startTestServer();
      baseUrl = server.baseUrl;
      stopServer = server.stop;
    });

    afterEach(() => {
      stopServer();
    });

    it('returns 500 and does NOT mark post as published when CMS item creation fails', async () => {
      // Re-seed with a publish-ready workspace
      content.cleanup();
      content = seedPublishableContent();

      // Mock Webflow to fail on CMS item creation
      mockWebflowError(
        `/collections/${TEST_COLLECTION_ID}/items`,
        500,
        'CMS create failed',
      );

      const { status, body } = await postJson(
        baseUrl,
        `/api/content-posts/${content.workspaceId}/${content.postId}/publish-to-webflow`,
        {},
      );

      expect(status).toBe(500);
      expect((body as { error: string }).error).toContain('Failed to create CMS item');

      // Verify post was NOT marked as published
      const { getPost } = await import('../../server/content-posts.js');
      const post = getPost(content.workspaceId, content.postId);
      expect(post).toBeDefined();
      expect(post!.webflowItemId).toBeUndefined();
      expect(post!.publishedAt).toBeUndefined();
    });

    it('returns 500 and does NOT mark post as published when CMS item update fails', async () => {
      // Re-seed with a publish-ready workspace
      content.cleanup();
      content = seedPublishableContent();

      // Pre-set the post as already having a Webflow item (triggers update path)
      db.prepare(
        `UPDATE content_posts
         SET webflow_item_id = ?, webflow_collection_id = ?
         WHERE id = ?`,
      ).run(TEST_ITEM_ID, TEST_COLLECTION_ID, content.postId);

      // Mock Webflow to fail on CMS item update (PATCH)
      mockWebflowError(
        `/collections/${TEST_COLLECTION_ID}/items/${TEST_ITEM_ID}`,
        500,
        'CMS update failed',
      );

      const { status, body } = await postJson(
        baseUrl,
        `/api/content-posts/${content.workspaceId}/${content.postId}/publish-to-webflow`,
        {},
      );

      expect(status).toBe(500);
      expect((body as { error: string }).error).toContain('Failed to update CMS item');

      // Verify publishedAt was NOT updated (it remains null since we only set webflowItemId above)
      const { getPost } = await import('../../server/content-posts.js');
      const post = getPost(content.workspaceId, content.postId);
      expect(post).toBeDefined();
      expect(post!.publishedAt).toBeUndefined();
    });

    // ── FM-2: publish step failure — post still marked as published ──────────
    //
    // This is the documented soft-failure (Phantom Success): the CMS item was
    // created successfully but the publish call failed, leaving the item in draft
    // state on Webflow. The route only logs a warning and continues, so local
    // state is still written with publishedAt set.
    //
    // This test documents the CURRENT BEHAVIOR, not the ideal behavior. If this
    // behaviour is ever changed to a hard error, update this test accordingly.
    it('FM-2: marks post as published even when the publish step fails (soft-failure)', async () => {
      content.cleanup();
      content = seedPublishableContent();

      // Mock: CMS item creation succeeds
      mockWebflowSuccess(
        `/collections/${TEST_COLLECTION_ID}/items`,
        { id: TEST_ITEM_ID },
      );

      // Mock: publish step fails
      mockWebflowError(
        `/collections/${TEST_COLLECTION_ID}/items/publish`,
        500,
        'Publish service unavailable',
      );

      const { status, body } = await postJson(
        baseUrl,
        `/api/content-posts/${content.workspaceId}/${content.postId}/publish-to-webflow`,
        {},
      );

      // Route returns 200 despite publish failure — this is the FM-2 behaviour
      expect(status).toBe(200);
      const b = body as { success: boolean; itemId: string; post: { publishedAt: string } };
      expect(b.success).toBe(true);
      expect(b.itemId).toBe(TEST_ITEM_ID);

      // Local state IS written: the post is marked as published
      const { getPost } = await import('../../server/content-posts.js');
      const post = getPost(content.workspaceId, content.postId);
      expect(post).toBeDefined();
      expect(post!.webflowItemId).toBe(TEST_ITEM_ID);
      expect(post!.publishedAt).toBeDefined();
      // publishedAt should be a valid ISO date string
      expect(() => new Date(post!.publishedAt!).toISOString()).not.toThrow();

      // Verify the publish endpoint WAS called (the attempt was made)
      const requests = getCapturedRequests();
      const publishReq = requests.find(r =>
        r.endpoint === `/collections/${TEST_COLLECTION_ID}/items/publish` &&
        r.method === 'POST',
      );
      expect(publishReq).toBeDefined();
    });

    // ── Missing publish target configuration ─────────────────────────────────

    it('returns 400 with a clear error when workspace has no publish target configured', async () => {
      // content from beforeEach — default seeded workspace has NO publish target
      const { status, body } = await postJson(
        baseUrl,
        `/api/content-posts/${content.workspaceId}/${content.postId}/publish-to-webflow`,
        {},
      );

      expect(status).toBe(400);
      expect((body as { error: string }).error).toMatch(/publish target|Publish Settings/i);
    });

    it('returns 400 when workspace has no Webflow site linked', async () => {
      // Set publish_target but NOT webflow_site_id
      db.prepare(
        `UPDATE workspaces SET publish_target = ? WHERE id = ?`,
      ).run(PUBLISH_TARGET, content.workspaceId);

      const { status, body } = await postJson(
        baseUrl,
        `/api/content-posts/${content.workspaceId}/${content.postId}/publish-to-webflow`,
        {},
      );

      expect(status).toBe(400);
      expect((body as { error: string }).error).toContain('Webflow site');
    });

    it('returns 404 when the post does not exist', async () => {
      content.cleanup();
      content = seedPublishableContent();

      const { status, body } = await postJson(
        baseUrl,
        `/api/content-posts/${content.workspaceId}/nonexistent-post-id/publish-to-webflow`,
        {},
      );

      expect(status).toBe(404);
      expect((body as { error: string }).error).toContain('Post not found');
    });

    it('returns 200 on a fully successful publish (create + publish both succeed)', async () => {
      content.cleanup();
      content = seedPublishableContent();

      mockWebflowSuccess(
        `/collections/${TEST_COLLECTION_ID}/items`,
        { id: TEST_ITEM_ID },
      );
      mockWebflowSuccess(
        `/collections/${TEST_COLLECTION_ID}/items/publish`,
        { publishedItemIds: [TEST_ITEM_ID] },
      );

      const { status, body } = await postJson(
        baseUrl,
        `/api/content-posts/${content.workspaceId}/${content.postId}/publish-to-webflow`,
        {},
      );

      expect(status).toBe(200);
      const b = body as { success: boolean; itemId: string; isUpdate: boolean };
      expect(b.success).toBe(true);
      expect(b.itemId).toBe(TEST_ITEM_ID);
      expect(b.isUpdate).toBe(false);

      // Verify captured requests include both create and publish calls
      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThan(0);

      const createReq = requests.find(r =>
        r.endpoint === `/collections/${TEST_COLLECTION_ID}/items` &&
        r.method === 'POST',
      );
      expect(createReq).toBeDefined();

      const publishReq = requests.find(r =>
        r.endpoint === `/collections/${TEST_COLLECTION_ID}/items/publish` &&
        r.method === 'POST',
      );
      expect(publishReq).toBeDefined();
    });
  });
});
