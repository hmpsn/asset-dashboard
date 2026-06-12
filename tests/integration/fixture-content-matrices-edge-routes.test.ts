import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api, postJson } = ctx;

let wsId = '';
let matrixId = '';
let cellId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Fixture Matrices Edge').id;
  const create = await postJson(`/api/content-matrices/${wsId}`, {
    name: 'Edge Matrix',
    templateId: 'tpl_fixture_matrices_edge',
    dimensions: [{ variableName: 'city', values: ['Austin'] }],
    urlPattern: '/service/{city}',
    keywordPattern: 'service in {city}',
  });
  const body = await create.json();
  matrixId = body.id;
  cellId = body.cells[0].id;
});

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Fixture content matrices edge routes', () => {
  it('validates unknown matrix and cell ids', async () => {
    const matrixRes = await api(`/api/content-matrices/${wsId}/mtx_missing_edge`);
    expect(matrixRes.status).toBe(404);

    const cellRes = await ctx.patchJson(`/api/content-matrices/${wsId}/${matrixId}/cells/cell_missing_edge`, {
      status: 'review',
    });
    expect(cellRes.status).toBe(404);
  });

  it('rejects malformed recommend-keywords payload', async () => {
    const res = await postJson(`/api/content-matrices/${wsId}/recommend-keywords`, {
      topic: '',
      pageType: 'unknown',
    });
    expect(res.status).toBe(400);
  });

  it('returns detail for created matrix and includes cell id', async () => {
    const res = await api(`/api/content-matrices/${wsId}/${matrixId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cells.some((c: { id: string }) => c.id === cellId)).toBe(true);
  });
});
