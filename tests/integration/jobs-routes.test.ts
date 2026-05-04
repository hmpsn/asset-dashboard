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
import { signToken } from '../../server/auth.js';
import { createUser, deleteUser } from '../../server/users.js';
import { createJob, updateJob, clearCompletedJobs } from '../../server/jobs.js';

const ctx = createTestContext(13210);
const { api, postJson, del } = ctx;

let testWsId = '';
let otherWsId = '';
let scopedUserId = '';
let scopedUserToken = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Jobs Test Workspace');
  testWsId = ws.id;
  const otherWs = createWorkspace('Jobs Other Workspace');
  otherWsId = otherWs.id;
  const scopedUser = await createUser(
    'jobs-scoped-user@test.local',
    'ScopedPass1!',
    'Jobs Scoped User',
    'member',
    [testWsId],
  );
  scopedUserId = scopedUser.id;
  scopedUserToken = signToken({ userId: scopedUser.id, email: scopedUser.email, role: scopedUser.role });
}, 25_000);

afterAll(async () => {
  clearCompletedJobs();
  deleteUser(scopedUserId);
  deleteWorkspace(testWsId);
  deleteWorkspace(otherWsId);
  await ctx.stopServer();
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

describe('Jobs — scoped JWT workspace guards', () => {
  const scopedHeaders = () => ({ Authorization: `Bearer ${scopedUserToken}` });

  it('rejects listing jobs for a workspace outside the JWT scope', async () => {
    const res = await api(`/api/jobs?workspaceId=${otherWsId}`, { headers: scopedHeaders() });
    expect(res.status).toBe(403);
  });

  it('rejects reading a job owned by another workspace', async () => {
    const job = createJob('tenancy-regression', { workspaceId: otherWsId, message: 'cross workspace' });
    updateJob(job.id, { status: 'done' });

    const res = await api(`/api/jobs/${job.id}`, { headers: scopedHeaders() });
    expect(res.status).toBe(403);
  });

  it('rejects creating a workspace job outside the JWT scope before job-type validation', async () => {
    const res = await ctx.api('/api/jobs', {
      method: 'POST',
      headers: { ...scopedHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'seo-audit',
        params: { workspaceId: otherWsId },
      }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects clearing completed jobs for a workspace outside the JWT scope', async () => {
    const res = await ctx.api(`/api/jobs/completed?workspaceId=${otherWsId}`, {
      method: 'DELETE',
      headers: scopedHeaders(),
    });
    expect(res.status).toBe(403);
  });
});

describe('Jobs — completed clear scope', () => {
  it('clears completed jobs for only the requested workspace', async () => {
    clearCompletedJobs();
    const workspaceJob = createJob('tenancy-regression', { workspaceId: testWsId, message: 'workspace done' });
    const otherJob = createJob('tenancy-regression', { workspaceId: otherWsId, message: 'other done' });
    const globalJob = createJob('tenancy-regression', { message: 'global done' });
    updateJob(workspaceJob.id, { status: 'done' });
    updateJob(otherJob.id, { status: 'done' });
    updateJob(globalJob.id, { status: 'done' });

    const res = await del(`/api/jobs/completed?workspaceId=${testWsId}`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ cleared: 1 });

    expect(await api(`/api/jobs/${workspaceJob.id}`)).toHaveProperty('status', 404);
    expect(await api(`/api/jobs/${otherJob.id}`)).toHaveProperty('status', 200);
    expect(await api(`/api/jobs/${globalJob.id}`)).toHaveProperty('status', 200);
  });

  it('clears completed global jobs without deleting workspace jobs', async () => {
    clearCompletedJobs();
    const workspaceJob = createJob('tenancy-regression', { workspaceId: testWsId, message: 'workspace done' });
    const globalJob = createJob('tenancy-regression', { message: 'global done' });
    updateJob(workspaceJob.id, { status: 'done' });
    updateJob(globalJob.id, { status: 'done' });

    const res = await del('/api/jobs/completed?scope=global');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ cleared: 1 });

    expect(await api(`/api/jobs/${workspaceJob.id}`)).toHaveProperty('status', 200);
    expect(await api(`/api/jobs/${globalJob.id}`)).toHaveProperty('status', 404);
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
