import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: { keyword?: string; removed?: boolean } }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: { keyword?: string; removed?: boolean }) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { getTrackedKeywords } from '../../server/rank-tracking.js';
import db from '../../server/db/index.js';
import { WS_EVENTS } from '../../server/ws-events.js';

let baseUrl = '';
let server: http.Server | undefined;
let wsId = '';

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close(err => err ? reject(err) : resolve());
  });
  server = undefined;
}

async function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, opts);
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function deleteJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function strategyBroadcasts() {
  return broadcastState.calls.filter(call => call.event === WS_EVENTS.STRATEGY_UPDATED);
}

function countActivities(type: string, keyword: string): number {
  const row = db.prepare(`
    SELECT COALESCE(COUNT(*), 0) AS count
    FROM activity_log
    WHERE workspace_id = ?
      AND type = ?
      AND title LIKE ?
  `).get(wsId, type, `%"${keyword}"%`) as { count: number };
  return row.count;
}

beforeAll(async () => {
  await startTestServer();
  const ws = createWorkspace('Tracked Keywords Broadcasts');
  wsId = ws.id;
});

beforeEach(() => {
  broadcastState.calls = [];
});

afterAll(async () => {
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM rank_tracking_config WHERE workspace_id = ?').run(wsId);
  deleteWorkspace(wsId);
  await stopTestServer();
});

describe('public tracked keyword workflow broadcasts', () => {
  it('broadcasts and records activity once for a newly tracked keyword', async () => {
    const res = await postJson(`/api/public/tracked-keywords/${wsId}`, {
      keyword: 'Broadcast Strategy Keyword',
    });
    expect(res.status).toBe(200);

    expect(getTrackedKeywords(wsId).map(k => k.query)).toContain('broadcast strategy keyword');
    expect(strategyBroadcasts()).toEqual([
      {
        workspaceId: wsId,
        event: WS_EVENTS.STRATEGY_UPDATED,
        payload: { keyword: 'broadcast strategy keyword' },
      },
    ]);
    expect(countActivities('client_keyword_tracked', 'broadcast strategy keyword')).toBe(1);

    broadcastState.calls = [];
    const duplicateRes = await postJson(`/api/public/tracked-keywords/${wsId}`, {
      keyword: 'broadcast strategy keyword',
    });
    expect(duplicateRes.status).toBe(200);
    expect(strategyBroadcasts()).toHaveLength(0);
    expect(countActivities('client_keyword_tracked', 'broadcast strategy keyword')).toBe(1);
  });

  it('broadcasts and records activity when removing an existing tracked keyword', async () => {
    const addRes = await postJson(`/api/public/tracked-keywords/${wsId}`, {
      keyword: 'Remove Strategy Keyword',
    });
    expect(addRes.status).toBe(200);
    broadcastState.calls = [];

    const removeRes = await deleteJson(`/api/public/tracked-keywords/${wsId}`, {
      keyword: 'remove strategy keyword',
    });
    expect(removeRes.status).toBe(200);

    expect(getTrackedKeywords(wsId).map(k => k.query)).not.toContain('remove strategy keyword');
    expect(strategyBroadcasts()).toEqual([
      {
        workspaceId: wsId,
        event: WS_EVENTS.STRATEGY_UPDATED,
        payload: { keyword: 'remove strategy keyword', removed: true },
      },
    ]);
    expect(countActivities('client_keyword_removed', 'remove strategy keyword')).toBe(1);
  });

  it('does not broadcast or log activity for a missing keyword removal', async () => {
    const removeRes = await deleteJson(`/api/public/tracked-keywords/${wsId}`, {
      keyword: 'missing strategy keyword',
    });
    expect(removeRes.status).toBe(200);
    expect(strategyBroadcasts()).toHaveLength(0);
    expect(countActivities('client_keyword_removed', 'missing strategy keyword')).toBe(0);
  });

  it('rejects malformed add and remove requests before mutating or broadcasting', async () => {
    const shortAddRes = await postJson(`/api/public/tracked-keywords/${wsId}`, {
      keyword: 'x',
    });
    expect(shortAddRes.status).toBe(400);

    const emptyRemoveRes = await deleteJson(`/api/public/tracked-keywords/${wsId}`, {
      keyword: '',
    });
    expect(emptyRemoveRes.status).toBe(400);

    expect(getTrackedKeywords(wsId).map(k => k.query)).not.toContain('x');
    expect(strategyBroadcasts()).toHaveLength(0);
  });
});
