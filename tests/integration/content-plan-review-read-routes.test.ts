/**
 * Integration tests for content-plan-review read-path endpoints.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/public/content-plan/:workspaceId → 200 with array
 * - GET /api/public/content-plan/:workspaceId/:matrixId unknown matrixId → 404 or null
 * - POST /api/content-plan/:workspaceId/:matrixId/send-template-review unknown matrixId → 404
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createMatrix, updateMatrixCell } from '../../server/content-matrices.js';
import db from '../../server/db/index.js';
import { withPublicTestAuth } from './public-auth-test-helpers.js';

let baseUrl = '';
let server: http.Server | undefined;
let workspaceId = '';
let matrixId = '';
let cellId = '';

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
  return fetch(`${baseUrl}${path}`, withPublicTestAuth(path));
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
  workspaceId = createWorkspace('Content Plan Review Read WS 13657').id;

  // Create a matrix with a cell in 'review' status so the public endpoint returns it
  const matrix = createMatrix(workspaceId, {
    name: 'Review Read Test Matrix',
    templateId: 'tpl_review_read_test',
    dimensions: [{ variableName: 'topic', values: ['SEO'] }],
    urlPattern: '/blog/{topic}',
    keywordPattern: '{topic} guide',
  });
  matrixId = matrix.id;
  cellId = matrix.cells[0].id;
  // Move cell to 'review' so it's visible in the public content-plan API
  updateMatrixCell(workspaceId, matrixId, cellId, { status: 'review' });
}, 60_000);

afterAll(async () => {
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM approval_batches WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM content_matrices WHERE workspace_id = ?').run(workspaceId);
  deleteWorkspace(workspaceId);
  await stopTestServer();
});

describe('GET /api/public/content-plan/:workspaceId', () => {
  it('returns 200 with array containing visible cells', async () => {
    const res = await getJson(`/api/public/content-plan/${workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
    expect(body[0].id).toBe(matrixId);
    expect(Array.isArray(body[0].cells)).toBe(true);
    expect(body[0].cells[0].id).toBe(cellId);
    expect(body[0].cells[0].status).toBe('review');
  });

  it('returns 200 with empty array when no cells are in review/flagged/approved/published status', async () => {
    const freshWsId = createWorkspace('Fresh No-Visible-Cells WS').id;
    // Create a matrix with only 'planned' cells (not visible to public)
    createMatrix(freshWsId, {
      name: 'Planned Only Matrix',
      templateId: 'tpl_planned',
      dimensions: [{ variableName: 'city', values: ['Austin'] }],
      urlPattern: '/loc/{city}',
      keywordPattern: '{city} services',
    });
    try {
      const res = await getJson(`/api/public/content-plan/${freshWsId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(0);
    } finally {
      db.prepare('DELETE FROM content_matrices WHERE workspace_id = ?').run(freshWsId);
      deleteWorkspace(freshWsId);
    }
  });

  it('returns 404 for unknown workspace', async () => {
    const res = await getJson('/api/public/content-plan/ws_nonexistent_xyz');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/public/content-plan/:workspaceId/:matrixId', () => {
  it('returns 200 with serialized matrix for known matrix with visible cells', async () => {
    const res = await getJson(`/api/public/content-plan/${workspaceId}/${matrixId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toBeNull();
    expect(body.id).toBe(matrixId);
    expect(Array.isArray(body.cells)).toBe(true);
    expect(body.cells[0].id).toBe(cellId);
    expect(body.cells[0].status).toBe('review');
    // Client-safe fields should be present
    expect(typeof body.stats).toBe('object');
    expect(Array.isArray(body.dimensions)).toBe(true);
  });

  it('returns 404 for unknown matrixId', async () => {
    const res = await getJson(`/api/public/content-plan/${workspaceId}/mtx_nonexistent_abc`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});

describe('POST /api/content-plan/:workspaceId/:matrixId/send-template-review', () => {
  it('returns 404 for unknown matrixId', async () => {
    const res = await postJson(
      `/api/content-plan/${workspaceId}/mtx_nonexistent_abc/send-template-review`,
      {},
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});
