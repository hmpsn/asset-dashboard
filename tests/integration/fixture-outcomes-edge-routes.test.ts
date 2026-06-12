import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Fixture Outcomes Edge').id;
});

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Fixture outcomes edge routes', () => {
  it('fresh workspace returns null learnings', async () => {
    const res = await api(`/api/outcomes/${wsId}/learnings`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toBeNull();
  });

  it('fresh workspace diagnostics endpoint returns object', async () => {
    const res = await api(`/api/outcomes/${wsId}/diagnostics`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(expect.any(Object));
  });

  it('unknown workspace actions returns empty array', async () => {
    const res = await api('/api/outcomes/ws_fixture_outcomes_missing/actions');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual([]);
  });
});
