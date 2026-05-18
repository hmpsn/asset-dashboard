import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import db from '../../server/db/index.js';

const nativeFetch = globalThis.fetch;

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: Record<string, unknown> }>,
}));

const seoAuditState = vi.hoisted(() => ({
  mode: 'success' as 'success' | 'error',
}));

const bulkSeoState = vi.hoisted(() => ({
  mode: 'success' as 'success' | 'error',
}));

const salesReportState = vi.hoisted(() => ({
  mode: 'success' as 'success' | 'error',
  lastMaxPages: null as number | null,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: Record<string, unknown>) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/seo-audit.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/seo-audit.js')>();
  return {
    ...actual,
    runSeoAudit: vi.fn(async () => {
      if (seoAuditState.mode === 'error') throw new Error('SEO audit failed in test');
      return {
        siteScore: 82,
        totalPages: 2,
        errors: 1,
        warnings: 1,
        infos: 0,
        pages: [
          {
            pageId: 'home',
            page: 'Home',
            slug: '/',
            url: 'https://example.test/',
            score: 82,
            issues: [],
          },
        ],
        siteWideIssues: [],
      };
    }),
  };
});

vi.mock('../../server/reports.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/reports.js')>();
  return {
    ...actual,
    saveSnapshot: vi.fn(() => ({
      id: 'snap_test_1',
      previousScore: 75,
      score: 82,
      createdAt: new Date().toISOString(),
      siteId: 'wf-test',
      audit: {
        siteScore: 82,
        totalPages: 2,
        errors: 1,
        warnings: 1,
        infos: 0,
        pages: [],
        siteWideIssues: [],
      },
    })),
    getLatestSnapshotBefore: vi.fn(() => null),
  };
});

vi.mock('../../server/recommendations.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/recommendations.js')>();
  return {
    ...actual,
    generateRecommendations: vi.fn(async () => undefined),
  };
});

vi.mock('../../server/content-posts-ai.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/content-posts-ai.js')>();
  return {
    ...actual,
    callCreativeAI: vi.fn(async () => {
      if (bulkSeoState.mode === 'error') throw new Error('Bulk SEO AI failed in test');
      return 'High-Intent Service Page Title';
    }),
  };
});

vi.mock('../../server/url-helpers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/url-helpers.js')>();
  return {
    ...actual,
    resolveBaseUrl: vi.fn(async () => ''),
  };
});

vi.mock('../../server/workspace-intelligence.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/workspace-intelligence.js')>();
  return {
    ...actual,
    buildWorkspaceIntelligence: vi.fn(async () => ({
      seoContext: {
        strategy: { pageMap: [] },
        personas: [],
        knowledgeBase: '',
        effectiveBrandVoiceBlock: '',
      },
    })),
    formatKeywordsForPrompt: vi.fn(() => ''),
    formatPersonasForPrompt: vi.fn(() => ''),
    formatKnowledgeBaseForPrompt: vi.fn(() => ''),
  };
});

vi.mock('../../server/webflow.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/webflow.js')>();
  return {
    ...actual,
    updatePageSeo: vi.fn(async () => ({ success: true })),
  };
});

vi.mock('../../server/sales-audit.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/sales-audit.js')>();
  return {
    ...actual,
    runSalesAudit: vi.fn(async (_url: string, maxPages: number) => {
      salesReportState.lastMaxPages = maxPages;
      if (salesReportState.mode === 'error') throw new Error('Sales report failed in test');
      return {
        siteScore: 67,
        summary: 'Mock sales audit summary',
        pages: [],
        checks: [],
      };
    }),
  };
});

import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { clearCompletedJobs, createJob, listJobs, updateJob } from '../../server/jobs.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';

let baseUrl = '';
let server: http.Server | undefined;
let workspaceAId = '';
let workspaceBId = '';
let siteA = '';
let siteB = '';
const originalAppPassword = process.env.APP_PASSWORD;
const originalOpenAiKey = process.env.OPENAI_API_KEY;

function countWorkspaceRows(table: 'jobs' | 'activity_log' | 'page_edit_states', workspaceId: string): number {
  const row = db.prepare(`SELECT COALESCE(COUNT(*), 0) AS count FROM ${table} WHERE workspace_id = ?`).get(workspaceId) as { count: number };
  return row.count;
}

function countGlobalJobs(): number {
  const row = db.prepare('SELECT COALESCE(COUNT(*), 0) AS count FROM jobs WHERE workspace_id IS NULL').get() as { count: number };
  return row.count;
}

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
  broadcastState.calls = [];
}

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  process.env.OPENAI_API_KEY = 'test-openai-key';
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
  await startTestServer();
}, 30_000);

beforeEach(() => {
  resetState();
  seoAuditState.mode = 'success';
  bulkSeoState.mode = 'success';
  salesReportState.mode = 'success';
  salesReportState.lastMaxPages = null;

  const wsA = createWorkspace('Legacy Jobs Mutation A', 'wf-site-a', 'Site A');
  const wsB = createWorkspace('Legacy Jobs Mutation B', 'wf-site-b', 'Site B');
  workspaceAId = wsA.id;
  workspaceBId = wsB.id;
  siteA = wsA.webflowSiteId!;
  siteB = wsB.webflowSiteId!;

  updateWorkspace(workspaceAId, {
    webflowToken: 'wf-token-a',
    liveDomain: 'https://a.example.test',
  });
  updateWorkspace(workspaceBId, {
    webflowToken: 'wf-token-b',
    liveDomain: 'https://b.example.test',
  });
});

afterEach(() => {
  resetState();
  deleteWorkspace(workspaceAId);
  deleteWorkspace(workspaceBId);
});

afterAll(async () => {
  await stopTestServer();
  if (originalAppPassword === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = originalAppPassword;
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
});

describe('legacy job mutation safety bundle', () => {
  it('seo-audit writes terminal state, activity, and audit broadcast only for the owning workspace', async () => {
    const res = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.SEO_AUDIT,
      params: { workspaceId: workspaceAId, siteId: siteA },
    });
    expect(res.status).toBe(200);
    const start = await res.json() as { jobId: string };

    const job = await waitForJob(start.jobId);
    expect(job).toMatchObject({
      workspaceId: workspaceAId,
      type: BACKGROUND_JOB_TYPES.SEO_AUDIT,
      status: 'done',
      result: expect.objectContaining({
        siteScore: 82,
        previousScore: 75,
        snapshotId: 'snap_test_1',
      }),
    });
    expect(countActivities(workspaceAId, 'audit_completed')).toBe(1);
    expect(countActivities(workspaceBId, 'audit_completed')).toBe(0);
    expect(broadcastState.calls).toContainEqual(expect.objectContaining({
      workspaceId: workspaceAId,
      event: WS_EVENTS.AUDIT_COMPLETE,
      payload: expect.objectContaining({ score: 82, previousScore: 75 }),
    }));
    expect(countWorkspaceRows('jobs', workspaceBId)).toBe(0);
  });

  it('seo-audit error and cross-workspace mismatch produce no mutation side effects', async () => {
    seoAuditState.mode = 'error';

    const failRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.SEO_AUDIT,
      params: { workspaceId: workspaceAId, siteId: siteA },
    });
    expect(failRes.status).toBe(200);
    const started = await failRes.json() as { jobId: string };
    const failedJob = await waitForJob(started.jobId);
    expect(failedJob).toMatchObject({
      workspaceId: workspaceAId,
      type: BACKGROUND_JOB_TYPES.SEO_AUDIT,
      status: 'error',
      message: 'Audit failed',
    });
    expect(countActivities(workspaceAId, 'audit_completed')).toBe(0);
    expect(broadcastState.calls).toHaveLength(0);

    const jobsBefore = listJobs(workspaceAId).length;
    const crossRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.SEO_AUDIT,
      params: { workspaceId: workspaceAId, siteId: siteB },
    });
    expect(crossRes.status).toBe(403);
    expect(listJobs(workspaceAId)).toHaveLength(jobsBefore);
    expect(countActivities(workspaceAId, 'audit_completed')).toBe(0);
    expect(broadcastState.calls).toHaveLength(0);
  });

  it('bulk-seo-fix writes page-state broadcast + activity on success and guards duplicate/cross-workspace starts', async () => {
    const res = await postJson('/api/jobs', {
      type: 'bulk-seo-fix',
      params: {
        workspaceId: workspaceAId,
        siteId: siteA,
        field: 'title',
        pages: [
          {
            pageId: 'page-1',
            title: 'Service Page',
            slug: 'services',
            publishedPath: '/services',
          },
        ],
      },
    });
    expect(res.status).toBe(200);
    const started = await res.json() as { jobId: string };
    const job = await waitForJob(started.jobId);
    expect(job).toMatchObject({
      workspaceId: workspaceAId,
      type: 'bulk-seo-fix',
      status: 'done',
      result: {
        field: 'title',
        results: [expect.objectContaining({ pageId: 'page-1', applied: true })],
      },
    });
    expect(countActivities(workspaceAId, 'seo_updated')).toBe(1);
    expect(broadcastState.calls).toContainEqual(expect.objectContaining({
      workspaceId: workspaceAId,
      event: WS_EVENTS.PAGE_STATE_UPDATED,
      payload: expect.objectContaining({ pageIds: ['page-1'], fields: ['title'] }),
    }));

    broadcastState.calls = [];
    const active = createJob('bulk-seo-fix', { workspaceId: workspaceAId, message: 'running' });
    const dupRes = await postJson('/api/jobs', {
      type: 'bulk-seo-fix',
      params: {
        workspaceId: workspaceAId,
        siteId: siteA,
        field: 'title',
        pages: [{ pageId: 'page-2', title: 'Another', slug: 'another' }],
      },
    });
    expect(dupRes.status).toBe(409);
    await expect(dupRes.json()).resolves.toMatchObject({
      error: 'A bulk SEO fix is already running',
      jobId: active.id,
    });
    updateJob(active.id, { status: 'done' });

    const crossRes = await postJson('/api/jobs', {
      type: 'bulk-seo-fix',
      params: {
        workspaceId: workspaceAId,
        siteId: siteB,
        field: 'title',
        pages: [{ pageId: 'page-3', title: 'Cross', slug: 'cross' }],
      },
    });
    expect(crossRes.status).toBe(403);
    expect(countWorkspaceRows('activity_log', workspaceBId)).toBe(0);
    expect(broadcastState.calls).toHaveLength(0);
  });

  it('bulk-seo-fix per-page AI error responses do not broadcast page-state updates', async () => {
    bulkSeoState.mode = 'error';

    const res = await postJson('/api/jobs', {
      type: 'bulk-seo-fix',
      params: {
        workspaceId: workspaceAId,
        siteId: siteA,
        field: 'description',
        pages: [{ pageId: 'page-1', title: 'Service Page', slug: 'services' }],
      },
    });
    expect(res.status).toBe(200);
    const start = await res.json() as { jobId: string };
    const job = await waitForJob(start.jobId);
    expect(job).toMatchObject({
      workspaceId: workspaceAId,
      type: 'bulk-seo-fix',
      status: 'done',
      result: {
        field: 'description',
        results: [expect.objectContaining({ pageId: 'page-1', applied: false })],
      },
    });
    expect(countWorkspaceRows('page_edit_states', workspaceAId)).toBe(0);
    expect(broadcastState.calls.some(call => call.event === WS_EVENTS.PAGE_STATE_UPDATED)).toBe(false);
    expect(countActivities(workspaceAId, 'seo_updated')).toBe(1);
  });

  it('sales-report error handling enforces terminal states and keeps workspace-scoped state untouched', async () => {
    const globalBefore = countGlobalJobs();
    const successRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.SALES_REPORT,
      params: { url: 'https://example.com', maxPages: 5 },
    });
    expect(successRes.status).toBe(200);
    const started = await successRes.json() as { jobId: string };
    const job = await waitForJob(started.jobId);
    expect(job).toMatchObject({
      type: BACKGROUND_JOB_TYPES.SALES_REPORT,
      status: 'done',
      result: expect.objectContaining({ siteScore: 67 }),
    });
    expect(countGlobalJobs()).toBe(globalBefore + 1);
    expect(countWorkspaceRows('activity_log', workspaceAId)).toBe(0);
    expect(countWorkspaceRows('activity_log', workspaceBId)).toBe(0);
    expect(broadcastState.calls).toHaveLength(0);

    salesReportState.mode = 'error';
    const errRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.SALES_REPORT,
      params: { url: 'https://example.com/fail' },
    });
    expect(errRes.status).toBe(200);
    const errStart = await errRes.json() as { jobId: string };
    const errJob = await waitForJob(errStart.jobId);
    expect(errJob).toMatchObject({
      type: BACKGROUND_JOB_TYPES.SALES_REPORT,
      status: 'error',
      message: 'Sales report failed',
    });

    const countBeforeMissingUrl = countGlobalJobs();
    const missingRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.SALES_REPORT,
      params: {},
    });
    expect(missingRes.status).toBe(400);
    await expect(missingRes.json()).resolves.toEqual({ error: 'url required' });

    const countBeforeInvalidMaxPages = countGlobalJobs();
    const invalidMaxPagesRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.SALES_REPORT,
      params: { url: 'https://example.com', maxPages: 0 },
    });
    expect(invalidMaxPagesRes.status).toBe(400);
    await expect(invalidMaxPagesRes.json()).resolves.toEqual({ error: 'maxPages must be a positive integer' });
    expect(countGlobalJobs()).toBe(countBeforeInvalidMaxPages);

    const nonIntegerMaxPagesRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.SALES_REPORT,
      params: { url: 'https://example.com', maxPages: 2.5 },
    });
    expect(nonIntegerMaxPagesRes.status).toBe(400);
    await expect(nonIntegerMaxPagesRes.json()).resolves.toEqual({ error: 'maxPages must be a positive integer' });
    expect(countGlobalJobs()).toBe(countBeforeInvalidMaxPages);

    salesReportState.mode = 'success';
    const boundedRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.SALES_REPORT,
      params: { url: 'https://example.com', maxPages: 999 },
    });
    expect(boundedRes.status).toBe(400);
    await expect(boundedRes.json()).resolves.toEqual({ error: 'maxPages must be between 1 and 100' });
    expect(salesReportState.lastMaxPages).toBe(25);

    expect(countGlobalJobs()).toBe(countBeforeMissingUrl);
  });
});
