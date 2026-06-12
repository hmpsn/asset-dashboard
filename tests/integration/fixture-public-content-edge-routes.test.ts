import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api, postJson } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Fixture Public Content Edge').id;
});

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Fixture public-content edge routes', () => {
  it('returns 404 for unknown workspace reads', async () => {
    const strategy = await api('/api/public/seo-strategy/ws_fixture_pc_missing');
    expect(strategy.status).toBe(404);
  });

  it('validates content-request submit payload', async () => {
    const bad = await postJson(`/api/public/content-request/${wsId}/submit`, {});
    expect(bad.status).toBe(400);
  });

  it('tracked-keywords route returns contract', async () => {
    const res = await api(`/api/public/tracked-keywords/${wsId}`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(expect.objectContaining({ keywords: expect.any(Array) }));
  });
});
