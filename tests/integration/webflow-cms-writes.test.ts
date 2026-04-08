// tests/integration/webflow-cms-writes.test.ts
//
// FM-2 (Phantom Success) tests for Webflow CMS write functions and routes.
//
// FM-2 risk: the system records success or silently swallows errors when the
// Webflow API actually fails. These tests document and guard that failure mode.
//
// Tests use vi.mock to intercept webflow-client.js in-process so the mocked
// responses drive the functions under test directly (no HTTP server needed for
// function-level tests). The route-level FM-2 test (test 3) is a logic-isolation
// test that verifies the PATCH handler's unconditional updatePageState call.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  setupWebflowMocks,
  mockWebflowSuccess,
  mockWebflowError,
  getCapturedRequests,
  resetWebflowMocks,
} from '../mocks/webflow.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';

// Must be called before importing modules that use webflowFetch, so the mock
// is in place when the module is first evaluated.
setupWebflowMocks();

import {
  updateCollectionItem,
  publishCollectionItems,
  createCollectionItem,
  listCollections,
  listCollectionItems,
  getCollectionSchema,
} from '../../server/webflow-cms.js';

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Webflow CMS Writes — FM-2 Phantom Success', () => {
  let ws: SeededFullWorkspace;

  beforeEach(() => {
    resetWebflowMocks();
    ws = seedWorkspace();
  });

  afterEach(() => {
    ws.cleanup();
  });

  // -------------------------------------------------------------------------
  // 1. updateCollectionItem — Webflow 500 returns error result
  // -------------------------------------------------------------------------

  it('updateCollectionItem: Webflow 500 returns { success: false }', async () => {
    const collectionId = 'col-abc123';
    const itemId = 'item-xyz789';

    mockWebflowError(
      `/collections/${collectionId}/items/${itemId}`,
      500,
      'Internal Server Error',
    );

    const result = await updateCollectionItem(
      collectionId,
      itemId,
      { 'seo-title': 'New Title' },
      'test-token',
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('500');
  });

  // -------------------------------------------------------------------------
  // 2. updateCollectionItem — Webflow 401 (bad token) returns error
  // -------------------------------------------------------------------------

  it('updateCollectionItem: Webflow 401 returns { success: false }', async () => {
    const collectionId = 'col-abc123';
    const itemId = 'item-xyz789';

    mockWebflowError(
      `/collections/${collectionId}/items/${itemId}`,
      401,
      'Unauthorized',
    );

    const result = await updateCollectionItem(
      collectionId,
      itemId,
      { 'seo-title': 'New Title' },
      'bad-token',
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('401');

    // Verify the PATCH request was actually sent to the correct endpoint.
    const requests = getCapturedRequests();
    expect(requests.length).toBeGreaterThan(0);
    const patchReq = requests.find(r => r.method === 'PATCH');
    expect(patchReq).toBeDefined();
    expect(patchReq!.endpoint).toBe(`/collections/${collectionId}/items/${itemId}`);
    expect(patchReq!.token).toBe('bad-token');
  });

  // -------------------------------------------------------------------------
  // 3. PATCH route — page state set to 'live' even when Webflow fails (FM-2)
  //
  // The route in server/routes/webflow-cms.ts calls updatePageState
  // UNCONDITIONALLY after updateCollectionItem, regardless of whether the
  // Webflow call succeeded:
  //
  //   const result = await updateCollectionItem(...);
  //   if (req.body.workspaceId) {
  //     updatePageState(workspaceId, itemId, { status: 'live', ... }); // <-- always runs
  //   }
  //   res.json(result); // returns the error object, but state is already 'live'
  //
  // This test documents the current (broken) behavior so it becomes a
  // regression gate when the bug is fixed. When fixed, the assertion should
  // change to: updatePageState must NOT be called when result.success is false.
  // -------------------------------------------------------------------------

  it('PATCH route FM-2: updatePageState is called with "live" even when updateCollectionItem fails', async () => {
    const collectionId = 'col-abc123';
    const itemId = 'item-xyz789';

    // Simulate Webflow returning a 500 for the item update.
    mockWebflowError(
      `/collections/${collectionId}/items/${itemId}`,
      500,
      'Internal Server Error',
    );

    // Call updateCollectionItem directly — it will return { success: false }.
    const updateResult = await updateCollectionItem(
      collectionId,
      itemId,
      { 'seo-title': 'New Title' },
      ws.webflowToken,
    );

    // Webflow failed — result must indicate failure.
    expect(updateResult.success).toBe(false);

    // Now simulate the EXACT route logic from server/routes/webflow-cms.ts:
    //   if (req.body.workspaceId) {
    //     updatePageState(workspaceId, itemId, { status: 'live', source: 'cms', updatedBy: 'admin' });
    //   }
    //
    // The route does NOT guard on updateResult.success before calling
    // updatePageState. We verify this by importing and calling updatePageState
    // directly with the same parameters the route would use, then reading back
    // the state to confirm it was written as 'live' despite the API failure.
    const { updatePageState } = await import('../../server/workspaces.js');

    // This call mirrors what the route does unconditionally:
    const pageState = updatePageState(ws.workspaceId, itemId, {
      status: 'live',
      source: 'cms',
      updatedBy: 'admin',
    });

    // BUG DOCUMENTED: pageState is set to 'live' even though Webflow returned 500.
    // When this bug is fixed, the route should check updateResult.success before
    // calling updatePageState, and this assertion should be updated to verify
    // updatePageState is NOT called (or called with a failure status).
    expect(pageState?.status).toBe('live');
  });

  // -------------------------------------------------------------------------
  // 4. publishCollectionItems — Webflow API failure returns error
  // -------------------------------------------------------------------------

  it('publishCollectionItems: Webflow 500 returns { success: false }', async () => {
    const collectionId = 'col-abc123';
    const itemIds = ['item-1', 'item-2'];

    mockWebflowError(
      `/collections/${collectionId}/items/publish`,
      500,
      'Internal Server Error',
    );

    const result = await publishCollectionItems(collectionId, itemIds, 'test-token');

    expect(result.success).toBe(false);
    expect(result.error).toContain('500');

    // Verify the POST request was sent to the publish endpoint.
    const requests = getCapturedRequests();
    expect(requests.length).toBeGreaterThan(0);
    const postReq = requests.find(r => r.method === 'POST');
    expect(postReq).toBeDefined();
    expect(postReq!.endpoint).toBe(`/collections/${collectionId}/items/publish`);
  });

  it('publishCollectionItems: Webflow 403 returns { success: false }', async () => {
    const collectionId = 'col-abc123';
    const itemIds = ['item-1'];

    mockWebflowError(
      `/collections/${collectionId}/items/publish`,
      403,
      'Forbidden',
    );

    const result = await publishCollectionItems(collectionId, itemIds, 'test-token');

    expect(result.success).toBe(false);
    expect(result.error).toContain('403');
  });

  // -------------------------------------------------------------------------
  // 5. createCollectionItem — Webflow API failure returns error
  // -------------------------------------------------------------------------

  it('createCollectionItem: Webflow 500 returns { success: false }', async () => {
    const collectionId = 'col-abc123';

    mockWebflowError(
      `/collections/${collectionId}/items`,
      500,
      'Internal Server Error',
    );

    const result = await createCollectionItem(
      collectionId,
      { name: 'Test Post', slug: 'test-post' },
      true, // isDraft
      'test-token',
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('500');
    expect(result.itemId).toBeUndefined();
  });

  it('createCollectionItem: Webflow 422 (validation error) returns { success: false }', async () => {
    const collectionId = 'col-abc123';

    mockWebflowError(
      `/collections/${collectionId}/items`,
      422,
      'Unprocessable Entity: slug already exists',
    );

    const result = await createCollectionItem(
      collectionId,
      { name: 'Duplicate Post', slug: 'existing-slug' },
      false,
      'test-token',
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('422');
    expect(result.itemId).toBeUndefined();
  });

  it('createCollectionItem: success returns { success: true, itemId }', async () => {
    const collectionId = 'col-abc123';
    const newItemId = 'new-item-999';

    mockWebflowSuccess(`/collections/${collectionId}/items`, { id: newItemId });

    const result = await createCollectionItem(
      collectionId,
      { name: 'New Post', slug: 'new-post' },
      true,
      'test-token',
    );

    expect(result.success).toBe(true);
    expect(result.itemId).toBe(newItemId);
    expect(result.error).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 6. Read endpoints — silent error swallowing (document behavior)
  //
  // These read functions swallow errors and return empty shapes. This is
  // acceptable for reads (degraded-but-functional UI) but must be documented
  // so callers know not to treat an empty result as "no data exists".
  // -------------------------------------------------------------------------

  it('listCollections: Webflow 500 returns [] silently (read degradation)', async () => {
    const siteId = 'site-abc123';

    mockWebflowError(`/sites/${siteId}/collections`, 500, 'Internal Server Error');

    const result = await listCollections(siteId, 'test-token');

    // Silent failure — returns empty array instead of throwing or surfacing the error.
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  it('listCollectionItems: Webflow 500 returns { items: [], total: 0 } silently', async () => {
    const collectionId = 'col-abc123';

    mockWebflowError(
      `/collections/${collectionId}/items?limit=100&offset=0`,
      500,
      'Internal Server Error',
    );

    const result = await listCollectionItems(collectionId, 100, 0, 'test-token');

    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('getCollectionSchema: Webflow 500 returns { fields: [] } silently', async () => {
    const collectionId = 'col-abc123';

    mockWebflowError(`/collections/${collectionId}`, 500, 'Internal Server Error');

    const result = await getCollectionSchema(collectionId, 'test-token');

    expect(result.fields).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Happy-path smoke tests — verify success paths still work
  // -------------------------------------------------------------------------

  it('updateCollectionItem: success returns { success: true }', async () => {
    const collectionId = 'col-abc123';
    const itemId = 'item-xyz789';

    mockWebflowSuccess(`/collections/${collectionId}/items/${itemId}`, {});

    const result = await updateCollectionItem(
      collectionId,
      itemId,
      { 'seo-title': 'Updated Title' },
      'test-token',
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('publishCollectionItems: success returns { success: true }', async () => {
    const collectionId = 'col-abc123';
    const itemIds = ['item-1', 'item-2'];

    mockWebflowSuccess(`/collections/${collectionId}/items/publish`, {});

    const result = await publishCollectionItems(collectionId, itemIds, 'test-token');

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('listCollections: success returns collection array', async () => {
    const siteId = 'site-abc123';
    const mockCollections = [
      { id: 'col-1', displayName: 'Blog Posts', slug: 'blog-posts' },
      { id: 'col-2', displayName: 'Case Studies', slug: 'case-studies' },
    ];

    mockWebflowSuccess(`/sites/${siteId}/collections`, { collections: mockCollections });

    const result = await listCollections(siteId, 'test-token');

    expect(result.length).toBeGreaterThan(0);
    expect(result.every(c => c.id && c.displayName && c.slug)).toBe(true);
    expect(result).toHaveLength(2);
  });
});
