import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13762);
const { api, postJson, patchJson, del } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
});

afterAll(async () => {
  if (wsId) await del(`/api/workspaces/${wsId}`);
  await ctx.stopServer();
});

describe('Fixture workspaces edge routes', () => {
  it('create requires name', async () => {
    const bad = await postJson('/api/workspaces', {});
    expect(bad.status).toBe(400);
  });

  it('create/update/delete lifecycle works', async () => {
    const create = await postJson('/api/workspaces', { name: 'Edge Workspace' });
    expect(create.status).toBe(200);
    const created = await create.json() as { id: string };
    wsId = created.id;

    const patch = await patchJson(`/api/workspaces/${wsId}`, { name: 'Edge Workspace Updated' });
    expect(patch.status).toBe(200);

    const read = await api(`/api/workspaces/${wsId}`);
    expect(read.status).toBe(200);

    const remove = await del(`/api/workspaces/${wsId}`);
    expect(remove.status).toBe(200);
    wsId = '';
  });

  it('unknown workspace read returns 404', async () => {
    const res = await api('/api/workspaces/ws_fixture_unknown_edge');
    expect(res.status).toBe(404);
  });
});
