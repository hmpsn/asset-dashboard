import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import {
  setupOpenAIMocks,
  mockOpenAIJsonResponse,
  mockOpenAIError,
  resetOpenAIMocks,
} from '../mocks/openai.js';

setupOpenAIMocks();

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

vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: vi.fn(async (workspaceId: string) => ({
    version: 1,
    workspaceId,
    assembledAt: new Date().toISOString(),
    seoContext: {
      strategy: { siteKeywords: [], businessContext: '', pageMap: [] },
      brandVoice: '',
      effectiveBrandVoiceBlock: '',
      knowledgeBase: '',
      businessContext: '',
      personas: null,
      pageKeywords: null,
    },
    pageProfile: null,
  })),
  formatKeywordsForPrompt: vi.fn(() => ''),
  formatPersonasForPrompt: vi.fn(() => ''),
  formatPageMapForPrompt: vi.fn(() => ''),
  formatKnowledgeBaseForPrompt: vi.fn(() => ''),
  invalidateIntelligenceCache: vi.fn(),
}));

vi.mock('../../server/web-scraper.js', () => ({
  buildReferenceContext: vi.fn(() => ''),
  buildSerpContext: vi.fn(() => ''),
  buildStyleExampleContext: vi.fn(() => ''),
}));

vi.mock('../../server/analytics-insights-store.js', () => ({
  getInsights: vi.fn(() => []),
}));

import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { getClientAction } from '../../server/client-actions.js';
import { clearCompletedJobs, listJobs, type Job } from '../../server/jobs.js';
import db from '../../server/db/index.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import type { ClientAction } from '../../shared/types/client-actions.js';

interface BriefRow {
  id: string;
  target_keyword: string;
}

let baseUrl = '';
let server: http.Server | undefined;
let wsId = '';
const originalAppPassword = process.env.APP_PASSWORD;
const originalOpenAiKey = process.env.OPENAI_API_KEY;

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
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
    server!.close(err => err ? reject(err) : resolve());
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

async function patchJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function mockBriefResponse() {
  return {
    executiveSummary: 'Refresh this page around the approved target keyword.',
    suggestedTitle: 'Local SEO Content Refresh Guide',
    suggestedMetaDesc: 'A focused content refresh brief for local SEO.',
    secondaryKeywords: ['local seo content', 'seo refresh'],
    contentFormat: 'guide',
    toneAndStyle: 'clear and practical',
    outline: [{ heading: 'Answer the core search intent', notes: 'Lead with the answer.', wordCount: 300 }],
    wordCountTarget: 1200,
    intent: 'informational',
    audience: 'Business owners',
    internalLinkSuggestions: ['/services/seo'],
  };
}

function playbookJobsExcluding(ids: Set<string>): Job[] {
  return listJobs(wsId).filter(job =>
    job.type === BACKGROUND_JOB_TYPES.ACTION_PLAYBOOK_EXECUTE && !ids.has(job.id)
  );
}

function contentBriefRows(): BriefRow[] {
  return db.prepare(`
    SELECT id, target_keyword
    FROM content_briefs
    WHERE workspace_id = ?
    ORDER BY created_at DESC
  `).all(wsId) as BriefRow[];
}

function countActivitiesForAction(actionId: string, type: string): number {
  const row = db.prepare(`
    SELECT COALESCE(COUNT(*), 0) AS count
    FROM activity_log
    WHERE workspace_id = ?
      AND type = ?
      AND metadata LIKE ?
  `).get(wsId, type, `%"actionId":"${actionId}"%`) as { count: number };
  return row.count;
}

async function waitFor<T>(label: string, probe: () => T | undefined | false | null): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < 6_000) {
    const value = probe();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function createContentDecayAction(sourceId: string, targetKeyword: string): Promise<ClientAction> {
  const createRes = await postJson(`/api/client-actions/${wsId}`, {
    sourceType: 'content_decay',
    sourceId,
    title: `Refresh: ${targetKeyword}`,
    summary: 'Traffic has declined and needs a content refresh.',
    payload: { pageUrl: '/blog/old-post', targetKeyword },
  });
  expect(createRes.status).toBe(200);
  return await createRes.json() as ClientAction;
}

beforeAll(async () => {
  process.env.OPENAI_API_KEY = 'test-openai-key';
  await startTestServer();
  const ws = createWorkspace('Background Job Mutation Safety');
  wsId = ws.id;
}, 30_000);

beforeEach(() => {
  resetOpenAIMocks();
  mockOpenAIJsonResponse('content-brief', mockBriefResponse());
  broadcastState.calls = [];
});

afterAll(async () => {
  clearCompletedJobs({ workspaceId: wsId });
  db.prepare('DELETE FROM jobs WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM content_briefs WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM client_actions WHERE workspace_id = ?').run(wsId);
  deleteWorkspace(wsId);
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
  if (originalOpenAiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalOpenAiKey;
  }
});

describe('background job mutation safety for action playbooks', () => {
  it('completes the content_decay playbook through the real brief write path', async () => {
    const beforeJobIds = new Set(listJobs(wsId).map(job => job.id));
    const beforeBriefCount = contentBriefRows().length;
    const action = await createContentDecayAction('mutation-safety:playbook-success', 'local seo guide');

    broadcastState.calls = [];
    const approveRes = await patchJson(`/api/public/client-actions/${wsId}/${action.id}/respond`, {
      status: 'approved',
      clientNote: 'Please create the refresh brief.',
    });
    expect(approveRes.status).toBe(200);
    expect((await approveRes.json() as ClientAction).status).toBe('approved');

    const doneJob = await waitFor('action playbook job to finish', () =>
      playbookJobsExcluding(beforeJobIds).find(job => job.status === 'done')
    );
    expect(doneJob).toMatchObject({
      type: BACKGROUND_JOB_TYPES.ACTION_PLAYBOOK_EXECUTE,
      status: 'done',
      progress: 100,
      workspaceId: wsId,
      message: 'Content brief created',
    });

    await waitFor('client action completion', () =>
      getClientAction(wsId, action.id)?.status === 'completed' ? true : undefined
    );

    const briefs = contentBriefRows();
    expect(briefs).toHaveLength(beforeBriefCount + 1);
    expect(briefs[0]?.target_keyword).toBe('local seo guide');

    expect(getClientAction(wsId, action.id)).toMatchObject({ status: 'completed' });
    expect(countActivitiesForAction(action.id, 'client_action_approved')).toBe(1);
    expect(countActivitiesForAction(action.id, 'client_action_completed')).toBe(1);

    const adminActionsRes = await api(`/api/client-actions/${wsId}`);
    expect(adminActionsRes.status).toBe(200);
    const adminActions = await adminActionsRes.json() as ClientAction[];
    expect(adminActions.find(stored => stored.id === action.id)?.status).toBe('completed');

    const publicActionsRes = await api(`/api/public/client-actions/${wsId}`);
    expect(publicActionsRes.status).toBe(200);
    const publicActions = await publicActionsRes.json() as ClientAction[];
    expect(publicActions.find(stored => stored.id === action.id)?.status).toBe('completed');

    const briefsRes = await api(`/api/content-briefs/${wsId}`);
    expect(briefsRes.status).toBe(200);
    const readPathBriefs = await briefsRes.json() as Array<{ id: string; targetKeyword: string }>;
    expect(readPathBriefs.some(brief => brief.id === briefs[0]?.id && brief.targetKeyword === 'local seo guide')).toBe(true);

    expect(broadcastState.calls).toEqual(expect.arrayContaining([
      { workspaceId: wsId, event: WS_EVENTS.CLIENT_ACTION_UPDATE, payload: { actionId: action.id, action: 'responded' } },
      { workspaceId: wsId, event: WS_EVENTS.CONTENT_UPDATED, payload: { domain: 'content-briefs', workspaceId: wsId } },
      { workspaceId: wsId, event: WS_EVENTS.CLIENT_ACTION_UPDATE, payload: { actionId: action.id, action: 'completed' } },
    ]));
  });

  it('marks failed playbook jobs as error without phantom content or completion side effects', async () => {
    mockOpenAIError('content-brief', 'simulated brief generation failure');
    const beforeJobIds = new Set(listJobs(wsId).map(job => job.id));
    const beforeBriefCount = contentBriefRows().length;
    const action = await createContentDecayAction('mutation-safety:playbook-failure', 'failed seo refresh');

    broadcastState.calls = [];
    const approveRes = await patchJson(`/api/public/client-actions/${wsId}/${action.id}/respond`, {
      status: 'approved',
      clientNote: 'Approved, but brief generation will fail.',
    });
    expect(approveRes.status).toBe(200);

    const failedJob = await waitFor('action playbook job to fail', () =>
      playbookJobsExcluding(beforeJobIds).find(job => job.status === 'error')
    );
    expect(failedJob).toMatchObject({
      type: BACKGROUND_JOB_TYPES.ACTION_PLAYBOOK_EXECUTE,
      status: 'error',
      workspaceId: wsId,
      message: 'Brief generation failed',
    });
    expect(failedJob.error).toContain('simulated brief generation failure');

    expect(contentBriefRows()).toHaveLength(beforeBriefCount);
    expect(getClientAction(wsId, action.id)).toMatchObject({
      status: 'approved',
      clientNote: 'Approved, but brief generation will fail.',
    });
    expect(countActivitiesForAction(action.id, 'client_action_approved')).toBe(1);
    expect(countActivitiesForAction(action.id, 'client_action_completed')).toBe(0);

    expect(broadcastState.calls).toEqual([
      { workspaceId: wsId, event: WS_EVENTS.CLIENT_ACTION_UPDATE, payload: { actionId: action.id, action: 'responded' } },
    ]);
  });
});
