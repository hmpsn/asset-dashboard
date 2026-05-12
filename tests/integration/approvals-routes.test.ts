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
 * - PATCH /api/public/approvals/:workspaceId/:batchId/approve (bulk trust-first approve)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';

const ctx = createTestContext(13214);
const { api, postJson, patchJson, del, clearCookies } = ctx;

let testWsId = '';
let otherWsId = '';
let protectedWsId = '';
let protectedOtherWsId = '';
const testSiteId = 'site_approval_test';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Approvals Test Workspace');
  testWsId = ws.id;
  const otherWs = createWorkspace('Approvals Other Workspace');
  otherWsId = otherWs.id;
  const protectedWs = createWorkspace('Approvals Protected Workspace');
  protectedWsId = protectedWs.id;
  updateWorkspace(protectedWsId, { clientPassword: 'approval-test-pw' });
  const protectedOtherWs = createWorkspace('Approvals Protected Other Workspace');
  protectedOtherWsId = protectedOtherWs.id;
  updateWorkspace(protectedOtherWsId, { clientPassword: 'approval-other-test-pw' });
}, 25_000);

afterAll(async () => {
  db.prepare('DELETE FROM approval_batches WHERE workspace_id IN (?, ?, ?, ?)').run(testWsId, otherWsId, protectedWsId, protectedOtherWsId);
  deleteWorkspace(testWsId);
  deleteWorkspace(otherWsId);
  deleteWorkspace(protectedWsId);
  deleteWorkspace(protectedOtherWsId);
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

  it('note is persisted and returned on GET', async () => {
    const res = await postJson(`/api/approvals/${testWsId}`, {
      siteId: testSiteId,
      name: 'Note Batch',
      note: 'Hello client',
      items: [{ pageId: 'p1', pageSlug: '/p1', field: 'seoTitle', currentValue: 'Old', proposedValue: 'New' }],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.note).toBe('Hello client');
    const getRes = await api(`/api/approvals/${testWsId}/${body.id}`);
    expect(getRes.status).toBe(200);
    const getBatch = await getRes.json();
    expect(getBatch.note).toBe('Hello client');
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

  it('requires client auth before reading or updating protected public approvals', async () => {
    const createRes = await postJson(`/api/approvals/${protectedWsId}`, {
      siteId: testSiteId,
      name: 'Protected SEO Changes',
      items: [
        {
          pageId: 'protected_page_1',
          pageSlug: '/protected-page',
          pageTitle: 'Protected Page',
          field: 'seoTitle',
          currentValue: 'Protected Old Title',
          proposedValue: 'Protected New Title',
        },
      ],
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json();
    const protectedItemId = created.items[0].id;

    clearCookies();
    const listRes = await api(`/api/public/approvals/${protectedWsId}`);
    expect(listRes.status).toBe(401);

    const readRes = await api(`/api/public/approvals/${protectedWsId}/${created.id}`);
    expect(readRes.status).toBe(401);

    const unauthenticatedPatchRes = await patchJson(
      `/api/public/approvals/${protectedWsId}/${created.id}/${protectedItemId}`,
      { status: 'approved', clientNote: 'This should not save.' },
    );
    expect(unauthenticatedPatchRes.status).toBe(401);

    const beforeLoginRes = await api(`/api/approvals/${protectedWsId}/${created.id}`);
    expect(beforeLoginRes.status).toBe(200);
    const beforeLoginBatch = await beforeLoginRes.json();
    const beforeLoginItem = beforeLoginBatch.items.find((i: { id: string }) => i.id === protectedItemId);
    expect(beforeLoginItem).toBeDefined();
    expect(beforeLoginItem.status).toBe('pending');
    expect(beforeLoginItem.clientNote).toBeUndefined();

    const loginRes = await postJson(`/api/public/auth/${protectedWsId}`, {
      password: 'approval-test-pw',
    });
    expect(loginRes.status).toBe(200);

    const authedReadRes = await api(`/api/public/approvals/${protectedWsId}/${created.id}`);
    expect(authedReadRes.status).toBe(200);

    const authedPatchRes = await patchJson(
      `/api/public/approvals/${protectedWsId}/${created.id}/${protectedItemId}`,
      { status: 'approved', clientNote: 'Approved after login.' },
    );
    expect(authedPatchRes.status).toBe(200);
    const updatedBatch = await authedPatchRes.json();
    const updatedItem = updatedBatch.items.find((i: { id: string }) => i.id === protectedItemId);
    expect(updatedItem).toBeDefined();
    expect(updatedItem.status).toBe('approved');
    expect(updatedItem.clientNote).toBe('Approved after login.');
    clearCookies();
  });

  it('does not let one protected public approval session access another protected workspace', async () => {
    const createRes = await postJson(`/api/approvals/${protectedOtherWsId}`, {
      siteId: testSiteId,
      name: 'Other Protected SEO Changes',
      items: [
        {
          pageId: 'protected_other_page_1',
          pageSlug: '/protected-other-page',
          pageTitle: 'Protected Other Page',
          field: 'seoTitle',
          currentValue: 'Other Old Title',
          proposedValue: 'Other New Title',
        },
      ],
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json();
    const protectedOtherItemId = created.items[0].id;

    clearCookies();
    const loginRes = await postJson(`/api/public/auth/${protectedWsId}`, {
      password: 'approval-test-pw',
    });
    expect(loginRes.status).toBe(200);

    const crossListRes = await api(`/api/public/approvals/${protectedOtherWsId}`);
    expect(crossListRes.status).toBe(401);

    const crossReadRes = await api(`/api/public/approvals/${protectedOtherWsId}/${created.id}`);
    expect(crossReadRes.status).toBe(401);

    const crossPatchRes = await patchJson(
      `/api/public/approvals/${protectedOtherWsId}/${created.id}/${protectedOtherItemId}`,
      { status: 'approved', clientNote: 'Wrong protected workspace.' },
    );
    expect(crossPatchRes.status).toBe(401);

    const ownerRes = await api(`/api/approvals/${protectedOtherWsId}/${created.id}`);
    expect(ownerRes.status).toBe(200);
    const ownerBatch = await ownerRes.json();
    const ownerItem = ownerBatch.items.find((i: { id: string }) => i.id === protectedOtherItemId);
    expect(ownerItem.status).toBe('pending');
    expect(ownerItem.clientNote).toBeUndefined();
    clearCookies();
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

  it('reminder preflight does not mask missing or wrong-workspace batches', async () => {
    const missingRes = await postJson(`/api/approvals/${testWsId}/batch_missing/remind`, {});
    expect(missingRes.status).toBe(404);

    const crossReminderRes = await postJson(`/api/approvals/${otherWsId}/${batchId}/remind`, {});
    expect(crossReminderRes.status).toBe(404);

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

describe('Approvals — bulk trust-first approve', () => {
  let bulkBatchId = '';
  let bulkItem1Id = '';
  let bulkItem2Id = '';

  beforeAll(async () => {
    const res = await postJson(`/api/approvals/${testWsId}`, {
      siteId: testSiteId,
      name: 'Bulk Approve Batch',
      items: [
        {
          pageId: 'bulk_page_1',
          pageSlug: '/bulk-1',
          pageTitle: 'Bulk Page 1',
          field: 'seoTitle',
          currentValue: 'Old Title 1',
          proposedValue: 'New SEO Title 1',
        },
        {
          pageId: 'bulk_page_2',
          pageSlug: '/bulk-2',
          pageTitle: 'Bulk Page 2',
          field: 'seoDescription',
          currentValue: 'Old description 2',
          proposedValue: 'New meta description 2',
        },
      ],
    });
    const body = await res.json();
    bulkBatchId = body.id;
    bulkItem1Id = body.items[0].id;
    bulkItem2Id = body.items[1].id;
  });

  afterAll(() => {
    db.prepare('DELETE FROM approval_batches WHERE id = ?').run(bulkBatchId);
  });

  it('returns 404 for a non-existent batch', async () => {
    const res = await patchJson(
      `/api/public/approvals/${testWsId}/batch_missing/approve`,
      {},
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 if clientNote exceeds 2000 chars', async () => {
    const res = await patchJson(
      `/api/public/approvals/${testWsId}/${bulkBatchId}/approve`,
      { clientNote: 'x'.repeat(2001) },
    );
    expect(res.status).toBe(400);
  });

  it('approves all pending items and stamps clientNote when provided', async () => {
    const res = await patchJson(
      `/api/public/approvals/${testWsId}/${bulkBatchId}/approve`,
      { clientNote: 'Flagged: bulk_page_1: please double-check' },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const item1 = body.items.find((i: { id: string }) => i.id === bulkItem1Id);
    const item2 = body.items.find((i: { id: string }) => i.id === bulkItem2Id);
    expect(item1.status).toBe('approved');
    expect(item2.status).toBe('approved');
    expect(item1.clientNote).toBe('Flagged: bulk_page_1: please double-check');
    expect(item2.clientNote).toBe('Flagged: bulk_page_1: please double-check');
  });

  it('returns 400 when called again with no pending items remaining', async () => {
    const res = await patchJson(
      `/api/public/approvals/${testWsId}/${bulkBatchId}/approve`,
      {},
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/no pending/i);
  });

  it('does not approve a batch through the wrong workspace', async () => {
    const createRes = await postJson(`/api/approvals/${testWsId}`, {
      siteId: testSiteId,
      name: 'Cross-Workspace Batch',
      items: [{
        pageId: 'cross_page_1', pageSlug: '/cross-1', pageTitle: 'Cross Page 1',
        field: 'seoTitle', currentValue: 'Old', proposedValue: 'New',
      }],
    });
    const created = await createRes.json();
    const crossBatchId = created.id;

    const crossRes = await patchJson(
      `/api/public/approvals/${otherWsId}/${crossBatchId}/approve`,
      {},
    );
    expect(crossRes.status).toBe(404);

    // Verify item still pending
    const ownerRes = await api(`/api/approvals/${testWsId}/${crossBatchId}`);
    const ownerBatch = await ownerRes.json();
    expect(ownerBatch.items[0].status).toBe('pending');

    db.prepare('DELETE FROM approval_batches WHERE id = ?').run(crossBatchId);
  });
});
