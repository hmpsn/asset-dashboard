import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13759);
const { api } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Fixture Data Export Edge').id;
});

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Fixture data-export edge routes', () => {
  it('returns JSON arrays for empty workspace exports', async () => {
    const briefs = await api(`/api/export/${wsId}/briefs`);
    expect(briefs.status).toBe(200);
    await expect(briefs.json()).resolves.toEqual([]);

    const activity = await api(`/api/export/${wsId}/activity`);
    expect(activity.status).toBe(200);
    await expect(activity.json()).resolves.toEqual([]);
  });

  it('returns CSV with header row', async () => {
    const res = await api(`/api/export/${wsId}/requests?format=csv`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.split('\n')[0]).toContain('id');
  });

  it('returns 200 empty export for unknown workspace', async () => {
    const res = await api('/api/export/ws_fixture_export_missing/briefs');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual([]);
  });
});
