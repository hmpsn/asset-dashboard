import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: Record<string, unknown> }>,
}));

const generationState = vi.hoisted(() => ({
  failEntryIds: new Set<string>(),
  calls: [] as Array<{ workspaceId: string; blueprintId: string; entryId: string }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: Record<string, unknown>) => {
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
import { addEntry, createBlueprint } from '../../server/page-strategy.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { WS_EVENTS } from '../../server/ws-events.js';

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

beforeAll(async () => {
  await startTestServer();
  wsAId = createWorkspace('Copy Batch Mutation Safety A').id;
  wsBId = createWorkspace('Copy Batch Mutation Safety B').id;
}, 25_000);

beforeEach(() => {
  broadcastState.calls = [];
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
});
