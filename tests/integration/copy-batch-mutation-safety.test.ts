import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: Record<string, unknown> }>,
  throwOnceOnEvent: null as string | null,
}));

const generationState = vi.hoisted(() => ({
  failEntryIds: new Set<string>(),
  calls: [] as Array<{ workspaceId: string; blueprintId: string; entryId: string }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: Record<string, unknown>) => {
    if (broadcastState.throwOnceOnEvent === event) {
      broadcastState.throwOnceOnEvent = null;
      throw new Error(`injected ${event} failure`);
    }
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/copy-generation.js', () => ({
  generateCopyForEntry: vi.fn(async (workspaceId: string, blueprintId: string, entryId: string) => {
    generationState.calls.push({ workspaceId, blueprintId, entryId });
    if (generationState.failEntryIds.has(entryId)) {
      throw new Error(`forced failure for ${entryId}`);
    }
    return { sections: [], metadata: null };
  }),
  regenerateSection: vi.fn(),
}));

import db from '../../server/db/index.js';
import {
  createCopyBatchGenerationJob,
  getCopyBatchJob,
  runCopyBatchGenerationJob,
} from '../../server/copy-batch-jobs.js';
import { runCopyEntryGenerationJob } from '../../server/copy-entry-generation-job.js';
import {
  createResourceScopedJob,
  getJobResourceClaims,
  updateJob,
} from '../../server/jobs.js';
import { addEntry, createBlueprint } from '../../server/page-strategy.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import {
  BACKGROUND_JOB_TYPES,
  JOB_RESOURCE_TYPES,
} from '../../shared/types/background-jobs.js';

interface BatchJobView {
  id: string;
  status: 'running' | 'complete' | 'failed';
  progress: { total: number; generated: number; reviewed: number; approved: number };
}

let baseUrl = '';
let server: http.Server | undefined;
let wsAId = '';
let wsBId = '';
const originalAppPassword = process.env.APP_PASSWORD;

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
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
  return fetch(`${baseUrl}${path}`, opts);
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function waitForBatchTerminalState(
  workspaceId: string,
  batchId: string,
  timeoutMs = 5_000,
): Promise<BatchJobView> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await api(`/api/copy/${workspaceId}/batch/${batchId}`);
    expect(res.status).toBe(200);
    const job = await res.json() as BatchJobView;
    if (job.status !== 'running') return job;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for batch ${batchId} terminal status`);
}

function countActivities(workspaceId: string, type: string): number {
  const row = db.prepare(`
    SELECT COALESCE(COUNT(*), 0) AS count
    FROM activity_log
    WHERE workspace_id = ?
      AND type = ?
  `).get(workspaceId, type) as { count: number };
  return row.count;
}

function countJobs(workspaceId: string): number {
  const row = db.prepare(`
    SELECT COALESCE(COUNT(*), 0) AS count
    FROM copy_batch_jobs
    WHERE workspace_id = ?
  `).get(workspaceId) as { count: number };
  return row.count;
}

function batchEvents(workspaceId: string) {
  return broadcastState.calls.filter(call =>
    call.workspaceId === workspaceId
    && (call.event === WS_EVENTS.COPY_BATCH_PROGRESS || call.event === WS_EVENTS.COPY_BATCH_COMPLETE),
  );
}

function failTerminalJobWrites(jobId: string): () => void {
  const triggerName = 'test_fail_copy_worker_terminal_job_writes';
  const escapedJobId = jobId.replaceAll("'", "''");
  db.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
  db.exec(`
    CREATE TEMP TRIGGER ${triggerName}
    BEFORE UPDATE OF status ON jobs
    WHEN NEW.id = '${escapedJobId}' AND NEW.status IN ('done', 'error')
    BEGIN
      SELECT RAISE(ABORT, 'injected terminal write failure');
    END
  `);
  return () => db.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
}

function failDoneJobWrite(jobId: string): () => void {
  const triggerName = 'test_fail_copy_batch_done_job_write';
  const escapedJobId = jobId.replaceAll("'", "''");
  db.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
  db.exec(`
    CREATE TEMP TRIGGER ${triggerName}
    BEFORE UPDATE OF status ON jobs
    WHEN NEW.id = '${escapedJobId}' AND NEW.status = 'done'
    BEGIN
      SELECT RAISE(ABORT, 'injected done write failure');
    END
  `);
  return () => db.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
}

beforeAll(async () => {
  await startTestServer();
  wsAId = createWorkspace('Copy Batch Mutation Safety A').id;
  wsBId = createWorkspace('Copy Batch Mutation Safety B').id;
}, 25_000);

beforeEach(() => {
  broadcastState.calls = [];
  broadcastState.throwOnceOnEvent = null;
  generationState.calls = [];
  generationState.failEntryIds.clear();

  db.prepare('DELETE FROM activity_log WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  db.prepare('DELETE FROM copy_batch_jobs WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  db.prepare(`
    DELETE FROM blueprint_entries
    WHERE blueprint_id IN (
      SELECT id FROM site_blueprints WHERE workspace_id IN (?, ?)
    )
  `).run(wsAId, wsBId);
  db.prepare('DELETE FROM site_blueprints WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
});

afterAll(async () => {
  db.prepare('DELETE FROM activity_log WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  db.prepare('DELETE FROM copy_batch_jobs WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  db.prepare(`
    DELETE FROM blueprint_entries
    WHERE blueprint_id IN (
      SELECT id FROM site_blueprints WHERE workspace_id IN (?, ?)
    )
  `).run(wsAId, wsBId);
  db.prepare('DELETE FROM site_blueprints WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);

  deleteWorkspace(wsAId);
  deleteWorkspace(wsBId);
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
});

describe('copy batch mutation safety', () => {
  it('persists batch lifecycle state, activities, broadcasts, and read-path visibility on success', async () => {
    const blueprint = createBlueprint({ workspaceId: wsAId, name: 'Batch Success Blueprint' });
    const entryA = addEntry(wsAId, blueprint.id, { name: 'Service Page A', pageType: 'service' });
    const entryB = addEntry(wsAId, blueprint.id, { name: 'Service Page B', pageType: 'service' });
    expect(entryA).not.toBeNull();
    expect(entryB).not.toBeNull();

    const startRes = await postJson(`/api/copy/${wsAId}/${blueprint.id}/batch`, {
      entryIds: [entryA!.id, entryB!.id],
      mode: 'review_inbox',
    });
    expect(startRes.status).toBe(200);
    const started = await startRes.json() as { batchId: string };
    expect(started.batchId).toMatch(/^bj_/);

    const terminal = await waitForBatchTerminalState(wsAId, started.batchId);
    expect(terminal.status).toBe('complete');
    expect(terminal.progress).toMatchObject({ total: 2, generated: 2, reviewed: 0, approved: 0 });

    expect(countJobs(wsAId)).toBe(1);
    expect(countActivities(wsAId, 'copy_batch_started')).toBe(1);
    expect(countActivities(wsAId, 'copy_batch_complete')).toBe(1);
    expect(generationState.calls).toHaveLength(2);
    expect(generationState.calls.length).toBeGreaterThan(0);
    expect(generationState.calls.every(call => call.workspaceId === wsAId && call.blueprintId === blueprint.id)).toBe(true); // every-ok: guarded by explicit length assertion above

    const events = batchEvents(wsAId);
    expect(events.length).toBeGreaterThanOrEqual(2);
    const completeEvents = events.filter(event => event.event === WS_EVENTS.COPY_BATCH_COMPLETE);
    expect(completeEvents).toHaveLength(1);
    expect(completeEvents[0].payload).toMatchObject({ batchId: started.batchId, total: 2, generated: 2, failed: 0, status: 'complete' });
  });

  it('keeps the batch and background job successful when the completion event throws', async () => {
    const blueprint = createBlueprint({ workspaceId: wsAId, name: 'Batch Effect Failure Blueprint' });
    const entry = addEntry(wsAId, blueprint.id, { name: 'Effect Failure Page', pageType: 'service' })!;
    broadcastState.throwOnceOnEvent = WS_EVENTS.COPY_BATCH_COMPLETE;

    const startRes = await postJson(`/api/copy/${wsAId}/${blueprint.id}/batch`, {
      entryIds: [entry.id],
      mode: 'review_inbox',
    });
    expect(startRes.status).toBe(200);
    const started = await startRes.json() as { batchId: string; jobId: string };

    expect(await waitForBatchTerminalState(wsAId, started.batchId)).toMatchObject({
      status: 'complete',
      progress: { total: 1, generated: 1 },
    });
    expect(db.prepare('SELECT status FROM copy_batch_jobs WHERE id = ?')
      .get(started.batchId)).toEqual({ status: 'complete' });
    expect(db.prepare('SELECT status, error FROM jobs WHERE id = ?')
      .get(started.jobId)).toEqual({ status: 'done', error: null });
    // A failed broadcast cannot suppress the later activity effect.
    expect(countActivities(wsAId, 'copy_batch_complete')).toBe(1);
  });

  it('keeps a completed batch authoritative when terminal job tracking fails', async () => {
    const blueprint = createBlueprint({ workspaceId: wsAId, name: 'Batch Terminal Truth Blueprint' });
    const entry = addEntry(wsAId, blueprint.id, { name: 'Terminal Truth Page', pageType: 'service' })!;
    const started = createCopyBatchGenerationJob({
      workspaceId: wsAId,
      blueprintId: blueprint.id,
      entryIds: [entry.id],
    });
    broadcastState.calls = [];
    const removeFailure = failDoneJobWrite(started.jobId);

    try {
      await runCopyBatchGenerationJob({
        jobId: started.jobId,
        batchId: started.batchId,
        workspaceId: wsAId,
        blueprintId: blueprint.id,
        entryIds: [entry.id],
      });
    } finally {
      removeFailure();
    }

    expect(generationState.calls).toContainEqual({
      workspaceId: wsAId,
      blueprintId: blueprint.id,
      entryId: entry.id,
    });
    expect(getCopyBatchJob(wsAId, started.batchId)).toMatchObject({
      status: 'complete',
      progress: { total: 1, generated: 1 },
    });
    const persistedJob = db.prepare('SELECT status, message, result FROM jobs WHERE id = ?')
      .get(started.jobId) as { status: string; message: string; result: string };
    expect(persistedJob.status).toBe('error');
    expect(persistedJob.message).toBe('Batch outcome committed, but completion tracking failed');
    expect(JSON.parse(persistedJob.result)).toMatchObject({
      batchId: started.batchId,
      status: 'complete',
      code: 'completion_tracking_failed',
      artifactCommitted: true,
      batchOutcomeCommitted: true,
    });
    expect(countActivities(wsAId, 'copy_batch_complete')).toBe(0);
    expect(batchEvents(wsAId).filter(event => event.event === WS_EVENTS.COPY_BATCH_COMPLETE)).toHaveLength(0);
  });

  it('marks all-failed runs as failed and avoids phantom success signals', async () => {
    const blueprint = createBlueprint({ workspaceId: wsAId, name: 'Batch Failure Blueprint' });
    const entryA = addEntry(wsAId, blueprint.id, { name: 'Failure Page A', pageType: 'service' });
    const entryB = addEntry(wsAId, blueprint.id, { name: 'Failure Page B', pageType: 'service' });
    expect(entryA).not.toBeNull();
    expect(entryB).not.toBeNull();
    generationState.failEntryIds.add(entryA!.id);
    generationState.failEntryIds.add(entryB!.id);

    const startRes = await postJson(`/api/copy/${wsAId}/${blueprint.id}/batch`, {
      entryIds: [entryA!.id, entryB!.id],
      mode: 'review_inbox',
    });
    expect(startRes.status).toBe(200);
    const started = await startRes.json() as { batchId: string };

    const terminal = await waitForBatchTerminalState(wsAId, started.batchId);
    expect(terminal.status).toBe('failed');
    expect(terminal.progress).toMatchObject({ total: 2, generated: 0 });
    expect(countActivities(wsAId, 'copy_batch_started')).toBe(1);
    expect(countActivities(wsAId, 'copy_batch_complete')).toBe(1);

    const completeEvents = batchEvents(wsAId).filter(event => event.event === WS_EVENTS.COPY_BATCH_COMPLETE);
    expect(completeEvents).toHaveLength(1);
    expect(completeEvents[0].payload).toMatchObject({ batchId: started.batchId, status: 'failed', generated: 0, failed: 2 });
  });

  it('rejects cross-workspace blueprint probes without jobs, activities, or broadcasts', async () => {
    const blueprint = createBlueprint({ workspaceId: wsAId, name: 'Cross Workspace Blueprint' });
    const entry = addEntry(wsAId, blueprint.id, { name: 'Cross Workspace Entry', pageType: 'service' });
    expect(entry).not.toBeNull();

    const startRes = await postJson(`/api/copy/${wsBId}/${blueprint.id}/batch`, {
      entryIds: [entry!.id],
      mode: 'review_inbox',
    });
    expect(startRes.status).toBe(404);
    expect(await startRes.json()).toMatchObject({ error: 'Blueprint not found' });

    expect(countJobs(wsBId)).toBe(0);
    expect(countActivities(wsBId, 'copy_batch_started')).toBe(0);
    expect(countActivities(wsBId, 'copy_batch_complete')).toBe(0);
    expect(batchEvents(wsBId)).toHaveLength(0);
  });

  it('rejects malformed requests before mutation side effects', async () => {
    const blueprint = createBlueprint({ workspaceId: wsAId, name: 'Malformed Request Blueprint' });

    const startRes = await postJson(`/api/copy/${wsAId}/${blueprint.id}/batch`, {
      entryIds: [],
      mode: 'review_inbox',
    });
    expect(startRes.status).toBe(400);

    expect(countJobs(wsAId)).toBe(0);
    expect(countActivities(wsAId, 'copy_batch_started')).toBe(0);
    expect(countActivities(wsAId, 'copy_batch_complete')).toBe(0);
    expect(batchEvents(wsAId)).toHaveLength(0);
  });

  it('rejects duplicate entry IDs before creating a job or batch row', async () => {
    const blueprint = createBlueprint({ workspaceId: wsAId, name: 'Duplicate Entry Blueprint' });
    const entry = addEntry(wsAId, blueprint.id, { name: 'Duplicate Entry', pageType: 'service' })!;

    const startRes = await postJson(`/api/copy/${wsAId}/${blueprint.id}/batch`, {
      entryIds: [entry.id, entry.id],
      mode: 'review_inbox',
    });

    expect(startRes.status).toBe(400);
    expect(countJobs(wsAId)).toBe(0);
    expect(countActivities(wsAId, 'copy_batch_started')).toBe(0);
  });

  it('allows disjoint batches in one workspace to run concurrently', async () => {
    const blueprint = createBlueprint({ workspaceId: wsAId, name: 'Disjoint Batch Blueprint' });
    const entryA = addEntry(wsAId, blueprint.id, { name: 'Disjoint A', pageType: 'service' })!;
    const entryB = addEntry(wsAId, blueprint.id, { name: 'Disjoint B', pageType: 'service' })!;

    const firstRes = await postJson(`/api/copy/${wsAId}/${blueprint.id}/batch`, {
      entryIds: [entryA.id],
    });
    const secondRes = await postJson(`/api/copy/${wsAId}/${blueprint.id}/batch`, {
      entryIds: [entryB.id],
    });
    expect(firstRes.status).toBe(200);
    expect(secondRes.status).toBe(200);

    const first = await firstRes.json() as { batchId: string };
    const second = await secondRes.json() as { batchId: string };
    expect(await waitForBatchTerminalState(wsAId, first.batchId)).toMatchObject({ status: 'complete' });
    expect(await waitForBatchTerminalState(wsAId, second.batchId)).toMatchObject({ status: 'complete' });
  });

  it('atomically rejects overlapping batch and single-entry generation starts', async () => {
    const blueprint = createBlueprint({ workspaceId: wsAId, name: 'Overlap Batch Blueprint' });
    const entryA = addEntry(wsAId, blueprint.id, { name: 'Overlap A', pageType: 'service' })!;
    const entryB = addEntry(wsAId, blueprint.id, { name: 'Overlap B', pageType: 'service' })!;

    const firstRes = await postJson(`/api/copy/${wsAId}/${blueprint.id}/batch`, {
      entryIds: [entryA.id, entryB.id],
    });
    expect(firstRes.status).toBe(200);
    const first = await firstRes.json() as { batchId: string; jobId: string };

    const overlapBatch = await postJson(`/api/copy/${wsAId}/${blueprint.id}/batch`, {
      entryIds: [entryB.id],
    });
    expect(overlapBatch.status).toBe(409);
    expect(await overlapBatch.json()).toMatchObject({ jobId: first.jobId });

    const overlapSingle = await postJson(
      `/api/copy/${wsAId}/${blueprint.id}/${entryA.id}/generate`,
      {},
    );
    expect(overlapSingle.status).toBe(409);
    expect(await overlapSingle.json()).toMatchObject({ jobId: first.jobId });
    expect(await waitForBatchTerminalState(wsAId, first.batchId)).toMatchObject({ status: 'complete' });
  });

  it('releases a single-entry claim after both terminal job writes fail during worker drain', async () => {
    const blueprint = createBlueprint({ workspaceId: wsAId, name: 'Single Drain Blueprint' });
    const entry = addEntry(wsAId, blueprint.id, { name: 'Single Drain Entry', pageType: 'service' })!;
    const { job } = createResourceScopedJob(BACKGROUND_JOB_TYPES.COPY_ENTRY_GENERATION, {
      workspaceId: wsAId,
      resources: [{ resourceType: JOB_RESOURCE_TYPES.COPY_ENTRY, resourceId: entry.id }],
    });
    const removeFailure = failTerminalJobWrites(job.id);

    try {
      await expect(runCopyEntryGenerationJob({
        jobId: job.id,
        workspaceId: wsAId,
        blueprintId: blueprint.id,
        entryId: entry.id,
      })).resolves.toBeUndefined();
    } finally {
      removeFailure();
    }

    expect(generationState.calls).toContainEqual({
      workspaceId: wsAId,
      blueprintId: blueprint.id,
      entryId: entry.id,
    });
    expect(db.prepare('SELECT status FROM jobs WHERE id = ?').get(job.id)).toEqual({ status: 'running' });
    expect(getJobResourceClaims(job.id)).toEqual([
      expect.objectContaining({
        resourceType: JOB_RESOURCE_TYPES.COPY_ENTRY,
        resourceId: entry.id,
        active: false,
      }),
    ]);

    const retry = createResourceScopedJob(BACKGROUND_JOB_TYPES.COPY_ENTRY_GENERATION, {
      workspaceId: wsAId,
      resources: [{ resourceType: JOB_RESOURCE_TYPES.COPY_ENTRY, resourceId: entry.id }],
    });
    expect(retry.job.id).not.toBe(job.id);
    updateJob(retry.job.id, { status: 'error', error: 'test cleanup' });
  });

  it('releases every batch entry claim after both terminal job writes fail during worker drain', async () => {
    const blueprint = createBlueprint({ workspaceId: wsAId, name: 'Batch Drain Blueprint' });
    const entry = addEntry(wsAId, blueprint.id, { name: 'Batch Drain Entry', pageType: 'service' })!;
    const started = createCopyBatchGenerationJob({
      workspaceId: wsAId,
      blueprintId: blueprint.id,
      entryIds: [entry.id],
    });
    const removeFailure = failTerminalJobWrites(started.jobId);

    try {
      await expect(runCopyBatchGenerationJob({
        jobId: started.jobId,
        batchId: started.batchId,
        workspaceId: wsAId,
        blueprintId: blueprint.id,
        entryIds: [entry.id],
      })).resolves.toBeUndefined();
    } finally {
      removeFailure();
    }

    expect(generationState.calls).toContainEqual({
      workspaceId: wsAId,
      blueprintId: blueprint.id,
      entryId: entry.id,
    });
    expect(db.prepare('SELECT status FROM jobs WHERE id = ?').get(started.jobId)).toEqual({ status: 'running' });
    expect(getCopyBatchJob(wsAId, started.batchId)?.status).toBe('complete');
    expect(getJobResourceClaims(started.jobId)).toEqual([
      expect.objectContaining({
        resourceType: JOB_RESOURCE_TYPES.COPY_ENTRY,
        resourceId: entry.id,
        active: false,
      }),
    ]);

    const retry = createResourceScopedJob(BACKGROUND_JOB_TYPES.COPY_ENTRY_GENERATION, {
      workspaceId: wsAId,
      resources: [{ resourceType: JOB_RESOURCE_TYPES.COPY_ENTRY, resourceId: entry.id }],
    });
    expect(retry.job.id).not.toBe(started.jobId);
    updateJob(retry.job.id, { status: 'error', error: 'test cleanup' });
  });
});
