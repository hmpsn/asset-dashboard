/**
 * Integration tests for content-matrices API endpoints.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/content-matrices/:workspaceId (list)
 * - POST /api/content-matrices/:workspaceId (create)
 * - GET /api/content-matrices/:workspaceId/:matrixId (get)
 * - PUT /api/content-matrices/:workspaceId/:matrixId (update)
 * - PATCH /api/content-matrices/:workspaceId/:matrixId/cells/:cellId (update cell)
 * - DELETE /api/content-matrices/:workspaceId/:matrixId (delete)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13241);
const { api, postJson, del } = ctx;

let testWsId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Content Matrices Test');
  testWsId = ws.id;
}, 25_000);

afterAll(() => {
  deleteWorkspace(testWsId);
  ctx.stopServer();
});

describe('Content Matrices — CRUD', () => {
  let matrixId = '';
  let firstCellId = '';

  it('GET returns empty array initially', async () => {
    const res = await api(`/api/content-matrices/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it('POST without name returns 400', async () => {
    const res = await postJson(`/api/content-matrices/${testWsId}`, {});
    expect(res.status).toBe(400);
  });

  it('POST without templateId returns 400', async () => {
    const res = await postJson(`/api/content-matrices/${testWsId}`, { name: 'Test' });
    expect(res.status).toBe(400);
  });

  it('POST creates a matrix with auto-generated cells', async () => {
    const res = await postJson(`/api/content-matrices/${testWsId}`, {
      name: 'Service × City Matrix',
      templateId: 'tpl_fake_123',
      dimensions: [
        { variableName: 'service', values: ['Plumbing', 'Electrical'] },
        { variableName: 'city', values: ['Austin', 'Dallas', 'Houston'] },
      ],
      urlPattern: '/services/{city}/{service}',
      keywordPattern: '{service} in {city}',
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/^mtx_/);
    expect(body.name).toBe('Service × City Matrix');
    expect(body.templateId).toBe('tpl_fake_123');
    expect(body.dimensions).toHaveLength(2);
    // 2 services × 3 cities = 6 cells
    expect(body.cells).toHaveLength(6);
    expect(body.stats.total).toBe(6);
    expect(body.stats.planned).toBe(6);

    // Verify cell content
    const austinPlumbing = body.cells.find(
      (c: { targetKeyword: string }) => c.targetKeyword === 'Plumbing in Austin',
    );
    expect(austinPlumbing).toBeDefined();
    expect(austinPlumbing.plannedUrl).toBe('/services/austin/plumbing');
    expect(austinPlumbing.status).toBe('planned');

    matrixId = body.id;
    firstCellId = body.cells[0].id;
  });

  it('GET returns the created matrix in list', async () => {
    const res = await api(`/api/content-matrices/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBe(1);
    expect(body[0].id).toBe(matrixId);
  });

  it('GET by ID returns the matrix with all cells', async () => {
    const res = await api(`/api/content-matrices/${testWsId}/${matrixId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(matrixId);
    expect(body.cells).toHaveLength(6);
  });

  it('GET by non-existent ID returns 404', async () => {
    const res = await api(`/api/content-matrices/${testWsId}/mtx_nonexistent`);
    expect(res.status).toBe(404);
  });

  it('PUT updates matrix name', async () => {
    const res = await ctx.api(`/api/content-matrices/${testWsId}/${matrixId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Service × City Matrix (v2)' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Service × City Matrix (v2)');
    // Cells should be preserved
    expect(body.cells).toHaveLength(6);
  });

  it('PATCH cell updates status and keyword', async () => {
    const res = await ctx.api(
      `/api/content-matrices/${testWsId}/${matrixId}/cells/${firstCellId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'keyword_validated',
          keywordValidation: {
            volume: 1200,
            difficulty: 35,
            cpc: 2.50,
            validatedAt: new Date().toISOString(),
          },
        }),
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const updatedCell = body.cells.find((c: { id: string }) => c.id === firstCellId);
    expect(updatedCell.status).toBe('keyword_validated');
    expect(updatedCell.keywordValidation.volume).toBe(1200);
    // keyword_validated still counts as 'planned' in stats
    expect(body.stats.planned).toBe(6);
  });

  it('PATCH non-existent cell returns 404', async () => {
    const res = await ctx.api(
      `/api/content-matrices/${testWsId}/${matrixId}/cells/cell_nonexistent`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'draft' }),
      },
    );
    expect(res.status).toBe(404);
  });

  it('DELETE removes the matrix', async () => {
    const res = await del(`/api/content-matrices/${testWsId}/${matrixId}`);
    expect(res.status).toBe(200);

    const listRes = await api(`/api/content-matrices/${testWsId}`);
    const list = await listRes.json();
    expect(list.length).toBe(0);
  });

  it('DELETE non-existent returns 404', async () => {
    const res = await del(`/api/content-matrices/${testWsId}/mtx_nonexistent`);
    expect(res.status).toBe(404);
  });
});
