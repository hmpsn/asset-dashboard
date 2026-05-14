import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: Record<string, unknown> }>,
}));

const aiState = vi.hoisted(() => ({
  mode: 'success' as 'success' | 'error',
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: Record<string, unknown>) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/workspace-site-scrape.js', () => ({
  scrapeWorkspaceSite: vi.fn(async () => ({
    scraped: [
      { title: 'Home', url: 'https://example.test/', text: 'Homepage copy' },
      { title: 'Services', url: 'https://example.test/services', text: 'Services copy' },
    ],
    pagesSummary: 'Home and Services page summaries',
  })),
}));

vi.mock('../../server/ai.js', () => ({
  callAI: vi.fn(async (opts: { feature?: string }) => {
    if (aiState.mode === 'error') {
      throw new Error('Workspace context AI failed');
    }
    if (opts.feature === 'brand-voice-gen') {
      return { text: 'Confident, practical, and direct tone.' };
    }
    if (opts.feature === 'knowledge-base-gen') {
      return { text: 'BUSINESS OVERVIEW: Example Agency' };
    }
    if (opts.feature === 'personas-gen') {
      return {
        text: JSON.stringify([
          {
            name: 'Marketing Director',
            description: 'Leads growth for a regional services brand.',
            painPoints: ['Low lead volume'],
            goals: ['Increase qualified traffic'],
            objections: ['Worried about timeline'],
            preferredContentFormat: 'Case studies',
            buyingStage: 'consideration',
          },
        ]),
      };
    }
    return { text: 'fallback' };
  }),
}));

import db from '../../server/db/index.js';
import { clearCompletedJobs, createJob, updateJob } from '../../server/jobs.js';
import { seedTwoWorkspaces, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import { WS_EVENTS } from '../../server/ws-events.js';

let baseUrl = '';
let server: http.Server | undefined;
let workspaceA: SeededFullWorkspace;
let workspaceB: SeededFullWorkspace;
const originalAppPassword = process.env.APP_PASSWORD;

function countRows(table: 'jobs' | 'tracked_actions' | 'usage_tracking', workspaceId: string): number {
  const row = db.prepare(`SELECT COALESCE(COUNT(*), 0) AS count FROM ${table} WHERE workspace_id = ?`).get(workspaceId) as { count: number };
  return row.count;
}

function countBrandVoiceActions(workspaceId: string): number {
  const row = db.prepare(`
    SELECT COALESCE(COUNT(*), 0) AS count
    FROM tracked_actions
    WHERE workspace_id = ? AND source_type = 'brand_voice' AND source_id = ? AND action_type = 'voice_calibrated'
  `).get(workspaceId, workspaceId) as { count: number };
  return row.count;
}

function resetWorkspaceState(workspaceId: string): void {
  clearCompletedJobs({ workspaceId });
  db.prepare('DELETE FROM jobs WHERE workspace_id = ?').run(workspaceId);
  db.prepare(`
    DELETE FROM action_outcomes
    WHERE action_id IN (
      SELECT id FROM tracked_actions WHERE workspace_id = ?
    )
  `).run(workspaceId);
  db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM usage_tracking WHERE workspace_id = ?').run(workspaceId);
}

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
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
}, 30_000);

beforeEach(() => {
  const seeded = seedTwoWorkspaces();
  workspaceA = seeded.wsA;
  workspaceB = seeded.wsB;
  updateWorkspace(workspaceA.workspaceId, { tier: 'growth' });
  updateWorkspace(workspaceB.workspaceId, { tier: 'growth' });
  broadcastState.calls = [];
  aiState.mode = 'success';
});

afterEach(() => {
  resetWorkspaceState(workspaceA.workspaceId);
  resetWorkspaceState(workspaceB.workspaceId);
  deleteWorkspace(workspaceA.workspaceId);
  deleteWorkspace(workspaceB.workspaceId);
});

afterAll(async () => {
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
});

describe('workspace-context background job mutation safety', () => {
  it('runs brand-voice generation through legacy route, writes one tracked action, and emits outcome broadcast once', async () => {
    const startRes = await postJson(`/api/workspaces/${workspaceA.workspaceId}/generate-brand-voice`, {});
    expect(startRes.status).toBe(200);
    const started = await startRes.json() as { jobId: string };

    const job = await waitForJob(started.jobId);
    expect(job).toMatchObject({
      workspaceId: workspaceA.workspaceId,
      type: BACKGROUND_JOB_TYPES.BRAND_VOICE_GENERATION,
      status: 'done',
      message: 'Brand voice draft ready for review',
    });
    expect(job.result).toMatchObject({
      kind: 'brandVoice',
      pagesScraped: 2,
      brandVoice: 'Confident, practical, and direct tone.',
    });

    expect(countBrandVoiceActions(workspaceA.workspaceId)).toBe(1);
    expect(countRows('tracked_actions', workspaceB.workspaceId)).toBe(0);
    expect(broadcastState.calls).toContainEqual(expect.objectContaining({
      workspaceId: workspaceA.workspaceId,
      event: WS_EVENTS.OUTCOME_ACTION_RECORDED,
      payload: expect.objectContaining({ actionId: expect.any(String) }),
    }));

    broadcastState.calls = [];
    const secondStartRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.BRAND_VOICE_GENERATION,
      params: { workspaceId: workspaceA.workspaceId },
    });
    expect(secondStartRes.status).toBe(200);
    const secondStart = await secondStartRes.json() as { jobId: string };
    const secondJob = await waitForJob(secondStart.jobId);
    expect(secondJob.status).toBe('done');

    expect(countBrandVoiceActions(workspaceA.workspaceId)).toBe(1);
    expect(broadcastState.calls.some(call => call.event === WS_EVENTS.OUTCOME_ACTION_RECORDED)).toBe(false);
  });

  it('runs knowledge-base and persona jobs with stable readable results and no brand-voice side effects', async () => {
    const kbStartRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.KNOWLEDGE_BASE_GENERATION,
      params: { workspaceId: workspaceA.workspaceId },
    });
    expect(kbStartRes.status).toBe(200);
    const kbStart = await kbStartRes.json() as { jobId: string };
    const kbJob = await waitForJob(kbStart.jobId);
    expect(kbJob).toMatchObject({
      workspaceId: workspaceA.workspaceId,
      type: BACKGROUND_JOB_TYPES.KNOWLEDGE_BASE_GENERATION,
      status: 'done',
      message: 'Knowledge base draft ready for review',
      result: {
        kind: 'knowledgeBase',
        pagesScraped: 2,
        knowledgeBase: 'BUSINESS OVERVIEW: Example Agency',
      },
    });

    const personaStartRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.PERSONA_GENERATION,
      params: { workspaceId: workspaceA.workspaceId },
    });
    expect(personaStartRes.status).toBe(200);
    const personaStart = await personaStartRes.json() as { jobId: string };
    const personaJob = await waitForJob(personaStart.jobId);
    expect(personaJob).toMatchObject({
      workspaceId: workspaceA.workspaceId,
      type: BACKGROUND_JOB_TYPES.PERSONA_GENERATION,
      status: 'done',
      message: 'Audience personas draft ready for review',
      result: {
        kind: 'personas',
        pagesScraped: 2,
      },
    });
    expect(personaJob.result).toEqual(expect.objectContaining({
      personas: [
        expect.objectContaining({
          name: 'Marketing Director',
          buyingStage: 'consideration',
        }),
      ],
    }));

    expect(countBrandVoiceActions(workspaceA.workspaceId)).toBe(0);
    expect(broadcastState.calls.some(call => call.event === WS_EVENTS.OUTCOME_ACTION_RECORDED)).toBe(false);
  });

  it('marks failures as error and rejects duplicate starts without mutation side effects', async () => {
    aiState.mode = 'error';

    const failStartRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.BRAND_VOICE_GENERATION,
      params: { workspaceId: workspaceA.workspaceId },
    });
    expect(failStartRes.status).toBe(200);
    const failStart = await failStartRes.json() as { jobId: string };
    const failedJob = await waitForJob(failStart.jobId);
    expect(failedJob).toMatchObject({
      workspaceId: workspaceA.workspaceId,
      type: BACKGROUND_JOB_TYPES.BRAND_VOICE_GENERATION,
      status: 'error',
      message: 'Brand voice generation failed',
    });
    expect(String(failedJob.error)).toContain('Workspace context AI failed');
    expect(countBrandVoiceActions(workspaceA.workspaceId)).toBe(0);
    expect(broadcastState.calls.some(call => call.event === WS_EVENTS.OUTCOME_ACTION_RECORDED)).toBe(false);

    const active = createJob(BACKGROUND_JOB_TYPES.KNOWLEDGE_BASE_GENERATION, {
      workspaceId: workspaceA.workspaceId,
      message: 'already running',
    });
    const duplicateRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.KNOWLEDGE_BASE_GENERATION,
      params: { workspaceId: workspaceA.workspaceId },
    });
    expect(duplicateRes.status).toBe(409);
    await expect(duplicateRes.json()).resolves.toMatchObject({
      error: 'knowledge base generation is already running for this workspace',
      jobId: active.id,
    });

    updateJob(active.id, { status: 'done' });
    expect(countRows('jobs', workspaceB.workspaceId)).toBe(0);
    expect(countRows('tracked_actions', workspaceB.workspaceId)).toBe(0);
  });
});
