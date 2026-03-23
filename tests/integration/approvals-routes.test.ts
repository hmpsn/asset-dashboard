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

const ctx = createTestContext(13214);
const { api, postJson, patchJson, del } = ctx;

let testWsId = '';
const testSiteId = 'site_approval_test';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Approvals Test Workspace');
  testWsId = ws.id;
}, 25_000);

afterAll(() => {
  deleteWorkspace(testWsId);
  ctx.stopServer();
});

describe('Approvals — create validation', () => {
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

  // Delete
  it('DELETE removes the batch', async () => {
    const res = await del(`/api/approvals/${testWsId}/${batchId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
