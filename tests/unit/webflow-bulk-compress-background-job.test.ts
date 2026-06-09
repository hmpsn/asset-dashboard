import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearCompletedJobs,
  getJob,
} from '../../server/jobs.js';

const state = vi.hoisted(() => ({
  fetchBytesCalls: [] as string[],
  compressionCalls: [] as Array<{ sourceName: string; outputBaseName?: string }>,
  replaceCalls: [] as Array<{ assetId: string; imageUrl: string; siteId: string; altText?: string; token?: string }>,
  fetchedBytesQueue: [] as Array<Uint8Array | Error>,
  compressionQueue: [] as Array<Record<string, unknown>>,
  replaceQueue: [] as Array<Record<string, unknown> | Error>,
  token: 'wf-token',
  activityCalls: [] as Array<{ workspaceId: string; type: string; message: string; metadata: Record<string, unknown> | undefined }>,
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

vi.mock('../../server/workspaces.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/workspaces.js')>();
  return {
    ...actual,
    getTokenForSite: vi.fn(() => state.token),
  };
});

vi.mock('../../server/external-fetch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/external-fetch.js')>();
  return {
    ...actual,
    fetchExternalBytes: vi.fn(async ({ url }: { url: string }) => {
      state.fetchBytesCalls.push(url);
      const next = state.fetchedBytesQueue.shift();
      if (next instanceof Error) throw next;
      return next ?? new Uint8Array(Buffer.alloc(1024));
    }),
  };
});

vi.mock('../../server/domains/webflow-assets/image-optimization.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/domains/webflow-assets/image-optimization.js')>();
  return {
    ...actual,
    compressImageBuffer: vi.fn(async (_buffer: Buffer, sourceName: string, options?: { outputBaseName?: string }) => {
      state.compressionCalls.push({ sourceName, outputBaseName: options?.outputBaseName });
      return state.compressionQueue.shift() ?? {
        compressed: Buffer.alloc(200),
        newFileName: 'image.jpg',
        originalSize: 1024,
        newSize: 200,
        savings: 824,
        savingsPercent: 80,
      };
    }),
    replaceCompressedAsset: vi.fn(async (options: { assetId: string; imageUrl: string; siteId: string; altText?: string; token?: string }) => {
      state.replaceCalls.push(options);
      const next = state.replaceQueue.shift();
      if (next instanceof Error) throw next;
      return next ?? {
        success: true,
        newAssetId: `new-${options.assetId}`,
        originalSize: 1024,
        newSize: 200,
        savings: 8_000,
        savingsPercent: 80,
        newFileName: `${options.assetId}.jpg`,
        oldAssetPreserved: false,
      };
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
    state.fetchBytesCalls = [];
    state.compressionCalls = [];
    state.replaceCalls = [];
    state.fetchedBytesQueue = [];
    state.compressionQueue = [];
    state.replaceQueue = [];
    state.token = 'wf-token';
    state.activityCalls = [];
  });

  afterAll(() => {
    clearCompletedJobs();
  });

  it('preserves result ordering, totalSaved accumulation, and summary activity', async () => {
    state.compressionQueue = [
      {
        compressed: Buffer.alloc(200),
        newFileName: 'asset-1.jpg',
        originalSize: 1024,
        newSize: 200,
        savings: 8_000,
        savingsPercent: 80,
      },
      {
        skipped: true,
        reason: 'Already optimized',
        originalSize: 1024,
        newSize: 1000,
      },
      {
        compressed: Buffer.alloc(200),
        newFileName: 'asset-3.jpg',
        originalSize: 1024,
        newSize: 200,
        savings: 4_000,
        savingsPercent: 40,
      },
    ];
    state.replaceQueue = [
      { success: true, savings: 8_000, newAssetId: 'new-1', newFileName: 'asset-1.jpg' },
      { success: true, savings: 4_000, newAssetId: 'new-3', newFileName: 'asset-3.jpg' },
    ];

    const started = startWebflowBulkCompressJob({
      workspaceId: 'ws-1',
      siteId: 'site-1',
      assets: [
        { assetId: 'asset-1', imageUrl: 'https://cdn.example.test/1.jpg' },
        { assetId: 'asset-2', imageUrl: 'https://cdn.example.test/2.jpg' },
        { assetId: 'asset-3', imageUrl: 'https://cdn.example.test/3.jpg' },
      ],
    });

    const job = await waitForTerminalJob(started.jobId);

    expect(state.fetchBytesCalls).toEqual([
      'https://cdn.example.test/1.jpg',
      'https://cdn.example.test/2.jpg',
      'https://cdn.example.test/3.jpg',
    ]);
    expect(state.replaceCalls).toEqual([
      {
        assetId: 'asset-1',
        imageUrl: 'https://cdn.example.test/1.jpg',
        siteId: 'site-1',
        token: 'wf-token',
        compression: expect.objectContaining({ newFileName: 'asset-1.jpg', savings: 8_000 }),
      },
      {
        assetId: 'asset-3',
        imageUrl: 'https://cdn.example.test/3.jpg',
        siteId: 'site-1',
        token: 'wf-token',
        compression: expect.objectContaining({ newFileName: 'asset-3.jpg', savings: 4_000 }),
      },
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
    state.replaceQueue = [
      { success: true, savings: 8_000, newAssetId: 'new-1', newFileName: 'asset-1.jpg' },
      new Error('replace exploded'),
    ];

    const started = startWebflowBulkCompressJob({
      workspaceId: 'ws-1',
      siteId: 'site-1',
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
          { assetId: 'asset-2', error: 'Error: replace exploded' },
        ],
      },
    });
  });
});
