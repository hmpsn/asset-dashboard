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

import db from '../../server/db/index.js';
import { createMatrix, getMatrix } from '../../server/content-matrices.js';
import { createTemplate, getTemplate } from '../../server/content-templates.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { WS_EVENTS } from '../../server/ws-events.js';

let baseUrl = '';
let server: http.Server | undefined;
let workspaceA = '';
let workspaceB = '';
let originalAppPassword: string | undefined;

async function startTestServer(): Promise<void> {
  originalAppPassword = process.env.APP_PASSWORD;
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

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, init);
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function putJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'PUT',
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

async function del(path: string): Promise<Response> {
  return api(path, { method: 'DELETE' });
}

function countTemplates(workspaceId: string): number {
  const row = db.prepare(
    `SELECT COALESCE(COUNT(*), 0) AS count FROM content_templates WHERE workspace_id = ?`,
  ).get(workspaceId) as { count: number };
  return row.count;
}

function countMatrices(workspaceId: string): number {
  const row = db.prepare(
    `SELECT COALESCE(COUNT(*), 0) AS count FROM content_matrices WHERE workspace_id = ?`,
  ).get(workspaceId) as { count: number };
  return row.count;
}

function countActivityAction(workspaceId: string, action: string): number {
  const row = db.prepare(
    `SELECT COALESCE(COUNT(*), 0) AS count
     FROM activity_log
     WHERE workspace_id = ?
       AND metadata LIKE ?`,
  ).get(workspaceId, `%"action":"${action}"%`) as { count: number };
  return row.count;
}

beforeAll(async () => {
  await startTestServer();
  workspaceA = createWorkspace('Workspace Mutation Helper A').id;
  workspaceB = createWorkspace('Workspace Mutation Helper B').id;
});

beforeEach(() => {
  broadcastState.calls = [];
  db.prepare('DELETE FROM activity_log WHERE workspace_id IN (?, ?)').run(workspaceA, workspaceB);
  db.prepare('DELETE FROM content_matrices WHERE workspace_id IN (?, ?)').run(workspaceA, workspaceB);
  db.prepare('DELETE FROM content_templates WHERE workspace_id IN (?, ?)').run(workspaceA, workspaceB);
});

afterAll(async () => {
  db.prepare('DELETE FROM activity_log WHERE workspace_id IN (?, ?)').run(workspaceA, workspaceB);
  db.prepare('DELETE FROM content_matrices WHERE workspace_id IN (?, ?)').run(workspaceA, workspaceB);
  db.prepare('DELETE FROM content_templates WHERE workspace_id IN (?, ?)').run(workspaceA, workspaceB);
  deleteWorkspace(workspaceA);
  deleteWorkspace(workspaceB);
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
});

describe('workspace mutation helper pilot (content templates + content matrices)', () => {
  it('template create success writes state, activity, and one content update broadcast', async () => {
    const res = await postJson(`/api/content-templates/${workspaceA}`, {
      name: 'Pilot Template',
      pageType: 'service',
      sections: [],
      variables: [],
      urlPattern: '/pilot',
      keywordPattern: 'pilot',
    });

    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.id).toMatch(/^tpl_/);
    expect(countTemplates(workspaceA)).toBe(1);
    expect(countActivityAction(workspaceA, 'template_created')).toBe(1);

    const contentUpdatedCalls = broadcastState.calls.filter(
      call => call.workspaceId === workspaceA && call.event === WS_EVENTS.CONTENT_UPDATED,
    );
    expect(contentUpdatedCalls).toHaveLength(1);
  });

  it('template create validation failure has no mutation side effects', async () => {
    const res = await postJson(`/api/content-templates/${workspaceA}`, {
      description: 'missing name',
    });

    expect(res.status).toBe(400);
    expect(countTemplates(workspaceA)).toBe(0);
    expect(countActivityAction(workspaceA, 'template_created')).toBe(0);
    expect(broadcastState.calls).toHaveLength(0);
  });

  it('cross-workspace template update returns 404 and preserves target workspace state', async () => {
    const externalTemplate = createTemplate(workspaceB, {
      name: 'Workspace B Template',
      pageType: 'service',
      sections: [],
      variables: [],
      urlPattern: '/b',
      keywordPattern: 'b',
    });

    const res = await putJson(`/api/content-templates/${workspaceA}/${externalTemplate.id}`, {
      name: 'Hijacked Name',
    });

    expect(res.status).toBe(404);
    expect(getTemplate(workspaceB, externalTemplate.id)?.name).toBe('Workspace B Template');
    expect(countActivityAction(workspaceA, 'template_updated')).toBe(0);
    expect(countActivityAction(workspaceB, 'template_updated')).toBe(0);
    expect(broadcastState.calls).toHaveLength(0);
  });

  it('matrix cell patch success writes state, activity, and one content update broadcast', async () => {
    const matrix = createMatrix(workspaceA, {
      name: 'Pilot Matrix',
      templateId: 'tpl_pilot',
      dimensions: [{ variableName: 'service', values: ['Audit'] }],
      urlPattern: '/audit/{service}',
      keywordPattern: '{service} services',
    });
    const cellId = matrix.cells[0].id;

    const res = await patchJson(
      `/api/content-matrices/${workspaceA}/${matrix.id}/cells/${cellId}`,
      { status: 'keyword_validated' },
    );

    expect(res.status).toBe(200);
    const updated = getMatrix(workspaceA, matrix.id);
    expect(updated?.cells.find(cell => cell.id === cellId)?.status).toBe('keyword_validated');
    expect(countActivityAction(workspaceA, 'matrix_cell_updated')).toBe(1);

    const contentUpdatedCalls = broadcastState.calls.filter(
      call => call.workspaceId === workspaceA && call.event === WS_EVENTS.CONTENT_UPDATED,
    );
    expect(contentUpdatedCalls).toHaveLength(1);
  });

  it('matrix delete cross-workspace mismatch returns 404 with no mutation side effects', async () => {
    const matrix = createMatrix(workspaceB, {
      name: 'Workspace B Matrix',
      templateId: 'tpl_b',
      dimensions: [{ variableName: 'city', values: ['Austin'] }],
      urlPattern: '/city/{city}',
      keywordPattern: '{city} services',
    });

    const res = await del(`/api/content-matrices/${workspaceA}/${matrix.id}`);
    expect(res.status).toBe(404);

    expect(countMatrices(workspaceA)).toBe(0);
    expect(countMatrices(workspaceB)).toBe(1);
    expect(countActivityAction(workspaceA, 'matrix_deleted')).toBe(0);
    expect(countActivityAction(workspaceB, 'matrix_deleted')).toBe(0);
    expect(broadcastState.calls).toHaveLength(0);
  });
});
