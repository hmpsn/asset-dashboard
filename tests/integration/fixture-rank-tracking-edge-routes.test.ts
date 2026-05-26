import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13765);
const { api } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Fixture Rank Tracking Edge').id;
});

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
