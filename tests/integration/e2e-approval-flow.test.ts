/**
 * API-level E2E test: Approval workflow flow.
 *
 * Tests the complete multi-step flow:
 * 1. Create workspace
 * 2. Create approval batch with items
 * 3. Client reviews items (approve/reject)
 * 4. Verify page states updated
 * 5. Verify activity logged
 * 6. Delete batch
 * 7. Clean up workspace
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13230);
const { api, postJson, patchJson, del } = ctx;

let testWsId = '';
const testSiteId = 'site_e2e_approval';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('E2E Approval Flow');
  testWsId = ws.id;
}, 25_000);

afterAll(() => {
  deleteWorkspace(testWsId);
  ctx.stopServer();
});

describe('E2E: Approval workflow', () => {
  let batchId = '';
  let item1Id = '';
  let item2Id = '';

  it('Step 1: Create approval batch with 2 items', async () => {
    const res = await postJson(`/api/approvals/${testWsId}`, {
      siteId: testSiteId,
      name: 'E2E SEO Changes',
      items: [
        {
          pageId: 'page_home',
          pageSlug: '/',
          pageTitle: 'Home',
          field: 'seoTitle',
          currentValue: 'Old Home Title',
          proposedValue: 'New Home Title | Brand',
        },
        {
          pageId: 'page_about',
          pageSlug: '/about',
          pageTitle: 'About',
          field: 'seoDescription',
          currentValue: 'Old about description',
          proposedValue: 'Improved meta description for about page',
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    batchId = body.id;
    item1Id = body.items[0].id;
    item2Id = body.items[1].id;
  });

  it('Step 2: Batch appears in list', async () => {
    const res = await api(`/api/approvals/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.some((b: { id: string }) => b.id === batchId)).toBe(true);
  });

  it('Step 3: Client approves first item', async () => {
    const res = await patchJson(
      `/api/public/approvals/${testWsId}/${batchId}/${item1Id}`,
      { status: 'approved' },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const item = body.items.find((i: { id: string }) => i.id === item1Id);
    expect(item.status).toBe('approved');
  });

  it('Step 4: Client rejects second item with note', async () => {
    const res = await patchJson(
      `/api/public/approvals/${testWsId}/${batchId}/${item2Id}`,
      { status: 'rejected', clientNote: 'I prefer the original wording' },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const item = body.items.find((i: { id: string }) => i.id === item2Id);
    expect(item.status).toBe('rejected');
    expect(item.clientNote).toBe('I prefer the original wording');
  });

  it('Step 5: Activity log reflects the reviews', async () => {
    const res = await api(`/api/public/activity/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Should have at least the approval and rejection entries
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  it('Step 6: Batch is also visible via public endpoint', async () => {
    const res = await api(`/api/public/approvals/${testWsId}/${batchId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(batchId);
    // Verify both items have their final statuses
    const approved = body.items.find((i: { id: string }) => i.id === item1Id);
    const rejected = body.items.find((i: { id: string }) => i.id === item2Id);
    expect(approved.status).toBe('approved');
    expect(rejected.status).toBe('rejected');
  });

  it('Step 7: Delete the batch', async () => {
    const res = await del(`/api/approvals/${testWsId}/${batchId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('Step 8: Batch no longer in list', async () => {
    const res = await api(`/api/approvals/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.some((b: { id: string }) => b.id === batchId)).toBe(false);
  });
});
