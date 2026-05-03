/**
 * Integration tests for miscellaneous API endpoints.
 *
 * Tests endpoints not covered by other integration test files:
 * - GET /api/roadmap
 * - GET /api/jobs
 * - GET /api/settings
 * - GET /api/metadata
 * - GET /api/presence
 * - GET /api/queue
 * - GET /api/requests
 * - GET /api/google/status
 * - GET /api/semrush/status
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { signToken } from '../../server/auth.js';
import { createUser, deleteUser } from '../../server/users.js';
import { createContentSubscription, deleteContentSubscription } from '../../server/content-subscriptions.js';

const ctx = createTestContext(13209);
const { api, postJson, patchJson, del } = ctx;

let testWsId = '';
let otherWsId = '';
let scopedUserId = '';
let scopedUserToken = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Misc Test Workspace');
  testWsId = ws.id;
  const otherWs = createWorkspace('Misc Other Test Workspace');
  otherWsId = otherWs.id;
  const scopedUser = await createUser(
    'misc-scoped-user@test.local',
    'ScopedPass1!',
    'Misc Scoped User',
    'member',
    [testWsId],
  );
  scopedUserId = scopedUser.id;
  scopedUserToken = signToken({ userId: scopedUser.id, email: scopedUser.email, role: scopedUser.role });
}, 25_000);

afterAll(async () => {
  deleteUser(scopedUserId);
  deleteWorkspace(testWsId);
  deleteWorkspace(otherWsId);
  await ctx.stopServer();
});

describe('Miscellaneous read-only endpoints', () => {
  it('GET /api/roadmap returns 200', async () => {
    const res = await api('/api/roadmap');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });
});

describe('PATCH /api/roadmap/item/:id — Zod validation, sprint scoping, field whitelist', () => {
  // Pick the first sprint+item from the live roadmap as the test target. The
  // PATCH route mutates data/roadmap.json — we restore the original status at
  // the end so the test is idempotent across runs.
  let sprintId = '';
  let itemId: number | string = 0;
  let originalStatus: 'pending' | 'in_progress' | 'done' = 'pending';

  beforeAll(async () => {
    const res = await api('/api/roadmap');
    const body = await res.json() as { sprints: Array<{ id: string; items: Array<{ id: number | string; status: 'pending' | 'in_progress' | 'done' }> }> };
    const sprint = body.sprints.find(s => s.items.length > 0);
    if (!sprint) throw new Error('No sprint with items found in roadmap.json — cannot run PATCH integration tests');
    sprintId = sprint.id;
    itemId = sprint.items[0].id;
    originalStatus = sprint.items[0].status;
  });

  afterAll(async () => {
    // Restore so re-runs see the same baseline.
    await patchJson(`/api/roadmap/item/${encodeURIComponent(String(itemId))}?sprintId=${encodeURIComponent(sprintId)}`, { status: originalStatus });
  });

  it('PATCH with valid status updates the item', async () => {
    const newStatus = originalStatus === 'done' ? 'pending' : 'done';
    const res = await patchJson(`/api/roadmap/item/${encodeURIComponent(String(itemId))}?sprintId=${encodeURIComponent(sprintId)}`, { status: newStatus });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; item: { id: number | string; status: string } };
    expect(body.ok).toBe(true);
    expect(body.item.status).toBe(newStatus);
  });

  it('PATCH without sprintId query param returns 400', async () => {
    const res = await patchJson(`/api/roadmap/item/${encodeURIComponent(String(itemId))}`, { status: 'pending' });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/sprintId/);
  });

  it('PATCH with invalid status enum returns 400 (Zod)', async () => {
    const res = await patchJson(`/api/roadmap/item/${encodeURIComponent(String(itemId))}?sprintId=${encodeURIComponent(sprintId)}`, { status: 'bogus' });
    expect(res.status).toBe(400);
  });

  it('PATCH with unknown field returns 400 (strict schema)', async () => {
    const res = await patchJson(`/api/roadmap/item/${encodeURIComponent(String(itemId))}?sprintId=${encodeURIComponent(sprintId)}`, { id: 999, status: 'done' });
    expect(res.status).toBe(400);
  });

  it('PATCH with unknown sprintId returns 404', async () => {
    const res = await patchJson(`/api/roadmap/item/${encodeURIComponent(String(itemId))}?sprintId=does-not-exist`, { status: 'pending' });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Sprint not found/);
  });

  it('PATCH with unknown itemId returns 404', async () => {
    const res = await patchJson(`/api/roadmap/item/9999999?sprintId=${encodeURIComponent(sprintId)}`, { status: 'pending' });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Item not found/);
  });
});

describe('Miscellaneous read-only endpoints (cont.)', () => {
  it('GET /api/jobs returns 200', async () => {
    const res = await api('/api/jobs');
    expect(res.status).toBe(200);
  });

  it('GET /api/settings returns 200', async () => {
    const res = await api('/api/settings');
    expect(res.status).toBe(200);
  });

  it('GET /api/metadata returns 200', async () => {
    const res = await api('/api/metadata');
    expect(res.status).toBe(200);
  });

  it('GET /api/presence returns 200 with object', async () => {
    const res = await api('/api/presence');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body).toBe('object');
  });

  it('GET /api/queue returns 200', async () => {
    const res = await api('/api/queue');
    expect(res.status).toBe(200);
  });

  it('GET /api/google/status returns 200', async () => {
    const res = await api('/api/google/status');
    expect(res.status).toBe(200);
  });

  it('GET /api/semrush/status returns 200', async () => {
    const res = await api('/api/semrush/status');
    expect(res.status).toBe(200);
  });
});

describe('Scoped JWT workspace guards for workspace-keyed endpoints', () => {
  const scopedHeaders = () => ({ Authorization: `Bearer ${scopedUserToken}` });
  let otherSubscriptionId = '';

  it('rejects Google annotation reads for a workspace outside the JWT scope', async () => {
    const res = await api(`/api/google/annotations/${otherWsId}`, { headers: scopedHeaders() });
    expect(res.status).toBe(403);
  });

  it('rejects Stripe payment reads for a workspace outside the JWT scope', async () => {
    const res = await api(`/api/stripe/payments/${otherWsId}`, { headers: scopedHeaders() });
    expect(res.status).toBe(403);
  });

  it('rejects keyword strategy reads for a workspace outside the JWT scope', async () => {
    const res = await api(`/api/webflow/keyword-strategy/${otherWsId}`, { headers: scopedHeaders() });
    expect(res.status).toBe(403);
  });

  it('allows keyword strategy reads for the JWT-scoped workspace', async () => {
    const res = await api(`/api/webflow/keyword-strategy/${testWsId}`, { headers: scopedHeaders() });
    expect(res.status).not.toBe(403);
  });

  it('rejects keyword strategy patches for a workspace outside the JWT scope', async () => {
    const res = await ctx.api(`/api/webflow/keyword-strategy/${otherWsId}`, {
      method: 'PATCH',
      headers: { ...scopedHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteKeywords: [] }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects keyword feedback mutations for a workspace outside the JWT scope', async () => {
    const res = await ctx.api(`/api/webflow/keyword-feedback/${otherWsId}`, {
      method: 'POST',
      headers: { ...scopedHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: 'cross workspace keyword', status: 'approved' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects Webflow asset reads when the workspace query is outside the JWT scope', async () => {
    const res = await api(`/api/webflow/assets/site_guard_test?workspaceId=${otherWsId}`, { headers: scopedHeaders() });
    expect(res.status).toBe(403);
  });

  it('rejects Webflow asset mutations when the body workspace is outside the JWT scope', async () => {
    const res = await ctx.api('/api/webflow/assets/asset_guard_test', {
      method: 'PATCH',
      headers: { ...scopedHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ altText: 'Blocked', siteId: 'site_guard_test', workspaceId: otherWsId }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects CMS image scans when the workspace query is outside the JWT scope', async () => {
    const res = await api(`/api/webflow/cms-images/site_guard_test?workspaceId=${otherWsId}`, { headers: scopedHeaders() });
    expect(res.status).toBe(403);
  });

  it('rejects content subscription reads by id when the row belongs to another workspace', async () => {
    const sub = createContentSubscription(otherWsId, {
      plan: 'content_starter',
      postsPerMonth: 2,
      priceUsd: 499,
      status: 'active',
    });
    otherSubscriptionId = sub.id;

    const res = await api(`/api/content-subscription/${sub.id}`, { headers: scopedHeaders() });
    expect(res.status).toBe(403);
  });

  it('rejects content subscription updates by id when the row belongs to another workspace', async () => {
    if (!otherSubscriptionId) {
      const sub = createContentSubscription(otherWsId, {
        plan: 'content_starter',
        postsPerMonth: 2,
        priceUsd: 499,
        status: 'active',
      });
      otherSubscriptionId = sub.id;
    }

    const res = await ctx.api(`/api/content-subscription/${otherSubscriptionId}`, {
      method: 'PATCH',
      headers: { ...scopedHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paused' }),
    });
    expect(res.status).toBe(403);
    deleteContentSubscription(otherWsId, otherSubscriptionId);
    otherSubscriptionId = '';
  });

  it('rejects content subscription deletes by id when the row belongs to another workspace', async () => {
    const sub = createContentSubscription(otherWsId, {
      plan: 'content_starter',
      postsPerMonth: 2,
      priceUsd: 499,
      status: 'active',
    });

    const res = await ctx.api(`/api/content-subscription/${sub.id}`, {
      method: 'DELETE',
      headers: scopedHeaders(),
    });
    expect(res.status).toBe(403);
    deleteContentSubscription(otherWsId, sub.id);
  });

  it('rejects delivered-count updates when the subscription belongs to another workspace', async () => {
    const sub = createContentSubscription(otherWsId, {
      plan: 'content_starter',
      postsPerMonth: 2,
      priceUsd: 499,
      status: 'active',
    });

    const res = await ctx.api(`/api/content-subscription/${sub.id}/delivered`, {
      method: 'POST',
      headers: { ...scopedHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 1 }),
    });
    expect(res.status).toBe(403);
    deleteContentSubscription(otherWsId, sub.id);
  });
});

describe('Requests CRUD via API', () => {
  let requestId = '';
  let otherRequestId = '';

  it('GET /api/requests returns 200 with array', async () => {
    const res = await api('/api/requests');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('POST /api/requests creates a request', async () => {
    const res = await postJson('/api/requests', {
      workspaceId: testWsId,
      title: 'Integration test request',
      description: 'Created by integration test',
      category: 'seo',
      priority: 'medium',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body.title).toBe('Integration test request');
    expect(body.workspaceId).toBe(testWsId);
    requestId = body.id;
  });

  it('POST /api/requests without required fields returns 400', async () => {
    const res = await postJson('/api/requests', {});
    expect(res.status).toBe(400);
  });

  it('rejects scoped JWT access to another workspace request by id', async () => {
    const createRes = await postJson('/api/requests', {
      workspaceId: otherWsId,
      title: 'Other workspace request',
      description: 'Should not be visible to scoped user',
      category: 'seo',
      priority: 'medium',
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json();
    otherRequestId = created.id;

    const headers = { Authorization: `Bearer ${scopedUserToken}` };
    const getRes = await api(`/api/requests/${otherRequestId}`, { headers });
    expect(getRes.status).toBe(403);

    const patchRes = await ctx.api(`/api/requests/${otherRequestId}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    });
    expect(patchRes.status).toBe(403);

    const deleteRes = await ctx.api(`/api/requests/${otherRequestId}`, {
      method: 'DELETE',
      headers,
    });
    expect(deleteRes.status).toBe(403);
  });

  it('rejects scoped JWT bulk update without mutating accessible requests first', async () => {
    const accessibleRes = await postJson('/api/requests', {
      workspaceId: testWsId,
      title: 'Scoped bulk accessible request',
      description: 'Should remain pending after forbidden bulk update',
      category: 'seo',
      priority: 'medium',
    });
    expect(accessibleRes.status).toBe(200);
    const accessible = await accessibleRes.json();

    const forbiddenRes = await postJson('/api/requests', {
      workspaceId: otherWsId,
      title: 'Scoped bulk forbidden request',
      description: 'Should block the whole bulk update',
      category: 'seo',
      priority: 'medium',
    });
    expect(forbiddenRes.status).toBe(200);
    const forbidden = await forbiddenRes.json();

    const bulkRes = await ctx.api('/api/requests/bulk', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${scopedUserToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: [accessible.id, forbidden.id], status: 'completed' }),
    });
    expect(bulkRes.status).toBe(403);

    const checkRes = await api(`/api/requests/${accessible.id}`);
    expect(checkRes.status).toBe(200);
    const checked = await checkRes.json();
    expect(checked.status).not.toBe('completed');

    await del(`/api/requests/${accessible.id}`);
    await del(`/api/requests/${forbidden.id}`);
  });

  it('GET /api/requests/:id returns the created request', async () => {
    const res = await api(`/api/requests/${requestId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(requestId);
    expect(body.title).toBe('Integration test request');
  });

  it('GET /api/requests?workspaceId= filters by workspace', async () => {
    const res = await api(`/api/requests?workspaceId=${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThanOrEqual(1);
    for (const req of body) {
      expect(req.workspaceId).toBe(testWsId);
    }
  });

  it('DELETE /api/requests/:id removes the request', async () => {
    const res = await del(`/api/requests/${requestId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('GET /api/requests/:id after delete returns 404', async () => {
    const res = await api(`/api/requests/${requestId}`);
    expect(res.status).toBe(404);
  });

  afterAll(async () => {
    if (otherRequestId) {
      await del(`/api/requests/${otherRequestId}`);
    }
  });
});
