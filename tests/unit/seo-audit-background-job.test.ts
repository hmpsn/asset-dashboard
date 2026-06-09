import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearCompletedJobs,
  getJob,
} from '../../server/jobs.js';

const seoAuditResult = {
  siteScore: 83,
  totalPages: 1,
  errors: 0,
  warnings: 1,
  infos: 0,
  pages: [{
    pageId: 'page-1',
    page: 'Home',
    slug: '/',
    url: 'https://example.com/',
    score: 83,
    issues: [{
      check: 'meta-description',
      severity: 'warning',
      message: 'Missing description',
      recommendation: 'Add a meta description.',
      suggestedFix: 'Add a concise meta description.',
    }],
  }],
  siteWideIssues: [],
};

const state = vi.hoisted(() => ({
  workspace: {
    id: 'ws-1',
    name: 'Audit Workspace',
    webflowSiteId: 'site-1',
    auditSuppressions: [],
  },
  runSeoAuditImpl: vi.fn(async () => seoAuditResult),
  eventOrder: [] as string[],
  activityCalls: [] as Array<{ workspaceId: string; type: string; metadata: Record<string, unknown> | undefined }>,
  bridgeCalls: [] as Array<{ workspaceId: string; score: number }>,
  broadcastCalls: [] as Array<{ workspaceId: string; score: number; previousScore: number | null }>,
  generateRecommendationCalls: [] as string[],
  recommendationReadyCalls: [] as Array<Record<string, unknown>>,
  auditCompleteCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../server/seo-audit.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/seo-audit.js')>();
  return {
    ...actual,
    runSeoAudit: vi.fn(async (...args: unknown[]) => state.runSeoAuditImpl(...args)),
  };
});

vi.mock('../../server/reports.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/reports.js')>();
  return {
    ...actual,
    saveSnapshot: vi.fn(() => {
      state.eventOrder.push('saveSnapshot');
      return {
        id: 'snap-1',
        siteId: 'site-1',
        createdAt: new Date().toISOString(),
        previousScore: 79,
        audit: seoAuditResult,
        score: seoAuditResult.siteScore,
      };
    }),
    getLatestSnapshotBefore: vi.fn(() => null),
  };
});

vi.mock('../../server/audit-snapshot-views.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/audit-snapshot-views.js')>();
  return {
    ...actual,
    getEffectiveAudit: vi.fn((result: typeof seoAuditResult) => result),
    getEffectivePreviousScore: vi.fn(() => 79),
  };
});

vi.mock('../../server/activity-log.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/activity-log.js')>();
  return {
    ...actual,
    addActivity: vi.fn((workspaceId: string, type: string, _message: string, _description?: string, metadata?: Record<string, unknown>) => {
      state.eventOrder.push('addActivity');
      state.activityCalls.push({ workspaceId, type, metadata });
    }),
  };
});

vi.mock('../../server/webflow-seo-audit-bridges.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/webflow-seo-audit-bridges.js')>();
  return {
    ...actual,
    handleOnDemandSeoAuditResult: vi.fn((workspace: { id: string }, audit: { siteScore: number }) => {
      state.eventOrder.push('bridge');
      state.bridgeCalls.push({ workspaceId: workspace.id, score: audit.siteScore });
    }),
  };
});

vi.mock('../../server/broadcast.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/broadcast.js')>();
  return {
    ...actual,
    broadcastToWorkspace: vi.fn((workspaceId: string, _event: string, payload: { score: number; previousScore: number | null }) => {
      state.eventOrder.push('broadcast');
      state.broadcastCalls.push({ workspaceId, score: payload.score, previousScore: payload.previousScore });
    }),
  };
});

vi.mock('../../server/recommendations.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/recommendations.js')>();
  return {
    ...actual,
    generateRecommendations: vi.fn(async (workspaceId: string) => {
      state.generateRecommendationCalls.push(workspaceId);
    }),
    loadRecommendations: vi.fn(() => ({ recommendations: [] })),
  };
});

vi.mock('../../server/workspaces.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/workspaces.js')>();
  return {
    ...actual,
    getWorkspace: vi.fn(() => state.workspace),
    listWorkspaces: vi.fn(() => [state.workspace]),
    getBrandName: vi.fn(() => 'Audit Workspace'),
    getClientPortalUrl: vi.fn(() => 'https://client.example.test'),
  };
});

vi.mock('../../server/email.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/email.js')>();
  return {
    ...actual,
    notifyClientRecommendationsReady: vi.fn((payload: Record<string, unknown>) => {
      state.recommendationReadyCalls.push(payload);
    }),
    notifyClientAuditComplete: vi.fn((payload: Record<string, unknown>) => {
      state.auditCompleteCalls.push(payload);
    }),
  };
});

import { startSeoAuditBackgroundJob } from '../../server/seo-audit-background-job.js';

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

describe('startSeoAuditBackgroundJob', () => {
  beforeEach(() => {
    clearCompletedJobs();
    state.workspace = {
      id: 'ws-1',
      name: 'Audit Workspace',
      webflowSiteId: 'site-1',
      auditSuppressions: [],
    };
    state.runSeoAuditImpl.mockReset();
    state.runSeoAuditImpl.mockResolvedValue(seoAuditResult);
    state.eventOrder = [];
    state.activityCalls = [];
    state.bridgeCalls = [];
    state.broadcastCalls = [];
    state.generateRecommendationCalls = [];
    state.recommendationReadyCalls = [];
    state.auditCompleteCalls = [];
  });

  afterAll(() => {
    clearCompletedJobs();
    vi.restoreAllMocks();
  });

  it('preserves snapshot-before-side-effect ordering and terminal result shape', async () => {
    const started = startSeoAuditBackgroundJob({
      workspaceId: 'ws-1',
      siteId: 'site-1',
      token: 'wf-token',
    });

    const job = await waitForTerminalJob(started.jobId);

    expect(job).toMatchObject({
      type: 'seo-audit',
      workspaceId: 'ws-1',
      status: 'done',
      message: 'Audit complete — score 83',
      result: expect.objectContaining({
        siteScore: 83,
        previousScore: 79,
        snapshotId: 'snap-1',
      }),
    });
    expect(state.eventOrder).toEqual([
      'saveSnapshot',
      'addActivity',
      'bridge',
      'broadcast',
    ]);
    expect(state.activityCalls).toEqual([
      {
        workspaceId: 'ws-1',
        type: 'audit_completed',
        metadata: { score: 83, previousScore: 79 },
      },
    ]);
    expect(state.bridgeCalls).toEqual([
      { workspaceId: 'ws-1', score: 83 },
    ]);
    expect(state.broadcastCalls).toEqual([
      { workspaceId: 'ws-1', score: 83, previousScore: 79 },
    ]);
    expect(state.generateRecommendationCalls).toEqual(['ws-1']);
    expect(state.recommendationReadyCalls).toHaveLength(0);
    expect(state.auditCompleteCalls).toHaveLength(0);
  });

  it('keeps the legacy error contract without mutation side effects', async () => {
    state.runSeoAuditImpl.mockRejectedValue(new Error('audit exploded'));

    const started = startSeoAuditBackgroundJob({
      workspaceId: 'ws-1',
      siteId: 'site-1',
      token: 'wf-token',
      skipLinkCheck: true,
    });

    const job = await waitForTerminalJob(started.jobId);

    expect(job).toMatchObject({
      type: 'seo-audit',
      workspaceId: 'ws-1',
      status: 'error',
      message: 'Audit failed',
      error: 'audit exploded',
    });
    expect(state.eventOrder).toEqual([]);
    expect(state.activityCalls).toHaveLength(0);
    expect(state.bridgeCalls).toHaveLength(0);
    expect(state.broadcastCalls).toHaveLength(0);
    expect(state.generateRecommendationCalls).toHaveLength(0);
  });
});
