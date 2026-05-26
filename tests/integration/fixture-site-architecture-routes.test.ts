import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13743);
const { api } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Fixture Site Architecture').id;
});

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Fixture site architecture routes', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/site-architecture/ws_fixture_arch_missing');
    expect(res.status).toBe(404);
  });

  it('returns tree object for fresh workspace', async () => {
    const res = await api(`/api/site-architecture/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { tree: { path: string; children: unknown[] } };
    expect(body.tree.path).toBe('/');
    expect(Array.isArray(body.tree.children)).toBe(true);
  });

  it('returns 404 schema coverage when workspace has no linked site id', async () => {
    const res = await api(`/api/site-architecture/${wsId}/schema-coverage`);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual(expect.objectContaining({ error: expect.any(String) }));
  });
});
