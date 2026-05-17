import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: Record<string, unknown> }>,
}));

const strategyState = vi.hoisted(() => ({
  mode: 'success' as 'success' | 'upToDate' | 'error',
}));

const seoDataState = vi.hoisted(() => ({
  mode: 'success' as 'success' | 'error',
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: Record<string, unknown>) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/keyword-strategy-pages.js', () => ({
  discoverKeywordStrategyPages: vi.fn(async () => ({
    baseUrl: 'https://example.com',
    pageInfo: [
      {
        path: '/services/local-seo',
        title: 'Local SEO Services',
        seoTitle: 'Local SEO Services',
        seoDesc: 'Grow local visibility.',
        contentSnippet: 'Local SEO content snippet.',
      },
    ],
    preloadedPageKeywords: null,
  })),
}));

vi.mock('../../server/keyword-strategy-search-data.js', () => ({
  fetchKeywordStrategySearchData: vi.fn(async () => ({
    gscData: [],
    deviceBreakdown: [],
    countryBreakdown: [],
    periodComparison: null,
    organicLandingPages: [],
    organicOverview: null,
    ga4Conversions: [],
    ga4EventsByPage: [],
  })),
}));

vi.mock('../../server/keyword-strategy-seo-data.js', () => ({
  fetchAndCacheKeywordStrategySeoData: vi.fn(async () => {
    if (seoDataState.mode === 'error') {
      throw new Error('SEO provider fetch failed');
    }
    return {
      seoContext: '',
      domainKeywords: [],
      keywordGaps: [],
      relatedKeywords: [],
      questionKeywords: [],
      competitorKeywords: [],
    };
  }),
}));

vi.mock('../../server/keyword-strategy-ai-synthesis.js', async importOriginal => {
  const original = await importOriginal<typeof import('../../server/keyword-strategy-ai-synthesis.js')>();

  return {
    ...original,
    synthesizeKeywordStrategy: vi.fn(async () => {
      if (strategyState.mode === 'upToDate') {
        return {
          strategy: null,
          pagesToAnalyze: [],
          keywordPool: new Map(),
          businessSection: 'Existing strategy is still fresh.',
          upToDate: true,
          freshPageCount: 1,
        };
      }

      if (strategyState.mode === 'error') {
        throw new Error('Strategy synthesis failed');
      }

      return {
        strategy: {
          siteKeywords: ['Local SEO', 'SEO Agency'],
          opportunities: ['Improve service page coverage'],
          contentGaps: [
            {
              topic: 'Local SEO checklist',
              targetKeyword: 'local seo checklist',
              intent: 'informational',
              priority: 'high',
              rationale: 'Clients need a practical starter guide.',
            },
          ],
          quickWins: [
            {
              pagePath: '/services/local-seo',
              currentKeyword: 'seo services',
              action: 'Refine heading hierarchy for local-intent keyword',
              estimatedImpact: 'high',
              rationale: 'Primary intent is mismatched today.',
              roiScore: 88,
            },
          ],
          pageMap: [
            {
              pagePath: '/services/local-seo',
              pageTitle: 'Local SEO Services',
              primaryKeyword: 'local seo',
              secondaryKeywords: ['seo agency'],
              searchIntent: 'commercial',
            },
          ],
        },
        pagesToAnalyze: [
          {
            path: '/services/local-seo',
            title: 'Local SEO Services',
            seoTitle: 'Local SEO Services',
            seoDesc: 'Grow local visibility.',
            contentSnippet: 'Local SEO content snippet.',
          },
        ],
        keywordPool: new Map([
          ['local seo', { volume: 1200, difficulty: 42, source: 'mock' }],
        ]),
        businessSection: 'Serve local businesses that need measurable SEO growth.',
      };
    }),
  };
});

vi.mock('../../server/keyword-strategy-enrichment.js', () => ({
  enrichKeywordStrategy: vi.fn(async () => ({
    siteKeywordMetrics: [
      {
        keyword: 'local seo',
        volume: 1200,
        difficulty: 42,
        cpc: 9.5,
      },
    ],
    topicClusters: [],
    cannibalization: [],
  })),
}));

vi.mock('../../server/keyword-strategy-follow-ons.js', async importOriginal => {
  const original = await importOriginal<typeof import('../../server/keyword-strategy-follow-ons.js')>();

  return {
    ...original,
    queueKeywordStrategyPostUpdateFollowOns: vi.fn(),
  };
});

import db from '../../server/db/index.js';
import { createJob, clearCompletedJobs, listJobs } from '../../server/jobs.js';
import { getUsageCount } from '../../server/usage-tracking.js';
import { getWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { listPageKeywords } from '../../server/page-keywords.js';
import { getTrackedKeywords } from '../../server/rank-tracking.js';
import { getActionBySource } from '../../server/outcome-tracking.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';

let baseUrl = '';
let server: http.Server | undefined;
const originalAppPassword = process.env.APP_PASSWORD;
const originalOpenAiKey = process.env.OPENAI_API_KEY;

let workspace: SeededFullWorkspace;
let otherWorkspace: SeededFullWorkspace;

function countRows(
  table:
    | 'jobs'
    | 'page_keywords'
    | 'content_gaps'
    | 'quick_wins'
    | 'activity_log'
    | 'strategy_history'
    | 'usage_tracking'
    | 'rank_tracking_config',
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
  db.prepare('DELETE FROM usage_tracking WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM strategy_history WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM page_keywords WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM content_gaps WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM quick_wins WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM keyword_gaps WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM topic_clusters WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM cannibalization_issues WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM rank_tracking_config WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(workspaceId);
  db.prepare('UPDATE workspaces SET keyword_strategy = NULL WHERE id = ?').run(workspaceId);
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
  return fetch(`${baseUrl}${path}`, opts);
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
  workspace = seedWorkspace({ tier: 'premium' });
  otherWorkspace = seedWorkspace({ tier: 'premium' });
  broadcastState.calls = [];
  strategyState.mode = 'success';
  seoDataState.mode = 'success';
});

afterEach(() => {
  resetWorkspaceState(workspace.workspaceId);
  resetWorkspaceState(otherWorkspace.workspaceId);
  deleteWorkspace(workspace.workspaceId);
  deleteWorkspace(otherWorkspace.workspaceId);
});

afterAll(async () => {
  await stopTestServer();
  if (originalAppPassword === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = originalAppPassword;
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
});

describe('keyword strategy job mutation safety', () => {
  it('persists the successful background-job lifecycle and keeps writes scoped to the requested workspace', async () => {
    const startRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY,
      params: {
        workspaceId: workspace.workspaceId,
        businessContext: 'Focus on local SEO services for multi-location businesses.',
      },
    });
    expect(startRes.status).toBe(200);
    const started = await startRes.json() as { jobId: string };
    expect(typeof started.jobId).toBe('string');

    const job = await waitForJob(started.jobId);
    expect(job).toMatchObject({
      workspaceId: workspace.workspaceId,
      type: BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY,
      status: 'done',
      result: expect.objectContaining({
        siteKeywords: ['Local SEO', 'SEO Agency'],
        pageMap: [
          expect.objectContaining({
            pagePath: '/services/local-seo',
            primaryKeyword: 'local seo',
          }),
        ],
      }),
    });

    const storedWorkspace = getWorkspace(workspace.workspaceId);
    expect(storedWorkspace?.keywordStrategy).toMatchObject({
      businessContext: 'Focus on local SEO services for multi-location businesses.',
      siteKeywords: ['Local SEO', 'SEO Agency'],
      opportunities: ['Improve service page coverage'],
      seoDataMode: 'none',
    });
    expect(listPageKeywords(workspace.workspaceId)).toEqual([
      expect.objectContaining({
        pagePath: '/services/local-seo',
        primaryKeyword: 'local seo',
        searchIntent: 'commercial',
      }),
    ]);
    expect(countRows('content_gaps', workspace.workspaceId)).toBe(1);
    expect(countRows('quick_wins', workspace.workspaceId)).toBe(1);
    expect(activityTitles(workspace.workspaceId, 'strategy_generated')).toContain('Keyword strategy generated');
    expect(getTrackedKeywords(workspace.workspaceId).map(keyword => keyword.query)).toEqual([
      'local seo',
      'seo agency',
    ]);
    expect(getUsageCount(workspace.workspaceId, 'strategy_generations')).toBe(1);
    expect(getActionBySource('strategy', workspace.workspaceId)).not.toBeNull();
    expect(broadcastState.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        workspaceId: workspace.workspaceId,
        event: WS_EVENTS.STRATEGY_UPDATED,
        payload: expect.objectContaining({
          pageCount: 1,
          siteKeywords: 2,
        }),
      }),
    ]));

    expect(getWorkspace(otherWorkspace.workspaceId)?.keywordStrategy).toBeUndefined();
    expect(countRows('page_keywords', otherWorkspace.workspaceId)).toBe(0);
    expect(countRows('content_gaps', otherWorkspace.workspaceId)).toBe(0);
    expect(countRows('quick_wins', otherWorkspace.workspaceId)).toBe(0);
    expect(countRows('activity_log', otherWorkspace.workspaceId)).toBe(0);
    expect(getTrackedKeywords(otherWorkspace.workspaceId)).toEqual([]);
  });

  it('completes the incremental no-op path without writing strategy rows, activity, or broadcasts', async () => {
    strategyState.mode = 'upToDate';

    const startRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY,
      params: {
        workspaceId: workspace.workspaceId,
        mode: 'incremental',
      },
    });
    expect(startRes.status).toBe(200);
    const started = await startRes.json() as { jobId: string };

    const job = await waitForJob(started.jobId);
    expect(job).toMatchObject({
      workspaceId: workspace.workspaceId,
      type: BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY,
      status: 'done',
      result: {
        upToDate: true,
        freshPageCount: 1,
      },
    });

    expect(getWorkspace(workspace.workspaceId)?.keywordStrategy).toBeUndefined();
    expect(countRows('page_keywords', workspace.workspaceId)).toBe(0);
    expect(countRows('content_gaps', workspace.workspaceId)).toBe(0);
    expect(countRows('quick_wins', workspace.workspaceId)).toBe(0);
    expect(countRows('activity_log', workspace.workspaceId)).toBe(0);
    expect(getTrackedKeywords(workspace.workspaceId)).toEqual([]);
    expect(getUsageCount(workspace.workspaceId, 'strategy_generations')).toBe(0);
    expect(getActionBySource('strategy', workspace.workspaceId)).toBeNull();
    expect(broadcastState.calls).toHaveLength(0);
  });

  it('marks the job failed and refunds usage when generation crashes after the job starts', async () => {
    strategyState.mode = 'error';

    const startRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY,
      params: {
        workspaceId: workspace.workspaceId,
      },
    });
    expect(startRes.status).toBe(200);
    const started = await startRes.json() as { jobId: string };

    const job = await waitForJob(started.jobId);
    expect(job).toMatchObject({
      workspaceId: workspace.workspaceId,
      type: BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY,
      status: 'error',
      error: 'Strategy synthesis failed',
      message: 'Strategy generation failed',
    });

    expect(getWorkspace(workspace.workspaceId)?.keywordStrategy).toBeUndefined();
    expect(countRows('page_keywords', workspace.workspaceId)).toBe(0);
    expect(countRows('content_gaps', workspace.workspaceId)).toBe(0);
    expect(countRows('quick_wins', workspace.workspaceId)).toBe(0);
    expect(countRows('activity_log', workspace.workspaceId)).toBe(0);
    expect(getTrackedKeywords(workspace.workspaceId)).toEqual([]);
    expect(getUsageCount(workspace.workspaceId, 'strategy_generations')).toBe(0);
    expect(getActionBySource('strategy', workspace.workspaceId)).toBeNull();
    expect(broadcastState.calls).toHaveLength(0);
    expect(listJobs(workspace.workspaceId)).toHaveLength(1);
  });

  it('marks the job failed and refunds usage when SEO provider fetch fails before synthesis', async () => {
    seoDataState.mode = 'error';

    const startRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY,
      params: {
        workspaceId: workspace.workspaceId,
      },
    });
    expect(startRes.status).toBe(200);
    const started = await startRes.json() as { jobId: string };

    const job = await waitForJob(started.jobId);
    expect(job).toMatchObject({
      workspaceId: workspace.workspaceId,
      type: BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY,
      status: 'error',
      error: 'SEO provider fetch failed',
      message: 'Strategy generation failed',
    });

    expect(getWorkspace(workspace.workspaceId)?.keywordStrategy).toBeUndefined();
    expect(countRows('page_keywords', workspace.workspaceId)).toBe(0);
    expect(countRows('content_gaps', workspace.workspaceId)).toBe(0);
    expect(countRows('quick_wins', workspace.workspaceId)).toBe(0);
    expect(countRows('activity_log', workspace.workspaceId)).toBe(0);
    expect(getTrackedKeywords(workspace.workspaceId)).toEqual([]);
    expect(getUsageCount(workspace.workspaceId, 'strategy_generations')).toBe(0);
    expect(getActionBySource('strategy', workspace.workspaceId)).toBeNull();
    expect(broadcastState.calls).toHaveLength(0);
    expect(listJobs(workspace.workspaceId)).toHaveLength(1);
  });

  it('rejects a duplicate active keyword strategy job without another write path starting', async () => {
    const activeJob = createJob(BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY, {
      workspaceId: workspace.workspaceId,
      message: 'Generating keyword strategy...',
    });

    const jobsBefore = listJobs(workspace.workspaceId).length;
    const res = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY,
      params: {
        workspaceId: workspace.workspaceId,
      },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'A keyword strategy is already being generated for this workspace',
      jobId: activeJob.id,
    });

    expect(listJobs(workspace.workspaceId)).toHaveLength(jobsBefore);
    expect(getWorkspace(workspace.workspaceId)?.keywordStrategy).toBeUndefined();
    expect(countRows('page_keywords', workspace.workspaceId)).toBe(0);
    expect(countRows('activity_log', workspace.workspaceId)).toBe(0);
    expect(broadcastState.calls).toHaveLength(0);
  });
});
