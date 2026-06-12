import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Fixture Rank Tracking').id;
});

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Fixture rank tracking read routes', () => {
  it('returns arrays for fresh workspace endpoints', async () => {
    const keywords = await api(`/api/rank-tracking/${wsId}/keywords`);
    expect(keywords.status).toBe(200);
    await expect(keywords.json()).resolves.toEqual(expect.any(Array));

    const latest = await api(`/api/rank-tracking/${wsId}/latest`);
    expect(latest.status).toBe(200);
    await expect(latest.json()).resolves.toEqual(expect.any(Array));
  });

  it('rejects invalid history limit values', async () => {
    const res = await api(`/api/rank-tracking/${wsId}/history?limit=invalid`);
    expect(res.status).toBe(400);
  });

  it('returns empty array for unknown workspace keywords', async () => {
    const res = await api('/api/rank-tracking/ws_fixture_rank_missing/keywords');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual([]);
  });
});
