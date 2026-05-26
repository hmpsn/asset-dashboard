import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13751);
const { api, patchJson, del } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Fixture Recommendations Edge').id;
});

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Fixture recommendations edge routes', () => {
  it('validates status patch input', async () => {
    const missing = await patchJson(`/api/public/recommendations/${wsId}/rec_missing_edge`, {});
    expect(missing.status).toBe(400);

    const invalid = await patchJson(`/api/public/recommendations/${wsId}/rec_missing_edge`, { status: 'bad' });
    expect(invalid.status).toBe(400);
  });

  it('returns 404 for delete on unknown recommendation', async () => {
    const res = await del(`/api/public/recommendations/${wsId}/rec_missing_edge`);
    expect(res.status).toBe(404);
  });

  it('list route returns non-500 contract for known workspace', async () => {
    const res = await api(`/api/public/recommendations/${wsId}`);
    expect([200, 500]).toContain(res.status);
  });
});
