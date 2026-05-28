/**
 * Integration tests for the tracked-keywords full CRUD lifecycle.
 *
 * Covers: add via public portal, list, remove, idempotency, validation,
 * workspace isolation, broadcasts, and multi-keyword scenarios.
 *
 * Related: tests/integration/tracked-keywords-broadcasts.test.ts — broadcast-focused.
 * This file focuses on the CRUD lifecycle contract, not broadcast semantics.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: Record<string, unknown> }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(
    (workspaceId: string, event: string, payload: Record<string, unknown>) => {
      broadcastState.calls.push({ workspaceId, event, payload });
    },
  ),
}));

vi.mock('../../server/email.js', () => ({
  notifyTeamActionApproved: vi.fn(),
  notifyTeamContentRequest: vi.fn(),
  notifyTeamChangesRequested: vi.fn(),
}));

// Bypass rate limiting — tests issue many writes in rapid succession and would
// otherwise exhaust the 10 req/min publicWriteLimiter or 60 req/min publicApiLimiter.
// The rate-limiter module is already covered by its own dedicated tests.
const noopMiddleware = (_req: unknown, _res: unknown, next: () => void) => next();
vi.mock('../../server/middleware.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/middleware.js')>();
  return {
    ...original,
    publicWriteLimiter: noopMiddleware,
    publicApiLimiter: noopMiddleware,
    globalPublicLimiter: noopMiddleware,
  };
});

import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { getTrackedKeywords } from '../../server/rank-tracking.js';
import db from '../../server/db/index.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { TRACKED_KEYWORD_SOURCE, TRACKED_KEYWORD_STATUS } from '../../shared/types/rank-tracking.js';

let baseUrl = '';
let server: http.Server | undefined;
let wsId = '';
let wsIdB = '';

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
    server!.close(err => (err ? reject(err) : resolve()));
  });
  server = undefined;
}

function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, opts);
}

function postJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function deleteJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function cleanupWorkspaceData(id: string): void {
  db.prepare('DELETE FROM rank_tracking_config WHERE workspace_id = ?').run(id);
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(id);
}

function rankTrackingBroadcasts(forWorkspace?: string) {
  return broadcastState.calls.filter(
    c =>
      c.event === WS_EVENTS.RANK_TRACKING_UPDATED &&
      (forWorkspace == null || c.workspaceId === forWorkspace),
  );
}

beforeAll(async () => {
  await startTestServer();
  const ws = createWorkspace('TK Lifecycle WS A');
  wsId = ws.id;
  const wsB = createWorkspace('TK Lifecycle WS B');
  wsIdB = wsB.id;
});

beforeEach(() => {
  broadcastState.calls = [];
  // Reset tracked keywords between tests so each test starts fresh
  cleanupWorkspaceData(wsId);
  cleanupWorkspaceData(wsIdB);
});

afterAll(async () => {
  cleanupWorkspaceData(wsId);
  cleanupWorkspaceData(wsIdB);
  deleteWorkspace(wsId);
  deleteWorkspace(wsIdB);
  await stopTestServer();
});

// ─── POST — add keyword ────────────────────────────────────────────────────────

describe('POST /api/public/tracked-keywords/:workspaceId — add keyword', () => {
  it('adds a keyword and returns an updated list containing it', async () => {
    const res = await postJson(`/api/public/tracked-keywords/${wsId}`, {
      keyword: 'seo strategy guide',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { keywords: { query: string }[] };
    expect(body.keywords).toEqual(
      expect.arrayContaining([expect.objectContaining({ query: 'seo strategy guide' })]),
    );
  });

  it('returns keyword with expected shape (query, source, status, pinned, addedAt)', async () => {
    const res = await postJson(`/api/public/tracked-keywords/${wsId}`, {
      keyword: 'content marketing tips',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      keywords: {
        query: string;
        source?: string;
        status?: string;
        pinned: boolean;
        addedAt: string;
      }[];
    };
    const kw = body.keywords.find(k => k.query === 'content marketing tips');
    expect(kw).toBeDefined();
    expect(kw!.source).toBe(TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED);
    expect(kw!.status ?? TRACKED_KEYWORD_STATUS.ACTIVE).toBe(TRACKED_KEYWORD_STATUS.ACTIVE);
    expect(typeof kw!.pinned).toBe('boolean');
    expect(kw!.addedAt).toBeTruthy();
  });

  it('is idempotent — adding a duplicate keyword returns the list without creating a second entry', async () => {
    await postJson(`/api/public/tracked-keywords/${wsId}`, { keyword: 'duplicate keyword' });

    const dupRes = await postJson(`/api/public/tracked-keywords/${wsId}`, {
      keyword: 'duplicate keyword',
    });
    expect(dupRes.status).toBe(200);
    const body = await dupRes.json() as { keywords: { query: string }[] };
    const matches = body.keywords.filter(k => k.query === 'duplicate keyword');
    expect(matches).toHaveLength(1);
  });

  it('returns 400 for a single-character keyword (too short)', async () => {
    const res = await postJson(`/api/public/tracked-keywords/${wsId}`, { keyword: 'x' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for a keyword exceeding 120 characters', async () => {
    const longKeyword = 'a'.repeat(121);
    const res = await postJson(`/api/public/tracked-keywords/${wsId}`, {
      keyword: longKeyword,
    });
    expect(res.status).toBe(400);
  });
});

// ─── GET — list keywords ───────────────────────────────────────────────────────

describe('GET /api/public/tracked-keywords/:workspaceId', () => {
  it('returns an empty keywords array for a fresh workspace', async () => {
    const res = await api(`/api/public/tracked-keywords/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { keywords: unknown[] };
    expect(body.keywords).toEqual([]);
  });

  it('returns the keyword in the list after adding it', async () => {
    await postJson(`/api/public/tracked-keywords/${wsId}`, {
      keyword: 'local seo services',
    });

    const res = await api(`/api/public/tracked-keywords/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { keywords: { query: string }[] };
    expect(body.keywords.map(k => k.query)).toContain('local seo services');
  });
});

// ─── DELETE — remove keyword ───────────────────────────────────────────────────

describe('DELETE /api/public/tracked-keywords/:workspaceId', () => {
  it('removes a keyword from the list', async () => {
    await postJson(`/api/public/tracked-keywords/${wsId}`, { keyword: 'keyword to remove' });

    const removeRes = await deleteJson(`/api/public/tracked-keywords/${wsId}`, {
      keyword: 'keyword to remove',
    });
    expect(removeRes.status).toBe(200);
    const body = await removeRes.json() as { keywords: { query: string }[] };
    expect(body.keywords.map(k => k.query)).not.toContain('keyword to remove');
  });

  it('confirms via subsequent GET that the keyword is gone after deletion', async () => {
    await postJson(`/api/public/tracked-keywords/${wsId}`, { keyword: 'ephemeral keyword' });
    await deleteJson(`/api/public/tracked-keywords/${wsId}`, { keyword: 'ephemeral keyword' });

    const getRes = await api(`/api/public/tracked-keywords/${wsId}`);
    expect(getRes.status).toBe(200);
    const body = await getRes.json() as { keywords: { query: string }[] };
    expect(body.keywords.map(k => k.query)).not.toContain('ephemeral keyword');
  });

  it('is idempotent — DELETE on a non-existent keyword returns 200 with the current list', async () => {
    await postJson(`/api/public/tracked-keywords/${wsId}`, { keyword: 'present keyword' });

    const removeRes = await deleteJson(`/api/public/tracked-keywords/${wsId}`, {
      keyword: 'this keyword was never added',
    });
    expect(removeRes.status).toBe(200);
    const body = await removeRes.json() as { keywords: { query: string }[] };
    // Still returns the existing list without error
    expect(Array.isArray(body.keywords)).toBe(true);
    // The keyword that was there is still there
    expect(body.keywords.map(k => k.query)).toContain('present keyword');
  });
});

// ─── Workspace isolation ───────────────────────────────────────────────────────

describe('Workspace isolation', () => {
  it('keywords added to workspace A do not appear in workspace B list', async () => {
    await postJson(`/api/public/tracked-keywords/${wsId}`, { keyword: 'workspace a keyword' });

    const resB = await api(`/api/public/tracked-keywords/${wsIdB}`);
    expect(resB.status).toBe(200);
    const bodyB = await resB.json() as { keywords: { query: string }[] };
    expect(bodyB.keywords.map(k => k.query)).not.toContain('workspace a keyword');
  });

  it('DELETE on workspace A does not affect workspace B keywords', async () => {
    // Add the same keyword to both workspaces
    await postJson(`/api/public/tracked-keywords/${wsId}`, { keyword: 'shared keyword name' });
    await postJson(`/api/public/tracked-keywords/${wsIdB}`, { keyword: 'shared keyword name' });

    // Delete from workspace A only
    await deleteJson(`/api/public/tracked-keywords/${wsId}`, { keyword: 'shared keyword name' });

    // Workspace B should still have it
    const resB = await api(`/api/public/tracked-keywords/${wsIdB}`);
    expect(resB.status).toBe(200);
    const bodyB = await resB.json() as { keywords: { query: string }[] };
    expect(bodyB.keywords.map(k => k.query)).toContain('shared keyword name');
  });
});

// ─── Broadcasts ───────────────────────────────────────────────────────────────

describe('Broadcasts', () => {
  it('POST broadcasts RANK_TRACKING_UPDATED with the keyword', async () => {
    const res = await postJson(`/api/public/tracked-keywords/${wsId}`, {
      keyword: 'broadcast test keyword',
    });
    expect(res.status).toBe(200);

    const broadcasts = rankTrackingBroadcasts(wsId);
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]).toMatchObject({
      workspaceId: wsId,
      event: WS_EVENTS.RANK_TRACKING_UPDATED,
      payload: { keyword: 'broadcast test keyword' },
    });
  });

  it('DELETE broadcasts RANK_TRACKING_UPDATED with keyword and removed flag', async () => {
    await postJson(`/api/public/tracked-keywords/${wsId}`, { keyword: 'remove broadcast keyword' });
    broadcastState.calls = [];

    const removeRes = await deleteJson(`/api/public/tracked-keywords/${wsId}`, {
      keyword: 'remove broadcast keyword',
    });
    expect(removeRes.status).toBe(200);

    const broadcasts = rankTrackingBroadcasts(wsId);
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]).toMatchObject({
      workspaceId: wsId,
      event: WS_EVENTS.RANK_TRACKING_UPDATED,
      payload: { keyword: 'remove broadcast keyword', removed: true },
    });
  });
});

// ─── Multiple keywords ─────────────────────────────────────────────────────────

describe('Multiple keywords', () => {
  it('can add multiple distinct keywords and all appear in the list', async () => {
    await postJson(`/api/public/tracked-keywords/${wsId}`, { keyword: 'keyword alpha' });
    await postJson(`/api/public/tracked-keywords/${wsId}`, { keyword: 'keyword beta' });
    await postJson(`/api/public/tracked-keywords/${wsId}`, { keyword: 'keyword gamma' });

    const res = await api(`/api/public/tracked-keywords/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { keywords: { query: string }[] };
    const queries = body.keywords.map(k => k.query);
    expect(queries).toContain('keyword alpha');
    expect(queries).toContain('keyword beta');
    expect(queries).toContain('keyword gamma');
  });

  it('removing one keyword leaves the other keywords intact', async () => {
    await postJson(`/api/public/tracked-keywords/${wsId}`, { keyword: 'keep me one' });
    await postJson(`/api/public/tracked-keywords/${wsId}`, { keyword: 'remove me' });
    await postJson(`/api/public/tracked-keywords/${wsId}`, { keyword: 'keep me two' });

    await deleteJson(`/api/public/tracked-keywords/${wsId}`, { keyword: 'remove me' });

    // Verify via DB helper to be independent of the HTTP layer
    const remaining = getTrackedKeywords(wsId).map(k => k.query);
    expect(remaining).toContain('keep me one');
    expect(remaining).toContain('keep me two');
    expect(remaining).not.toContain('remove me');
  });
});
