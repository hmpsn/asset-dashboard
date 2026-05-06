/**
 * Integration tests for approvals API endpoints.
 *
 * Tests the full HTTP request/response cycle for:
 * - POST /api/approvals/:workspaceId (create batch)
 * - GET /api/approvals/:workspaceId (list batches)
 * - GET /api/approvals/:workspaceId/:batchId (get batch)
 * - DELETE /api/approvals/:workspaceId/:batchId (delete batch)
 * - GET /api/public/approvals/:workspaceId (public list)
 * - GET /api/public/approvals/:workspaceId/:batchId (public get)
 * - PATCH /api/public/approvals/:workspaceId/:batchId/:itemId (client review)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';

const ctx = createTestContext(13214);
const { api, postJson, patchJson, del } = ctx;

let testWsId = '';
let otherWsId = '';
const testSiteId = 'site_approval_test';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Approvals Test Workspace');
  testWsId = ws.id;
  const otherWs = createWorkspace('Approvals Other Workspace');
  otherWsId = otherWs.id;
}, 25_000);

afterAll(async () => {
  db.prepare('DELETE FROM approval_batches WHERE workspace_id IN (?, ?)').run(testWsId, otherWsId);
  deleteWorkspace(testWsId);
  deleteWorkspace(otherWsId);
  await ctx.stopServer();
});

describe('Approvals — create validation', () => {
  async function listBatches() {
    const res = await api(`/api/approvals/${testWsId}`);
    expect(res.status).toBe(200);
    return await res.json() as Array<{ id: string }>;
  }

  it('POST without siteId or items returns 400', async () => {
    const res = await postJson(`/api/approvals/${testWsId}`, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.toLowerCase()).toContain('required');
  });

  it('POST without items returns 400', async () => {
    const res = await postJson(`/api/approvals/${testWsId}`, {
      siteId: testSiteId,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.toLowerCase()).toContain('required');
  });

  it('rejects unsupported create workflow fields without inserting a batch', async () => {
    const before = await listBatches();

    const topLevelStatusRes = await postJson(`/api/approvals/${testWsId}`, {
      siteId: testSiteId,
      name: 'Unsupported Batch Status',
      status: 'approved',
      items: [
        {
          pageId: 'page_invalid_top',
          pageSlug: '/invalid-top',
          pageTitle: 'Invalid Top',
          field: 'seoTitle',
          currentValue: 'Old',
          proposedValue: 'New',
        },
      ],
    });
    expect(topLevelStatusRes.status).toBe(400);

    const itemStatusRes = await postJson(`/api/approvals/${testWsId}`, {
      siteId: testSiteId,
      name: 'Unsupported Item Status',
      items: [
        {
          pageId: 'page_invalid_item',
          pageSlug: '/invalid-item',
          pageTitle: 'Invalid Item',
          field: 'seoTitle',
          currentValue: 'Old',
          proposedValue: 'New',
          status: 'approved',
        },
      ],
    });
    expect(itemStatusRes.status).toBe(400);

    const after = await listBatches();
    expect(after).toHaveLength(before.length);
  });
});

describe('Approvals — CRUD', () => {
  let batchId = '';
  let itemId = '';

  it('POST creates an approval batch', async () => {
    const res = await postJson(`/api/approvals/${testWsId}`, {
      siteId: testSiteId,
      name: 'Test SEO Changes',
      items: [
        {
          pageId: 'page_1',
          pageSlug: '/test-page',
          pageTitle: 'Test Page',
          field: 'seoTitle',
          currentValue: 'Old Title',
          proposedValue: 'New SEO Title',
        },
        {
          pageId: 'page_2',
          pageSlug: '/test-page-2',
          pageTitle: 'Test Page 2',
          field: 'seoDescription',
          currentValue: 'Old description',
          proposedValue: 'New meta description for test page 2',
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body.name).toBe('Test SEO Changes');
    expect(body.items).toHaveLength(2);
    batchId = body.id;
    itemId = body.items[0].id;
  });

  it('GET /api/approvals/:workspaceId lists batches', async () => {
    const res = await api(`/api/approvals/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/approvals/:workspaceId/:batchId returns batch', async () => {
    const res = await api(`/api/approvals/${testWsId}/${batchId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(batchId);
  });

  it('GET batch with bad id returns 404', async () => {
    const res = await api(`/api/approvals/${testWsId}/batch_nonexistent`);
    expect(res.status).toBe(404);
  });

  // Public endpoints
  it('GET /api/public/approvals/:workspaceId returns batches', async () => {
    const res = await api(`/api/public/approvals/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/public/approvals/:workspaceId/:batchId returns batch', async () => {
    const res = await api(`/api/public/approvals/${testWsId}/${batchId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(batchId);
  });

  // Client review
  it('PATCH item with bad id returns 404', async () => {
    const res = await patchJson(
      `/api/public/approvals/${testWsId}/${batchId}/item_nonexistent`,
      { status: 'approved' },
    );
    expect(res.status).toBe(404);
  });

  it('rejects invalid public review input without mutating the item', async () => {
    const beforeRes = await api(`/api/public/approvals/${testWsId}/${batchId}`);
    expect(beforeRes.status).toBe(200);
    const beforeBatch = await beforeRes.json();
    const beforeItem = beforeBatch.items.find((i: { id: string }) => i.id === itemId);
    expect(beforeItem.status).toBe('pending');

    const invalidStatusRes = await patchJson(
      `/api/public/approvals/${testWsId}/${batchId}/${itemId}`,
      { status: 'applied', clientNote: 'Trying to skip apply.' },
    );
    expect(invalidStatusRes.status).toBe(400);

    const unsupportedFieldRes = await patchJson(
      `/api/public/approvals/${testWsId}/${batchId}/${itemId}`,
      { status: 'approved', id: 'spoofed_item_id' },
    );
    expect(unsupportedFieldRes.status).toBe(400);

    const afterRes = await api(`/api/public/approvals/${testWsId}/${batchId}`);
    expect(afterRes.status).toBe(200);
    const afterBatch = await afterRes.json();
    const afterItem = afterBatch.items.find((i: { id: string }) => i.id === itemId);
    expect(afterItem.status).toBe(beforeItem.status);
    expect(afterItem.clientNote).toBeUndefined();
    expect(afterItem.updatedAt).toBe(beforeItem.updatedAt);
  });

  it('does not let public routes read or update a batch through the wrong workspace', async () => {
    const crossGetRes = await api(`/api/public/approvals/${otherWsId}/${batchId}`);
    expect(crossGetRes.status).toBe(404);

    const crossPatchRes = await patchJson(
      `/api/public/approvals/${otherWsId}/${batchId}/${itemId}`,
      { status: 'approved' },
    );
    expect(crossPatchRes.status).toBe(404);

    const ownerRes = await api(`/api/public/approvals/${testWsId}/${batchId}`);
    expect(ownerRes.status).toBe(200);
    const ownerBatch = await ownerRes.json();
    const ownerItem = ownerBatch.items.find((i: { id: string }) => i.id === itemId);
    expect(ownerItem.status).toBe('pending');
  });

  it('does not let public apply preflight mask missing or wrong-workspace batches', async () => {
    const missingRes = await postJson(`/api/public/approvals/${testWsId}/batch_missing/apply`, {});
    expect(missingRes.status).toBe(404);

    const crossApplyRes = await postJson(`/api/public/approvals/${otherWsId}/${batchId}/apply`, {});
    expect(crossApplyRes.status).toBe(404);

    const ownerRes = await api(`/api/public/approvals/${testWsId}/${batchId}`);
    expect(ownerRes.status).toBe(200);
    const ownerBatch = await ownerRes.json();
    const ownerItem = ownerBatch.items.find((i: { id: string }) => i.id === itemId);
    expect(ownerItem.status).toBe('pending');
  });

  it('PATCH approves an item', async () => {
    const res = await patchJson(
      `/api/public/approvals/${testWsId}/${batchId}/${itemId}`,
      { status: 'approved' },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const item = body.items.find((i: { id: string }) => i.id === itemId);
    expect(item.status).toBe('approved');
  });

  it('DELETE with a missing or wrong-workspace batch returns 404 without deleting the owner batch', async () => {
    const missingRes = await del(`/api/approvals/${testWsId}/batch_missing`);
    expect(missingRes.status).toBe(404);

    const crossDeleteRes = await del(`/api/approvals/${otherWsId}/${batchId}`);
    expect(crossDeleteRes.status).toBe(404);

    const ownerRes = await api(`/api/approvals/${testWsId}/${batchId}`);
    expect(ownerRes.status).toBe(200);
    const ownerBatch = await ownerRes.json();
    expect(ownerBatch.id).toBe(batchId);
  });

  // Delete
  it('DELETE removes the batch', async () => {
    const res = await del(`/api/approvals/${testWsId}/${batchId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
