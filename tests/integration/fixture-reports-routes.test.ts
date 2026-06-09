import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { createClientUser, deleteClientUser, signClientToken } from '../../server/client-users.js';

const ctx = createTestContext(13741);
const { api } = ctx;

let wsId = '';
let siteId = '';
let clientUserId = '';
let clientToken = '';

function clientCookieHeader(): string {
  return `client_user_token_${wsId}=${clientToken}`;
}

async function getWithClientToken(urlPath: string): Promise<Response> {
  ctx.clearCookies();
  return api(urlPath, {
    headers: {
      Cookie: clientCookieHeader(),
    },
  });
}

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Fixture Reports').id;
  siteId = `fixture_site_${Date.now()}`;
  updateWorkspace(wsId, { webflowSiteId: siteId });
  const clientUser = await createClientUser(
    'fixture-reports-client@test.local',
    'ClientPass1!',
    'Fixture Reports Client',
    wsId,
  );
  clientUserId = clientUser.id;
  clientToken = signClientToken(clientUser);
});

afterAll(async () => {
  if (clientUserId) deleteClientUser(clientUserId, wsId);
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Fixture reports routes', () => {
  it('returns history array and null latest for fresh site', async () => {
    const history = await api(`/api/reports/${siteId}/history`);
    expect(history.status).toBe(200);
    await expect(history.json()).resolves.toEqual(expect.any(Array));

    const latest = await api(`/api/reports/${siteId}/latest`);
    expect(latest.status).toBe(200);
    await expect(latest.json()).resolves.toBeNull();
  });

  it('returns 404 for unknown snapshot id endpoints', async () => {
    const snap = await api('/api/reports/snapshot/snap_fixture_missing');
    expect(snap.status).toBe(404);

    const publicSnap = await api('/api/public/report/snap_fixture_missing');
    expect(publicSnap.status).toBe(404);
  });

  it('returns public report list for workspace', async () => {
    const res = await getWithClientToken(`/api/public/reports/${wsId}`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(expect.any(Array));
  });
});
