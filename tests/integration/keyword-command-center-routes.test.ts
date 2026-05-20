import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13360); // port-ok: next free after 13359
const { api, postJson } = ctx;

let workspaceId = '';

beforeAll(async () => {
  await ctx.startServer();
  workspaceId = createWorkspace('Keyword Command Center Route Test').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(workspaceId);
  await ctx.stopServer();
});

describe('Keyword Command Center routes', () => {
  it('GET returns read-model rows, counts, filters, and raw evidence metadata', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.counts).toEqual(expect.objectContaining({ total: expect.any(Number) }));
    expect(body.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'all', label: 'All' }),
      expect.objectContaining({ id: 'tracked', label: 'Tracked' }),
      expect.objectContaining({ id: 'raw_evidence', label: 'Raw Evidence' }),
    ]));
    expect(body.rawEvidenceTotal).toEqual(expect.any(Number));
  });

  it('POST track activates a keyword and protected lifecycle actions require explicit confirmation', async () => {
    const track = await postJson(`/api/webflow/keyword-command-center/${workspaceId}/actions`, {
      action: 'track',
      keyword: 'Route Test Keyword',
    });
    expect(track.status).toBe(200);
    await expect(track.json()).resolves.toEqual(expect.objectContaining({
      ok: true,
      keyword: 'route test keyword',
    }));

    const pause = await postJson(`/api/webflow/keyword-command-center/${workspaceId}/actions`, {
      action: 'pause_tracking',
      keyword: 'Route Test Keyword',
    });
    expect(pause.status).toBe(409);
    await expect(pause.json()).resolves.toEqual({
      error: 'Manual keyword requires explicit confirmation before this action.',
    });

    const retire = await postJson(`/api/webflow/keyword-command-center/${workspaceId}/actions`, {
      action: 'retire',
      keyword: 'Route Test Keyword',
    });
    expect(retire.status).toBe(409);
    await expect(retire.json()).resolves.toEqual({
      error: 'Manual keyword requires explicit confirmation before this action.',
    });

    const forcedRetire = await postJson(`/api/webflow/keyword-command-center/${workspaceId}/actions`, {
      action: 'retire',
      keyword: 'Route Test Keyword',
      force: true,
    });
    expect(forcedRetire.status).toBe(200);

    const read = await api(`/api/webflow/keyword-command-center/${workspaceId}`);
    expect(read.status).toBe(200);
    const body = await read.json();
    expect(body.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        normalizedKeyword: 'route test keyword',
        lifecycleStatus: 'retired',
      }),
    ]));
  });
});
