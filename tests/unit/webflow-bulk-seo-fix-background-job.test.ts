import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearCompletedJobs,
  getJob,
} from '../../server/jobs.js';
import { WS_EVENTS } from '../../server/ws-events.js';

const nativeFetch = globalThis.fetch;
const originalOpenAiKey = process.env.OPENAI_API_KEY;

const state = vi.hoisted(() => ({
  intelligenceCalls: [] as Array<{ workspaceId: string; slices: string[] }>,
  creativeResponses: [] as Array<string | Error>,
  creativeCalls: [] as Array<{ workspaceId: string; feature: string; systemPrompt: string; userPrompt: string }>,
  updateSeoResponses: [] as Array<{ success: boolean; error?: string }>,
  updateSeoCalls: [] as Array<{ pageId: string; payload: Record<string, unknown>; token: string | undefined }>,
  pageStateCalls: [] as Array<{ workspaceId: string; pageId: string; payload: Record<string, unknown> }>,
  seoChangeCalls: [] as Array<{ workspaceId: string; pageId: string; pagePath: string; fields: string[]; source: string }>,
  broadcastCalls: [] as Array<{ workspaceId: string; event: string; payload: Record<string, unknown> }>,
  activityCalls: [] as Array<{ workspaceId: string; type: string; message: string; detail: string | undefined; metadata: Record<string, unknown> | undefined }>,
  invalidateCalls: [] as string[],
  resolveRecCalls: [] as Array<{ workspaceId: string; pageIds: string[] }>,
  fetchCalls: [] as string[],
  fetchResponses: [] as Array<{ ok: boolean; html: string } | Error>,
}));

vi.mock('../../server/workspace-intelligence.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/workspace-intelligence.js')>();
  return {
    ...actual,
    buildWorkspaceIntelligence: vi.fn(async (workspaceId: string, opts?: { slices?: string[] }) => {
      state.intelligenceCalls.push({ workspaceId, slices: [...(opts?.slices ?? [])] });
      return {
        seoContext: {
          effectiveBrandVoiceBlock: '\nVoice: confident and direct.',
        },
      };
    }),
  };
});
vi.mock('../../server/intelligence/cache-invalidation.js', () => ({
  invalidateIntelligenceCache: vi.fn((workspaceId: string) => {
    state.invalidateCalls.push(workspaceId);
  }),
}));

vi.mock('../../server/content-posts-ai.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/content-posts-ai.js')>();
  return {
    ...actual,
    callCreativeAI: vi.fn(async (args: { workspaceId?: string; feature?: string; systemPrompt: string; userPrompt: string }) => {
      state.creativeCalls.push({
        workspaceId: args.workspaceId ?? '',
        feature: args.feature ?? '',
        systemPrompt: args.systemPrompt,
        userPrompt: args.userPrompt,
      });
      const next = state.creativeResponses.shift();
      if (next instanceof Error) throw next;
      return next ?? '';
    }),
  };
});

vi.mock('../../server/webflow.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/webflow.js')>();
  return {
    ...actual,
    updatePageSeo: vi.fn(async (pageId: string, payload: Record<string, unknown>, token?: string) => {
      state.updateSeoCalls.push({ pageId, payload, token });
      return state.updateSeoResponses.shift() ?? { success: true };
    }),
  };
});

vi.mock('../../server/workspaces.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/workspaces.js')>();
  return {
    ...actual,
    getBrandName: vi.fn(() => 'Hmpsn Studio'),
    updatePageState: vi.fn((workspaceId: string, pageId: string, payload: Record<string, unknown>) => {
      state.pageStateCalls.push({ workspaceId, pageId, payload });
    }),
  };
});

vi.mock('../../server/seo-change-tracker.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/seo-change-tracker.js')>();
  return {
    ...actual,
    recordSeoChange: vi.fn((workspaceId: string, pageId: string, pagePath: string, _pageTitle: string, fields: string[], source: string) => {
      state.seoChangeCalls.push({ workspaceId, pageId, pagePath, fields, source });
    }),
  };
});

vi.mock('../../server/broadcast.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/broadcast.js')>();
  return {
    ...actual,
    broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: Record<string, unknown>) => {
      state.broadcastCalls.push({ workspaceId, event, payload });
    }),
  };
});

vi.mock('../../server/activity-log.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/activity-log.js')>();
  return {
    ...actual,
    addActivity: vi.fn((workspaceId: string, type: string, message: string, detail?: string, metadata?: Record<string, unknown>) => {
      state.activityCalls.push({ workspaceId, type, message, detail, metadata });
    }),
  };
});

vi.mock('../../server/recommendations.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/recommendations.js')>();
  return {
    ...actual,
    resolveRecommendationsForPageIds: vi.fn((workspaceId: string, pageIds: string[]) => {
      state.resolveRecCalls.push({ workspaceId, pageIds: [...pageIds] });
      return pageIds.length;
    }),
  };
});

vi.mock('../../server/url-helpers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/url-helpers.js')>();
  return {
    ...actual,
    resolveBaseUrl: vi.fn(async () => 'https://example.test'),
  };
});

import { startWebflowBulkSeoFixJob } from '../../server/webflow-bulk-seo-fix-background-job.js';

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

describe('startWebflowBulkSeoFixJob', () => {
  beforeEach(() => {
    clearCompletedJobs();
    process.env.OPENAI_API_KEY = 'test-openai-key';
    state.intelligenceCalls = [];
    state.creativeResponses = [];
    state.creativeCalls = [];
    state.updateSeoResponses = [];
    state.updateSeoCalls = [];
    state.pageStateCalls = [];
    state.seoChangeCalls = [];
    state.broadcastCalls = [];
    state.activityCalls = [];
    state.invalidateCalls = [];
    state.resolveRecCalls = [];
    state.fetchCalls = [];
    state.fetchResponses = [];

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      state.fetchCalls.push(String(input));
      const next = state.fetchResponses.shift();
      if (next instanceof Error) throw next;
      return new Response(next?.html ?? '', { status: next?.ok === false ? 500 : 200 });
    }));
  });

  afterAll(() => {
    clearCompletedJobs();
    vi.restoreAllMocks();
    if (originalOpenAiKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiKey;
    if (nativeFetch) {
      vi.stubGlobal('fetch', nativeFetch);
    } else {
      vi.unstubAllGlobals();
    }
  });

  it('preserves ordered page writes, broadcast wiring, and recommendation resolution for applied pages', async () => {
    state.fetchResponses = [
      { ok: true, html: '<html><body><h1>Services</h1><p>Expert SEO services for local businesses.</p></body></html>' },
    ];
    state.creativeResponses = [
      '"SEO Services for Local Growth"',
      'Second page title',
    ];
    state.updateSeoResponses = [
      { success: true },
      { success: false, error: 'Webflow API error' },
    ];

    const started = startWebflowBulkSeoFixJob({
      workspaceId: 'ws-1',
      siteId: 'site-1',
      field: 'title',
      token: 'wf-token',
      liveDomain: 'https://example.test',
      brandName: 'Hmpsn Studio',
      pages: [
        {
          pageId: 'page-1',
          title: 'Services',
          slug: 'services',
          publishedPath: '/services',
        },
        {
          pageId: 'page-2',
          title: 'About',
          slug: 'about',
          pageContent: 'About page context already present.',
        },
      ],
    });

    const job = await waitForTerminalJob(started.jobId);

    expect(state.intelligenceCalls).toEqual([
      { workspaceId: 'ws-1', slices: ['seoContext'] },
    ]);
    expect(state.fetchCalls).toEqual([
      'https://example.test/services',
    ]);
    expect(state.creativeCalls).toHaveLength(2);
    expect(state.creativeCalls[0]).toEqual(expect.objectContaining({
      workspaceId: 'ws-1',
      feature: 'job-bulk-seo-fix',
    }));
    expect(state.creativeCalls[0].systemPrompt).toContain('Return ONLY the requested text');
    expect(state.creativeCalls[0].userPrompt).toContain('Brand name is "Hmpsn Studio"');
    expect(state.creativeCalls[0].userPrompt).toContain('Page content excerpt: Services Expert SEO services for local businesses.');
    expect(state.updateSeoCalls).toEqual([
      { pageId: 'page-1', payload: { seo: { title: 'SEO Services for Local Growth' } }, token: 'wf-token' },
      { pageId: 'page-2', payload: { seo: { title: 'Second page title' } }, token: 'wf-token' },
    ]);
    expect(state.pageStateCalls).toEqual([
      {
        workspaceId: 'ws-1',
        pageId: 'page-1',
        payload: {
          status: 'live',
          source: 'bulk-fix',
          fields: ['title'],
          updatedBy: 'system',
          slug: '/services',
        },
      },
    ]);
    expect(state.seoChangeCalls).toEqual([
      {
        workspaceId: 'ws-1',
        pageId: 'page-1',
        pagePath: '/services',
        fields: ['title'],
        source: 'bulk-fix',
      },
    ]);
    expect(job).toMatchObject({
      type: 'bulk-seo-fix',
      workspaceId: 'ws-1',
      status: 'done',
      progress: 2,
      message: 'Done — 1/2 titles updated',
      result: {
        field: 'title',
        results: [
          { pageId: 'page-1', text: 'SEO Services for Local Growth', applied: true },
          { pageId: 'page-2', text: '', applied: false, error: 'Webflow API error' },
        ],
      },
    });
    expect(state.broadcastCalls).toEqual([
      {
        workspaceId: 'ws-1',
        event: WS_EVENTS.PAGE_STATE_UPDATED,
        payload: { pageIds: ['page-1'], fields: ['title'], source: 'bulk-fix' },
      },
    ]);
    expect(state.invalidateCalls).toEqual(['ws-1']);
    expect(state.resolveRecCalls).toEqual([
      { workspaceId: 'ws-1', pageIds: ['page-1'] },
    ]);
    expect(state.activityCalls).toEqual([
      {
        workspaceId: 'ws-1',
        type: 'seo_updated',
        message: 'Bulk title optimization: 1 pages updated',
        detail: 'AI-generated titles applied to 1/2 pages',
        metadata: { field: 'title', pagesUpdated: 1, totalPages: 2, pageIds: ['page-1'] },
      },
    ]);
  });

  it('keeps empty AI responses as soft failures without page-state broadcasts', async () => {
    state.creativeResponses = ['""'];

    const started = startWebflowBulkSeoFixJob({
      workspaceId: 'ws-1',
      siteId: 'site-1',
      field: 'description',
      token: 'wf-token',
      pages: [
        {
          pageId: 'page-3',
          title: 'Contact',
          slug: 'contact',
          pageContent: 'Contact us for help.',
        },
      ],
    });

    const job = await waitForTerminalJob(started.jobId);

    expect(job).toMatchObject({
      type: 'bulk-seo-fix',
      workspaceId: 'ws-1',
      status: 'done',
      message: 'Done — 0/1 descriptions updated',
      result: {
        field: 'description',
        results: [
          { pageId: 'page-3', text: '', applied: false, error: 'Empty AI response' },
        ],
      },
    });
    expect(state.pageStateCalls).toEqual([]);
    expect(state.seoChangeCalls).toEqual([]);
    expect(state.broadcastCalls).toEqual([]);
    expect(state.invalidateCalls).toEqual([]);
    expect(state.resolveRecCalls).toEqual([]);
    expect(state.activityCalls).toEqual([
      {
        workspaceId: 'ws-1',
        type: 'seo_updated',
        message: 'Bulk description optimization: 0 pages updated',
        detail: 'AI-generated descriptions applied to 0/1 pages',
        metadata: { field: 'description', pagesUpdated: 0, totalPages: 1, pageIds: [] },
      },
    ]);
  });

  it('preserves the missing-OpenAI-key terminal error contract', async () => {
    delete process.env.OPENAI_API_KEY;

    const started = startWebflowBulkSeoFixJob({
      workspaceId: 'ws-1',
      siteId: 'site-1',
      field: 'title',
      token: 'wf-token',
      pages: [
        { pageId: 'page-4', title: 'Home' },
      ],
    });

    const job = await waitForTerminalJob(started.jobId);

    expect(job).toMatchObject({
      type: 'bulk-seo-fix',
      workspaceId: 'ws-1',
      status: 'error',
      message: 'Missing API key',
      error: 'OPENAI_API_KEY not configured',
    });
    expect(state.creativeCalls).toEqual([]);
    expect(state.activityCalls).toEqual([]);
    expect(state.broadcastCalls).toEqual([]);
  });
});
