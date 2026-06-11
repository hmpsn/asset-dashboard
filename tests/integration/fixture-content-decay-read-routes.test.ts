import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13734, { autoPublicAuth: true });
const { api, postJson } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Fixture Content Decay').id;
});

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Fixture content decay read routes', () => {
  it('returns null for fresh workspace reads', async () => {
    const adminRead = await api(`/api/content-decay/${wsId}`);
    expect(adminRead.status).toBe(200);
    await expect(adminRead.json()).resolves.toBeNull();

    const publicRead = await api(`/api/public/content-decay/${wsId}`);
    expect(publicRead.status).toBe(200);
    await expect(publicRead.json()).resolves.toBeNull();
  });

  it('returns 404 for unknown workspace mutation endpoints', async () => {
    const analyze = await postJson('/api/content-decay/ws_fixture_decay_missing/analyze', {});
    expect(analyze.status).toBe(404);

    const recs = await postJson('/api/content-decay/ws_fixture_decay_missing/recommendations', {});
    expect(recs.status).toBe(404);
  });

  it('requires existing analysis before recommendations', async () => {
    const res = await postJson(`/api/content-decay/${wsId}/recommendations`, {});
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual(expect.objectContaining({ error: 'Run decay analysis first' }));
  });
});
