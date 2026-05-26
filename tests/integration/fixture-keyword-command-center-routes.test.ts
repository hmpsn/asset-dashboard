import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13745);
const { api, postJson } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Fixture Keyword Command Center').id;
  await api('/api/admin/feature-flags/local-seo-visibility', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true }),
  });
});

afterAll(async () => {
  await api('/api/admin/feature-flags/local-seo-visibility', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: null }),
  });
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Fixture keyword command center routes', () => {
  it('legacy full endpoint is removed', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${wsId}`);
    expect(res.status).toBe(404);
  });

  it('summary route returns split model payload', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${wsId}/summary`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(expect.objectContaining({ counts: expect.any(Object) }));
  });

  it('bulk actions validate keyword list constraints', async () => {
    const empty = await postJson(`/api/webflow/keyword-command-center/${wsId}/actions/bulk`, {
      action: 'track',
      keywords: [],
    });
    expect(empty.status).toBe(400);

    const tooMany = await postJson(`/api/webflow/keyword-command-center/${wsId}/actions/bulk`, {
      action: 'track',
      keywords: Array.from({ length: 51 }, (_, i) => `kw-${i}`),
    });
    expect(tooMany.status).toBe(400);
  });
});
