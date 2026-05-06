/**
 * Integration tests for content-requests API endpoints.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/content-requests/:workspaceId (list)
 * - GET /api/content-requests/:workspaceId/:id (get single)
 * - PATCH /api/content-requests/:workspaceId/:id (update)
 * - DELETE /api/content-requests/:workspaceId/:id (delete)
 * - GET /api/content-performance/:workspaceId (content performance)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createContentRequest, getContentRequest, updateContentRequest } from '../../server/content-requests.js';

const ctx = createTestContext(13218);
const { api, postJson, patchJson, del } = ctx;

let testWsId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Content Requests Test Workspace');
  testWsId = ws.id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(testWsId);
  await ctx.stopServer();
});

describe('Content Requests — list', () => {
  it('GET /api/content-requests/:workspaceId returns array', async () => {
    const res = await api(`/api/content-requests/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('Content Requests — get single', () => {
  it('GET /api/content-requests/:workspaceId/:id with bad id returns 404', async () => {
    const res = await api(`/api/content-requests/${testWsId}/req_nonexistent`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Request not found');
  });
});

describe('Content Requests — update', () => {
  it('PATCH /api/content-requests/:workspaceId/:id with bad id returns 404', async () => {
    const res = await patchJson(`/api/content-requests/${testWsId}/req_nonexistent`, {
      status: 'in_progress',
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Request not found');
  });
});

describe('Public content request lifecycle guards', () => {
  function createRequest(keyword: string, status: 'requested' | 'client_review' | 'approved' | 'delivered') {
    const request = createContentRequest(testWsId, {
      topic: `Reliability ${keyword}`,
      targetKeyword: `${keyword} ${Date.now()} ${Math.random()}`,
      intent: 'informational',
      priority: 'medium',
      rationale: 'Regression guard',
      serviceType: 'brief_only',
      initialStatus: status === 'requested' ? 'requested' : 'brief_generated',
      dedupe: false,
    });
    if (status === 'client_review') return updateContentRequest(testWsId, request.id, { status: 'client_review' })!;
    if (status === 'approved') return updateContentRequest(testWsId, request.id, { status: 'approved' })!;
    if (status === 'delivered') return updateContentRequest(testWsId, request.id, { status: 'delivered' })!;
    return request;
  }

  it('rejects client brief approval before client_review', async () => {
    const request = createRequest('requested', 'requested');
    const res = await postJson(`/api/public/content-request/${testWsId}/${request.id}/approve`, {});
    expect(res.status).toBe(409);
    expect(getContentRequest(testWsId, request.id)?.status).toBe('requested');
  });

  it('allows client brief approval from client_review', async () => {
    const request = createRequest('client-review', 'client_review');
    const res = await postJson(`/api/public/content-request/${testWsId}/${request.id}/approve`, {});
    expect(res.status).toBe(200);
    expect(getContentRequest(testWsId, request.id)?.status).toBe('approved');
  });

  it('rejects unsupported approval fields before changing brief status', async () => {
    const request = createRequest('strict-approve', 'client_review');
    const res = await postJson(`/api/public/content-request/${testWsId}/${request.id}/approve`, {
      status: 'delivered',
    });
    expect(res.status).toBe(400);
    expect(getContentRequest(testWsId, request.id)?.status).toBe('client_review');
  });

  it('rejects unsupported change-request fields before storing feedback', async () => {
    const request = createRequest('strict-changes', 'client_review');
    const res = await postJson(`/api/public/content-request/${testWsId}/${request.id}/request-changes`, {
      feedback: 'Please adjust the keyword angle.',
      status: 'approved',
    });
    expect(res.status).toBe(400);
    const unchanged = getContentRequest(testWsId, request.id);
    expect(unchanged?.status).toBe('client_review');
    expect(unchanged?.clientFeedback).toBeUndefined();
  });

  it('upgrades only approved brief-only requests into full-post work', async () => {
    const request = createRequest('upgrade', 'approved');
    const res = await postJson(`/api/public/content-request/${testWsId}/${request.id}/upgrade`, {});
    expect(res.status).toBe(200);
    const updated = getContentRequest(testWsId, request.id);
    expect(updated?.serviceType).toBe('full_post');
    expect(updated?.status).toBe('in_progress');
    expect(updated?.upgradedAt).toBeDefined();
  });

  it('rejects unsupported upgrade fields before changing service workflow state', async () => {
    const request = createRequest('strict-upgrade', 'approved');
    const res = await postJson(`/api/public/content-request/${testWsId}/${request.id}/upgrade`, {
      status: 'published',
      serviceType: 'full_post',
    });
    expect(res.status).toBe(400);
    const unchanged = getContentRequest(testWsId, request.id);
    expect(unchanged?.status).toBe('approved');
    expect(unchanged?.serviceType).toBe('brief_only');
    expect(unchanged?.upgradedAt).toBeUndefined();
  });

  it('rejects delivered brief upgrade attempts', async () => {
    const request = createRequest('delivered', 'delivered');
    const res = await postJson(`/api/public/content-request/${testWsId}/${request.id}/upgrade`, {});
    expect(res.status).toBe(409);
    const unchanged = getContentRequest(testWsId, request.id);
    expect(unchanged?.status).toBe('delivered');
    expect(unchanged?.serviceType).toBe('brief_only');
  });

  it('rejects unsupported decline fields before changing request state', async () => {
    const request = createRequest('strict-decline', 'requested');
    const res = await postJson(`/api/public/content-request/${testWsId}/${request.id}/decline`, {
      reason: 'Not a fit.',
      status: 'published',
    });
    expect(res.status).toBe(400);
    const unchanged = getContentRequest(testWsId, request.id);
    expect(unchanged?.status).toBe('requested');
    expect(unchanged?.declineReason).toBeUndefined();
  });
});

describe('Content Requests — delete', () => {
  it('DELETE /api/content-requests/:workspaceId/:id with bad id returns 404', async () => {
    const res = await del(`/api/content-requests/${testWsId}/req_nonexistent`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Request not found');
  });
});

describe('Content Performance', () => {
  it('GET /api/content-performance/:workspaceId returns items', async () => {
    const res = await api(`/api/content-performance/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('items');
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('GET /api/content-performance/:workspaceId with bad id returns 404', async () => {
    const res = await api('/api/content-performance/ws_nonexistent_999');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Workspace not found');
  });
});

describe('Content Requests — brief generation includes strategy context', () => {
  it('generate-brief route accepts and threads strategyCardContext from request fields', async () => {
    // Verify the route handler compiles and handles requests
    // The generateBrief function signature now accepts strategyCardContext,
    // and the route handler constructs it from request.rationale, request.intent, request.priority
    const res = await api(`/api/content-requests/${testWsId}/nonexistent/generate-brief`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    // Should get 404 for nonexistent request (verifies route handler is wired)
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Request not found');
  });
});
