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
  it('legacy full GET endpoint is removed so callers use split read models', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${workspaceId}`);
    expect(res.status).toBe(404);
  });

  it('GET summary, rows, and detail expose split read models', async () => {
    await postJson(`/api/webflow/keyword-command-center/${workspaceId}/actions`, {
      action: 'track',
      keyword: 'Split Route Keyword',
    });

    const summary = await api(`/api/webflow/keyword-command-center/${workspaceId}/summary`);
    expect(summary.status).toBe(200);
    const summaryBody = await summary.json();
    expect(summaryBody).toEqual(expect.objectContaining({
      counts: expect.objectContaining({ total: expect.any(Number) }),
      filters: expect.any(Array),
      summarizedAt: expect.any(String),
    }));
    expect(summaryBody.rows).toBeUndefined();

    const rows = await api(`/api/webflow/keyword-command-center/${workspaceId}/rows?search=split&page=1&pageSize=2`);
    expect(rows.status).toBe(200);
    const rowsBody = await rows.json();
    expect(rowsBody.pageInfo).toEqual(expect.objectContaining({
      page: 1,
      pageSize: 2,
      totalRows: expect.any(Number),
    }));
    expect(rowsBody.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ normalizedKeyword: 'split route keyword' }),
    ]));
    expect(rowsBody.rows[0].explanation).toBeUndefined();

    const detail = await api(`/api/webflow/keyword-command-center/${workspaceId}/detail?keyword=${encodeURIComponent('Split Route Keyword')}`);
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toEqual(expect.objectContaining({
      row: expect.objectContaining({ normalizedKeyword: 'split route keyword' }),
    }));
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

    const read = await api(`/api/webflow/keyword-command-center/${workspaceId}/detail?keyword=${encodeURIComponent('Route Test Keyword')}`);
    expect(read.status).toBe(200);
    const body = await read.json();
    expect(body.row).toEqual(expect.objectContaining({
      normalizedKeyword: 'route test keyword',
      lifecycleStatus: 'retired',
    }));
  });

  it('POST pause or retire returns 404 when the keyword is not tracked', async () => {
    const pause = await postJson(`/api/webflow/keyword-command-center/${workspaceId}/actions`, {
      action: 'pause_tracking',
      keyword: 'Untracked Route Keyword',
    });
    expect(pause.status).toBe(404);
    await expect(pause.json()).resolves.toEqual({ error: 'Keyword is not tracked' });

    const retire = await postJson(`/api/webflow/keyword-command-center/${workspaceId}/actions`, {
      action: 'retire',
      keyword: 'Untracked Route Keyword',
    });
    expect(retire.status).toBe(404);
    await expect(retire.json()).resolves.toEqual({ error: 'Keyword is not tracked' });
  });
});
