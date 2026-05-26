import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13739);
const { api } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Fixture Intelligence').id;
});

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Fixture intelligence routes', () => {
  it('returns health object with caches', async () => {
    const res = await api('/api/intelligence/health');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(expect.objectContaining({ caches: expect.any(Object) }));
  });

  it('returns intelligence object for known workspace and valid slice filter', async () => {
    const res = await api(`/api/intelligence/${wsId}?slices=seoContext,insights`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('seoContext');
    expect(body).toHaveProperty('insights');
  });

  it('unknown workspace does not hard-crash (200/500 accepted)', async () => {
    const res = await api('/api/intelligence/ws_fixture_intel_missing');
    expect([200, 500]).toContain(res.status);
  });
});
