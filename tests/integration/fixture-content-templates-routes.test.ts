import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api, postJson, del } = ctx;

let wsId = '';
let templateId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Fixture Content Templates').id;
});

afterAll(async () => {
  if (templateId) {
    await del(`/api/content-templates/${wsId}/${templateId}`);
  }
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Fixture content templates routes', () => {
  it('rejects template creation without name', async () => {
    const res = await postJson(`/api/content-templates/${wsId}`, {});
    expect(res.status).toBe(400);
  });

  it('creates and retrieves a minimal template', async () => {
    const create = await postJson(`/api/content-templates/${wsId}`, {
      name: 'Fixture Template',
      pageType: 'service',
      variables: [],
      sections: [],
      urlPattern: '/fixture/{city}',
      keywordPattern: 'fixture keyword',
    });
    expect(create.status).toBe(201);
    const body = await create.json() as { id: string };
    templateId = body.id;

    const get = await api(`/api/content-templates/${wsId}/${templateId}`);
    expect(get.status).toBe(200);
  });

  it('returns 404 for unknown template id', async () => {
    const res = await api(`/api/content-templates/${wsId}/tpl_fixture_missing`);
    expect(res.status).toBe(404);
  });
});
