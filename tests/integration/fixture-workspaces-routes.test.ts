import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13747);
const { api, postJson, patchJson, del } = ctx;

let wsId = '';

afterAll(async () => {
  if (wsId) {
    await del(`/api/workspaces/${wsId}`);
  }
  await ctx.stopServer();
});

beforeAll(async () => {
  await ctx.startServer();
});

describe('Fixture workspaces routes', () => {
  it('rejects workspace creation without name', async () => {
    const res = await postJson('/api/workspaces', {});
    expect(res.status).toBe(400);
  });

  it('creates, patches, reads, and deletes a workspace', async () => {
    const create = await postJson('/api/workspaces', { name: 'Fixture Workspace CRUD' });
    expect(create.status).toBe(200);
    const created = await create.json() as { id: string; name: string };
    wsId = created.id;

    const patch = await patchJson(`/api/workspaces/${wsId}`, { name: 'Fixture Workspace Updated' });
    expect(patch.status).toBe(200);

    const read = await api(`/api/workspaces/${wsId}`);
    expect(read.status).toBe(200);
    const body = await read.json() as { name: string };
    expect(body.name).toBe('Fixture Workspace Updated');

    const remove = await del(`/api/workspaces/${wsId}`);
    expect(remove.status).toBe(200);
    wsId = '';
  });

  it('returns 404 for unknown workspace id reads', async () => {
    const res = await api('/api/workspaces/ws_fixture_missing');
    expect(res.status).toBe(404);
  });
});
