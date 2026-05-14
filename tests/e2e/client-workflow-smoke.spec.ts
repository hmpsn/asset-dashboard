import { expect, test } from '@playwright/test';

let workspaceId = '';
let approvalBatchId = '';
let approvalItemId = '';

test.describe('Client workflow smoke pack', () => {
  test.beforeAll(async ({ request }) => {
    const wsRes = await request.post('/api/workspaces', {
      data: { name: 'E2E Client Workflow Smoke' },
    });
    expect(wsRes.ok()).toBe(true);
    const wsBody = await wsRes.json();
    workspaceId = wsBody.id;

    await request.patch(`/api/workspaces/${workspaceId}`, {
      data: {
        clientPortalEnabled: true,
        tier: 'growth',
        billingMode: 'platform',
      },
    });
  });

  test.afterAll(async ({ request }) => {
    if (approvalBatchId) {
      await request.delete(`/api/approvals/${workspaceId}/${approvalBatchId}`);
    }
    if (workspaceId) {
      await request.delete(`/api/workspaces/${workspaceId}`);
    }
  });

  test('workflow smoke: admin send-to-client decision converges to admin read path', async ({ request }) => {
    const createBatchRes = await request.post(`/api/approvals/${workspaceId}`, {
      data: {
        siteId: `smoke-site-${Date.now()}`,
        name: 'Smoke Decision Batch',
        items: [{
          pageId: 'smoke-page-1',
          pageSlug: '/smoke-page',
          pageTitle: 'Smoke Page',
          field: 'seoTitle',
          currentValue: 'Old Smoke Title',
          proposedValue: 'New Smoke Title',
        }],
      },
    });
    expect(createBatchRes.ok()).toBe(true);
    const batch = await createBatchRes.json();
    approvalBatchId = batch.id;
    approvalItemId = batch.items[0].id;

    const publicListRes = await request.get(`/api/public/approvals/${workspaceId}`);
    expect(publicListRes.ok()).toBe(true);
    const publicList = await publicListRes.json() as Array<{ id: string }>;
    expect(publicList.some(item => item.id === approvalBatchId)).toBe(true);

    const publicApproveRes = await request.patch(`/api/public/approvals/${workspaceId}/${approvalBatchId}/${approvalItemId}`, {
      data: { status: 'approved' },
    });
    expect(publicApproveRes.ok()).toBe(true);

    const adminDetailRes = await request.get(`/api/approvals/${workspaceId}/${approvalBatchId}`);
    expect(adminDetailRes.ok()).toBe(true);
    const adminDetail = await adminDetailRes.json();
    const item = adminDetail.items.find((entry: { id: string }) => entry.id === approvalItemId);
    expect(item.status).toBe('approved');
  });

  test('client smoke: tier and billing visibility endpoints remain coherent', async ({ request }) => {
    const workspaceRes = await request.get(`/api/public/workspace/${workspaceId}`);
    expect(workspaceRes.ok()).toBe(true);
    const workspaceBody = await workspaceRes.json();

    expect(workspaceBody.id).toBe(workspaceId);
    expect(workspaceBody.tier).toBe('growth');
    expect(workspaceBody.baseTier).toBe('growth');
    expect(workspaceBody.billingMode).toBe('platform');
    expect(typeof workspaceBody.stripeEnabled).toBe('boolean');

    const tierRes = await request.get(`/api/public/tier/${workspaceId}`);
    expect(tierRes.ok()).toBe(true);
    const tierBody = await tierRes.json();

    expect(tierBody.tier).toBe('growth');
    expect(tierBody.baseTier).toBe('growth');
    expect(tierBody.isTrial).toBe(false);
  });

  test('workflow smoke: deep-link URL and async job status surfaces remain healthy', async ({ page, request }) => {
    await page.goto(`/client/${workspaceId}/inbox?tab=decisions`);
    await expect(page.locator('body')).not.toBeEmpty();
    await expect(page).toHaveURL(new RegExp(`/client/${workspaceId}/inbox\\?tab=decisions`));

    const jobStartRes = await request.post('/api/jobs', {
      data: {
        type: 'sales-report',
        params: { url: 'https://invalid.invalid' },
      },
    });
    expect(jobStartRes.ok()).toBe(true);
    const jobStartBody = await jobStartRes.json();
    expect(typeof jobStartBody.jobId).toBe('string');

    let terminal: { status: string; message?: string; error?: string } | null = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      const statusRes = await request.get(`/api/jobs/${jobStartBody.jobId}`);
      expect(statusRes.ok()).toBe(true);
      const statusBody = await statusRes.json() as { status: string; message?: string; error?: string };
      if (statusBody.status === 'done' || statusBody.status === 'error' || statusBody.status === 'cancelled') {
        terminal = statusBody;
        break;
      }
      await page.waitForTimeout(250);
    }

    expect(terminal).not.toBeNull();
    expect(['done', 'error', 'cancelled']).toContain(terminal!.status);
    expect(
      typeof terminal!.message === 'string' ||
      typeof terminal!.error === 'string',
    ).toBe(true);
  });
});
