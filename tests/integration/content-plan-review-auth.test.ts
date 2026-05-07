import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { createMatrix, getMatrix, updateMatrixCell } from '../../server/content-matrices.js';
import db from '../../server/db/index.js';

const ctx = createTestContext(13351); // port-ok: 13201-13350 already allocated in integration suite
const { api, postJson, clearCookies } = ctx;

let workspaceId = '';
let matrixId = '';
let cellId = '';
let passwordlessWorkspaceId = '';
let passwordlessMatrixId = '';
let passwordlessCellId = '';
let otherProtectedWorkspaceId = '';
let otherProtectedMatrixId = '';
let otherProtectedCellId = '';

function createReviewMatrix(workspaceId: string, name: string) {
  const matrix = createMatrix(workspaceId, {
    name,
    templateId: 'tpl_content_plan_auth',
    dimensions: [{ variableName: 'service', values: ['Audit'] }],
    urlPattern: '/services/{service}',
    keywordPattern: '{service} services',
  });
  const cellId = matrix.cells[0].id;
  updateMatrixCell(workspaceId, matrix.id, cellId, { status: 'review' });
  return { matrixId: matrix.id, cellId };
}

function resetCell(workspaceId: string, matrixId: string, cellId: string): void {
  updateMatrixCell(workspaceId, matrixId, cellId, {
    status: 'review',
    clientFlag: undefined,
    clientFlaggedAt: undefined,
  });
}

beforeAll(async () => {
  await ctx.startServer();
  workspaceId = createWorkspace('Protected Content Plan Review Workspace').id;
  updateWorkspace(workspaceId, { clientPassword: 'content-plan-secret' });
  const protectedReview = createReviewMatrix(workspaceId, 'Protected Content Plan');
  matrixId = protectedReview.matrixId;
  cellId = protectedReview.cellId;

  passwordlessWorkspaceId = createWorkspace('Passwordless Content Plan Review Workspace').id;
  const passwordlessReview = createReviewMatrix(passwordlessWorkspaceId, 'Passwordless Content Plan');
  passwordlessMatrixId = passwordlessReview.matrixId;
  passwordlessCellId = passwordlessReview.cellId;

  otherProtectedWorkspaceId = createWorkspace('Other Protected Content Plan Review Workspace').id;
  updateWorkspace(otherProtectedWorkspaceId, { clientPassword: 'other-content-plan-secret' });
  const otherProtectedReview = createReviewMatrix(otherProtectedWorkspaceId, 'Other Protected Content Plan');
  otherProtectedMatrixId = otherProtectedReview.matrixId;
  otherProtectedCellId = otherProtectedReview.cellId;
}, 25_000);

beforeEach(() => {
  clearCookies();
  resetCell(workspaceId, matrixId, cellId);
  resetCell(passwordlessWorkspaceId, passwordlessMatrixId, passwordlessCellId);
  resetCell(otherProtectedWorkspaceId, otherProtectedMatrixId, otherProtectedCellId);
});

afterAll(async () => {
  db.prepare('DELETE FROM activity_log WHERE workspace_id IN (?, ?, ?)').run(workspaceId, passwordlessWorkspaceId, otherProtectedWorkspaceId);
  db.prepare('DELETE FROM content_matrices WHERE workspace_id IN (?, ?, ?)').run(workspaceId, passwordlessWorkspaceId, otherProtectedWorkspaceId);
  deleteWorkspace(workspaceId);
  deleteWorkspace(passwordlessWorkspaceId);
  deleteWorkspace(otherProtectedWorkspaceId);
  await ctx.stopServer();
});

describe('public content-plan review auth', () => {
  it('requires client auth before reading or flagging protected content-plan cells', async () => {
    const listRes = await api(`/api/public/content-plan/${workspaceId}`);
    expect(listRes.status).toBe(401);

    const detailRes = await api(`/api/public/content-plan/${workspaceId}/${matrixId}`);
    expect(detailRes.status).toBe(401);

    const flagRes = await postJson(`/api/public/content-plan/${workspaceId}/${matrixId}/cells/${cellId}/flag`, {
      comment: 'This unauthenticated flag should not persist.',
    });
    expect(flagRes.status).toBe(401);

    const beforeLoginCell = getMatrix(workspaceId, matrixId)?.cells.find(cell => cell.id === cellId);
    expect(beforeLoginCell?.status).toBe('review');
    expect(beforeLoginCell?.clientFlag).toBeUndefined();
    expect(beforeLoginCell?.clientFlaggedAt).toBeUndefined();

    const loginRes = await postJson(`/api/public/auth/${workspaceId}`, {
      password: 'content-plan-secret',
    });
    expect(loginRes.status).toBe(200);

    const authedListRes = await api(`/api/public/content-plan/${workspaceId}`);
    expect(authedListRes.status).toBe(200);
    const plans = await authedListRes.json();
    expect(plans).toHaveLength(1);
    expect(plans[0].cells[0]).toMatchObject({ id: cellId, status: 'review' });

    const authedFlagRes = await postJson(`/api/public/content-plan/${workspaceId}/${matrixId}/cells/${cellId}/flag`, {
      comment: 'Please revise this planned page.',
    });
    expect(authedFlagRes.status).toBe(200);

    const flaggedCell = getMatrix(workspaceId, matrixId)?.cells.find(cell => cell.id === cellId);
    expect(flaggedCell).toMatchObject({
      status: 'flagged',
      clientFlag: 'Please revise this planned page.',
    });
    expect(flaggedCell?.clientFlaggedAt).toEqual(expect.any(String));
  });

  it('allows passwordless content-plan review workspaces by URL', async () => {
    const listRes = await api(`/api/public/content-plan/${passwordlessWorkspaceId}`);
    expect(listRes.status).toBe(200);
    const plans = await listRes.json();
    expect(plans).toHaveLength(1);
    expect(plans[0].cells[0]).toMatchObject({ id: passwordlessCellId, status: 'review' });

    const flagRes = await postJson(`/api/public/content-plan/${passwordlessWorkspaceId}/${passwordlessMatrixId}/cells/${passwordlessCellId}/flag`, {
      comment: 'Passwordless workspace can still collect client feedback.',
    });
    expect(flagRes.status).toBe(200);

    const flaggedCell = getMatrix(passwordlessWorkspaceId, passwordlessMatrixId)?.cells.find(cell => cell.id === passwordlessCellId);
    expect(flaggedCell).toMatchObject({
      status: 'flagged',
      clientFlag: 'Passwordless workspace can still collect client feedback.',
    });
  });

  it('does not let one protected workspace session access another protected content plan', async () => {
    const loginRes = await postJson(`/api/public/auth/${workspaceId}`, {
      password: 'content-plan-secret',
    });
    expect(loginRes.status).toBe(200);

    const listRes = await api(`/api/public/content-plan/${otherProtectedWorkspaceId}`);
    expect(listRes.status).toBe(401);

    const flagRes = await postJson(`/api/public/content-plan/${otherProtectedWorkspaceId}/${otherProtectedMatrixId}/cells/${otherProtectedCellId}/flag`, {
      comment: 'This should not cross protected workspace boundaries.',
    });
    expect(flagRes.status).toBe(401);

    const otherCell = getMatrix(otherProtectedWorkspaceId, otherProtectedMatrixId)?.cells.find(cell => cell.id === otherProtectedCellId);
    expect(otherCell?.status).toBe('review');
    expect(otherCell?.clientFlag).toBeUndefined();
    expect(otherCell?.clientFlaggedAt).toBeUndefined();
  });
});
