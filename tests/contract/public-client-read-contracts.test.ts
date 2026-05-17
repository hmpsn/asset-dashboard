import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from '../integration/helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { createClientUser, deleteClientUser, signClientToken } from '../../server/client-users.js';
import { createContentRequest } from '../../server/content-requests.js';
import { createMatrix, updateMatrixCell } from '../../server/content-matrices.js';
import { createBatch } from '../../server/approvals.js';
import { createClientAction } from '../../server/client-actions.js';
import { deleteSchemaPlan, saveSchemaPlan } from '../../server/schema-store.js';
import type { SchemaSitePlan } from '../../shared/types/schema-plan.ts';
import db from '../../server/db/index.js';

const ctx = createTestContext(13227);
const { api, clearCookies } = ctx;

let workspaceAId = '';
let workspaceASiteId = '';
let workspaceBId = '';
let workspaceBSiteId = '';
let clientAId = '';
let clientBId = '';
let clientAToken = '';
let clientBToken = '';
const cleanups: Array<() => void> = [];

function cookieForWorkspace(workspaceId: string, token: string): string {
  return `client_user_token_${workspaceId}=${token}`;
}

async function getWithClientToken(urlPath: string, workspaceId: string, token: string): Promise<Response> {
  clearCookies();
  return api(urlPath, {
    headers: {
      Cookie: cookieForWorkspace(workspaceId, token),
    },
  });
}

function buildSchemaPlan(workspaceId: string, siteId: string): SchemaSitePlan {
  const now = new Date().toISOString();
  return {
    id: `schema-plan-contract-${siteId}`,
    workspaceId,
    siteId,
    siteUrl: 'https://example.test',
    canonicalEntities: [],
    pageRoles: [{
      pagePath: '/',
      pageTitle: 'Home',
      role: 'homepage',
      primaryType: 'WebPage',
      entityRefs: [],
    }],
    status: 'sent_to_client',
    generatedAt: now,
    updatedAt: now,
  };
}

beforeAll(async () => {
  await ctx.startServer();

  const wsA = seedWorkspace({ tier: 'growth', clientPassword: 'contract-shared-password' });
  workspaceAId = wsA.workspaceId;
  workspaceASiteId = wsA.webflowSiteId;
  cleanups.push(wsA.cleanup);

  const wsB = seedWorkspace({ tier: 'growth', clientPassword: 'contract-shared-password-b' });
  workspaceBId = wsB.workspaceId;
  workspaceBSiteId = wsB.webflowSiteId;
  cleanups.push(wsB.cleanup);

  const clientA = await createClientUser(
    'contracts-client-a@test.local',
    'ClientPass1!',
    'Contracts Client A',
    workspaceAId,
    'client_member',
  );
  const clientB = await createClientUser(
    'contracts-client-b@test.local',
    'ClientPass1!',
    'Contracts Client B',
    workspaceBId,
    'client_member',
  );
  clientAId = clientA.id;
  clientBId = clientB.id;
  clientAToken = signClientToken(clientA);
  clientBToken = signClientToken(clientB);

  createContentRequest(workspaceAId, {
    topic: 'Contract test content request',
    targetKeyword: 'contract test keyword',
    intent: 'informational',
    priority: 'medium',
    rationale: 'Seeded for public contract assertions',
    clientNote: 'Please prioritize this topic',
  });

  const matrix = createMatrix(workspaceAId, {
    name: 'Contract Matrix',
    templateId: 'tpl_contract_matrix',
    dimensions: [{ variableName: 'service', values: ['orthodontics'] }],
    urlPattern: '/services/{service}',
    keywordPattern: '{service} services',
  });
  updateMatrixCell(workspaceAId, matrix.id, matrix.cells[0].id, { status: 'review' });

  saveSchemaPlan(buildSchemaPlan(workspaceAId, workspaceASiteId));

  createBatch(workspaceAId, workspaceASiteId, 'Contract Approval Batch', [{
    pageId: 'page-contract',
    pageTitle: 'Contract Page',
    pageSlug: 'contract-page',
    field: 'seoTitle',
    currentValue: 'Old SEO Title',
    proposedValue: 'New SEO Title',
  }]);

  createClientAction({
    workspaceId: workspaceAId,
    sourceType: 'content_decay',
    sourceId: 'contract-decay-source',
    title: 'Refresh decaying page',
    summary: 'Traffic dropped materially for this page',
    payload: { targetKeyword: 'contract test keyword' },
    priority: 'high',
  });
}, 40_000);

afterAll(async () => {
  if (clientAId) {
    deleteClientUser(clientAId, workspaceAId);
  }
  if (clientBId) {
    deleteClientUser(clientBId, workspaceBId);
  }
  deleteSchemaPlan(workspaceASiteId);
  deleteSchemaPlan(workspaceBSiteId);
  db.prepare('DELETE FROM activity_log WHERE workspace_id IN (?, ?)').run(workspaceAId, workspaceBId);
  db.prepare('DELETE FROM approval_batches WHERE workspace_id IN (?, ?)').run(workspaceAId, workspaceBId);
  db.prepare('DELETE FROM content_matrices WHERE workspace_id IN (?, ?)').run(workspaceAId, workspaceBId);
  db.prepare('DELETE FROM content_topic_requests WHERE workspace_id IN (?, ?)').run(workspaceAId, workspaceBId);
  db.prepare('DELETE FROM client_actions WHERE workspace_id IN (?, ?)').run(workspaceAId, workspaceBId);
  for (const cleanup of cleanups) {
    cleanup();
  }
  await ctx.stopServer();
});

describe('public/client read auth boundary contracts', () => {
  it('requires auth for protected endpoints', async () => {
    clearCookies();
    expect((await api(`/api/public/content-requests/${workspaceAId}`)).status).toBe(401);
    expect((await api(`/api/public/content-plan/${workspaceAId}`)).status).toBe(401);
    expect((await api(`/api/public/schema-plan/${workspaceAId}`)).status).toBe(401);
    expect((await api(`/api/public/approvals/${workspaceAId}`)).status).toBe(401);
    expect((await api(`/api/public/client-actions/${workspaceAId}`)).status).toBe(401);
  });

  it('rejects cross-workspace client token on representative protected endpoint', async () => {
    const res = await getWithClientToken(
      `/api/public/client-actions/${workspaceAId}`,
      workspaceBId,
      clientBToken,
    );
    expect(res.status).toBe(401);
  });
});

describe('GET /api/public/content-requests/:workspaceId contract', () => {
  it('returns client-safe fields and omits admin-only fields', async () => {
    const res = await getWithClientToken(`/api/public/content-requests/${workspaceAId}`, workspaceAId, clientAToken);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<Record<string, unknown>>;
    expect(body.length).toBeGreaterThan(0);
    const item = body[0];
    expect(item).toHaveProperty('id');
    expect(item).toHaveProperty('topic');
    expect(item).toHaveProperty('targetKeyword');
    expect(item).toHaveProperty('status');
    expect(item).toHaveProperty('serviceType');
    expect(item).toHaveProperty('comments');
    expect(item).not.toHaveProperty('rationale');
    expect(item).not.toHaveProperty('internalNote');
    expect(item).not.toHaveProperty('workspaceId');
  });

  it('returns 404 for missing workspace', async () => {
    const res = await getWithClientToken('/api/public/content-requests/ws_contract_missing', workspaceAId, clientAToken);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Workspace not found' });
  });
});

describe('GET /api/public/content-plan/:workspaceId contract', () => {
  it('returns client-safe matrix + cell fields', async () => {
    const res = await getWithClientToken(`/api/public/content-plan/${workspaceAId}`, workspaceAId, clientAToken);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<Record<string, unknown>>;
    expect(body.length).toBe(1);
    const matrix = body[0];
    expect(matrix).toHaveProperty('id');
    expect(matrix).toHaveProperty('name');
    expect(matrix).toHaveProperty('stats');
    expect(matrix).toHaveProperty('dimensions');
    expect(matrix).toHaveProperty('cells');
    expect(matrix).not.toHaveProperty('templateId');
    expect(matrix).not.toHaveProperty('workspaceId');

    const cells = matrix.cells as Array<Record<string, unknown>>;
    expect(cells.length).toBeGreaterThan(0);
    expect(cells[0]).toHaveProperty('targetKeyword');
    expect(cells[0]).toHaveProperty('status');
    expect(cells[0]).not.toHaveProperty('briefId');
    expect(cells[0]).not.toHaveProperty('postId');
  });

  it('returns 404 for missing workspace', async () => {
    const res = await getWithClientToken('/api/public/content-plan/ws_contract_missing', workspaceAId, clientAToken);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/public/schema-plan/:workspaceId contract', () => {
  it('returns expected public schema plan shape', async () => {
    const res = await getWithClientToken(`/api/public/schema-plan/${workspaceAId}`, workspaceAId, clientAToken);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.siteId).toBe(workspaceASiteId);
    expect(body.workspaceId).toBe(workspaceAId);
    expect(body.status).toBe('sent_to_client');
    expect(body).toHaveProperty('pageRoles');
    expect(body).not.toHaveProperty('webflowToken');
    expect(body).not.toHaveProperty('clientPassword');
  });

  it('returns 404 for missing workspace/site link', async () => {
    const res = await getWithClientToken('/api/public/schema-plan/ws_contract_missing', workspaceAId, clientAToken);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/public/approvals/:workspaceId contract', () => {
  it('returns expected approval-batch list shape', async () => {
    const res = await getWithClientToken(`/api/public/approvals/${workspaceAId}`, workspaceAId, clientAToken);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<Record<string, unknown>>;
    expect(body.length).toBe(1);
    const batch = body[0];
    expect(batch).toHaveProperty('id');
    expect(batch).toHaveProperty('name');
    expect(batch).toHaveProperty('status');
    expect(batch).toHaveProperty('items');
    expect(batch).not.toHaveProperty('clientPassword');
  });

  it('returns 200 with empty array for missing workspace', async () => {
    const res = await getWithClientToken('/api/public/approvals/ws_contract_missing', workspaceAId, clientAToken);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual([]);
  });
});

describe('GET /api/public/client-actions/:workspaceId contract', () => {
  it('returns expected client-action list shape', async () => {
    const res = await getWithClientToken(`/api/public/client-actions/${workspaceAId}`, workspaceAId, clientAToken);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<Record<string, unknown>>;
    expect(body.length).toBe(1);
    const action = body[0];
    expect(action).toHaveProperty('id');
    expect(action).toHaveProperty('sourceType');
    expect(action).toHaveProperty('title');
    expect(action).toHaveProperty('summary');
    expect(action).toHaveProperty('status');
    expect(action).toHaveProperty('priority');
    expect(action).not.toHaveProperty('passwordHash');
  });

  it('returns 200 with empty array for missing workspace', async () => {
    const res = await getWithClientToken('/api/public/client-actions/ws_contract_missing', workspaceAId, clientAToken);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual([]);
  });
});
