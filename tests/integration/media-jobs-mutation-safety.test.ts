import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import db from '../../server/db/index.js';

const nativeFetch = globalThis.fetch;

const webflowState = vi.hoisted(() => ({
  uploadCalls: [] as Array<{ siteId: string; fileName: string }>,
  deleteCalls: [] as Array<{ assetId: string }>,
  updateCalls: [] as Array<{ assetId: string; altText?: string }>,
}));

const altState = vi.hoisted(() => ({
  queue: [] as Array<string | null | Error>,
}));

const fetchState = vi.hoisted(() => ({
  failExternal: false,
  failInternal: false,
}));

vi.mock('../../server/webflow.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/webflow.js')>();
  return {
    ...actual,
    uploadAsset: vi.fn(async (siteId: string, _tmpPath: string, fileName: string) => {
      webflowState.uploadCalls.push({ siteId, fileName });
      return { success: true, assetId: `new-${fileName}` };
    }),
    deleteAsset: vi.fn(async (assetId: string) => {
      webflowState.deleteCalls.push({ assetId });
      return { success: true };
    }),
    updateAsset: vi.fn(async (assetId: string, payload: { altText?: string }) => {
      webflowState.updateCalls.push({ assetId, altText: payload.altText });
      return { success: true };
    }),
  };
});

vi.mock('../../server/alttext.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/alttext.js')>();
  return {
    ...actual,
    generateAltText: vi.fn(async () => {
      const next = altState.queue.shift();
      if (next instanceof Error) throw next;
      return next ?? 'Fallback generated alt text';
    }),
  };
});

vi.mock('sharp', () => {
  return {
    default: vi.fn(() => ({
      jpeg: vi.fn().mockReturnThis(),
      png: vi.fn().mockReturnThis(),
      webp: vi.fn().mockReturnThis(),
      toBuffer: vi.fn(async () => Buffer.alloc(200)),
    })),
  };
});

import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import { createJob, clearCompletedJobs, listJobs, updateJob } from '../../server/jobs.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';

let baseUrl = '';
let server: http.Server | undefined;
let workspaceAId = '';
let workspaceBId = '';
let siteA = '';
let siteB = '';
const originalAppPassword = process.env.APP_PASSWORD;

function countActivities(workspaceId: string, type: string): number {
  const row = db.prepare(`
    SELECT COALESCE(COUNT(*), 0) AS count
    FROM activity_log
    WHERE workspace_id = ? AND type = ?
  `).get(workspaceId, type) as { count: number };
  return row.count;
}

function resetState(): void {
  clearCompletedJobs();
  db.prepare('DELETE FROM jobs').run();
  db.prepare('DELETE FROM activity_log').run();
  db.prepare('DELETE FROM page_edit_states').run();
  webflowState.uploadCalls = [];
  webflowState.deleteCalls = [];
  webflowState.updateCalls = [];
  altState.queue = [];
  fetchState.failExternal = false;
  fetchState.failInternal = false;
}

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, resolve));
  const { port } = server!.address() as AddressInfo;
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
  return nativeFetch(`${baseUrl}${path}`, opts);
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function waitForJob(jobId: string, timeoutMs = 10_000): Promise<Record<string, unknown>> {
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
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    if (url.startsWith('http://localhost:')) {
      if (fetchState.failInternal) throw new Error('Bulk internal fetch failed');
      return new Response(JSON.stringify({ success: true, savings: 8000 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (fetchState.failExternal) throw new Error('External image fetch failed');
    return new Response(Buffer.alloc(1024), { status: 200 });
  }));

  await startTestServer();
}, 30_000);

beforeEach(() => {
  resetState();

  const wsA = createWorkspace('Media Jobs Mutation A', 'wf-media-a', 'Media A');
  const wsB = createWorkspace('Media Jobs Mutation B', 'wf-media-b', 'Media B');
  workspaceAId = wsA.id;
  workspaceBId = wsB.id;
  siteA = wsA.webflowSiteId!;
  siteB = wsB.webflowSiteId!;

  updateWorkspace(workspaceAId, {
    webflowToken: 'wf-media-token-a',
    liveDomain: 'https://a.media.test',
  });
  updateWorkspace(workspaceBId, {
    webflowToken: 'wf-media-token-b',
    liveDomain: 'https://b.media.test',
  });
});

afterEach(() => {
  resetState();
  deleteWorkspace(workspaceAId);
  deleteWorkspace(workspaceBId);
});

afterAll(async () => {
  await stopTestServer();
  vi.unstubAllGlobals();
  if (originalAppPassword === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = originalAppPassword;
});

describe('media background-job mutation safety', () => {
  it('compress writes done state + optimization activity on success, scoped to owning workspace', async () => {
    const res = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.COMPRESS,
      params: {
        workspaceId: workspaceAId,
        siteId: siteA,
        assetId: 'asset-1',
        imageUrl: 'https://cdn.example.test/asset-1.jpg',
        fileName: 'hero.jpg',
      },
    });
    expect(res.status).toBe(200);
    const started = await res.json() as { jobId: string };

    const job = await waitForJob(started.jobId);
    expect(job).toMatchObject({
      workspaceId: workspaceAId,
      type: BACKGROUND_JOB_TYPES.COMPRESS,
      status: 'done',
      result: expect.objectContaining({
        success: true,
        newFileName: 'hero.jpg',
        savingsPercent: expect.any(Number),
      }),
    });
    expect(webflowState.uploadCalls).toHaveLength(1);
    expect(webflowState.deleteCalls).toHaveLength(1);
    expect(countActivities(workspaceAId, 'images_optimized')).toBe(1);
    expect(countActivities(workspaceBId, 'images_optimized')).toBe(0);
  });

  it('compress failure does not write optimization activity or downstream Webflow writes', async () => {
    fetchState.failExternal = true;

    const res = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.COMPRESS,
      params: {
        workspaceId: workspaceAId,
        siteId: siteA,
        assetId: 'asset-2',
        imageUrl: 'https://cdn.example.test/asset-2.jpg',
        fileName: 'broken.jpg',
      },
    });
    expect(res.status).toBe(200);
    const started = await res.json() as { jobId: string };
    const job = await waitForJob(started.jobId);

    expect(job).toMatchObject({
      workspaceId: workspaceAId,
      type: BACKGROUND_JOB_TYPES.COMPRESS,
      status: 'error',
      message: 'Compression failed',
    });
    expect(webflowState.uploadCalls).toHaveLength(0);
    expect(webflowState.deleteCalls).toHaveLength(0);
    expect(countActivities(workspaceAId, 'images_optimized')).toBe(0);
  });

  it('bulk-compress enforces duplicate/cross-workspace guards and logs one summary activity on success', async () => {
    const active = createJob(BACKGROUND_JOB_TYPES.BULK_COMPRESS, { workspaceId: workspaceAId, message: 'running' });
    const dupRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.BULK_COMPRESS,
      params: {
        workspaceId: workspaceAId,
        siteId: siteA,
        assets: [{ assetId: 'dup-1', imageUrl: 'https://cdn.example.test/dup-1.jpg' }],
      },
    });
    expect(dupRes.status).toBe(409);
    await expect(dupRes.json()).resolves.toMatchObject({
      error: 'A bulk compression is already running',
      jobId: active.id,
    });
    updateJob(active.id, { status: 'done' });

    const crossBefore = listJobs(workspaceAId).length;
    const crossRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.BULK_COMPRESS,
      params: {
        workspaceId: workspaceAId,
        siteId: siteB,
        assets: [{ assetId: 'cross-1', imageUrl: 'https://cdn.example.test/cross-1.jpg' }],
      },
    });
    expect(crossRes.status).toBe(403);
    expect(listJobs(workspaceAId)).toHaveLength(crossBefore);

    const res = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.BULK_COMPRESS,
      params: {
        workspaceId: workspaceAId,
        siteId: siteA,
        assets: [
          { assetId: 'asset-1', imageUrl: 'https://cdn.example.test/asset-1.jpg' },
          { assetId: 'asset-2', imageUrl: 'https://cdn.example.test/asset-2.jpg' },
        ],
      },
    });
    expect(res.status).toBe(200);
    const started = await res.json() as { jobId: string };
    const job = await waitForJob(started.jobId);

    expect(job).toMatchObject({
      workspaceId: workspaceAId,
      type: BACKGROUND_JOB_TYPES.BULK_COMPRESS,
      status: 'done',
      result: expect.objectContaining({
        totalSaved: 16_000,
      }),
    });
    expect(countActivities(workspaceAId, 'images_optimized')).toBe(1);
    expect(countActivities(workspaceBId, 'images_optimized')).toBe(0);
  });

  it('bulk-alt enforces duplicate/cross-workspace guards and writes only successful alt updates', async () => {
    const active = createJob(BACKGROUND_JOB_TYPES.BULK_ALT, { workspaceId: workspaceAId, message: 'running' });
    const dupRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.BULK_ALT,
      params: {
        workspaceId: workspaceAId,
        siteId: siteA,
        assets: [{ assetId: 'dup-alt-1', imageUrl: 'https://cdn.example.test/dup-alt-1.jpg' }],
      },
    });
    expect(dupRes.status).toBe(409);
    await expect(dupRes.json()).resolves.toMatchObject({
      error: 'Bulk alt text generation is already running',
      jobId: active.id,
    });
    updateJob(active.id, { status: 'done' });

    const jobsBefore = listJobs(workspaceAId).length;
    const crossRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.BULK_ALT,
      params: {
        workspaceId: workspaceAId,
        siteId: siteB,
        assets: [{ assetId: 'cross-alt-1', imageUrl: 'https://cdn.example.test/cross-alt-1.jpg' }],
      },
    });
    expect(crossRes.status).toBe(403);
    expect(listJobs(workspaceAId)).toHaveLength(jobsBefore);

    altState.queue = ['Alt for hero image', new Error('alt generation failed')];
    const res = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.BULK_ALT,
      params: {
        workspaceId: workspaceAId,
        siteId: siteA,
        assets: [
          { assetId: 'asset-alt-1', imageUrl: 'https://cdn.example.test/asset-alt-1.jpg' },
          { assetId: 'asset-alt-2', imageUrl: 'https://cdn.example.test/asset-alt-2.jpg' },
        ],
      },
    });
    expect(res.status).toBe(200);
    const started = await res.json() as { jobId: string };
    const job = await waitForJob(started.jobId);

    expect(job).toMatchObject({
      workspaceId: workspaceAId,
      type: BACKGROUND_JOB_TYPES.BULK_ALT,
      status: 'done',
      result: [
        expect.objectContaining({ assetId: 'asset-alt-1', updated: true, altText: 'Alt for hero image' }),
        expect.objectContaining({ assetId: 'asset-alt-2', updated: false }),
      ],
    });
    expect(webflowState.updateCalls).toEqual([
      { assetId: 'asset-alt-1', altText: 'Alt for hero image' },
    ]);
    expect(countActivities(workspaceAId, 'images_optimized')).toBe(1);
    expect(countActivities(workspaceBId, 'images_optimized')).toBe(0);
  });
});
