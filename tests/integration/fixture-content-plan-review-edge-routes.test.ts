import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { createMatrix, updateMatrixCell } from '../../server/content-matrices.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api, postJson } = ctx;

let openWs = '';
let protectedWs = '';
let openMatrixId = '';
let openCellId = '';
let protectedMatrixId = '';
let protectedCellId = '';

beforeAll(async () => {
  await ctx.startServer();
  openWs = createWorkspace('Fixture Content Plan Edge Open').id;
  protectedWs = createWorkspace('Fixture Content Plan Edge Protected').id;
  updateWorkspace(protectedWs, { clientPassword: 'plan-edge-pass' });

  const openMatrix = createMatrix(openWs, {
    name: 'Open Plan',
    templateId: 'tpl_fixture_plan_edge',
    dimensions: [{ variableName: 'service', values: ['audit'] }],
    urlPattern: '/services/{service}',
    keywordPattern: '{service} services',
  });
  openMatrixId = openMatrix.id;
  openCellId = openMatrix.cells[0].id;
  updateMatrixCell(openWs, openMatrixId, openCellId, { status: 'review' });

  const protectedMatrix = createMatrix(protectedWs, {
    name: 'Protected Plan',
    templateId: 'tpl_fixture_plan_edge',
    dimensions: [{ variableName: 'service', values: ['audit'] }],
    urlPattern: '/services/{service}',
    keywordPattern: '{service} services',
  });
  protectedMatrixId = protectedMatrix.id;
  protectedCellId = protectedMatrix.cells[0].id;
  updateMatrixCell(protectedWs, protectedMatrixId, protectedCellId, { status: 'review' });
});

afterAll(async () => {
  deleteWorkspace(openWs);
  deleteWorkspace(protectedWs);
  await ctx.stopServer();
});

describe('Fixture content-plan review edge routes', () => {
  it('requires auth for protected workspace list', async () => {
    const res = await api(`/api/public/content-plan/${protectedWs}`, {
      headers: { 'x-no-auto-public-auth': 'true' },
    });
    expect(res.status).toBe(401);
  });

  it('allows open workspace flag flow and validates missing comment payload', async () => {
    const bad = await postJson(`/api/public/content-plan/${openWs}/${openMatrixId}/cells/${openCellId}/flag`, {});
    expect(bad.status).toBe(400);

    const ok = await postJson(`/api/public/content-plan/${openWs}/${openMatrixId}/cells/${openCellId}/flag`, {
      comment: 'Please revise heading',
    });
    expect(ok.status).toBe(200);
  });

  it('returns 404 for unknown matrix id in open workspace', async () => {
    const res = await api(`/api/public/content-plan/${openWs}/mtx_fixture_missing`);
    expect(res.status).toBe(404);
  });
});
