import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13736);
const { api } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Fixture Page Strategy').id;
});

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Fixture page strategy read routes', () => {
  it('returns defaults for known and unknown page types', async () => {
    const service = await api('/api/page-strategy/section-plan-defaults/service');
    expect(service.status).toBe(200);
    const serviceBody = await service.json() as Array<unknown>;
    expect(serviceBody.length).toBeGreaterThan(0);

    const fallback = await api('/api/page-strategy/section-plan-defaults/unknown-type');
    expect(fallback.status).toBe(200);
    const fallbackBody = await fallback.json() as Array<unknown>;
    expect(fallbackBody.length).toBeGreaterThan(0);
  });

  it('returns list shape for workspace blueprints', async () => {
    const res = await api(`/api/page-strategy/${wsId}`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(expect.any(Array));
  });

  it('returns 404 for unknown blueprint id within valid workspace', async () => {
    const res = await api(`/api/page-strategy/${wsId}/bp_fixture_missing`);
    expect(res.status).toBe(404);
  });
});
