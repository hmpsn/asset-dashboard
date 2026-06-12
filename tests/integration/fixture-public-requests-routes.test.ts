import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api, postJson } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Fixture Public Requests').id;
});

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Fixture public requests routes', () => {
  it('returns 404 for unknown workspace list', async () => {
    const res = await api('/api/public/requests/ws_fixture_requests_missing');
    expect(res.status).toBe(404);
  });

  it('rejects invalid request payloads', async () => {
    const badCategory = await postJson(`/api/public/requests/${wsId}`, {
      title: 'Bad category',
      description: 'Payload',
      category: 'billing',
    });
    expect(badCategory.status).toBe(400);

    const missingTitle = await postJson(`/api/public/requests/${wsId}`, {
      description: 'No title',
      category: 'bug',
    });
    expect(missingTitle.status).toBe(400);
  });

  it('creates request and returns it in list', async () => {
    const create = await postJson(`/api/public/requests/${wsId}`, {
      title: 'Fixture request',
      description: 'Please update this page',
      category: 'content',
      priority: 'high',
    });
    expect(create.status).toBe(200);
    const created = await create.json() as { id: string };

    const list = await api(`/api/public/requests/${wsId}`);
    expect(list.status).toBe(200);
    const body = await list.json() as Array<{ id: string }>;
    expect(body.some(item => item.id === created.id)).toBe(true);
  });
});
