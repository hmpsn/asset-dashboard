/**
 * Integration tests for feedback API endpoints.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/feedback (list all)
 * - GET /api/feedback/:workspaceId (list by workspace)
 * - PATCH /api/feedback/:workspaceId/:id (update status)
 * - POST /api/feedback/:workspaceId/:id/reply (add reply)
 * - DELETE /api/feedback/:workspaceId/:id (delete)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13220);
const { api, postJson, patchJson, del } = ctx;

let testWsId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Feedback Test Workspace');
  testWsId = ws.id;
}, 25_000);

afterAll(() => {
  deleteWorkspace(testWsId);
  ctx.stopServer();
});

describe('Feedback — list', () => {
  it('GET /api/feedback returns array', async () => {
    const res = await api('/api/feedback');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/feedback/:workspaceId returns array', async () => {
    const res = await api(`/api/feedback/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('Feedback — update status validation', () => {
  it('PATCH without status returns 400', async () => {
    const res = await patchJson(`/api/feedback/${testWsId}/fb_fake`, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid status');
  });

  it('PATCH with invalid status returns 400', async () => {
    const res = await patchJson(`/api/feedback/${testWsId}/fb_fake`, {
      status: 'bad_status',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid status');
  });

  it('PATCH with valid status but bad id returns 404', async () => {
    const res = await patchJson(`/api/feedback/${testWsId}/fb_nonexistent`, {
      status: 'acknowledged',
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not found');
  });
});

describe('Feedback — reply validation', () => {
  it('POST reply without content returns 400', async () => {
    const res = await postJson(`/api/feedback/${testWsId}/fb_fake/reply`, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Content required');
  });

  it('POST reply with empty content returns 400', async () => {
    const res = await postJson(`/api/feedback/${testWsId}/fb_fake/reply`, {
      content: '   ',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Content required');
  });

  it('POST reply with bad id returns 404', async () => {
    const res = await postJson(`/api/feedback/${testWsId}/fb_nonexistent/reply`, {
      content: 'Thanks for the feedback!',
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not found');
  });
});

describe('Feedback — delete', () => {
  it('DELETE with bad id returns 404', async () => {
    const res = await del(`/api/feedback/${testWsId}/fb_nonexistent`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not found');
  });
});
