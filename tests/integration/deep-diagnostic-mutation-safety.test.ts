import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import db from '../../server/db/index.js';

const nativeFetch = globalThis.fetch;

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

vi.mock('../../server/ai.js', () => ({
  callAI: vi.fn(async () => {
    if (aiState.mode === 'error') throw new Error('Deep diagnostic synthesis failed');
    return {
      text: JSON.stringify({
        rootCauses: [
          {
            rank: 1,
            title: 'Canonical mismatch on affected page',
            confidence: 'high',
            explanation: 'The canonical target diverges from the intended ranking URL.',
            evidence: ['Canonical probe mismatch', 'Traffic drop aligns with canonical drift'],
          },
        ],
        remediationActions: [
          {
            priority: 'P0',
            title: 'Fix canonical target',
            description: 'Point canonical to the intended URL and republish.',
            effort: 'low',
            impact: 'high',
            owner: 'seo',
            pageUrls: ['/services/seo-audit'],
          },
        ],
        adminReport: '## Executive Summary\n\nCanonical mismatch detected.',
        clientSummary: 'We identified a technical indexing issue and have already started a fix.',
      }),
    };
  }),
}));

vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: vi.fn(async () => ({
    seoContext: { rankTracking: { avgPosition: 12 } },
    operational: { recentActivity: [] },
  })),
}));

import { clearCompletedJobs, createJob, listJobs, updateJob } from '../../server/jobs.js';
import { setFlagOverride } from '../../server/feature-flags.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { upsertAnomalyDigestInsight, getInsightById } from '../../server/analytics-insights-store.js';
import { getReportForInsight } from '../../server/diagnostic-store.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';

let baseUrl = '';
let server: http.Server | undefined;
let workspaceAId = '';
let workspaceBId = '';
let anomalyInsightId = '';

const originalAppPassword = process.env.APP_PASSWORD;

function countRows(
  table: 'jobs' | 'diagnostic_reports' | 'activity_log' | 'analytics_insights',
  workspaceId: string,
): number {
  const row = db.prepare(`SELECT COALESCE(COUNT(*), 0) AS count FROM ${table} WHERE workspace_id = ?`).get(workspaceId) as { count: number };
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

function resetWorkspaceState(workspaceId: string): void {
  clearCompletedJobs({ workspaceId });
  db.prepare('DELETE FROM jobs WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM diagnostic_reports WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM analytics_insights WHERE workspace_id = ?').run(workspaceId);
}

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
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
  workspaceAId = createWorkspace('Deep Diagnostic Mutation Safety A').id;
  workspaceBId = createWorkspace('Deep Diagnostic Mutation Safety B').id;
  setFlagOverride('deep-diagnostics', true);
  aiState.mode = 'success';
  broadcastState.calls = [];

  anomalyInsightId = upsertAnomalyDigestInsight({
    workspaceId: workspaceAId,
    anomalyType: 'traffic_drop',
    metric: 'clicks',
    data: {
      anomalyType: 'traffic_drop',
      metric: 'clicks',
      severity: 'critical',
      currentValue: 120,
      expectedValue: 420,
      deviationPercent: -71.4,
      firstDetected: new Date().toISOString(),
      durationDays: 5,
      affectedPage: '/services/seo-audit',
    },
    severity: 'critical',
    domain: 'seo',
    impactScore: 88,
  }).id;
});

afterEach(() => {
  setFlagOverride('deep-diagnostics', null);
  resetWorkspaceState(workspaceAId);
  resetWorkspaceState(workspaceBId);
  deleteWorkspace(workspaceAId);
  deleteWorkspace(workspaceBId);
});

afterAll(async () => {
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
});

describe('deep diagnostic mutation safety', () => {
  it('writes diagnostic completion state, logs activity, stamps insight, and broadcasts once on success', async () => {
    const startRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.DEEP_DIAGNOSTIC,
      params: { workspaceId: workspaceAId, insightId: anomalyInsightId },
    });
    expect(startRes.status).toBe(200);
    const started = await startRes.json() as { jobId: string; reportId: string };
    expect(typeof started.jobId).toBe('string');
    expect(typeof started.reportId).toBe('string');

    const job = await waitForJob(started.jobId);
    expect(job).toMatchObject({
      workspaceId: workspaceAId,
      type: BACKGROUND_JOB_TYPES.DEEP_DIAGNOSTIC,
      status: 'done',
      message: 'Diagnostic complete',
      result: { reportId: started.reportId },
    });

    const report = getReportForInsight(workspaceAId, anomalyInsightId);
    expect(report).toMatchObject({
      id: started.reportId,
      workspaceId: workspaceAId,
      status: 'completed',
    });
    expect(report?.rootCauses.length).toBeGreaterThan(0);
    expect(report?.remediationActions.length).toBeGreaterThan(0);
    expect(countActivities(workspaceAId, 'diagnostic_completed')).toBe(1);
    expect(countActivities(workspaceBId, 'diagnostic_completed')).toBe(0);

    expect(broadcastState.calls).toContainEqual(expect.objectContaining({
      workspaceId: workspaceAId,
      event: WS_EVENTS.DIAGNOSTIC_COMPLETE,
      payload: expect.objectContaining({
        reportId: started.reportId,
        insightId: anomalyInsightId,
      }),
    }));
    expect(broadcastState.calls.length).toBeGreaterThan(0);
    expect(broadcastState.calls.every(call => call.workspaceId === workspaceAId)).toBe(true); // every-ok: guarded by length assertion above

    const insight = getInsightById(anomalyInsightId, workspaceAId);
    expect(insight).toBeDefined();
    expect(insight?.data).toEqual(expect.objectContaining({
      diagnosticReportId: started.reportId,
    }));

    const byInsightRes = await api(`/api/workspaces/${workspaceAId}/diagnostics/by-insight/${anomalyInsightId}`);
    expect(byInsightRes.status).toBe(200);
    await expect(byInsightRes.json()).resolves.toMatchObject({
      report: expect.objectContaining({ id: started.reportId, status: 'completed' }),
    });
  });

  it('marks failures without completion activity and broadcasts only DIAGNOSTIC_FAILED', async () => {
    aiState.mode = 'error';

    const startRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.DEEP_DIAGNOSTIC,
      params: { workspaceId: workspaceAId, insightId: anomalyInsightId },
    });
    expect(startRes.status).toBe(200);
    const started = await startRes.json() as { jobId: string; reportId: string };

    const job = await waitForJob(started.jobId);
    expect(job).toMatchObject({
      workspaceId: workspaceAId,
      type: BACKGROUND_JOB_TYPES.DEEP_DIAGNOSTIC,
      status: 'error',
    });
    expect(String(job.message)).toContain('Diagnostic failed');

    const report = getReportForInsight(workspaceAId, anomalyInsightId);
    expect(report?.id).toBe(started.reportId);
    expect(report?.status).toBe('failed');
    expect(report?.errorMessage).toContain('Deep diagnostic synthesis failed');

    expect(countActivities(workspaceAId, 'diagnostic_completed')).toBe(0);
    expect(broadcastState.calls.some(call => call.event === WS_EVENTS.DIAGNOSTIC_COMPLETE)).toBe(false);
    expect(broadcastState.calls).toContainEqual(expect.objectContaining({
      workspaceId: workspaceAId,
      event: WS_EVENTS.DIAGNOSTIC_FAILED,
      payload: expect.objectContaining({
        reportId: started.reportId,
        insightId: anomalyInsightId,
      }),
    }));

    const insight = getInsightById(anomalyInsightId, workspaceAId);
    expect(insight?.data).not.toEqual(expect.objectContaining({
      diagnosticReportId: started.reportId,
    }));
  });

  it('rejects cross-workspace and duplicate starts without additional mutation side effects', async () => {
    const jobsBefore = listJobs(workspaceAId).length;
    const reportsBefore = countRows('diagnostic_reports', workspaceAId);

    const active = createJob(BACKGROUND_JOB_TYPES.DEEP_DIAGNOSTIC, {
      workspaceId: workspaceAId,
      message: 'already running',
    });

    const duplicateRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.DEEP_DIAGNOSTIC,
      params: { workspaceId: workspaceAId, insightId: anomalyInsightId },
    });
    expect(duplicateRes.status).toBe(409);
    await expect(duplicateRes.json()).resolves.toMatchObject({
      error: 'A diagnostic is already running for this workspace',
      jobId: active.id,
    });

    updateJob(active.id, { status: 'done' });
    expect(listJobs(workspaceAId).length).toBe(jobsBefore + 1);
    expect(countRows('diagnostic_reports', workspaceAId)).toBe(reportsBefore);
    expect(countActivities(workspaceAId, 'diagnostic_completed')).toBe(0);
    expect(broadcastState.calls).toHaveLength(0);

    const crossRes = await postJson('/api/jobs', {
      type: BACKGROUND_JOB_TYPES.DEEP_DIAGNOSTIC,
      params: { workspaceId: workspaceBId, insightId: anomalyInsightId },
    });
    expect(crossRes.status).toBe(404);
    await expect(crossRes.json()).resolves.toEqual({ error: 'Anomaly insight not found' });
    expect(countRows('diagnostic_reports', workspaceBId)).toBe(0);
    expect(countRows('activity_log', workspaceBId)).toBe(0);
    expect(countRows('analytics_insights', workspaceBId)).toBe(0);
  });
});
