import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import db from '../../server/db/index.js';

const nativeFetch = globalThis.fetch;

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: Record<string, unknown> }>,
}));

const cmsWriteState = vi.hoisted(() => ({
  itemUpdateMode: 'success' as 'success' | 'failure',
  publishMode: 'success' as 'success' | 'failure',
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: Record<string, unknown>) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/webflow.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../server/webflow.js')>();
  return {
    ...actual,
    updateCollectionItem: vi.fn(async () => (
      cmsWriteState.itemUpdateMode === 'success'
        ? { success: true }
        : { success: false, error: '500: upstream write failed' }
    )),
    publishCollectionItems: vi.fn(async () => (
      cmsWriteState.publishMode === 'success'
        ? { success: true }
        : { success: false, error: '500: upstream publish failed' }
    )),
  };
});

import { WS_EVENTS } from '../../server/ws-events.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';

let baseUrl = '';
let server: http.Server | undefined;
let workspaceAId = '';
let workspaceBId = '';
let siteA = '';
let siteB = '';
const originalAppPassword = process.env.APP_PASSWORD;

function resetWorkspaceState(workspaceId: string): void {
  db.prepare('DELETE FROM page_edit_states WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(workspaceId);
}

function countRows(table: 'page_edit_states' | 'activity_log', workspaceId: string): number {
  const row = db.prepare(`SELECT COALESCE(COUNT(*), 0) AS count FROM ${table} WHERE workspace_id = ?`).get(workspaceId) as { count: number };
  return row.count;
}

function countActivities(workspaceId: string, type: string): number {
  const row = db.prepare(`
    SELECT COALESCE(COUNT(*), 0) AS count
    FROM activity_log
    WHERE workspace_id = ? AND type = ?
  `).get(workspaceId, type) as { count: number };
  return row.count;
}

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, resolve));
  const { port } = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close(err => (err ? reject(err) : resolve()));
  });
  server = undefined;
}

async function api(path: string, opts?: RequestInit): Promise<Response> {
  return nativeFetch(`${baseUrl}${path}`, opts);
}

async function patchJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await startTestServer();
}, 30_000);

beforeEach(() => {
  cmsWriteState.itemUpdateMode = 'success';
  cmsWriteState.publishMode = 'success';
  broadcastState.calls = [];

  const wsA = createWorkspace('Webflow CMS Mutation Safety A', 'wf-cms-site-a');
  const wsB = createWorkspace('Webflow CMS Mutation Safety B', 'wf-cms-site-b');
  workspaceAId = wsA.id;
  workspaceBId = wsB.id;
  siteA = wsA.webflowSiteId!;
  siteB = wsB.webflowSiteId!;

  updateWorkspace(workspaceAId, {
    webflowToken: 'wf-token-a',
  });
  updateWorkspace(workspaceBId, {
    webflowToken: 'wf-token-b',
  });
});

afterEach(() => {
  resetWorkspaceState(workspaceAId);
  resetWorkspaceState(workspaceBId);
  deleteWorkspace(workspaceAId);
  deleteWorkspace(workspaceBId);
});

afterAll(async () => {
  await stopTestServer();
  if (originalAppPassword === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = originalAppPassword;
});

describe('webflow CMS mutation safety', () => {
  it('GET collection items rejects non-positive limit values', async () => {
    const res = await api(`/api/webflow/collections/col_123/items?workspaceId=${workspaceAId}&siteId=${siteA}&limit=0`);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'limit must be a positive integer' });
  });

  it('GET collection items rejects negative offset values', async () => {
    const res = await api(`/api/webflow/collections/col_123/items?workspaceId=${workspaceAId}&siteId=${siteA}&offset=-1`);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'offset must be a non-negative integer' });
  });

  it('PATCH collection item success writes draft page state, activity, broadcast, and read-path visibility', async () => {
    const res = await patchJson('/api/webflow/collections/col_123/items/item_123', {
      workspaceId: workspaceAId,
      siteId: siteA,
      fieldData: { 'seo-title': 'Improved title' },
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });

    expect(countRows('page_edit_states', workspaceAId)).toBe(1);
    expect(countActivities(workspaceAId, 'seo_updated')).toBe(1);
    expect(countRows('page_edit_states', workspaceBId)).toBe(0);
    expect(broadcastState.calls).toContainEqual(expect.objectContaining({
      workspaceId: workspaceAId,
      event: WS_EVENTS.PAGE_STATE_UPDATED,
      payload: expect.objectContaining({ pageId: 'item_123', source: 'cms-draft', fields: ['seo-title'] }),
    }));

    const readRes = await api(`/api/workspaces/${workspaceAId}/page-states/item_123`);
    expect(readRes.status).toBe(200);
    await expect(readRes.json()).resolves.toMatchObject({
      status: 'fix-proposed',
      source: 'cms-draft',
      fields: ['seo-title'],
    });
  });

  it('PATCH collection item provider failure returns error result and does not mutate, broadcast, or log', async () => {
    cmsWriteState.itemUpdateMode = 'failure';
    const pageRowsBefore = countRows('page_edit_states', workspaceAId);
    const activityRowsBefore = countRows('activity_log', workspaceAId);

    const res = await patchJson('/api/webflow/collections/col_123/items/item_123', {
      workspaceId: workspaceAId,
      siteId: siteA,
      fieldData: { 'seo-title': 'Improved title' },
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: false, error: '500: upstream write failed' });

    expect(countRows('page_edit_states', workspaceAId)).toBe(pageRowsBefore);
    expect(countRows('activity_log', workspaceAId)).toBe(activityRowsBefore);
    expect(broadcastState.calls).toHaveLength(0);
    const readRes = await api(`/api/workspaces/${workspaceAId}/page-states/item_123`);
    expect(readRes.status).toBe(404);
  });

  it('publish success writes live page state, activity, broadcast, and read-path visibility', async () => {
    const res = await postJson('/api/webflow/collections/col_123/publish', {
      workspaceId: workspaceAId,
      siteId: siteA,
      itemIds: ['item_1', 'item_2'],
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });

    expect(countRows('page_edit_states', workspaceAId)).toBe(2);
    expect(countActivities(workspaceAId, 'seo_updated')).toBe(1);
    expect(countRows('page_edit_states', workspaceBId)).toBe(0);
    expect(broadcastState.calls).toContainEqual(expect.objectContaining({
      workspaceId: workspaceAId,
      event: WS_EVENTS.PAGE_STATE_UPDATED,
      payload: expect.objectContaining({ pageIds: ['item_1', 'item_2'], source: 'cms-publish' }),
    }));

    const readRes = await api(`/api/workspaces/${workspaceAId}/page-states/item_1`);
    expect(readRes.status).toBe(200);
    await expect(readRes.json()).resolves.toMatchObject({
      status: 'live',
      source: 'cms-publish',
    });
  });

  it('publish provider failure and cross-workspace mismatch do not mutate, broadcast, or log', async () => {
    cmsWriteState.publishMode = 'failure';
    const rowsBeforeFail = countRows('page_edit_states', workspaceAId);
    const activityBeforeFail = countRows('activity_log', workspaceAId);

    const failRes = await postJson('/api/webflow/collections/col_123/publish', {
      workspaceId: workspaceAId,
      siteId: siteA,
      itemIds: ['item_1'],
    });
    expect(failRes.status).toBe(200);
    await expect(failRes.json()).resolves.toEqual({ success: false, error: '500: upstream publish failed' });
    expect(countRows('page_edit_states', workspaceAId)).toBe(rowsBeforeFail);
    expect(countRows('activity_log', workspaceAId)).toBe(activityBeforeFail);
    expect(broadcastState.calls).toHaveLength(0);

    const rowsBeforeCross = countRows('page_edit_states', workspaceAId);
    const activityBeforeCross = countRows('activity_log', workspaceAId);
    const crossRes = await postJson('/api/webflow/collections/col_123/publish', {
      workspaceId: workspaceAId,
      siteId: siteB,
      itemIds: ['item_x'],
    });
    expect(crossRes.status).toBe(403);
    expect(countRows('page_edit_states', workspaceAId)).toBe(rowsBeforeCross);
    expect(countRows('activity_log', workspaceAId)).toBe(activityBeforeCross);
    expect(countRows('page_edit_states', workspaceBId)).toBe(0);
    expect(countRows('activity_log', workspaceBId)).toBe(0);
    expect(broadcastState.calls).toHaveLength(0);
  });
});
