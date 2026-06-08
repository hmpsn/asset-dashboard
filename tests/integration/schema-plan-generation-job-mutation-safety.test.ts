import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: Record<string, unknown> }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: Record<string, unknown>) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/helpers.js', async () => {
  const actual = await vi.importActual<typeof import('../../server/helpers.js')>('../../server/helpers.js');
  return {
    ...actual,
    buildSchemaContext: vi.fn(async () => ({
      ctx: {
        siteId: 'unused',
        workspaceId: 'unused',
        companyName: 'Schema Test Co',
        businessContext: 'Technical SEO agency',
        liveDomain: 'schema-test.example',
      },
    })),
  };
});

vi.mock('../../server/schema-intelligence.js', () => ({
  buildSchemaIntelligence: vi.fn(async () => ({
    baseUrl: 'https://schema-test.example',
    seoContext: {
      strategy: 'Use consistent Organization, Service, and FAQ schema where appropriate.',
    },
  })),
}));

vi.mock('../../server/site-architecture.js', () => ({
  getCachedArchitecture: vi.fn(async () => ({
    pages: [
      { path: '/', title: 'Home' },
      { path: '/services', title: 'Services' },
    ],
  })),
}));

vi.mock('../../server/schema-plan.js', async () => {
  const { saveSchemaPlan } = await import('../../server/schema-store.js');
  return {
    generateSchemaPlan: vi.fn(async ({
      siteId,
      workspaceId,
      siteUrl,
      companyName,
    }: {
      siteId: string;
      workspaceId: string;
      siteUrl: string;
      companyName: string;
    }) => {
      const now = new Date().toISOString();
      return saveSchemaPlan({
        id: `schema-plan-${siteId}`,
        siteId,
        workspaceId,
        siteUrl,
        status: 'draft',
        canonicalEntities: [
          {
            id: 'entity-org',
            name: companyName,
            type: 'Organization',
            description: 'Primary organization entity',
          },
        ],
        pageRoles: [
          {
            pagePath: '/',
            pageTitle: 'Home',
            role: 'homepage',
            primaryType: 'Organization',
            entityRefs: ['entity-org'],
          },
          {
            pagePath: '/services',
            pageTitle: 'Services',
            role: 'service',
            primaryType: 'Service',
            entityRefs: [],
          },
        ],
        generatedAt: now,
        updatedAt: now,
      });
    }),
  };
});

import db from '../../server/db/index.js';
import { clearCompletedJobs, createJob } from '../../server/jobs.js';
import { getSchemaPlan, deleteSchemaPlan } from '../../server/schema-store.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import { WS_EVENTS } from '../../server/ws-events.js';

let baseUrl = '';
let server: http.Server | undefined;
let workspaceAId = '';
let workspaceASiteId = '';
let workspaceBId = '';
let workspaceBSiteId = '';
const originalAppPassword = process.env.APP_PASSWORD;

function resetWorkspaceState(workspaceId: string, siteId: string): void {
  clearCompletedJobs({ workspaceId });
  db.prepare('DELETE FROM jobs WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(workspaceId);
  deleteSchemaPlan(siteId);
}

function countActivities(workspaceId: string, type: string): number {
  const row = db.prepare(`
    SELECT COALESCE(COUNT(*), 0) AS count
    FROM activity_log
    WHERE workspace_id = ? AND type = ?
  `).get(workspaceId, type) as { count: number };
  return row.count;
}

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close(err => (err ? reject(err) : resolve()));
  });
  server = undefined;
}

async function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, opts);
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function waitForJob(jobId: string, timeoutMs = 8_000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await api(`/api/jobs/${jobId}`);
    if (res.status === 200) {
      const job = await res.json() as Record<string, unknown>;
      const status = job.status;
      if (status === 'done' || status === 'error' || status === 'cancelled') return job;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
}

beforeAll(async () => {
  await startTestServer();
}, 30_000);

beforeEach(() => {
  const workspaceA = createWorkspace('Schema Plan Job Test A', 'schema-plan-site-a');
  workspaceAId = workspaceA.id;
  workspaceASiteId = workspaceA.webflowSiteId || 'schema-plan-site-a';
  const workspaceB = createWorkspace('Schema Plan Job Test B', 'schema-plan-site-b');
  workspaceBId = workspaceB.id;
  workspaceBSiteId = workspaceB.webflowSiteId || 'schema-plan-site-b';
  broadcastState.calls = [];
});

afterEach(() => {
  resetWorkspaceState(workspaceAId, workspaceASiteId);
  resetWorkspaceState(workspaceBId, workspaceBSiteId);
  deleteWorkspace(workspaceAId);
  deleteWorkspace(workspaceBId);
});

afterAll(async () => {
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
});

describe('schema plan generation job mutation safety', () => {
  it('runs schema-plan generation through /api/jobs, persists the plan, logs activity, and broadcasts cache updates', async () => {
    const startRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.SCHEMA_PLAN_GENERATION,
      params: {
        workspaceId: workspaceAId,
        siteId: workspaceASiteId,
      },
    });
    expect(startRes.status).toBe(200);
    const started = await startRes.json() as { jobId: string };

    const job = await waitForJob(started.jobId);
    expect(job).toMatchObject({
      workspaceId: workspaceAId,
      type: BACKGROUND_JOB_TYPES.SCHEMA_PLAN_GENERATION,
      status: 'done',
      message: 'Schema plan ready — 2 pages mapped',
      result: {
        persisted: true,
        siteId: workspaceASiteId,
        pageCount: 2,
        canonicalEntityCount: 1,
      },
    });

    const plan = getSchemaPlan(workspaceASiteId);
    expect(plan).not.toBeNull();
    expect(plan).toMatchObject({
      workspaceId: workspaceAId,
      siteId: workspaceASiteId,
      status: 'draft',
    });
    expect(countActivities(workspaceAId, 'schema_plan_generated')).toBe(1);
    expect(getSchemaPlan(workspaceBSiteId)).toBeNull();
    expect(countActivities(workspaceBId, 'schema_plan_generated')).toBe(0);

    expect(broadcastState.calls).toContainEqual({
      workspaceId: workspaceAId,
      event: WS_EVENTS.SCHEMA_PLAN_UPDATED,
      payload: {
        siteId: workspaceASiteId,
        action: 'generated',
        status: 'draft',
        jobId: started.jobId,
      },
    });
  });

  it('uses the legacy schema-plan route as a compatibility wrapper that returns the durable job id', async () => {
    const startRes = await postJson(`/api/webflow/schema-plan/${workspaceASiteId}?workspaceId=${encodeURIComponent(workspaceAId)}`, {});
    expect(startRes.status).toBe(200);
    expect(await startRes.json()).toMatchObject({
      jobId: expect.any(String),
      deprecated: true,
    });
  });

  it('returns the active schema-plan generation job instead of starting a duplicate run', async () => {
    const active = createJob(BACKGROUND_JOB_TYPES.SCHEMA_PLAN_GENERATION, {
      workspaceId: workspaceAId,
      message: 'Generating schema plan...',
    });

    const jobsRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.SCHEMA_PLAN_GENERATION,
      params: {
        workspaceId: workspaceAId,
        siteId: workspaceASiteId,
      },
    });
    expect(jobsRes.status).toBe(200);
    expect(await jobsRes.json()).toEqual({ jobId: active.id, existing: true });

    const legacyRes = await postJson(`/api/webflow/schema-plan/${workspaceASiteId}?workspaceId=${encodeURIComponent(workspaceAId)}`, {});
    expect(legacyRes.status).toBe(200);
    expect(await legacyRes.json()).toEqual({ jobId: active.id, existing: true, deprecated: true });
  });
});
