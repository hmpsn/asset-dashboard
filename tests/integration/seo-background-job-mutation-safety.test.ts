import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: Record<string, unknown> }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: Record<string, unknown>) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/ai.js', async importOriginal => {
  const original = await importOriginal<typeof import('../../server/ai.js')>();
  return {
    ...original,
    callAI: vi.fn(async () => ({
      text: JSON.stringify({
        primaryKeyword: 'seo services',
        primaryKeywordPresence: { inTitle: true, inMeta: true, inContent: true, inSlug: true },
        secondaryKeywords: ['technical seo'],
        longTailKeywords: ['technical seo services'],
        searchIntent: 'commercial',
        searchIntentConfidence: 0.91,
        contentGaps: ['pricing'],
        competitorKeywords: ['seo agency'],
        optimizationScore: 88,
        optimizationIssues: ['Need more proof'],
        recommendations: ['Add a case study'],
        estimatedDifficulty: 'medium',
        keywordDifficulty: 0,
        monthlyVolume: 0,
        topicCluster: 'SEO services',
      }),
    })),
  };
});

vi.mock('../../server/content-posts-ai.js', async importOriginal => {
  const original = await importOriginal<typeof import('../../server/content-posts-ai.js')>();
  return {
    ...original,
    callCreativeAI: vi.fn(async () =>
      JSON.stringify(['First improved title', 'Second improved title', 'Third improved title'])
    ),
  };
});

vi.mock('../../server/url-helpers.js', async importOriginal => {
  const original = await importOriginal<typeof import('../../server/url-helpers.js')>();
  return {
    ...original,
    resolveBaseUrl: vi.fn(async () => ''),
  };
});

vi.mock('../../server/search-console.js', async importOriginal => {
  const original = await importOriginal<typeof import('../../server/search-console.js')>();
  return {
    ...original,
    getQueryPageData: vi.fn(async () => []),
  };
});

vi.mock('../../server/workspace-intelligence.js', async importOriginal => {
  const original = await importOriginal<typeof import('../../server/workspace-intelligence.js')>();
  return {
    ...original,
    buildWorkspaceIntelligence: vi.fn(async (workspaceId: string) => ({
      version: 1,
      workspaceId,
      assembledAt: new Date().toISOString(),
      seoContext: {
        strategy: { siteKeywords: [], businessContext: '', pageMap: [{ pagePath: '/services/seo', primaryKeyword: 'seo services' }] },
        brandVoice: '',
        effectiveBrandVoiceBlock: '',
        knowledgeBase: '',
        businessContext: '',
        personas: [],
        pageKeywords: null,
      },
      learnings: {},
      pageProfile: null,
    })),
    formatForPrompt: vi.fn(() => '\nFULL CONTEXT'),
    formatKeywordsForPrompt: vi.fn(() => '\nKEYWORDS'),
    formatKnowledgeBaseForPrompt: vi.fn(() => '\nKNOWLEDGE'),
    formatPersonasForPrompt: vi.fn(() => '\nPERSONAS'),
    formatPageMapForPrompt: vi.fn(() => '\nPAGE MAP'),
    invalidateIntelligenceCache: vi.fn(),
  };
});

vi.mock('../../server/webflow.js', async importOriginal => {
  const original = await importOriginal<typeof import('../../server/webflow.js')>();
  return {
    ...original,
    updatePageSeo: vi.fn(async () => ({ success: true })),
  };
});

import db from '../../server/db/index.js';
import { clearCompletedJobs, listJobs } from '../../server/jobs.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';

let baseUrl = '';
let server: http.Server | undefined;
let workspaceId = '';
let otherWorkspaceId = '';
const primarySiteId = 'wf-site-seo-job-mutation';
const otherSiteId = 'wf-site-foreign-job-mutation';
const originalAppPassword = process.env.APP_PASSWORD;
const originalOpenAiKey = process.env.OPENAI_API_KEY;

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  process.env.OPENAI_API_KEY = 'test-openai-key';
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
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

function resetWorkspaceState(id: string): void {
  clearCompletedJobs({ workspaceId: id });
  db.prepare('DELETE FROM jobs WHERE workspace_id = ?').run(id);
  db.prepare('DELETE FROM page_keywords WHERE workspace_id = ?').run(id);
  db.prepare('DELETE FROM seo_suggestions WHERE workspace_id = ?').run(id);
  db.prepare('DELETE FROM page_edit_states WHERE workspace_id = ?').run(id);
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(id);
}

function countRows(table: 'page_keywords' | 'seo_suggestions' | 'page_edit_states' | 'activity_log', id: string): number {
  const row = db.prepare(`SELECT COALESCE(COUNT(*), 0) AS count FROM ${table} WHERE workspace_id = ?`).get(id) as { count: number };
  return row.count;
}

function activityTitles(id: string, type: string): string[] {
  return db.prepare(`
    SELECT title
    FROM activity_log
    WHERE workspace_id = ? AND type = ?
    ORDER BY created_at DESC
  `).all(id, type).map((row: { title: string }) => row.title);
}

async function waitForJob(jobId: string, timeoutMs = 8_000): Promise<Record<string, unknown>> {
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
  const workspace = createWorkspace('SEO Job Mutation Safety');
  workspaceId = workspace.id;
  updateWorkspace(workspaceId, { webflowSiteId: primarySiteId, webflowToken: 'wf-token-primary' });

  const otherWorkspace = createWorkspace('SEO Job Mutation Safety Other');
  otherWorkspaceId = otherWorkspace.id;
  updateWorkspace(otherWorkspaceId, { webflowSiteId: otherSiteId, webflowToken: 'wf-token-other' });
}, 30_000);

beforeEach(() => {
  resetWorkspaceState(workspaceId);
  resetWorkspaceState(otherWorkspaceId);
  broadcastState.calls = [];
});

afterAll(async () => {
  resetWorkspaceState(workspaceId);
  resetWorkspaceState(otherWorkspaceId);
  deleteWorkspace(workspaceId);
  deleteWorkspace(otherWorkspaceId);
  await stopTestServer();
  if (originalAppPassword === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = originalAppPassword;
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
});

describe('SEO background-job mutation safety', () => {
  it('bulk analyze writes page keywords, completes the job, broadcasts strategy updates, and surfaces through the strategy read path', async () => {
    const startRes = await postJson(`/api/seo/${workspaceId}/bulk-analyze`, {
      pages: [{
        pageId: 'page-analyze-1',
        title: 'Services',
        publishedPath: '/services/seo',
        seoTitle: 'SEO Services',
        seoDescription: 'Old description',
      }],
    });
    expect(startRes.status).toBe(200);
    const { jobId } = await startRes.json() as { jobId: string };

    const job = await waitForJob(jobId);
    expect(job).toMatchObject({
      workspaceId,
      type: 'seo-bulk-analyze',
      status: 'done',
      result: { analyzed: 1, failed: 0, total: 1 },
    });

    const strategyRes = await api(`/api/webflow/keyword-strategy/${workspaceId}`);
    expect(strategyRes.status).toBe(200);
    const strategy = await strategyRes.json() as { pageMap: Array<{ pagePath: string; primaryKeyword: string; pageTitle: string }> };
    expect(strategy.pageMap).toHaveLength(1);
    expect(strategy.pageMap[0]).toMatchObject({
      pagePath: '/services/seo',
      primaryKeyword: 'seo services',
      pageTitle: 'Services',
    });

    expect(countRows('page_keywords', workspaceId)).toBe(1);
    expect(activityTitles(workspaceId, 'page_analysis')).toContain('Bulk page analysis: 1/1 pages analyzed');
    expect(broadcastState.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ workspaceId, event: WS_EVENTS.STRATEGY_UPDATED }),
      expect.objectContaining({ workspaceId, event: WS_EVENTS.BULK_OPERATION_COMPLETE }),
    ]));
  });

  it('rejects invalid bulk analyze input before jobs, writes, activity, or broadcasts', async () => {
    const jobsBefore = listJobs(workspaceId).length;
    const res = await postJson(`/api/seo/${workspaceId}/bulk-analyze`, { pages: [] });
    expect(res.status).toBe(400);

    expect(listJobs(workspaceId)).toHaveLength(jobsBefore);
    expect(countRows('page_keywords', workspaceId)).toBe(0);
    expect(countRows('activity_log', workspaceId)).toBe(0);
    expect(broadcastState.calls).toHaveLength(0);
  });

  it('bulk rewrite writes SEO suggestions, completes the job, and surfaces through the suggestions read path', async () => {
    const startRes = await postJson(`/api/seo/${workspaceId}/bulk-rewrite`, {
      siteId: primarySiteId,
      field: 'title',
      pages: [{
        pageId: 'page-rewrite-1',
        title: 'Services',
        publishedPath: '/services/seo',
        currentSeoTitle: 'Old title',
      }],
    });
    expect(startRes.status).toBe(200);
    const { jobId } = await startRes.json() as { jobId: string };

    const job = await waitForJob(jobId);
    expect(job).toMatchObject({
      workspaceId,
      type: 'seo-bulk-rewrite',
      status: 'done',
      result: { suggestions: 1, generatedPages: 1, failed: 0, total: 1, field: 'title' },
    });

    const suggestionsRes = await api(`/api/webflow/seo-suggestions/${workspaceId}`);
    expect(suggestionsRes.status).toBe(200);
    const suggestionsBody = await suggestionsRes.json() as {
      counts: { pending: number; selected: number; total: number };
      suggestions: Array<{ pageId: string; pageSlug: string; field: string; variations: string[] }>;
    };
    expect(suggestionsBody.counts).toMatchObject({ pending: 1, selected: 0, total: 1 });
    expect(suggestionsBody.suggestions).toHaveLength(1);
    expect(suggestionsBody.suggestions[0]).toMatchObject({
      pageId: 'page-rewrite-1',
      pageSlug: '/services/seo',
      field: 'title',
      variations: ['First improved title', 'Second improved title', 'Third improved title'],
    });

    expect(activityTitles(workspaceId, 'seo_updated')).toContain('Bulk SEO rewrite: 1 title variations for 1/1 pages');
    expect(broadcastState.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ workspaceId, event: WS_EVENTS.BULK_OPERATION_COMPLETE }),
    ]));
  });

  it('rejects cross-workspace bulk rewrite siteIds without creating jobs, suggestions, activity, or broadcasts', async () => {
    const jobsBefore = listJobs(workspaceId).length;
    const res = await postJson(`/api/seo/${workspaceId}/bulk-rewrite`, {
      siteId: otherSiteId,
      field: 'title',
      pages: [{ pageId: 'page-rewrite-x', title: 'Services', publishedPath: '/services/seo' }],
    });
    expect(res.status).toBe(400);

    expect(listJobs(workspaceId)).toHaveLength(jobsBefore);
    expect(countRows('seo_suggestions', workspaceId)).toBe(0);
    expect(countRows('activity_log', workspaceId)).toBe(0);
    expect(broadcastState.calls).toHaveLength(0);
  });

  it('bulk accept fixes writes page state, completes the job, and surfaces through the page-state read path', async () => {
    const startRes = await postJson(`/api/seo/${workspaceId}/bulk-accept-fixes`, {
      siteId: primarySiteId,
      fixes: [{
        pageId: 'page-accept-1',
        check: 'meta-description',
        suggestedFix: 'A better meta description',
        pageSlug: 'services',
        publishedPath: '/services/seo',
        pageName: 'Services',
      }],
    });
    expect(startRes.status).toBe(200);
    const { jobId } = await startRes.json() as { jobId: string };

    const job = await waitForJob(jobId);
    expect(job).toMatchObject({
      workspaceId,
      type: 'seo-bulk-accept-fixes',
      status: 'done',
      result: { applied: 1, failed: 0, total: 1 },
    });

    const stateRes = await api(`/api/workspaces/${workspaceId}/page-states/page-accept-1`);
    expect(stateRes.status).toBe(200);
    const pageState = await stateRes.json() as { status: string; source: string; fields?: string[] };
    expect(pageState).toMatchObject({
      status: 'live',
      source: 'audit',
      fields: ['description'],
    });

    expect(countRows('page_edit_states', workspaceId)).toBe(1);
    expect(activityTitles(workspaceId, 'seo_updated')).toContain('Bulk audit fix: 1 fix applied');
    expect(broadcastState.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ workspaceId, event: WS_EVENTS.PAGE_STATE_UPDATED }),
      expect.objectContaining({ workspaceId, event: WS_EVENTS.BULK_OPERATION_COMPLETE }),
    ]));
  });
});
