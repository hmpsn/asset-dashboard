/**
 * Integration coverage for content plan review HTTP workflow routes.
 *
 * Focus: admin sample-send validation and no side effects on malformed input.
 * Uses createApp() in-process so workspace broadcasts can be mocked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: unknown }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: unknown) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createMatrix, getMatrix } from '../../server/content-matrices.js';
import db from '../../server/db/index.js';
import { WS_EVENTS } from '../../server/ws-events.js';

let baseUrl = '';
let server: http.Server | undefined;
let workspaceId = '';

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

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createReviewMatrix(): { matrixId: string; cellId: string } {
  const matrix = createMatrix(workspaceId, {
    name: 'Sample Review Matrix',
    templateId: 'tpl_sample_review',
    dimensions: [{ variableName: 'service', values: ['Audit'] }],
    urlPattern: '/services/{service}',
    keywordPattern: '{service} services',
  });
  return { matrixId: matrix.id, cellId: matrix.cells[0].id };
}

function countApprovalBatches(): number {
  const row = db.prepare(`
    SELECT COALESCE(COUNT(*), 0) AS count
    FROM approval_batches
    WHERE workspace_id = ?
  `).get(workspaceId) as { count: number };
  return row.count;
}

function countSampleReviewActivities(): number {
  const row = db.prepare(`
    SELECT COALESCE(COUNT(*), 0) AS count
    FROM activity_log
    WHERE workspace_id = ?
      AND type = 'content_updated'
      AND metadata LIKE '%"sample_review_sent"%'
  `).get(workspaceId) as { count: number };
  return row.count;
}

beforeAll(async () => {
  await startTestServer();
  workspaceId = createWorkspace('Content Plan Review Routes Workspace').id;
}, 25_000);

beforeEach(() => {
  broadcastState.calls = [];
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM approval_batches WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM content_matrices WHERE workspace_id = ?').run(workspaceId);
});

afterAll(async () => {
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM approval_batches WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM content_matrices WHERE workspace_id = ?').run(workspaceId);
  deleteWorkspace(workspaceId);
  await stopTestServer();
});

describe('POST /api/content-plan/:workspaceId/:matrixId/send-samples', () => {
  it('rejects malformed cellIds before creating approvals, mutating cells, activity, or broadcasts', async () => {
    const { matrixId, cellId } = createReviewMatrix();

    const res = await postJson(`/api/content-plan/${workspaceId}/${matrixId}/send-samples`, {
      cellIds: cellId,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();

    const stored = getMatrix(workspaceId, matrixId);
    expect(stored?.cells.find(cell => cell.id === cellId)?.status).toBe('planned');
    expect(countApprovalBatches()).toBe(0);
    expect(countSampleReviewActivities()).toBe(0);
    expect(broadcastState.calls.some(call => call.event === WS_EVENTS.APPROVAL_UPDATE)).toBe(false);
    expect(broadcastState.calls.some(call => call.event === WS_EVENTS.CONTENT_UPDATED)).toBe(false);
  });

  it('sends valid sample cell ids for client review', async () => {
    const { matrixId, cellId } = createReviewMatrix();

    const res = await postJson(`/api/content-plan/${workspaceId}/${matrixId}/send-samples`, {
      cellIds: [cellId],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cellsSent).toBe(1);

    const stored = getMatrix(workspaceId, matrixId);
    expect(stored?.cells.find(cell => cell.id === cellId)?.status).toBe('review');
    expect(countApprovalBatches()).toBe(1);
    expect(countSampleReviewActivities()).toBe(1);
    expect(broadcastState.calls.some(call => call.event === WS_EVENTS.APPROVAL_UPDATE)).toBe(true);
    expect(broadcastState.calls.some(call => call.event === WS_EVENTS.CONTENT_UPDATED)).toBe(true);
  });
});
