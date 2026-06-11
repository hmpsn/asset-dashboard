/**
 * Public background-job read routes.
 *
 * Port: 13897 (next free in the sanctioned 13201–13899 range).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestContext } from './helpers.js';
import { createJob, updateJob } from '../../server/jobs.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';

const ctx = createTestContext(13897, { autoPublicAuth: true });
const { api, clearCookies } = ctx;

let passwordlessWorkspaceId = '';
let protectedWorkspaceId = '';
let publicJobId = '';
let privateJobId = '';

beforeAll(async () => {
  passwordlessWorkspaceId = createWorkspace('Public Jobs Passwordless').id;
  protectedWorkspaceId = createWorkspace('Public Jobs Protected').id;
  updateWorkspace(protectedWorkspaceId, { clientPassword: 'protected-jobs-password' });

  const publicJob = createJob(BACKGROUND_JOB_TYPES.RECOMMENDATIONS_GENERATION, {
    workspaceId: passwordlessWorkspaceId,
    status: 'done',
    message: 'Recommendations ready',
  });
  publicJobId = publicJob.id;
  updateJob(publicJobId, {
    status: 'done',
    result: {
      persisted: true,
      generatedAt: '2026-06-08T20:00:00.000Z',
      recommendationCount: 3,
    },
    error: 'internal diagnostics',
  });

  const privateJob = createJob(BACKGROUND_JOB_TYPES.PAGE_ANALYSIS, {
    workspaceId: passwordlessWorkspaceId,
    status: 'done',
    message: 'Page analysis complete',
  });
  privateJobId = privateJob.id;
  updateJob(privateJobId, {
    status: 'done',
    result: { score: 91 },
  });

  await ctx.startServer();
}, 25_000);

afterAll(async () => {
  deleteWorkspace(passwordlessWorkspaceId);
  deleteWorkspace(protectedWorkspaceId);
  await ctx.stopServer();
});

describe('GET /api/public/jobs/:workspaceId', () => {
  it('returns only client-visible jobs with scrubbed payloads', async () => {
    clearCookies();

    const res = await api(`/api/public/jobs/${passwordlessWorkspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<Record<string, unknown>>;

    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: publicJobId,
      type: BACKGROUND_JOB_TYPES.RECOMMENDATIONS_GENERATION,
      workspaceId: passwordlessWorkspaceId,
      message: 'Recommendations ready',
      error: 'internal diagnostics',
    });
    expect(body[0]).not.toHaveProperty('result');
    expect(body.some(job => job.id === privateJobId)).toBe(false);
  });

  it('returns 401 for a protected workspace without a portal session', async () => {
    clearCookies();

    const res = await api(`/api/public/jobs/${protectedWorkspaceId}`, {
      headers: { 'x-no-auto-public-auth': 'true' },
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/public/jobs/:workspaceId/:id', () => {
  it('returns a scrubbed public job detail record', async () => {
    clearCookies();

    const res = await api(`/api/public/jobs/${passwordlessWorkspaceId}/${publicJobId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;

    expect(body).toMatchObject({
      id: publicJobId,
      type: BACKGROUND_JOB_TYPES.RECOMMENDATIONS_GENERATION,
      workspaceId: passwordlessWorkspaceId,
    });
    expect(body).not.toHaveProperty('result');
  });

  it('404s for non-client-visible jobs even within the same workspace', async () => {
    clearCookies();

    const res = await api(`/api/public/jobs/${passwordlessWorkspaceId}/${privateJobId}`);
    expect(res.status).toBe(404);
  });
});
