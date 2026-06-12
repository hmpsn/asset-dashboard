import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { authPostJson, authApi } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Fixture Content Publish Edge').id;
});

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Fixture content-publish edge routes', () => {
  it('returns 404 for unknown workspace publish-to-webflow', async () => {
    const res = await authPostJson('/api/content-posts/ws_fixture_pub_missing/post_missing/publish-to-webflow', {});
    expect(res.status).toBe(404);
  });

  it('validates generateImage boolean input', async () => {
    const res = await authPostJson(`/api/content-posts/${wsId}/post_missing/publish-to-webflow`, { generateImage: 'yes' });
    expect(res.status).toBe(400);
  });

  it('enforces workspace-site access on publish-collections when workspaceId provided', async () => {
    const res = await authApi(`/api/webflow/publish-collections/site_missing_edge?workspaceId=${wsId}`);
    expect(res.status).toBe(403);
  });
});
