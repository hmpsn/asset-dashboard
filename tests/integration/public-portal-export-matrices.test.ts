/**
 * I1 — Public matrices export route for client portal
 *
 * Tests GET /api/public/export/:workspaceId/matrices?format=csv|json
 *
 * Auth matrix:
 *   (a) client JWT cookie for workspace A       → 200 with CSV/JSON body
 *   (b) no credential + password-set workspace  → 401
 *   (c) admin HMAC x-auth-token                → 200 (admin can always export)
 *   (d) client JWT for workspace B against A   → 401 (cross-workspace isolation)
 *   (e) passwordless workspace + no credential → 200 (preserved)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { createClientUser, deleteClientUser, signClientToken } from '../../server/client-users.js';
import { deleteWorkspace } from '../../server/workspaces.js';
import { createMatrix } from '../../server/content-matrices.js';
import crypto from 'crypto';

const ctx = createEphemeralTestContext(import.meta.url);

let wsA = { workspaceId: '', cleanup: () => {} };
let wsB = { workspaceId: '', cleanup: () => {} };
let wsNoPass = { workspaceId: '', cleanup: () => {} };

let clientUserIdA = '';
let clientTokenA = '';
let clientTokenB = '';

const SESSION_SECRET =
  process.env.SESSION_SECRET ?? 'asset-dashboard-test-session-secret';
const adminHmacToken = crypto
  .createHmac('sha256', SESSION_SECRET)
  .update('admin')
  .digest('hex');

async function getWithCookie(path: string, cookieValue: string): Promise<Response> {
  ctx.clearCookies();
  return ctx.api(path, {
    headers: { Cookie: cookieValue, 'x-no-auto-public-auth': 'true' },
  });
}

async function getUnauthenticated(path: string): Promise<Response> {
  ctx.clearCookies();
  return ctx.api(path, { headers: { 'x-no-auto-public-auth': 'true' } });
}

async function getAsAdmin(path: string): Promise<Response> {
  ctx.clearCookies();
  return ctx.api(path, {
    headers: { 'x-auth-token': adminHmacToken, 'x-no-auto-public-auth': 'true' },
  });
}

beforeAll(async () => {
  await ctx.startServer();

  wsA = seedWorkspace();
  wsB = seedWorkspace();
  wsNoPass = seedWorkspace({ clientPassword: '' });

  // Create one matrix in wsA so the export returns rows
  createMatrix(wsA.workspaceId, {
    name: 'Export Test Matrix',
    templateId: 'tpl-export-test',
    dimensions: [{ variableName: 'service', values: ['Audit'] }],
    urlPattern: '/services/{service}',
    keywordPattern: '{service} audit',
  });

  const userA = await createClientUser(
    'client-export-a@test.local',
    'test-password-a',
    'Export Client A',
    wsA.workspaceId,
    'client_member',
  );
  clientUserIdA = userA.id;
  clientTokenA = signClientToken(userA);

  const userB = await createClientUser(
    'client-export-b@test.local',
    'test-password-b',
    'Export Client B',
    wsB.workspaceId,
    'client_member',
  );
  clientTokenB = signClientToken(userB);
}, 40_000);

afterAll(async () => {
  if (clientUserIdA) deleteClientUser(clientUserIdA, wsA.workspaceId);
  wsA.cleanup();
  wsB.cleanup();
  wsNoPass.cleanup();
  if (wsB.workspaceId) deleteWorkspace(wsB.workspaceId);
  await ctx.stopServer();
});

describe('GET /api/public/export/:workspaceId/matrices', () => {
  const csvPath = (wsId: string) => `/api/public/export/${wsId}/matrices?format=csv`;
  const jsonPath = (wsId: string) => `/api/public/export/${wsId}/matrices?format=json`;

  it('(a) returns CSV with matrix headers when client JWT cookie is valid', async () => {
    const res = await getWithCookie(
      csvPath(wsA.workspaceId),
      `client_user_token_${wsA.workspaceId}=${clientTokenA}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const body = await res.text();
    // CSV header row must include canonical column names
    expect(body).toContain('matrixId');
    expect(body).toContain('targetKeyword');
    expect(body).toContain('status');
  });

  it('(a) returns JSON when client JWT cookie is valid and format=json', async () => {
    const res = await getWithCookie(
      jsonPath(wsA.workspaceId),
      `client_user_token_${wsA.workspaceId}=${clientTokenA}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });

  it('(b) returns 401 when no credential and workspace has clientPassword', async () => {
    const res = await getUnauthenticated(csvPath(wsA.workspaceId));
    expect(res.status).toBe(401);
  });

  it('(c) admin HMAC token → 200 (admin can always export)', async () => {
    const res = await getAsAdmin(csvPath(wsA.workspaceId));
    expect(res.status).toBe(200);
  });

  it('(d) client JWT for workspace B rejected against workspace A (cross-workspace isolation)', async () => {
    const res = await getWithCookie(
      csvPath(wsA.workspaceId),
      `client_user_token_${wsB.workspaceId}=${clientTokenB}`,
    );
    expect(res.status).toBe(401);
  });

  it('(e) passwordless workspace accessible without any credential', async () => {
    const res = await getUnauthenticated(csvPath(wsNoPass.workspaceId));
    expect(res.status).toBe(200);
  });
});
