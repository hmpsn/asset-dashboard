/**
 * Integration tests for content-matrices read-path endpoints.
 *
 * Supplements the existing content-matrices-routes.test.ts with focused
 * read-path and validation coverage:
 * - GET /api/content-matrices/:workspaceId → 200 with array
 * - GET /api/content-matrices/:workspaceId/:matrixId unknown id → 404
 * - POST /api/content-matrices/:workspaceId missing name → 400
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'http';

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));
import type { AddressInfo } from 'net';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';

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
    server!.close(err => (err ? reject(err) : resolve()));
  });
  server = undefined;
}

async function getJson(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`);
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await startTestServer();
  workspaceId = createWorkspace('Content Matrices Read WS 13658').id;
}, 60_000);

afterAll(async () => {
  db.prepare('DELETE FROM content_matrices WHERE workspace_id = ?').run(workspaceId);
  deleteWorkspace(workspaceId);
  await stopTestServer();
});

describe('GET /api/content-matrices/:workspaceId', () => {
  it('returns 200 with empty array for fresh workspace', async () => {
    const res = await getJson(`/api/content-matrices/${workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });
});

describe('GET /api/content-matrices/:workspaceId/:matrixId', () => {
  it('returns 404 for unknown matrixId', async () => {
    const res = await getJson(`/api/content-matrices/${workspaceId}/mtx_nonexistent_xyz`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});

describe('POST /api/content-matrices/:workspaceId validation', () => {
  it('returns 400 when name is missing', async () => {
    const res = await postJson(`/api/content-matrices/${workspaceId}`, {
      templateId: 'tpl_123',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('returns 400 when templateId is missing', async () => {
    const res = await postJson(`/api/content-matrices/${workspaceId}`, {
      name: 'Test Matrix',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('creates a matrix and it appears in GET list and GET by ID', async () => {
    const res = await postJson(`/api/content-matrices/${workspaceId}`, {
      name: 'Read Route Matrix',
      templateId: 'tpl_read_route_test',
      dimensions: [{ variableName: 'city', values: ['Austin', 'Dallas'] }],
      urlPattern: '/locations/{city}',
      keywordPattern: 'services in {city}',
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/^mtx_/);
    expect(body.name).toBe('Read Route Matrix');
    // 2 cities → 2 cells
    expect(body.cells).toHaveLength(2);

    const listRes = await getJson(`/api/content-matrices/${workspaceId}`);
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list.some((m: { id: string }) => m.id === body.id)).toBe(true);

    const getRes = await getJson(`/api/content-matrices/${workspaceId}/${body.id}`);
    expect(getRes.status).toBe(200);
    const detail = await getRes.json();
    expect(detail.id).toBe(body.id);
    expect(detail.cells).toHaveLength(2);
  });
});
