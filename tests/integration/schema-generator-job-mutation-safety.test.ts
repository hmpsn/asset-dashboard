import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: Record<string, unknown> }>,
}));

const generationState = vi.hoisted(() => ({
  mode: 'success' as 'success' | 'error',
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: Record<string, unknown>) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/schema-generation-context.js', () => ({
  prepareBulkSchemaGenerationContext: vi.fn(async () => ({
    ctx: {
      siteId: 'test-site',
      workspaceId: 'test-workspace',
    },
  })),
}));

function buildSchemaSuggestion() {
  return {
    pageId: 'page-home',
    pageTitle: 'Homepage',
    slug: '/',
    url: 'https://example.com/',
    existingSchemas: [],
    suggestedSchemas: [
      {
        type: 'Service',
        reason: 'Service homepage with local SEO intent',
        priority: 'high' as const,
        template: {
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'Service',
              name: 'Local SEO Services',
            },
          ],
        },
      },
    ],
  };
}

vi.mock('../../server/schema-suggester.js', () => ({
  generateSchemaSuggestions: vi.fn(async (
    _siteId: string,
    _token: string | undefined,
    _ctx: unknown,
    onProgress?: (partial: Array<Record<string, unknown>>, done?: boolean, message?: string) => void,
  ) => {
    if (generationState.mode === 'error') {
      throw new Error('Schema generator crashed');
    }
    const partial = [buildSchemaSuggestion()];
    onProgress?.(partial, false, 'Generating schema suggestions...');
    return partial;
  }),
}));

import db from '../../server/db/index.js';
import { clearCompletedJobs, createJob } from '../../server/jobs.js';
import { getSchemaSnapshot } from '../../server/schema-store.js';
import { seedTwoWorkspaces, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import { WS_EVENTS } from '../../server/ws-events.js';

let baseUrl = '';
let server: http.Server | undefined;
let workspaceA: SeededFullWorkspace;
let workspaceB: SeededFullWorkspace;
const originalAppPassword = process.env.APP_PASSWORD;

function countRows(
  table: 'jobs' | 'schema_snapshots' | 'activity_log',
  workspaceId: string,
): number {
  const row = db.prepare(`SELECT COALESCE(COUNT(*), 0) AS count FROM ${table} WHERE workspace_id = ?`).get(workspaceId) as { count: number };
  return row.count;
}

function resetWorkspaceState(workspaceId: string): void {
  clearCompletedJobs({ workspaceId });
  db.prepare('DELETE FROM jobs WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM schema_snapshots WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(workspaceId);
}

function activityTitles(workspaceId: string, type: string): string[] {
  return db.prepare(`
    SELECT title
    FROM activity_log
    WHERE workspace_id = ? AND type = ?
    ORDER BY created_at DESC
  `).all(workspaceId, type).map((row: { title: string }) => row.title);
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
  const seeded = seedTwoWorkspaces();
  workspaceA = seeded.wsA;
  workspaceB = seeded.wsB;
  broadcastState.calls = [];
  generationState.mode = 'success';
});

afterEach(() => {
  resetWorkspaceState(workspaceA.workspaceId);
  resetWorkspaceState(workspaceB.workspaceId);
  deleteWorkspace(workspaceA.workspaceId);
  deleteWorkspace(workspaceB.workspaceId);
});

afterAll(async () => {
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
});

describe('schema generator job mutation safety', () => {
  it('writes snapshot state, activity, and broadcasts for successful runs while preserving admin/public read paths', async () => {
    updateWorkspace(workspaceA.workspaceId, { clientPassword: null });

    const startRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR,
      params: {
        workspaceId: workspaceA.workspaceId,
        siteId: workspaceA.webflowSiteId,
      },
    });
    expect(startRes.status).toBe(200);
    const started = await startRes.json() as { jobId: string };

    const job = await waitForJob(started.jobId);
    expect(job).toMatchObject({
      workspaceId: workspaceA.workspaceId,
      type: BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR,
      status: 'done',
      message: 'Done — 1 page schemas generated',
    });

    const snapshot = getSchemaSnapshot(workspaceA.webflowSiteId);
    expect(snapshot).not.toBeNull();
    expect(snapshot).toMatchObject({
      workspaceId: workspaceA.workspaceId,
      pageCount: 1,
    });

    expect(activityTitles(workspaceA.workspaceId, 'schema_generated')).toContain('Schema generated for 1 pages');
    expect(countRows('schema_snapshots', workspaceB.workspaceId)).toBe(0);
    expect(countRows('activity_log', workspaceB.workspaceId)).toBe(0);

    expect(broadcastState.calls).toEqual([
      {
        workspaceId: workspaceA.workspaceId,
        event: WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED,
        payload: {
          siteId: workspaceA.webflowSiteId,
          action: 'generated',
          pageCount: 1,
        },
      },
    ]);

    const adminReadRes = await api(`/api/webflow/schema-snapshot/${workspaceA.webflowSiteId}?workspaceId=${workspaceA.workspaceId}`);
    expect(adminReadRes.status).toBe(200);
    const adminSnapshot = await adminReadRes.json() as { pageCount: number; results: Array<{ pageId: string }> };
    expect(adminSnapshot.pageCount).toBe(1);
    expect(adminSnapshot.results[0]?.pageId).toBe('page-home');

    const publicReadRes = await api(`/api/public/schema-snapshot/${workspaceA.workspaceId}`);
    expect(publicReadRes.status).toBe(200);
    const publicSnapshot = await publicReadRes.json() as {
      pageCount: number;
      pages: Array<{ pageId: string; schemaTypes: string[] }>;
    };
    expect(publicSnapshot.pageCount).toBe(1);
    expect(publicSnapshot.pages).toEqual([
      expect.objectContaining({
        pageId: 'page-home',
        schemaTypes: ['Service'],
      }),
    ]);
  });

  it('marks failed runs as error without writing snapshot state, activity, or broadcasts', async () => {
    generationState.mode = 'error';

    const startRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR,
      params: {
        workspaceId: workspaceA.workspaceId,
        siteId: workspaceA.webflowSiteId,
      },
    });
    expect(startRes.status).toBe(200);
    const started = await startRes.json() as { jobId: string };

    const job = await waitForJob(started.jobId);
    expect(job).toMatchObject({
      workspaceId: workspaceA.workspaceId,
      type: BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR,
      status: 'error',
      message: 'Schema generation failed',
    });
    expect(String(job.error)).toContain('Schema generator crashed');

    expect(getSchemaSnapshot(workspaceA.webflowSiteId)).toBeNull();
    expect(countRows('schema_snapshots', workspaceA.workspaceId)).toBe(0);
    expect(countRows('activity_log', workspaceA.workspaceId)).toBe(0);
    expect(broadcastState.calls).toHaveLength(0);
  });

  it('rejects duplicate starts and cross-workspace site mismatches without mutation side effects', async () => {
    const active = createJob(BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR, {
      workspaceId: workspaceA.workspaceId,
      message: 'already running',
    });

    const duplicateRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR,
      params: {
        workspaceId: workspaceA.workspaceId,
        siteId: workspaceA.webflowSiteId,
      },
    });
    expect(duplicateRes.status).toBe(409);
    await expect(duplicateRes.json()).resolves.toMatchObject({
      error: 'Schema generation is already running for this workspace',
      jobId: active.id,
    });

    const crossWorkspaceRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR,
      params: {
        workspaceId: workspaceA.workspaceId,
        siteId: workspaceB.webflowSiteId,
      },
    });
    expect(crossWorkspaceRes.status).toBe(403);

    expect(countRows('jobs', workspaceA.workspaceId)).toBe(1);
    expect(countRows('jobs', workspaceB.workspaceId)).toBe(0);
    expect(countRows('schema_snapshots', workspaceA.workspaceId)).toBe(0);
    expect(countRows('schema_snapshots', workspaceB.workspaceId)).toBe(0);
    expect(countRows('activity_log', workspaceA.workspaceId)).toBe(0);
    expect(countRows('activity_log', workspaceB.workspaceId)).toBe(0);
    expect(broadcastState.calls).toHaveLength(0);
  });
});
