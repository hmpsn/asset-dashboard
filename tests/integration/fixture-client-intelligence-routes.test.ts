import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Fixture Client Intelligence').id;
});

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Fixture client intelligence routes', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/public/intelligence/ws_fixture_ci_missing');
    expect(res.status).toBe(404);
  });

  it('returns object payload for fresh workspace', async () => {
    const res = await api(`/api/public/intelligence/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body).toBe('object');
    expect(body).not.toBeNull();
  });

  it('does not leak restricted admin-only fields', async () => {
    const res = await api(`/api/public/intelligence/${wsId}`);
    const body = await res.json() as Record<string, unknown>;
    expect(body).not.toHaveProperty('knowledgeBase');
    expect(body).not.toHaveProperty('churnRisk');
  });
});
