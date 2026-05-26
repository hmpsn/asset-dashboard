import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13753, { env: { OPENAI_API_KEY: '' } });
const { api, postJson } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Fixture Rewrite Chat Edge').id;
});

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Fixture rewrite-chat edge routes', () => {
  it('returns 404 for unknown workspace pages route', async () => {
    const res = await api('/api/rewrite-chat/ws_fixture_rewrite_missing/pages');
    expect(res.status).toBe(404);
  });

  it('validates load-page url payload', async () => {
    const missing = await postJson(`/api/rewrite-chat/${wsId}/load-page`, {});
    expect(missing.status).toBe(400);

    const malformed = await postJson(`/api/rewrite-chat/${wsId}/load-page`, { url: 'not-a-url' });
    expect([400, 500, 502]).toContain(malformed.status);
  });

  it('validates chat question payload', async () => {
    const res = await postJson(`/api/rewrite-chat/${wsId}`, { question: '' });
    expect(res.status).toBe(400);
  });
});
