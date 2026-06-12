import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api, postJson } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Fixture Requests Edge').id;
});

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Fixture requests edge routes', () => {
  it('rejects missing required create fields', async () => {
    const empty = await postJson('/api/requests', {});
    expect(empty.status).toBe(400);

    const missingWs = await postJson('/api/requests', { title: 't', description: 'd' });
    expect(missingWs.status).toBe(400);
  });

  it('creates request and returns it by id', async () => {
    const create = await postJson('/api/requests', {
      workspaceId: wsId,
      title: 'Fixture admin request',
      description: 'Need content update',
      category: 'content',
    });
    expect(create.status).toBe(200);
    const body = await create.json() as { id: string };

    const read = await api(`/api/requests/${body.id}`);
    expect(read.status).toBe(200);
  });

  it('returns 404 for unknown request id', async () => {
    const res = await api('/api/requests/req_fixture_missing_edge');
    expect(res.status).toBe(404);
  });
});
