import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api, postJson } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Fixture Rank Tracking Edge').id;
  // Public rank-tracking endpoints now require authenticated portal access
  // (sprint-platform-health-wave8 Plan A Task 1). Seed password + login.
  updateWorkspace(wsId, { clientPassword: 'test-password' });
  const authRes = await postJson(`/api/public/auth/${wsId}`, { password: 'test-password' });
  expect(authRes.status).toBe(200);
}, 30_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Fixture rank-tracking edge routes', () => {
  it('history rejects invalid limit', async () => {
    const res = await api(`/api/rank-tracking/${wsId}/history?limit=zero`);
    expect(res.status).toBe(400);
  });

  it('public history rejects invalid limit', async () => {
    const res = await api(`/api/public/rank-tracking/${wsId}/history?limit=0`);
    expect(res.status).toBe(400);
  });

  it('unknown workspace keywords returns empty list', async () => {
    const res = await api('/api/rank-tracking/ws_fixture_rank_edge_missing/keywords');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual([]);
  });
});
