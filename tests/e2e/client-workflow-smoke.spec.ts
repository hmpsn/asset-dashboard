import { expect, test } from '@playwright/test';

let workspaceId = '';
let freeTierWorkspaceId = '';
let approvalBatchId = '';
let approvalItemId = '';
let schemaSiteId = '';

test.describe('Client workflow smoke pack', () => {
  test.beforeAll(async ({ request }) => {
    const wsRes = await request.post('/api/workspaces', {
      data: { name: 'E2E Client Workflow Smoke' },
    });
    expect(wsRes.ok()).toBe(true);
    const wsBody = await wsRes.json();
    workspaceId = wsBody.id;
    schemaSiteId = `schema-smoke-${Date.now()}`;

    await request.patch(`/api/workspaces/${workspaceId}`, {
      data: {
        clientPortalEnabled: true,
        tier: 'growth',
        billingMode: 'platform',
        webflowSiteId: schemaSiteId,
      },
    });

    const freeWsRes = await request.post('/api/workspaces', {
      data: { name: 'E2E Client Workflow Smoke Free Tier' },
    });
    expect(freeWsRes.ok()).toBe(true);
    const freeWsBody = await freeWsRes.json();
    freeTierWorkspaceId = freeWsBody.id;

    await request.patch(`/api/workspaces/${freeTierWorkspaceId}`, {
      data: {
        clientPortalEnabled: true,
        tier: 'free',
        billingMode: 'platform',
      },
    });
  });

  test.afterAll(async ({ request }) => {
    if (approvalBatchId) {
      await request.delete(`/api/approvals/${workspaceId}/${approvalBatchId}`);
    }
    if (schemaSiteId) {
      await request.delete(`/api/webflow/schema-plan/${schemaSiteId}`).catch(() => undefined);
    }
    if (workspaceId) {
      await request.delete(`/api/workspaces/${workspaceId}`);
    }
    if (freeTierWorkspaceId) {
      await request.delete(`/api/workspaces/${freeTierWorkspaceId}`);
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

  test('client smoke: free tier public workspace + tier endpoints stay coherent', async ({ request }) => {
    const [workspaceRes, tierRes, requestsRes] = await Promise.all([
      request.get(`/api/public/workspace/${freeTierWorkspaceId}`),
      request.get(`/api/public/tier/${freeTierWorkspaceId}`),
      request.get(`/api/public/content-requests/${freeTierWorkspaceId}`),
    ]);

    expect(workspaceRes.ok()).toBe(true);
    expect(tierRes.ok()).toBe(true);
    expect(requestsRes.ok()).toBe(true);

    const workspaceBody = await workspaceRes.json() as { tier: string; baseTier: string; id: string };
    const tierBody = await tierRes.json() as { tier: string; baseTier: string; isTrial: boolean };
    const requestsBody = await requestsRes.json() as Array<unknown>;

    expect(workspaceBody.id).toBe(freeTierWorkspaceId);
    expect(workspaceBody.tier).toBe(tierBody.tier);
    expect(workspaceBody.baseTier).toBe('free');
    expect(tierBody.baseTier).toBe('free');
    expect(typeof tierBody.isTrial).toBe('boolean');
    expect(Array.isArray(requestsBody)).toBe(true);
  });

  test('workflow smoke: schema + content publish visibility stays coherent across public reads', async ({ request }) => {
    const requestRes = await request.post(`/api/public/content-request/${workspaceId}`, {
      data: {
        topic: `Smoke Publish Topic ${Date.now()}`,
        targetKeyword: 'smoke publish keyword',
        intent: 'informational',
        priority: 'medium',
        rationale: 'Smoke visibility flow',
        source: 'client',
        serviceType: 'brief_only',
      },
    });
    expect(requestRes.ok()).toBe(true);
    const created = await requestRes.json() as { id: string };

    const deliveredRes = await request.patch(`/api/content-requests/${workspaceId}/${created.id}`, {
      data: {
        status: 'delivered',
        deliveryUrl: 'https://example.test/smoke-publish',
        deliveryNotes: 'Ready to publish',
      },
    });
    expect(deliveredRes.ok()).toBe(true);

    const publishedRes = await request.patch(`/api/content-requests/${workspaceId}/${created.id}`, {
      data: { status: 'published' },
    });
    expect(publishedRes.ok()).toBe(true);

    const publicContentRes = await request.get(`/api/public/content-requests/${workspaceId}`);
    expect(publicContentRes.ok()).toBe(true);
    const publicContent = await publicContentRes.json() as Array<{ id: string; status: string; deliveryUrl?: string }>;
    const published = publicContent.find(item => item.id === created.id);
    expect(published).toBeDefined();
    expect(published?.status).toBe('published');
    expect(published?.deliveryUrl).toBe('https://example.test/smoke-publish');

    const generatePlanRes = await request.post(`/api/webflow/schema-plan/${schemaSiteId}`);
    expect(generatePlanRes.ok()).toBe(true);

    const sendPlanRes = await request.post(`/api/webflow/schema-plan/${schemaSiteId}/send-to-client`);
    expect(sendPlanRes.ok()).toBe(true);

    const publicSchemaRes = await request.get(`/api/public/schema-plan/${workspaceId}`);
    expect(publicSchemaRes.ok()).toBe(true);
    const publicSchema = await publicSchemaRes.json() as { id: string; status: string };
    expect(publicSchema).toBeTruthy();
    expect(typeof publicSchema.id).toBe('string');
    expect(publicSchema.status).toBe('sent_to_client');

    const feedbackRes = await request.post(`/api/public/schema-plan/${workspaceId}/feedback`, {
      data: { action: 'approve' },
    });
    expect(feedbackRes.ok()).toBe(true);

    const approvedSchemaRes = await request.get(`/api/public/schema-plan/${workspaceId}`);
    expect(approvedSchemaRes.ok()).toBe(true);
    const approvedSchema = await approvedSchemaRes.json() as { status: string };
    expect(approvedSchema.status).toBe('client_approved');
  });
});
