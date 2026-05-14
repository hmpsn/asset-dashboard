import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

const nativeFetch = globalThis.fetch;

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: Record<string, unknown> }>,
}));

const analysisState = vi.hoisted(() => ({
  mode: 'success' as 'success' | 'error',
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: Record<string, unknown>) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/workspace-data.js', () => ({
  getWorkspacePages: vi.fn(async () => [
    {
      id: 'page-1',
      title: 'Local SEO Services',
      slug: 'services/local-seo',
      seo: {
        title: 'Local SEO Services',
        description: 'Grow local visibility.',
      },
    },
  ]),
}));

vi.mock('../../server/url-helpers.js', () => ({
  resolveBaseUrl: vi.fn(async () => 'https://example.com'),
}));

vi.mock('../../server/webflow.js', () => ({
  buildStaticPathSet: vi.fn(() => new Set<string>()),
  discoverCmsUrls: vi.fn(async () => ({ cmsUrls: [] })),
  getSiteSubdomain: vi.fn(async () => null),
  toCmsPageId: vi.fn((value: string) => `cms:${value}`),
}));

vi.mock('../../server/ai.js', () => ({
  callAI: vi.fn(async () => {
    if (analysisState.mode === 'error') {
      throw new Error('Page analysis AI failed');
    }

    return {
      text: JSON.stringify({
        primaryKeyword: 'local seo services',
        primaryKeywordPresence: {
          inTitle: true,
          inMeta: true,
          inContent: true,
          inSlug: true,
        },
        secondaryKeywords: ['seo agency'],
        longTailKeywords: ['local seo services for small businesses'],
        searchIntent: 'commercial',
        searchIntentConfidence: 0.91,
        contentGaps: ['service-area proof points'],
        competitorKeywords: ['best local seo agency'],
        optimizationScore: 87,
        optimizationIssues: ['Missing local proof section'],
        recommendations: ['Add location-specific outcomes'],
        estimatedDifficulty: 'medium',
        keywordDifficulty: 0,
        monthlyVolume: 0,
        topicCluster: 'local seo',
      }),
    };
  }),
}));

vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: vi.fn(async () => ({ seoContext: null, learnings: null })),
  formatForPrompt: vi.fn(() => ''),
  formatPageMapForPrompt: vi.fn(() => ''),
  invalidateIntelligenceCache: vi.fn(),
}));

vi.mock('../../server/provider-keyword-metrics.js', () => ({
  getProviderMetricsForKeywords: vi.fn(async () => new Map()),
  resolvePersistedKeywordMetrics: vi.fn(() => ({
    keywordDifficulty: 0,
    monthlyVolume: 0,
  })),
}));

vi.mock('../../server/bridge-infrastructure.js', () => ({
  debouncedPageAnalysisInvalidate: vi.fn((_workspaceId: string, fn: () => void) => fn()),
  invalidateSubCachePrefix: vi.fn(),
}));

import db from '../../server/db/index.js';
import { createJob, clearCompletedJobs, listJobs } from '../../server/jobs.js';
import { deleteWorkspace } from '../../server/workspaces.js';
import { listPageKeywords } from '../../server/page-keywords.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { WS_EVENTS } from '../../server/ws-events.js';

let baseUrl = '';
let server: http.Server | undefined;
const originalAppPassword = process.env.APP_PASSWORD;
const originalOpenAiKey = process.env.OPENAI_API_KEY;

let workspace: SeededFullWorkspace;
let otherWorkspace: SeededFullWorkspace;

function countRows(
  table: 'jobs' | 'page_keywords' | 'activity_log',
  workspaceId: string,
): number {
  const row = db.prepare(`SELECT COALESCE(COUNT(*), 0) AS count FROM ${table} WHERE workspace_id = ?`).get(workspaceId) as { count: number };
  return row.count;
}

function activityTitles(workspaceId: string, type: string): string[] {
  return db.prepare(`
    SELECT title
    FROM activity_log
    WHERE workspace_id = ? AND type = ?
    ORDER BY created_at DESC
  `).all(workspaceId, type).map((row: { title: string }) => row.title);
}

function resetWorkspaceState(workspaceId: string): void {
  clearCompletedJobs({ workspaceId });
  db.prepare('DELETE FROM jobs WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM page_keywords WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(workspaceId);
}

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  process.env.OPENAI_API_KEY = 'test-openai-key';
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
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    if (url.startsWith(baseUrl)) {
      return nativeFetch(url, init);
    }

    if (url === 'https://example.com/services/local-seo') {
      return new Response(`
        <html>
          <head>
            <title>Local SEO Services</title>
            <meta name="description" content="Grow local visibility." />
          </head>
          <body>
            <main>
              Local SEO services for multi-location businesses.
            </main>
          </body>
        </html>
      `, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }));
}, 30_000);

beforeEach(() => {
  workspace = seedWorkspace({ tier: 'premium' });
  otherWorkspace = seedWorkspace({ tier: 'premium' });
  broadcastState.calls = [];
  analysisState.mode = 'success';
});

afterEach(() => {
  resetWorkspaceState(workspace.workspaceId);
  resetWorkspaceState(otherWorkspace.workspaceId);
  deleteWorkspace(workspace.workspaceId);
  deleteWorkspace(otherWorkspace.workspaceId);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await stopTestServer();
  if (originalAppPassword === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = originalAppPassword;
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
});

describe('page analysis job mutation safety', () => {
  it('persists analyzed page-keyword writes, activity, and broadcasts only for the requested workspace', async () => {
    const startRes = await postJson('/api/jobs', {
      type: 'page-analysis',
      params: {
        workspaceId: workspace.workspaceId,
        siteId: workspace.webflowSiteId,
      },
    });
    expect(startRes.status).toBe(200);
    const started = await startRes.json() as { jobId: string };

    const job = await waitForJob(started.jobId);
    expect(job).toMatchObject({
      workspaceId: workspace.workspaceId,
      type: 'page-analysis',
      status: 'done',
      result: {
        analyzed: 1,
        skipped: 0,
        skippedFetch: 0,
        failed: 0,
        total: 1,
      },
    });

    expect(listPageKeywords(workspace.workspaceId)).toEqual([
      expect.objectContaining({
        pagePath: '/services/local-seo',
        pageTitle: 'Local SEO Services',
        primaryKeyword: 'local seo services',
        searchIntent: 'commercial',
        optimizationScore: 87,
      }),
    ]);
    expect(activityTitles(workspace.workspaceId, 'page_analysis')).toContain('Bulk page analysis completed — 1 pages');
    expect(broadcastState.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        workspaceId: workspace.workspaceId,
        event: WS_EVENTS.STRATEGY_UPDATED,
        payload: expect.objectContaining({
          analyzed: 1,
          source: 'page-analysis-job',
        }),
      }),
    ]));

    expect(countRows('page_keywords', otherWorkspace.workspaceId)).toBe(0);
    expect(countRows('activity_log', otherWorkspace.workspaceId)).toBe(0);
    expect(broadcastState.calls.length).toBeGreaterThan(0);
    for (const call of broadcastState.calls) {
      expect(call.workspaceId).toBe(workspace.workspaceId);
    }
  });

  it('records skipped analysis without persisting page-keyword rows or broadcasts when page analysis crashes per page', async () => {
    analysisState.mode = 'error';

    const startRes = await postJson('/api/jobs', {
      type: 'page-analysis',
      params: {
        workspaceId: workspace.workspaceId,
        siteId: workspace.webflowSiteId,
      },
    });
    expect(startRes.status).toBe(200);
    const started = await startRes.json() as { jobId: string };

    const job = await waitForJob(started.jobId);
    expect(job).toMatchObject({
      workspaceId: workspace.workspaceId,
      type: 'page-analysis',
      status: 'done',
      message: 'Done — 0/1 pages analyzed (1 skipped)',
      result: {
        analyzed: 0,
        skipped: 1,
        skippedFetch: 0,
        failed: 1,
        total: 1,
      },
    });

    expect(countRows('page_keywords', workspace.workspaceId)).toBe(0);
    expect(activityTitles(workspace.workspaceId, 'page_analysis')).toContain('Bulk page analysis completed — 0 pages');
    expect(broadcastState.calls).toHaveLength(0);
  });

  it('rejects a mismatched workspace/site pair without starting another workspace write path', async () => {
    const jobsBefore = listJobs(workspace.workspaceId).length;

    const res = await postJson('/api/jobs', {
      type: 'page-analysis',
      params: {
        workspaceId: workspace.workspaceId,
        siteId: otherWorkspace.webflowSiteId,
      },
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'You do not have access to this workspace',
    });
    expect(listJobs(workspace.workspaceId)).toHaveLength(jobsBefore);
    expect(countRows('page_keywords', workspace.workspaceId)).toBe(0);
    expect(countRows('activity_log', workspace.workspaceId)).toBe(0);
    expect(broadcastState.calls).toHaveLength(0);
  });

  it('rejects a duplicate active page-analysis job without starting a second mutation path', async () => {
    const activeJob = createJob('page-analysis', {
      workspaceId: workspace.workspaceId,
      message: 'Discovering pages...',
    });

    const jobsBefore = listJobs(workspace.workspaceId).length;
    const res = await postJson('/api/jobs', {
      type: 'page-analysis',
      params: {
        workspaceId: workspace.workspaceId,
        siteId: workspace.webflowSiteId,
      },
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Page analysis is already running',
      jobId: activeJob.id,
    });
    expect(listJobs(workspace.workspaceId)).toHaveLength(jobsBefore);
    expect(countRows('page_keywords', workspace.workspaceId)).toBe(0);
    expect(countRows('activity_log', workspace.workspaceId)).toBe(0);
    expect(broadcastState.calls).toHaveLength(0);
  });
});
