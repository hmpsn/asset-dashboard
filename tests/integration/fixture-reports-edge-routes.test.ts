import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api, postJson } = ctx;

let wsId = '';
let siteId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Fixture Reports Edge').id;
  siteId = `fixture_reports_edge_${Date.now()}`;
  updateWorkspace(wsId, { webflowSiteId: siteId });
});

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Fixture reports edge routes', () => {
  it('snapshot create validates missing audit payload', async () => {
    const res = await postJson(`/api/reports/${siteId}/snapshot`, { siteName: 'No audit' });
    expect(res.status).toBe(400);
  });

  it('unknown snapshot id returns 404', async () => {
    const res = await api('/api/reports/snapshot/snap_fixture_reports_missing');
    expect(res.status).toBe(404);
  });

  it('history endpoint returns array for known site', async () => {
    const res = await api(`/api/reports/${siteId}/history`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(expect.any(Array));
  });
});
