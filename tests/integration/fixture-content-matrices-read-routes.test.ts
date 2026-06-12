import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api, postJson } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Fixture Content Matrices').id;
});

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Fixture content matrices read routes', () => {
  it('returns empty list for fresh workspace', async () => {
    const res = await api(`/api/content-matrices/${wsId}`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual([]);
  });

  it('returns 404 for unknown matrix id', async () => {
    const res = await api(`/api/content-matrices/${wsId}/mtx_fixture_missing`);
    expect(res.status).toBe(404);
  });

  it('validates required create fields', async () => {
    const missingName = await postJson(`/api/content-matrices/${wsId}`, { templateId: 'tpl_1' });
    expect(missingName.status).toBe(400);

    const missingTemplate = await postJson(`/api/content-matrices/${wsId}`, { name: 'Matrix' });
    expect(missingTemplate.status).toBe(400);
  });
});
