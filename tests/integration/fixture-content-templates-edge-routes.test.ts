import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api, postJson, del } = ctx;

let wsId = '';
let templateId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Fixture Content Templates Edge').id;
});

afterAll(async () => {
  if (templateId) await del(`/api/content-templates/${wsId}/${templateId}`);
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Fixture content-templates edge routes', () => {
  it('returns empty list initially', async () => {
    const res = await api(`/api/content-templates/${wsId}`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual([]);
  });

  it('rejects invalid create payload and supports minimal valid create', async () => {
    const bad = await postJson(`/api/content-templates/${wsId}`, {});
    expect(bad.status).toBe(400);

    const ok = await postJson(`/api/content-templates/${wsId}`, {
      name: 'Edge Template',
      pageType: 'blog',
      variables: [],
      sections: [],
      urlPattern: '/blog/{topic}',
      keywordPattern: '{topic}',
    });
    expect(ok.status).toBe(201);
    const body = await ok.json();
    templateId = body.id;
  });

  it('returns 404 for unknown template read', async () => {
    const res = await api(`/api/content-templates/${wsId}/tpl_fixture_unknown`);
    expect(res.status).toBe(404);
  });
});
