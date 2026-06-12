import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Fixture Outcomes').id;
});

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Fixture outcomes read routes', () => {
  it('returns overview array and includes workspace entry', async () => {
    const res = await api('/api/outcomes/overview');
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ workspaceId: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.some(entry => entry.workspaceId === wsId)).toBe(true);
  });

  it('returns zeroed scorecard for fresh workspace', async () => {
    const res = await api(`/api/outcomes/${wsId}/scorecard`);
    expect(res.status).toBe(200);
    const body = await res.json() as { totalTracked: number; overallWinRate: number };
    expect(body.totalTracked).toBe(0);
    expect(body.overallWinRate).toBe(0);
  });

  it('returns empty arrays for top-wins/timeline/actions on fresh workspace', async () => {
    const wins = await api(`/api/outcomes/${wsId}/top-wins`);
    expect(wins.status).toBe(200);
    await expect(wins.json()).resolves.toEqual([]);

    const timeline = await api(`/api/outcomes/${wsId}/timeline`);
    expect(timeline.status).toBe(200);
    await expect(timeline.json()).resolves.toEqual([]);

    const actions = await api(`/api/outcomes/${wsId}/actions`);
    expect(actions.status).toBe(200);
    await expect(actions.json()).resolves.toEqual([]);
  });
});
