import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13731, { autoPublicAuth: true });
const { api, postJson } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Fixture Public Content').id;
});

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Fixture public content routes', () => {
  it('returns 404 for unknown workspace public seo strategy', async () => {
    const res = await api('/api/public/seo-strategy/ws_fixture_public_content_missing');
    expect(res.status).toBe(404);
  });

  it('rejects malformed content request payload', async () => {
    const missingTopic = await postJson(`/api/public/content-request/${wsId}`, { targetKeyword: 'abc' });
    expect(missingTopic.status).toBe(400);

    const invalidPriority = await postJson(`/api/public/content-request/${wsId}`, {
      topic: 'Topic',
      targetKeyword: 'kw',
      priority: 'urgent-now',
    });
    expect(invalidPriority.status).toBe(400);
  });

  it('accepts valid content request and lists it', async () => {
    const create = await postJson(`/api/public/content-request/${wsId}`, {
      topic: 'Fixture content request',
      targetKeyword: 'fixture keyword',
      priority: 'medium',
    });
    expect(create.status).toBe(200);

    const list = await api(`/api/public/content-requests/${wsId}`);
    expect(list.status).toBe(200);
    const body = await list.json() as Array<{ topic: string }>;
    expect(body.some(item => item.topic === 'Fixture content request')).toBe(true);
  });
});
