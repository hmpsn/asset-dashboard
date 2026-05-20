import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: Record<string, unknown> }>,
}));

const strategyState = vi.hoisted(() => ({
  mode: 'success' as 'success' | 'upToDate' | 'upToDateNeedsCleanup' | 'upToDateKeywordGapOnly' | 'dropsAnalyzedPage' | 'error',
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
      if (strategyState.mode === 'upToDateKeywordGapOnly') {
        return {
          strategy: {
            siteKeywords: ['local seo'],
            opportunities: [],
            contentGaps: [],
            quickWins: [],
            pageMap: [
              {
                pagePath: '/services/local-seo',
                pageTitle: 'Local SEO Services',
                primaryKeyword: 'local seo',
                secondaryKeywords: [],
              },
            ],
          },
          pagesToAnalyze: [],
          keywordPool: new Map([
            ['local seo', { volume: 1200, difficulty: 42, source: 'mock' }],
            ['paper tiger', { volume: 9000, difficulty: 10, source: 'keyword_gap' }],
          ]),
          businessSection: 'Existing strategy is still fresh but has stale table-backed gaps.',
          upToDate: true,
          freshPageCount: 1,
          keywordEvaluationContext: {
            businessTerms: ['local', 'seo'],
            strictBusinessFit: false,
          },
        };
      }

      if (strategyState.mode === 'upToDateNeedsCleanup') {
        return {
          strategy: {
            siteKeywords: ['paper tiger', 'local seo'],
            opportunities: [],
            contentGaps: [],
            quickWins: [],
            pageMap: [
              {
                pagePath: '/services/local-seo',
                pageTitle: 'Local SEO Services',
                primaryKeyword: 'paper tiger',
                secondaryKeywords: ['local seo'],
              },
            ],
          },
          pagesToAnalyze: [],
          keywordPool: new Map([
            ['local seo', { volume: 1200, difficulty: 42, source: 'mock' }],
          ]),
          businessSection: 'Existing strategy is still fresh but needs cleanup.',
          upToDate: true,
          freshPageCount: 1,
          keywordEvaluationContext: {
            businessTerms: ['local', 'seo'],
            strictBusinessFit: false,
          },
        };
      }

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

      if (strategyState.mode === 'dropsAnalyzedPage') {
        return {
          strategy: {
            siteKeywords: ['local seo'],
            opportunities: [],
            contentGaps: [],
            quickWins: [],
            pageMap: [
              {
                pagePath: '/services/local-seo',
                pageTitle: 'Local SEO Services',
                primaryKeyword: 'local seo',
                secondaryKeywords: [],
              },
            ],
          },
          pagesToAnalyze: [
            {
              path: '/stale-dropped',
              title: 'Stale Dropped',
              seoTitle: 'Stale Dropped',
              seoDesc: 'Old noisy page assignment.',
              contentSnippet: 'Old noisy page assignment.',
            },
          ],
          keywordPool: new Map([
            ['local seo', { volume: 1200, difficulty: 42, source: 'mock' }],
          ]),
          businessSection: 'A stale analyzed page was dropped by final strategy sanitation.',
          keywordEvaluationContext: {
            businessTerms: ['local', 'seo'],
            strictBusinessFit: false,
          },
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
import { discoverKeywordStrategyPages } from '../../server/keyword-strategy-pages.js';
import { getUsageCount } from '../../server/usage-tracking.js';
import { getWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { listPageKeywords, upsertPageKeyword } from '../../server/page-keywords.js';
import { addTrackedKeyword, getTrackedKeywords } from '../../server/rank-tracking.js';
import { replaceAllContentGaps } from '../../server/content-gaps.js';
import { listKeywordGaps, replaceAllKeywordGaps } from '../../server/keyword-gaps.js';
import { getActionBySource } from '../../server/outcome-tracking.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { TRACKED_KEYWORD_SOURCE, TRACKED_KEYWORD_STATUS } from '../../shared/types/rank-tracking.js';
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
  vi.mocked(discoverKeywordStrategyPages).mockClear();
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
      'SEO Agency',
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

  it('sanitizes all-fresh incremental cleanup and reconciles strategy-owned rank tracking', async () => {
    strategyState.mode = 'upToDateNeedsCleanup';
    const generatedAt = '2026-05-01T00:00:00.000Z';
    updateWorkspace(workspace.workspaceId, {
      keywordStrategy: {
        siteKeywords: ['paper tiger', 'local seo'],
        opportunities: [],
        generatedAt,
      },
    });
    upsertPageKeyword(workspace.workspaceId, {
      pagePath: '/services/local-seo',
      pageTitle: 'Local SEO Services',
      primaryKeyword: 'paper tiger',
      secondaryKeywords: ['local seo'],
      analysisGeneratedAt: generatedAt,
    });
    replaceAllContentGaps(workspace.workspaceId, [{
      topic: 'Paper Tiger Guide',
      targetKeyword: 'paper tiger',
      intent: 'informational',
      priority: 'high',
      rationale: 'Stale competitor-gap artifact that should not survive cleanup.',
    }]);
    addTrackedKeyword(workspace.workspaceId, 'paper tiger', {
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY,
      pagePath: '/services/local-seo',
      strategyGeneratedAt: generatedAt,
      lastStrategySeenAt: generatedAt,
    });

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
      result: expect.objectContaining({
        siteKeywords: ['local seo'],
        pageMap: [
          expect.objectContaining({
            pagePath: '/services/local-seo',
            primaryKeyword: 'local seo',
          }),
        ],
      }),
    });

    expect(countRows('content_gaps', workspace.workspaceId)).toBe(0);
    const activeTracked = getTrackedKeywords(workspace.workspaceId).map(keyword => keyword.query);
    expect(activeTracked).toContain('local seo');
    expect(activeTracked).not.toContain('paper tiger');
    expect(getTrackedKeywords(workspace.workspaceId, { includeInactive: true })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        query: 'paper tiger',
        status: TRACKED_KEYWORD_STATUS.REPLACED,
        replacedBy: 'local seo',
      }),
    ]));
    expect(broadcastState.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        workspaceId: workspace.workspaceId,
        event: WS_EVENTS.RANK_TRACKING_UPDATED,
      }),
      expect.objectContaining({
        workspaceId: workspace.workspaceId,
        event: WS_EVENTS.STRATEGY_UPDATED,
      }),
    ]));
  });

  it('persists all-fresh incremental cleanup when only table-backed keyword gaps are stale', async () => {
    strategyState.mode = 'upToDateKeywordGapOnly';
    const generatedAt = '2026-05-01T00:00:00.000Z';
    updateWorkspace(workspace.workspaceId, {
      keywordStrategy: {
        siteKeywords: ['local seo'],
        opportunities: [],
        generatedAt,
      },
    });
    upsertPageKeyword(workspace.workspaceId, {
      pagePath: '/services/local-seo',
      pageTitle: 'Local SEO Services',
      primaryKeyword: 'local seo',
      secondaryKeywords: [],
      analysisGeneratedAt: generatedAt,
    });
    replaceAllKeywordGaps(workspace.workspaceId, [
      {
        keyword: 'paper tiger',
        volume: 9000,
        difficulty: 10,
        competitorDomain: 'rival.example',
        competitorPosition: 2,
      },
    ]);

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
      result: expect.objectContaining({
        siteKeywords: ['local seo'],
      }),
    });

    expect(listKeywordGaps(workspace.workspaceId)).toEqual([]);
    expect(broadcastState.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        workspaceId: workspace.workspaceId,
        event: WS_EVENTS.STRATEGY_UPDATED,
      }),
    ]));
  });

  it('retires stale page keywords when an analyzed page is absent from the sanitized incremental strategy', async () => {
    strategyState.mode = 'dropsAnalyzedPage';
    const generatedAt = '2026-05-01T00:00:00.000Z';
    updateWorkspace(workspace.workspaceId, {
      keywordStrategy: {
        siteKeywords: ['paper tiger'],
        opportunities: [],
        generatedAt,
      },
    });
    upsertPageKeyword(workspace.workspaceId, {
      pagePath: '/stale-dropped',
      pageTitle: 'Stale Dropped',
      primaryKeyword: 'paper tiger',
      secondaryKeywords: [],
      analysisGeneratedAt: generatedAt,
    });
    addTrackedKeyword(workspace.workspaceId, 'paper tiger', {
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY,
      pagePath: '/stale-dropped',
      strategyGeneratedAt: generatedAt,
      lastStrategySeenAt: generatedAt,
    });

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
      result: expect.objectContaining({
        siteKeywords: ['local seo'],
      }),
    });

    expect(listPageKeywords(workspace.workspaceId).map(page => page.pagePath)).not.toContain('/stale-dropped');
    expect(getTrackedKeywords(workspace.workspaceId).map(keyword => keyword.query)).not.toContain('paper tiger');
    expect(getTrackedKeywords(workspace.workspaceId, { includeInactive: true })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        query: 'paper tiger',
        status: TRACKED_KEYWORD_STATUS.DEPRECATED,
      }),
    ]));
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

  it('accepts the UI default maxPages=500 for keyword strategy jobs', async () => {
    const startRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY,
      params: {
        workspaceId: workspace.workspaceId,
        maxPages: 500,
      },
    });

    expect(startRes.status).toBe(200);
    const started = await startRes.json() as { jobId: string };
    const job = await waitForJob(started.jobId);
    expect(job).toMatchObject({
      workspaceId: workspace.workspaceId,
      type: BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY,
      status: 'done',
    });
    expect(discoverKeywordStrategyPages).toHaveBeenCalledWith(expect.objectContaining({ maxPagesParam: 500 }));
  });

  it('accepts maxPages=0 as the All pages sentinel for keyword strategy jobs', async () => {
    const startRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY,
      params: {
        workspaceId: workspace.workspaceId,
        maxPages: 0,
      },
    });

    expect(startRes.status).toBe(200);
    const started = await startRes.json() as { jobId: string };
    const job = await waitForJob(started.jobId);
    expect(job).toMatchObject({
      workspaceId: workspace.workspaceId,
      type: BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY,
      status: 'done',
    });
    expect(discoverKeywordStrategyPages).toHaveBeenCalledWith(expect.objectContaining({ maxPagesParam: 0 }));
  });

  it('rejects negative maxPages before creating a keyword strategy job', async () => {
    const jobsBefore = listJobs(workspace.workspaceId).length;

    const res = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY,
      params: {
        workspaceId: workspace.workspaceId,
        maxPages: -1,
      },
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'maxPages must be a non-negative integer' });
    expect(listJobs(workspace.workspaceId)).toHaveLength(jobsBefore);
    expect(getWorkspace(workspace.workspaceId)?.keywordStrategy).toBeUndefined();
    expect(countRows('page_keywords', workspace.workspaceId)).toBe(0);
    expect(countRows('content_gaps', workspace.workspaceId)).toBe(0);
    expect(countRows('quick_wins', workspace.workspaceId)).toBe(0);
    expect(countRows('activity_log', workspace.workspaceId)).toBe(0);
    expect(getTrackedKeywords(workspace.workspaceId)).toEqual([]);
    expect(getActionBySource('strategy', workspace.workspaceId)).toBeNull();
    expect(broadcastState.calls).toHaveLength(0);
  });

  it('rejects maxPages above the supported cap before creating a keyword strategy job', async () => {
    const jobsBefore = listJobs(workspace.workspaceId).length;

    const res = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY,
      params: {
        workspaceId: workspace.workspaceId,
        maxPages: 2001,
      },
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'maxPages must be between 0 and 2000' });
    expect(listJobs(workspace.workspaceId)).toHaveLength(jobsBefore);
    expect(getWorkspace(workspace.workspaceId)?.keywordStrategy).toBeUndefined();
    expect(countRows('page_keywords', workspace.workspaceId)).toBe(0);
    expect(countRows('content_gaps', workspace.workspaceId)).toBe(0);
    expect(countRows('quick_wins', workspace.workspaceId)).toBe(0);
    expect(countRows('activity_log', workspace.workspaceId)).toBe(0);
    expect(getTrackedKeywords(workspace.workspaceId)).toEqual([]);
    expect(getActionBySource('strategy', workspace.workspaceId)).toBeNull();
    expect(broadcastState.calls).toHaveLength(0);
  });

  it('rejects non-integer maxPages before creating a keyword strategy job', async () => {
    const jobsBefore = listJobs(workspace.workspaceId).length;

    const res = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY,
      params: {
        workspaceId: workspace.workspaceId,
        maxPages: 3.5,
      },
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'maxPages must be a non-negative integer' });
    expect(listJobs(workspace.workspaceId)).toHaveLength(jobsBefore);
    expect(getWorkspace(workspace.workspaceId)?.keywordStrategy).toBeUndefined();
    expect(countRows('page_keywords', workspace.workspaceId)).toBe(0);
    expect(countRows('content_gaps', workspace.workspaceId)).toBe(0);
    expect(countRows('quick_wins', workspace.workspaceId)).toBe(0);
    expect(countRows('activity_log', workspace.workspaceId)).toBe(0);
    expect(getTrackedKeywords(workspace.workspaceId)).toEqual([]);
    expect(getActionBySource('strategy', workspace.workspaceId)).toBeNull();
    expect(broadcastState.calls).toHaveLength(0);
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
