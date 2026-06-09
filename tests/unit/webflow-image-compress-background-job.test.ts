import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearCompletedJobs,
  getJob,
} from '../../server/jobs.js';

const nativeFetch = globalThis.fetch;

const state = vi.hoisted(() => ({
  token: 'wf-token',
  fetchedBuffer: Buffer.alloc(1024),
  fetchShouldFail: false,
  compressionResult: {
    compressed: Buffer.alloc(200),
    newFileName: 'hero.jpg',
    originalSize: 1024,
    newSize: 200,
    savings: 824,
    savingsPercent: 80,
  } as
    | {
      compressed: Buffer;
      newFileName: string;
      originalSize: number;
      newSize: number;
      savings: number;
      savingsPercent: number;
    }
    | {
      skipped: true;
      reason: string;
      originalSize: number;
      newSize: number;
    },
  replaceResult: {
    success: true,
    newAssetId: 'new-hero',
    originalSize: 1024,
    newSize: 200,
    savings: 824,
    savingsPercent: 80,
    newFileName: 'hero.jpg',
    oldAssetPreserved: false,
  } as
    | {
      success: true;
      newAssetId?: string;
      originalSize?: number;
      newSize?: number;
      savings?: number;
      savingsPercent?: number;
      newFileName?: string;
      oldAssetPreserved?: boolean;
    }
    | { success: false; error: string },
  replaceCalls: [] as Array<{ assetId: string; imageUrl: string; siteId: string; altText?: string; token?: string }>,
  activityCalls: [] as Array<{ workspaceId: string; type: string; message: string; metadata: Record<string, unknown> | undefined }>,
  compressionCalls: [] as Array<{ sourceName: string; outputBaseName?: string }>,
}));

vi.mock('../../server/workspaces.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/workspaces.js')>();
  return {
    ...actual,
    getTokenForSite: vi.fn(() => state.token),
  };
});

vi.mock('../../server/activity-log.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/activity-log.js')>();
  return {
    ...actual,
    addActivity: vi.fn((workspaceId: string, type: string, message: string, _userId?: string, metadata?: Record<string, unknown>) => {
      state.activityCalls.push({ workspaceId, type, message, metadata });
    }),
  };
});

vi.mock('../../server/domains/webflow-assets/image-optimization.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/domains/webflow-assets/image-optimization.js')>();
  return {
    ...actual,
    compressImageBuffer: vi.fn(async (_buffer: Buffer, sourceName: string, options?: { outputBaseName?: string }) => {
      state.compressionCalls.push({ sourceName, outputBaseName: options?.outputBaseName });
      return state.compressionResult;
    }),
    replaceCompressedAsset: vi.fn(async (options: { assetId: string; imageUrl: string; siteId: string; altText?: string; token?: string }) => {
      state.replaceCalls.push(options);
      return state.replaceResult;
    }),
  };
});

import { startWebflowImageCompressJob } from '../../server/webflow-image-compress-background-job.js';

async function waitForTerminalJob(jobId: string): Promise<NonNullable<ReturnType<typeof getJob>>> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const job = getJob(jobId);
    if (job && (job.status === 'done' || job.status === 'error')) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
}

describe('startWebflowImageCompressJob', () => {
  beforeEach(() => {
    clearCompletedJobs();
    state.token = 'wf-token';
    state.fetchedBuffer = Buffer.alloc(1024);
    state.fetchShouldFail = false;
    state.compressionResult = {
      compressed: Buffer.alloc(200),
      newFileName: 'hero.jpg',
      originalSize: 1024,
      newSize: 200,
      savings: 824,
      savingsPercent: 80,
    };
    state.replaceResult = {
      success: true,
      newAssetId: 'new-hero',
      originalSize: 1024,
      newSize: 200,
      savings: 824,
      savingsPercent: 80,
      newFileName: 'hero.jpg',
      oldAssetPreserved: false,
    };
    state.replaceCalls = [];
    state.activityCalls = [];
    state.compressionCalls = [];

    vi.stubGlobal('fetch', vi.fn(async () => {
      if (state.fetchShouldFail) {
        throw new Error('download exploded');
      }
      return new Response(state.fetchedBuffer, { status: 200 });
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

  it('keeps the legacy success result, message, and activity shape unchanged', async () => {
    const started = startWebflowImageCompressJob({
      workspaceId: 'ws-1',
      assetId: 'asset-1',
      imageUrl: 'https://cdn.example.test/hero.jpg',
      siteId: 'site-1',
      altText: 'Hero alt',
      fileName: 'hero.jpg',
    });

    const job = await waitForTerminalJob(started.jobId);

    expect(state.compressionCalls).toEqual([
      { sourceName: 'hero.jpg', outputBaseName: 'hero.jpg' },
    ]);
    expect(job).toMatchObject({
      type: 'compress',
      workspaceId: 'ws-1',
      status: 'done',
      message: 'Saved 1KB (80%)',
      result: {
        success: true,
        newAssetId: 'new-hero',
        originalSize: 1024,
        newSize: 200,
        savings: 824,
        savingsPercent: 80,
        newFileName: 'hero.jpg',
      },
    });
    expect(state.replaceCalls).toEqual([
      {
        assetId: 'asset-1',
        imageUrl: 'https://cdn.example.test/hero.jpg',
        siteId: 'site-1',
        altText: 'Hero alt',
        token: 'wf-token',
        compression: expect.objectContaining({
          newFileName: 'hero.jpg',
          savings: 824,
        }),
      },
    ]);
    expect(state.activityCalls).toEqual([
      {
        workspaceId: 'ws-1',
        type: 'images_optimized',
        message: 'Image compressed: hero.jpg — saved 1KB (80%)',
        metadata: {
          originalSize: 1024,
          newSize: 200,
          savings: 824,
          savingsPercent: 80,
        },
      },
    ]);
  });

  it('keeps the legacy already-optimized skip result without downstream writes', async () => {
    state.compressionResult = {
      skipped: true,
      reason: 'Already optimized (only 2% savings)',
      originalSize: 1024,
      newSize: 1000,
    };

    const started = startWebflowImageCompressJob({
      workspaceId: 'ws-1',
      assetId: 'asset-2',
      imageUrl: 'https://cdn.example.test/skip.jpg',
      siteId: 'site-1',
      fileName: 'skip.jpg',
    });

    const job = await waitForTerminalJob(started.jobId);

    expect(job).toMatchObject({
      type: 'compress',
      workspaceId: 'ws-1',
      status: 'done',
      message: 'Already optimized',
      result: {
        skipped: true,
        reason: 'Already optimized (only 2% savings)',
      },
    });
    expect(state.replaceCalls).toHaveLength(0);
    expect(state.activityCalls).toHaveLength(0);
  });

  it('keeps the legacy upload error result when replacement fails', async () => {
    state.replaceResult = { success: false, error: 'Upload exploded' };

    const started = startWebflowImageCompressJob({
      workspaceId: 'ws-1',
      assetId: 'asset-3',
      imageUrl: 'https://cdn.example.test/broken.jpg',
      siteId: 'site-1',
      fileName: 'broken.jpg',
    });

    const job = await waitForTerminalJob(started.jobId);

    expect(job).toMatchObject({
      type: 'compress',
      workspaceId: 'ws-1',
      status: 'error',
      error: 'Upload exploded',
      message: 'Upload failed',
    });
  });

  it('keeps the legacy error result when the download fails', async () => {
    state.fetchShouldFail = true;

    const started = startWebflowImageCompressJob({
      workspaceId: 'ws-1',
      assetId: 'asset-3',
      imageUrl: 'https://cdn.example.test/broken.jpg',
      siteId: 'site-1',
      fileName: 'broken.jpg',
    });

    const job = await waitForTerminalJob(started.jobId);

    expect(job).toMatchObject({
      type: 'compress',
      workspaceId: 'ws-1',
      status: 'error',
      message: 'Compression failed',
      error: 'download exploded',
    });
    expect(state.replaceCalls).toHaveLength(0);
    expect(state.activityCalls).toHaveLength(0);
  });
});
