import fs from 'fs';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearCompletedJobs,
  getJob,
} from '../../server/jobs.js';

const nativeFetch = globalThis.fetch;

const state = vi.hoisted(() => ({
  workspace: {
    id: 'ws-1',
    webflowSiteId: 'site-1',
    keywordStrategy: { siteKeywords: ['seo agency', 'web analytics', 'growth strategy'] },
  },
  token: 'wf-token',
  fetchResponses: [] as Array<{ status: number; body?: Buffer } | Error>,
  altTextResponses: [] as Array<string | null | Error>,
  altTextCalls: [] as Array<{ tmpPath: string; context: string | undefined }>,
  intelligenceCalls: [] as Array<{ workspaceId: string; slices: string[] }>,
  updateCalls: [] as Array<{ assetId: string; altText: string; token: string | undefined }>,
  activityCalls: [] as Array<{ workspaceId: string; type: string; message: string; metadata: Record<string, unknown> | undefined }>,
  writtenPaths: [] as string[],
  unlinkedPaths: [] as string[],
}));

vi.mock('../../server/workspaces.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/workspaces.js')>();
  return {
    ...actual,
    getTokenForSite: vi.fn(() => state.token),
    getWorkspace: vi.fn(() => state.workspace),
    listWorkspaces: vi.fn(() => [state.workspace]),
  };
});

vi.mock('../../server/workspace-intelligence.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/workspace-intelligence.js')>();
  return {
    ...actual,
    buildWorkspaceIntelligence: vi.fn(async (workspaceId: string, opts?: { slices?: string[] }) => {
      state.intelligenceCalls.push({ workspaceId, slices: [...(opts?.slices ?? [])] });
      return {
        seoContext: {
          effectiveBrandVoiceBlock: 'Voice: clear and direct.',
        },
      };
    }),
  };
});

vi.mock('../../server/alttext.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/alttext.js')>();
  return {
    ...actual,
    generateAltText: vi.fn(async (tmpPath: string, context?: string) => {
      state.altTextCalls.push({ tmpPath, context });
      const next = state.altTextResponses.shift();
      if (next instanceof Error) throw next;
      return next ?? null;
    }),
  };
});

vi.mock('../../server/webflow.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/webflow.js')>();
  return {
    ...actual,
    updateAsset: vi.fn(async (assetId: string, payload: { altText: string }, token?: string) => {
      state.updateCalls.push({ assetId, altText: payload.altText, token });
      return { success: true };
    }),
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

import { startWebflowBulkAltJob } from '../../server/webflow-bulk-alt-background-job.js';

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

describe('startWebflowBulkAltJob', () => {
  beforeEach(() => {
    clearCompletedJobs();
    state.workspace = {
      id: 'ws-1',
      webflowSiteId: 'site-1',
      keywordStrategy: { siteKeywords: ['seo agency', 'web analytics', 'growth strategy'] },
    };
    state.token = 'wf-token';
    state.fetchResponses = [];
    state.altTextResponses = [];
    state.altTextCalls = [];
    state.intelligenceCalls = [];
    state.updateCalls = [];
    state.activityCalls = [];
    state.writtenPaths = [];
    state.unlinkedPaths = [];

    vi.stubGlobal('fetch', vi.fn(async () => {
      const next = state.fetchResponses.shift();
      if (next instanceof Error) throw next;
      return new Response(next?.body ?? Buffer.alloc(0), { status: next?.status ?? 200 });
    }));

    vi.spyOn(Date, 'now').mockReturnValue(1_717_171_717_000);
    vi.spyOn(fs, 'writeFileSync').mockImplementation((target) => {
      state.writtenPaths.push(String(target));
    });
    vi.spyOn(fs, 'unlinkSync').mockImplementation((target) => {
      state.unlinkedPaths.push(String(target));
    });
  });

  afterAll(() => {
    clearCompletedJobs();
    vi.restoreAllMocks();
    if (nativeFetch) {
      vi.stubGlobal('fetch', nativeFetch);
    } else {
      vi.unstubAllGlobals();
    }
  });

  it('preserves one-time context assembly, ordered results, and summary activity', async () => {
    state.fetchResponses = [
      { status: 200, body: Buffer.from('asset-1') },
      { status: 200, body: Buffer.from('asset-2') },
    ];
    state.altTextResponses = ['Hero image alt', null];

    const started = startWebflowBulkAltJob({
      workspaceId: 'ws-1',
      siteId: 'site-1',
      assets: [
        { assetId: 'asset-1', imageUrl: 'https://cdn.example.test/hero.jpg' },
        { assetId: 'asset-2', imageUrl: 'https://cdn.example.test/logo.png?fit=max' },
      ],
    });

    const job = await waitForTerminalJob(started.jobId);

    expect(state.intelligenceCalls).toEqual([
      { workspaceId: 'ws-1', slices: ['seoContext'] },
    ]);
    expect(state.altTextCalls).toEqual([
      {
        tmpPath: '/tmp/bulk_alt_1717171717000.jpg',
        context: 'Site keywords: seo agency, web analytics, growth strategyVoice: clear and direct.',
      },
      {
        tmpPath: '/tmp/bulk_alt_1717171717000.png',
        context: 'Site keywords: seo agency, web analytics, growth strategyVoice: clear and direct.',
      },
    ]);
    expect(state.updateCalls).toEqual([
      { assetId: 'asset-1', altText: 'Hero image alt', token: 'wf-token' },
    ]);
    expect(state.writtenPaths).toEqual([
      '/tmp/bulk_alt_1717171717000.jpg',
      '/tmp/bulk_alt_1717171717000.png',
    ]);
    expect(state.unlinkedPaths).toEqual([
      '/tmp/bulk_alt_1717171717000.jpg',
      '/tmp/bulk_alt_1717171717000.png',
    ]);
    expect(job).toMatchObject({
      type: 'bulk-alt',
      workspaceId: 'ws-1',
      status: 'done',
      progress: 2,
      message: 'Done — 1/2 updated',
      result: [
        { assetId: 'asset-1', altText: 'Hero image alt', updated: true },
        { assetId: 'asset-2', updated: false, error: 'Generation returned null' },
      ],
    });
    expect(state.activityCalls).toEqual([
      {
        workspaceId: 'ws-1',
        type: 'images_optimized',
        message: 'Bulk alt text: 1 images updated',
        metadata: { updated: 1, total: 2 },
      },
    ]);
  });

  it('keeps per-asset download and generation failures as soft failures while completing the job', async () => {
    state.fetchResponses = [
      { status: 404 },
      { status: 200, body: Buffer.from('asset-2') },
      { status: 200, body: Buffer.from('asset-3') },
    ];
    state.altTextResponses = [
      new Error('generation exploded'),
      'Footer image alt',
    ];

    const started = startWebflowBulkAltJob({
      workspaceId: 'ws-1',
      siteId: 'site-1',
      assets: [
        { assetId: 'asset-1', imageUrl: 'https://cdn.example.test/missing.jpg' },
        { assetId: 'asset-2', imageUrl: 'https://cdn.example.test/broken.png' },
        { assetId: 'asset-3', imageUrl: 'https://cdn.example.test/footer.svg' },
      ],
    });

    const job = await waitForTerminalJob(started.jobId);

    expect(job).toMatchObject({
      type: 'bulk-alt',
      workspaceId: 'ws-1',
      status: 'done',
      progress: 3,
      message: 'Done — 1/3 updated',
      result: [
        { assetId: 'asset-1', updated: false, error: 'Download failed: 404' },
        { assetId: 'asset-2', updated: false, error: 'Error: generation exploded' },
        { assetId: 'asset-3', altText: 'Footer image alt', updated: true },
      ],
    });
    expect(state.updateCalls).toEqual([
      { assetId: 'asset-3', altText: 'Footer image alt', token: 'wf-token' },
    ]);
    expect(state.unlinkedPaths).toEqual([
      '/tmp/bulk_alt_1717171717000.svg',
    ]);
    expect(state.activityCalls).toEqual([
      {
        workspaceId: 'ws-1',
        type: 'images_optimized',
        message: 'Bulk alt text: 1 images updated',
        metadata: { updated: 1, total: 3 },
      },
    ]);
  });
});
