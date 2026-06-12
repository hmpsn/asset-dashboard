import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api, postJson, patchJson } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Fixture Client Actions Edge').id;
});

afterAll(async () => {
  db.prepare('DELETE FROM client_actions WHERE workspace_id = ?').run(wsId);
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Fixture client-actions edge routes', () => {
  it('validates required fields on create', async () => {
    const res = await postJson(`/api/client-actions/${wsId}`, {});
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown action patch', async () => {
    const res = await patchJson(`/api/client-actions/${wsId}/ca_fixture_missing/status`, { status: 'completed' });
    expect([404, 400]).toContain(res.status);
  });

  it('creates and lists action in workspace', async () => {
    const create = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'content_decay',
      title: 'Edge action',
      summary: 'Investigate decline',
    });
    expect(create.status).toBe(200);

    const list = await api(`/api/client-actions/${wsId}`);
    expect(list.status).toBe(200);
    const body = await list.json() as Array<{ title: string }>;
    expect(body.some(item => item.title === 'Edge action')).toBe(true);
  });
});
