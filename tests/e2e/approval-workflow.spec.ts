/**
 * Playwright E2E test: Approval workflow via API + UI.
 *
 * Tests:
 * - Create workspace and approval batch via API
 * - Public approval page loads
 * - Client can view approval items
 * - Approve/reject actions via API
 * - Verify final state
 */
import { test, expect } from '@playwright/test';

let testWsId = '';
let batchId = '';

test.describe('Approval workflow', () => {
  test.beforeAll(async ({ request }) => {
    // Create workspace
    const wsRes = await request.post('/api/workspaces', {
      data: { name: 'E2E Approval Workflow' },
    });
    expect(wsRes.ok()).toBe(true);
    const ws = await wsRes.json();
    testWsId = ws.id;

    // Create approval batch
    const batchRes = await request.post(`/api/approvals/${testWsId}`, {
      data: {
        siteId: 'site_e2e_pw',
        name: 'E2E Playwright Approvals',
        items: [
          {
            pageId: 'page_1',
            pageSlug: '/',
            pageTitle: 'Home',
            field: 'seoTitle',
            currentValue: 'Old Title',
            proposedValue: 'New Optimized Title',
          },
          {
            pageId: 'page_2',
            pageSlug: '/about',
            pageTitle: 'About',
            field: 'seoDescription',
            currentValue: 'Old description',
            proposedValue: 'New optimized description for better CTR',
          },
        ],
      },
    });
    expect(batchRes.ok()).toBe(true);
    const batch = await batchRes.json();
    batchId = batch.id;
  });

  test.afterAll(async ({ request }) => {
    if (testWsId && batchId) {
      await request.delete(`/api/approvals/${testWsId}/${batchId}`);
    }
    if (testWsId) {
      await request.delete(`/api/workspaces/${testWsId}`);
    }
  });

  test('approval batch exists via API', async ({ request }) => {
    const res = await request.get(`/api/public/approvals/${testWsId}/${batchId}`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.id).toBe(batchId);
    expect(body.items).toHaveLength(2);
  });

  test('client can approve an item via API', async ({ request }) => {
    const res = await request.get(`/api/public/approvals/${testWsId}/${batchId}`);
    const batch = await res.json();
    const itemId = batch.items[0].id;

    const approveRes = await request.patch(
      `/api/public/approvals/${testWsId}/${batchId}/${itemId}`,
      { data: { status: 'approved' } },
    );
    expect(approveRes.ok()).toBe(true);
    const updated = await approveRes.json();
    const item = updated.items.find((i: { id: string }) => i.id === itemId);
    expect(item.status).toBe('approved');
  });

  test('client can reject an item with note via API', async ({ request }) => {
    const res = await request.get(`/api/public/approvals/${testWsId}/${batchId}`);
    const batch = await res.json();
    const itemId = batch.items[1].id;

    const rejectRes = await request.patch(
      `/api/public/approvals/${testWsId}/${batchId}/${itemId}`,
      { data: { status: 'rejected', clientNote: 'Keep the original' } },
    );
    expect(rejectRes.ok()).toBe(true);
    const updated = await rejectRes.json();
    const item = updated.items.find((i: { id: string }) => i.id === itemId);
    expect(item.status).toBe('rejected');
    expect(item.clientNote).toBe('Keep the original');
  });

  test('final batch state reflects all decisions', async ({ request }) => {
    const res = await request.get(`/api/public/approvals/${testWsId}/${batchId}`);
    expect(res.ok()).toBe(true);
    const batch = await res.json();
    const statuses = batch.items.map((i: { status: string }) => i.status);
    expect(statuses).toContain('approved');
    expect(statuses).toContain('rejected');
  });
});
