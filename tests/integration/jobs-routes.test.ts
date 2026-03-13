/**
 * Integration tests for jobs API endpoints.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/jobs (list)
 * - GET /api/jobs/:id (get single)
 * - POST /api/jobs (create — validation only, actual job types need external APIs)
 * - DELETE /api/jobs/:id (cancel)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13210);
const { api, postJson, del } = ctx;

let testWsId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Jobs Test Workspace');
  testWsId = ws.id;
}, 25_000);

afterAll(() => {
  deleteWorkspace(testWsId);
  ctx.stopServer();
});

describe('Jobs — list and get', () => {
  it('GET /api/jobs returns 200 with array', async () => {
    const res = await api('/api/jobs');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/jobs?workspaceId= filters by workspace', async () => {
    const res = await api(`/api/jobs?workspaceId=${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/jobs/:id with bad id returns 404', async () => {
    const res = await api('/api/jobs/job_nonexistent_999');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Job not found');
  });

  it('DELETE /api/jobs/:id with bad id returns 404', async () => {
    const res = await del('/api/jobs/job_nonexistent_999');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Job not found');
  });
});

describe('Jobs — creation validation', () => {
  it('POST /api/jobs without type returns 400', async () => {
    const res = await postJson('/api/jobs', { params: {} });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('type required');
  });

  it('POST /api/jobs with seo-audit without siteId returns 400', async () => {
    const res = await postJson('/api/jobs', {
      type: 'seo-audit',
      params: { workspaceId: testWsId },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('siteId required');
  });

  it('POST /api/jobs with compress without required params returns 400', async () => {
    const res = await postJson('/api/jobs', {
      type: 'compress',
      params: { workspaceId: testWsId },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('required');
  });

  it('POST /api/jobs with bulk-compress without assets returns 400', async () => {
    const res = await postJson('/api/jobs', {
      type: 'bulk-compress',
      params: { workspaceId: testWsId },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('required');
  });

  it('POST /api/jobs with bulk-alt without assets returns 400', async () => {
    const res = await postJson('/api/jobs', {
      type: 'bulk-alt',
      params: { workspaceId: testWsId },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('required');
  });
});
