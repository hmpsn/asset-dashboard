import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13744);
const { api } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Fixture Workspace Home').id;
});

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Fixture workspace home routes', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/workspace-home/ws_fixture_home_missing');
    expect(res.status).toBe(404);
  });

  it('validates days query bounds', async () => {
    const zero = await api(`/api/workspace-home/${wsId}?days=0`);
    expect(zero.status).toBe(400);

    const float = await api(`/api/workspace-home/${wsId}?days=7.5`);
    expect(float.status).toBe(400);
  });

  it('returns expected aggregate arrays for fresh workspace', async () => {
    const res = await api(`/api/workspace-home/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(Array.isArray(body.ranks)).toBe(true);
    expect(Array.isArray(body.requests)).toBe(true);
    expect(Array.isArray(body.contentRequests)).toBe(true);
  });
});
