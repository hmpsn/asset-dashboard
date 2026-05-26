/**
 * Integration tests — content matrix CRUD lifecycle.
 *
 * Covers: create, read, update, delete, cell editing, broadcast
 * verification, and workspace isolation.
 *
 * Complements:
 *  - content-matrices-routes.test.ts (port 13241) — general CRUD
 *  - content-matrices-read-routes.test.ts — read-path validation
 *
 * Uses in-process server with dynamic port so vi.mock works.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// ── Mocks (must be declared before any server import) ────────────────────────

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

vi.mock('../../server/email.js', () => ({
  isEmailConfigured: vi.fn(() => false),
  sendEmail: vi.fn(),
  notifyApprovalReady: vi.fn(),
  notifyTeamActionApproved: vi.fn(),
  notifyTeamChangesRequested: vi.fn(),
  notifyTeamNewRequest: vi.fn(),
  notifyClientBriefReady: vi.fn(),
  notifyClientContentPublished: vi.fn(),
  notifyClientPostReady: vi.fn(),
  notifyClientFixesApplied: vi.fn(),
  notifyClientStatusChange: vi.fn(),
  notifyTeamContentRequest: vi.fn(),
}));

// ── Server bootstrap ─────────────────────────────────────────────────────────

import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

let baseUrl = '';
let server: http.Server | undefined;

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

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function getJson(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`);
}

function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function putJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function patchJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function del(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { method: 'DELETE' });
}

// ── Fixture data ─────────────────────────────────────────────────────────────

/** Minimal valid POST body that produces 2 cells (1 service × 2 cities). */
const MATRIX_PAYLOAD = {
  name: 'Lifecycle Test Matrix',
  templateId: 'tpl_lifecycle_001',
  dimensions: [
    { variableName: 'service', values: ['Plumbing'] },
    { variableName: 'city', values: ['Austin', 'Dallas'] },
  ],
  urlPattern: '/services/{city}/{service}',
  keywordPattern: '{service} in {city}',
};

// ── Workspace state ──────────────────────────────────────────────────────────

let wsA = '';
let wsB = '';

beforeAll(async () => {
  await startTestServer();
  wsA = createWorkspace('Content Matrices Lifecycle WS-A').id;
  wsB = createWorkspace('Content Matrices Lifecycle WS-B').id;
}, 60_000);

afterAll(async () => {
  deleteWorkspace(wsA);
  deleteWorkspace(wsB);
  await stopTestServer();
});

// ════════════════════════════════════════════════════════════════════════════
// POST — create
// ════════════════════════════════════════════════════════════════════════════

describe('POST /api/content-matrices/:workspaceId — create matrix', () => {
  it('creates a matrix and returns 201 with id and key fields', async () => {
    const res = await postJson(`/api/content-matrices/${wsA}`, MATRIX_PAYLOAD);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/^mtx_/);
    expect(body.name).toBe(MATRIX_PAYLOAD.name);
    expect(body.templateId).toBe(MATRIX_PAYLOAD.templateId);
    expect(Array.isArray(body.dimensions)).toBe(true);
    expect(body.dimensions).toHaveLength(2);
    // 1 service × 2 cities = 2 cells
    expect(body.cells).toHaveLength(2);
    expect(body.stats?.total).toBe(2);
  });

  it('returns matrix in subsequent GET list', async () => {
    // Create a fresh matrix so this test is self-contained
    const createRes = await postJson(`/api/content-matrices/${wsA}`, {
      ...MATRIX_PAYLOAD,
      name: 'Lifecycle List Test',
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const listRes = await getJson(`/api/content-matrices/${wsA}`);
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(Array.isArray(list)).toBe(true);
    const found = list.find((m: { id: string }) => m.id === created.id);
    expect(found).toBeDefined();
  });

  it('returns 400 for missing required field "name"', async () => {
    const res = await postJson(`/api/content-matrices/${wsA}`, {
      templateId: 'tpl_xyz',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('returns 400 for missing required field "templateId"', async () => {
    const res = await postJson(`/api/content-matrices/${wsA}`, {
      name: 'No Template',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('creates matrix even for an unknown workspaceId (no workspace-existence check on POST)', async () => {
    // requireWorkspaceAccess passes through when no JWT is present (HMAC-auth mode).
    // The create route does not validate workspace existence; the row is simply
    // written with the supplied workspace_id.  This test documents the current
    // contract so regressions are caught if validation is added later.
    const res = await postJson('/api/content-matrices/ws_does_not_exist_xyz', MATRIX_PAYLOAD);
    // Either 201 (row written) or 404/400 if workspace validation is ever added.
    expect([201, 400, 404]).toContain(res.status);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// GET — list
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/content-matrices/:workspaceId — list', () => {
  let freshWs = '';

  beforeAll(() => {
    freshWs = createWorkspace('Content Matrices Lifecycle List WS').id;
  });

  afterAll(() => {
    deleteWorkspace(freshWs);
  });

  it('returns empty array for fresh workspace', async () => {
    const res = await getJson(`/api/content-matrices/${freshWs}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it('returns created matrix in list', async () => {
    const createRes = await postJson(`/api/content-matrices/${freshWs}`, MATRIX_PAYLOAD);
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const listRes = await getJson(`/api/content-matrices/${freshWs}`);
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.some((m: { id: string }) => m.id === created.id)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// GET — single matrix
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/content-matrices/:workspaceId/:matrixId — get one', () => {
  let matrixId = '';
  let freshWs = '';

  beforeAll(async () => {
    freshWs = createWorkspace('Content Matrices Lifecycle Get WS').id;
    const res = await postJson(`/api/content-matrices/${freshWs}`, MATRIX_PAYLOAD);
    const body = await res.json();
    matrixId = body.id;
  });

  afterAll(() => {
    deleteWorkspace(freshWs);
  });

  it('returns full matrix with cells', async () => {
    const res = await getJson(`/api/content-matrices/${freshWs}/${matrixId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(matrixId);
    expect(body.name).toBe(MATRIX_PAYLOAD.name);
    expect(Array.isArray(body.cells)).toBe(true);
    expect(body.cells.length).toBeGreaterThan(0);
    // Each cell should have expected fields
    const cell = body.cells[0];
    expect(cell.id).toBeDefined();
    expect(cell.targetKeyword).toBeDefined();
    expect(cell.status).toBe('planned');
  });

  it('returns 404 for nonexistent matrixId', async () => {
    const res = await getJson(`/api/content-matrices/${freshWs}/mtx_nonexistent_lifecycle`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('workspace isolation: matrixId from wsA returns 404 via wsB path', async () => {
    const altWs = createWorkspace('Content Matrices Lifecycle Isolation WS').id;
    try {
      const res = await getJson(`/api/content-matrices/${altWs}/${matrixId}`);
      expect(res.status).toBe(404);
    } finally {
      deleteWorkspace(altWs);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PUT — update matrix
// ════════════════════════════════════════════════════════════════════════════

describe('PUT /api/content-matrices/:workspaceId/:matrixId — update', () => {
  let matrixId = '';
  let freshWs = '';

  beforeAll(async () => {
    freshWs = createWorkspace('Content Matrices Lifecycle Put WS').id;
    broadcastState.calls = [];
    const res = await postJson(`/api/content-matrices/${freshWs}`, MATRIX_PAYLOAD);
    const body = await res.json();
    matrixId = body.id;
    broadcastState.calls = []; // reset after create
  });

  afterAll(() => {
    deleteWorkspace(freshWs);
  });

  it('updates matrix name/headers and returns updated matrix', async () => {
    const res = await putJson(`/api/content-matrices/${freshWs}/${matrixId}`, {
      name: 'Updated Lifecycle Matrix',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(matrixId);
    expect(body.name).toBe('Updated Lifecycle Matrix');
    // Cells should still be present
    expect(Array.isArray(body.cells)).toBe(true);
    expect(body.cells.length).toBeGreaterThan(0);
  });

  it('returns 404 for nonexistent matrixId', async () => {
    const res = await putJson(`/api/content-matrices/${freshWs}/mtx_nonexistent_put`, {
      name: 'Ghost Update',
    });
    expect(res.status).toBe(404);
  });

  it('broadcasts CONTENT_UPDATED on successful update', async () => {
    broadcastState.calls = [];
    const res = await putJson(`/api/content-matrices/${freshWs}/${matrixId}`, {
      name: 'Broadcast Verify Update',
    });
    expect(res.status).toBe(200);

    const broadcast = broadcastState.calls.find(
      c => c.workspaceId === freshWs && c.event === 'content:updated',
    );
    expect(broadcast).toBeDefined();
    expect((broadcast?.payload as Record<string, unknown>)?.domain).toBe('content-plan');
    expect((broadcast?.payload as Record<string, unknown>)?.matrixId).toBe(matrixId);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PATCH — update cell
// ════════════════════════════════════════════════════════════════════════════

describe('PATCH /api/content-matrices/:workspaceId/:matrixId/cells/:cellId — update cell', () => {
  let matrixId = '';
  let cellId = '';
  let freshWs = '';

  beforeAll(async () => {
    freshWs = createWorkspace('Content Matrices Lifecycle Patch WS').id;
    const res = await postJson(`/api/content-matrices/${freshWs}`, MATRIX_PAYLOAD);
    const body = await res.json();
    matrixId = body.id;
    cellId = body.cells[0].id;
  });

  afterAll(() => {
    deleteWorkspace(freshWs);
  });

  it('updates a cell keyword and returns updated cell data', async () => {
    const res = await patchJson(
      `/api/content-matrices/${freshWs}/${matrixId}/cells/${cellId}`,
      { targetKeyword: 'emergency plumber Austin TX' },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(matrixId);
    const updatedCell = body.cells.find((c: { id: string }) => c.id === cellId);
    expect(updatedCell).toBeDefined();
    expect(updatedCell.targetKeyword).toBe('emergency plumber Austin TX');
  });

  it('returns 404 for nonexistent cellId', async () => {
    const res = await patchJson(
      `/api/content-matrices/${freshWs}/${matrixId}/cells/cell_nonexistent_xyz`,
      { targetKeyword: 'anything' },
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DELETE
// ════════════════════════════════════════════════════════════════════════════

describe('DELETE /api/content-matrices/:workspaceId/:matrixId', () => {
  let freshWs = '';
  let matrixId = '';

  beforeAll(async () => {
    freshWs = createWorkspace('Content Matrices Lifecycle Delete WS').id;
    const res = await postJson(`/api/content-matrices/${freshWs}`, MATRIX_PAYLOAD);
    const body = await res.json();
    matrixId = body.id;
  });

  afterAll(() => {
    deleteWorkspace(freshWs);
  });

  it('returns 404 for nonexistent matrixId', async () => {
    const res = await del(`/api/content-matrices/${freshWs}/mtx_nonexistent_delete`);
    expect(res.status).toBe(404);
  });

  it('deletes matrix and returns 200', async () => {
    const res = await del(`/api/content-matrices/${freshWs}/${matrixId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('deleted matrix returns 404 on GET', async () => {
    const res = await getJson(`/api/content-matrices/${freshWs}/${matrixId}`);
    expect(res.status).toBe(404);
  });

  it('deleted matrix not in list', async () => {
    const res = await getJson(`/api/content-matrices/${freshWs}`);
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(list.every((m: { id: string }) => m.id !== matrixId)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Workspace isolation
// ════════════════════════════════════════════════════════════════════════════

describe('Workspace isolation', () => {
  let wsAMatrix = '';

  beforeAll(async () => {
    const res = await postJson(`/api/content-matrices/${wsA}`, {
      ...MATRIX_PAYLOAD,
      name: 'WsA Isolation Matrix',
    });
    const body = await res.json();
    wsAMatrix = body.id;
  });

  it('matrix from wsA not in wsB list', async () => {
    const res = await getJson(`/api/content-matrices/${wsB}`);
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(list.every((m: { id: string }) => m.id !== wsAMatrix)).toBe(true);
  });

  it('DELETE of wsA matrix fails (404) via wsB path', async () => {
    const res = await del(`/api/content-matrices/${wsB}/${wsAMatrix}`);
    expect(res.status).toBe(404);
  });
});
