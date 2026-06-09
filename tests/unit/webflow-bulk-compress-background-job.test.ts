import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearCompletedJobs,
  getJob,
} from '../../server/jobs.js';

const nativeFetch = globalThis.fetch;

const state = vi.hoisted(() => ({
  responses: [] as Array<Record<string, unknown> | Error>,
  activityCalls: [] as Array<{ workspaceId: string; type: string; message: string; metadata: Record<string, unknown> | undefined }>,
  fetchCalls: [] as Array<{ url: string; body: Record<string, unknown> }>,
}));

vi.mock('../../server/activity-log.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/activity-log.js')>();
  return {
    ...actual,
    addActivity: vi.fn((workspaceId: string, type: string, message: string, _userId?: string, metadata?: Record<string, unknown>) => {
      state.activityCalls.push({ workspaceId, type, message, metadata });
    }),
  };
});

import { startWebflowBulkCompressJob } from '../../server/webflow-bulk-compress-background-job.js';

async function waitForTerminalJob(jobId: string): Promise<NonNullable<ReturnType<typeof getJob>>> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const job = getJob(jobId);
    if (job && (job.status === 'done' || job.status === 'error')) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
}

describe('startWebflowBulkCompressJob', () => {
  beforeEach(() => {
    clearCompletedJobs();
    state.responses = [];
    state.activityCalls = [];
    state.fetchCalls = [];

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      const next = state.responses.shift();
      const body = init?.body && typeof init.body === 'string'
        ? JSON.parse(init.body) as Record<string, unknown>
        : {};
      state.fetchCalls.push({ url, body });

      if (next instanceof Error) {
        throw next;
      }

      return new Response(JSON.stringify(next ?? {}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));
  });

  afterAll(() => {
    clearCompletedJobs();
    if (nativeFetch) {
      vi.stubGlobal('fetch', nativeFetch);
    } else {
      vi.unstubAllGlobals();
    }
  });

  it('preserves result ordering, totalSaved accumulation, and summary activity', async () => {
    state.responses = [
      { success: true, savings: 8_000, newAssetId: 'new-1' },
      { skipped: true, reason: 'Already optimized' },
      { success: true, savings: 4_000, newAssetId: 'new-3' },
    ];

    const started = startWebflowBulkCompressJob({
      workspaceId: 'ws-1',
      siteId: 'site-1',
      baseUrl: 'http://localhost:3001',
      headers: { 'x-auth-token': 'token' },
      assets: [
        { assetId: 'asset-1', imageUrl: 'https://cdn.example.test/1.jpg' },
        { assetId: 'asset-2', imageUrl: 'https://cdn.example.test/2.jpg' },
        { assetId: 'asset-3', imageUrl: 'https://cdn.example.test/3.jpg' },
      ],
    });

    const job = await waitForTerminalJob(started.jobId);

    expect(state.fetchCalls.map((call) => call.url)).toEqual([
      'http://localhost:3001/api/webflow/ws-1/compress/asset-1',
      'http://localhost:3001/api/webflow/ws-1/compress/asset-2',
      'http://localhost:3001/api/webflow/ws-1/compress/asset-3',
    ]);
    expect(job).toMatchObject({
      type: 'bulk-compress',
      workspaceId: 'ws-1',
      status: 'done',
      progress: 3,
      message: 'Done — saved 12KB total',
      result: {
        totalSaved: 12_000,
        results: [
          { assetId: 'asset-1', success: true, savings: 8_000, newAssetId: 'new-1' },
          { assetId: 'asset-2', skipped: true, reason: 'Already optimized' },
          { assetId: 'asset-3', success: true, savings: 4_000, newAssetId: 'new-3' },
        ],
      },
    });
    expect(state.activityCalls).toEqual([
      {
        workspaceId: 'ws-1',
        type: 'images_optimized',
        message: 'Bulk compression: 3 images processed, 12KB saved',
        metadata: { processed: 3, totalSavedBytes: 12_000 },
      },
    ]);
  });

  it('preserves partial-failure behavior by recording per-asset error results and still completing', async () => {
    state.responses = [
      { success: true, savings: 8_000 },
      new Error('compress route exploded'),
    ];

    const started = startWebflowBulkCompressJob({
      workspaceId: 'ws-1',
      siteId: 'site-1',
      baseUrl: 'http://localhost:3001',
      headers: {},
      assets: [
        { assetId: 'asset-1', imageUrl: 'https://cdn.example.test/1.jpg' },
        { assetId: 'asset-2', imageUrl: 'https://cdn.example.test/2.jpg' },
      ],
    });

    const job = await waitForTerminalJob(started.jobId);

    expect(job).toMatchObject({
      type: 'bulk-compress',
      workspaceId: 'ws-1',
      status: 'done',
      message: 'Done — saved 8KB total',
      result: {
        totalSaved: 8_000,
        results: [
          { assetId: 'asset-1', success: true, savings: 8_000 },
          { assetId: 'asset-2', error: 'Error: compress route exploded' },
        ],
      },
    });
  });
});
