/**
 * Integration tests for rank-tracking admin route lifecycle.
 *
 * Focuses on mutation lifecycle patterns, broadcast verification for admin
 * routes, workspace isolation, and edge cases not covered in other files.
 *
 * Related test files (do not duplicate):
 * - rank-tracking-routes.test.ts (13213) — basic CRUD + snapshot, public reads
 * - rank-tracking-read-routes.test.ts (13610) — read-path, invalid limit edge cases
 * - tracked-keywords-lifecycle.test.ts — public keyword add/remove full lifecycle
 * - tracked-keywords-broadcasts.test.ts — broadcast semantics for public routes
 *
 * Coverage in this file:
 * - Full lifecycle: add → verify presence → pin → unpin → delete
 * - Admin POST broadcasts RANK_TRACKING_UPDATED with correct payload
 * - Admin DELETE broadcasts RANK_TRACKING_UPDATED with correct payload
 * - Admin PATCH pin broadcasts RANK_TRACKING_UPDATED with correct payload
 * - No broadcast on duplicate add
 * - No broadcast on delete of non-existent keyword
 * - Workspace isolation for admin keyword routes
 * - History with ?queries= filter
 * - History with custom ?limit= values
 * - Negative limit → 400
 * - Float limit → 400
 * - Empty-string query → 400
 * - Object-type query → 400
 * - Whitespace-only query → 400
 * - Pinned flag respected on add
 * - Multiple keyword coexistence
 * - Delete-leaves-others-intact pattern
 * - Public history and latest return arrays (basic guard)
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// ─── Mocks (must be hoisted before any imports that load the mocked modules) ──

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: unknown }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: unknown) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/email.js', () => ({
  isEmailConfigured: vi.fn(() => false),
  sendEmail: vi.fn(),
  notifyApprovalReady: vi.fn(),
  notifyTeamActionApproved: vi.fn(),
  notifyTeamChangesRequested: vi.fn(),
  notifyTeamNewRequest: vi.fn(),
  notifyClientBriefReady: vi.fn(),
  notifyClientContentPublished: vi.fn(),
  notifyClientPostReady: vi.fn(),
  notifyClientFixesApplied: vi.fn(),
  notifyClientStatusChange: vi.fn(),
  notifyTeamContentRequest: vi.fn(),
}));

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

// ─── Imports (after vi.mock calls) ────────────────────────────────────────────

import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { getTrackedKeywords, storeRankSnapshot } from '../../server/rank-tracking.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import db from '../../server/db/index.js';

// ─── Server lifecycle ─────────────────────────────────────────────────────────

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

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

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

function patchJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function del(path: string): Promise<Response> {
  return api(path, { method: 'DELETE' });
}

// ─── Test-local helpers ───────────────────────────────────────────────────────

function rankTrackingBroadcasts(forWorkspace?: string) {
  return broadcastState.calls.filter(
    c =>
      c.event === WS_EVENTS.RANK_TRACKING_UPDATED &&
      (forWorkspace == null || c.workspaceId === forWorkspace),
  );
}

function kwUrl(workspaceId: string, query?: string): string {
  const base = `/api/rank-tracking/${workspaceId}/keywords`;
  return query ? `${base}/${encodeURIComponent(query)}` : base;
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await startTestServer();
  wsId = createWorkspace('RT Lifecycle WS A').id;
  wsIdB = createWorkspace('RT Lifecycle WS B').id;
}, 25_000);

beforeEach(() => {
  broadcastState.calls = [];
  // Reset admin-tracked keywords between tests for clean state
  db.prepare('DELETE FROM rank_tracking_config WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM rank_tracking_config WHERE workspace_id = ?').run(wsIdB);
  db.prepare('DELETE FROM tracked_keywords WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM tracked_keywords WHERE workspace_id = ?').run(wsIdB);
  db.prepare('DELETE FROM rank_snapshots WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM rank_snapshots WHERE workspace_id = ?').run(wsIdB);
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(wsIdB);
});

afterAll(async () => {
  db.prepare('DELETE FROM rank_tracking_config WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM rank_tracking_config WHERE workspace_id = ?').run(wsIdB);
  db.prepare('DELETE FROM tracked_keywords WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM tracked_keywords WHERE workspace_id = ?').run(wsIdB);
  db.prepare('DELETE FROM rank_snapshots WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM rank_snapshots WHERE workspace_id = ?').run(wsIdB);
  deleteWorkspace(wsId);
  deleteWorkspace(wsIdB);
  await stopTestServer();
});

// ─── Full CRUD lifecycle ──────────────────────────────────────────────────────

describe('Admin keyword CRUD — full lifecycle', () => {
  it('fresh workspace starts with an empty keyword list', async () => {
    const res = await api(kwUrl(wsId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it('POST adds a keyword and returns an updated list containing it', async () => {
    const res = await postJson(kwUrl(wsId), { query: 'seo analytics platform' });
    expect(res.status).toBe(200);
    const body = await res.json() as { query: string }[];
    expect(Array.isArray(body)).toBe(true);
    const added = body.find(k => k.query === 'seo analytics platform');
    expect(added).toBeDefined();
  });

  it('GET keywords reflects the newly added keyword', async () => {
    await postJson(kwUrl(wsId), { query: 'content marketing tool' });
    const res = await api(kwUrl(wsId));
    expect(res.status).toBe(200);
    const body = await res.json() as { query: string }[];
    expect(body.map(k => k.query)).toContain('content marketing tool');
  });

  it('PATCH pin toggles pinned state and returns updated list', async () => {
    await postJson(kwUrl(wsId), { query: 'local seo guide' });

    const pinRes = await patchJson(
      `${kwUrl(wsId, 'local seo guide')}/pin`,
      {},
    );
    expect(pinRes.status).toBe(200);
    const body = await pinRes.json() as { query: string; pinned: boolean }[];
    const kw = body.find(k => k.query === 'local seo guide');
    expect(kw).toBeDefined();
    // First toggle: should now be pinned
    expect(kw!.pinned).toBe(true);
  });

  it('PATCH pin twice returns to unpinned state', async () => {
    await postJson(kwUrl(wsId), { query: 'backlink strategy' });

    await patchJson(`${kwUrl(wsId, 'backlink strategy')}/pin`, {});
    const secondPin = await patchJson(`${kwUrl(wsId, 'backlink strategy')}/pin`, {});
    expect(secondPin.status).toBe(200);
    const body = await secondPin.json() as { query: string; pinned: boolean }[];
    const kw = body.find(k => k.query === 'backlink strategy');
    expect(kw).toBeDefined();
    expect(kw!.pinned).toBe(false);
  });

  it('DELETE removes the keyword and subsequent GET confirms absence', async () => {
    await postJson(kwUrl(wsId), { query: 'keyword to delete' });

    const delRes = await del(kwUrl(wsId, 'keyword to delete'));
    expect(delRes.status).toBe(200);

    const verifyRes = await api(kwUrl(wsId));
    expect(verifyRes.status).toBe(200);
    const body = await verifyRes.json() as { query: string }[];
    expect(body.map(k => k.query)).not.toContain('keyword to delete');
  });

  it('DELETE on a non-existent keyword returns 200 without error', async () => {
    const res = await del(kwUrl(wsId, 'does-not-exist-keyword'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('KCC hard-delete route handles keywords containing a percent sign', async () => {
    await postJson(kwUrl(wsId), { query: '100% growth' });

    const res = await del(
      `/api/webflow/keyword-command-center/${wsId}/keywords/${encodeURIComponent('100% growth')}`,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; keyword: string };
    expect(body.ok).toBe(true);
    expect(body.keyword).toBe('100 growth');
  });

  it('POST with pinned:true adds keyword already pinned', async () => {
    const res = await postJson(kwUrl(wsId), {
      query: 'pinned from the start',
      pinned: true,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { query: string; pinned: boolean }[];
    const kw = body.find(k => k.query === 'pinned from the start');
    expect(kw).toBeDefined();
    expect(kw!.pinned).toBe(true);
  });
});

// ─── Validation / bad input ───────────────────────────────────────────────────

describe('Admin keyword POST — validation', () => {
  it('missing query field returns 400 with descriptive error', async () => {
    const res = await postJson(kwUrl(wsId), {});
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('query required');
  });

  it('empty-string query returns 400', async () => {
    const res = await postJson(kwUrl(wsId), { query: '' });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('query required');
  });

  it('whitespace-only query returns 400', async () => {
    const res = await postJson(kwUrl(wsId), { query: '   ' });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('query required');
  });

  it('object-type query returns 400', async () => {
    const res = await postJson(kwUrl(wsId), { query: { text: 'embedded object' } });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('query required');
  });

  it('null query returns 400', async () => {
    const res = await postJson(kwUrl(wsId), { query: null });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('query required');
  });
});

// ─── Deduplication ────────────────────────────────────────────────────────────

describe('Admin keyword POST — deduplication', () => {
  it('adding the same keyword twice keeps only one entry', async () => {
    await postJson(kwUrl(wsId), { query: 'duplicate admin keyword' });
    const secondRes = await postJson(kwUrl(wsId), { query: 'duplicate admin keyword' });
    expect(secondRes.status).toBe(200);
    const body = await secondRes.json() as { query: string }[];
    const matches = body.filter(k => k.query === 'duplicate admin keyword');
    expect(matches).toHaveLength(1);
  });

  it('canonical variants are treated as the same keyword (preserves first form)', async () => {
    await postJson(kwUrl(wsId), { query: 'Keyword Variant - Original' });
    const dupRes = await postJson(kwUrl(wsId), { query: ' keyword variant original ' });
    expect(dupRes.status).toBe(200);
    const body = await dupRes.json() as { query: string }[];
    // keywordComparisonKey normalizes both to the same canonical — only one entry
    const matches = body.filter(k =>
      k.query === 'Keyword Variant - Original' || k.query === ' keyword variant original ',
    );
    expect(matches).toHaveLength(1);
  });
});

// ─── Broadcasts ───────────────────────────────────────────────────────────────

describe('Admin keyword mutations — broadcasts', () => {
  it('POST broadcasts RANK_TRACKING_UPDATED with added action', async () => {
    const res = await postJson(kwUrl(wsId), { query: 'broadcast add keyword' });
    expect(res.status).toBe(200);

    const broadcasts = rankTrackingBroadcasts(wsId);
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]).toMatchObject({
      workspaceId: wsId,
      event: WS_EVENTS.RANK_TRACKING_UPDATED,
      payload: expect.objectContaining({ action: 'added', source: 'manual' }),
    });
  });

  it('POST duplicate does NOT broadcast a second time', async () => {
    await postJson(kwUrl(wsId), { query: 'no-dup-broadcast kw' });
    broadcastState.calls = [];

    const res = await postJson(kwUrl(wsId), { query: 'no-dup-broadcast kw' });
    expect(res.status).toBe(200);
    expect(rankTrackingBroadcasts(wsId)).toHaveLength(0);
  });

  it('DELETE broadcasts RANK_TRACKING_UPDATED with removed action', async () => {
    await postJson(kwUrl(wsId), { query: 'broadcast del keyword' });
    broadcastState.calls = [];

    const delRes = await del(kwUrl(wsId, 'broadcast del keyword'));
    expect(delRes.status).toBe(200);

    const broadcasts = rankTrackingBroadcasts(wsId);
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]).toMatchObject({
      workspaceId: wsId,
      event: WS_EVENTS.RANK_TRACKING_UPDATED,
      payload: expect.objectContaining({ action: 'removed' }),
    });
  });

  it('DELETE on non-existent keyword does NOT broadcast', async () => {
    const res = await del(kwUrl(wsId, 'ghost keyword nobody added'));
    expect(res.status).toBe(200);
    expect(rankTrackingBroadcasts(wsId)).toHaveLength(0);
  });

  it('PATCH pin broadcasts RANK_TRACKING_UPDATED with pin_toggled action', async () => {
    await postJson(kwUrl(wsId), { query: 'pin broadcast keyword' });
    broadcastState.calls = [];

    const pinRes = await patchJson(`${kwUrl(wsId, 'pin broadcast keyword')}/pin`, {});
    expect(pinRes.status).toBe(200);

    const broadcasts = rankTrackingBroadcasts(wsId);
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]).toMatchObject({
      workspaceId: wsId,
      event: WS_EVENTS.RANK_TRACKING_UPDATED,
      payload: expect.objectContaining({ action: 'pin_toggled' }),
    });
  });

  it('PATCH pin on non-existent keyword does NOT broadcast', async () => {
    const res = await patchJson(`${kwUrl(wsId, 'ghost-pin-keyword')}/pin`, {});
    expect(res.status).toBe(200);
    expect(rankTrackingBroadcasts(wsId)).toHaveLength(0);
  });
});

// ─── Workspace isolation ──────────────────────────────────────────────────────

describe('Admin keyword mutations — workspace isolation', () => {
  it('keywords added to workspace A do not appear in workspace B list', async () => {
    await postJson(kwUrl(wsId), { query: 'workspace a only keyword' });

    const resB = await api(kwUrl(wsIdB));
    expect(resB.status).toBe(200);
    const bodyB = await resB.json() as { query: string }[];
    expect(bodyB.map(k => k.query)).not.toContain('workspace a only keyword');
  });

  it('keywords added to workspace B do not appear in workspace A list', async () => {
    await postJson(kwUrl(wsIdB), { query: 'workspace b only keyword' });

    const resA = await api(kwUrl(wsId));
    expect(resA.status).toBe(200);
    const bodyA = await resA.json() as { query: string }[];
    expect(bodyA.map(k => k.query)).not.toContain('workspace b only keyword');
  });

  it('deleting a keyword from workspace A does not affect workspace B', async () => {
    await postJson(kwUrl(wsId), { query: 'shared keyword label' });
    await postJson(kwUrl(wsIdB), { query: 'shared keyword label' });

    await del(kwUrl(wsId, 'shared keyword label'));

    const resB = await api(kwUrl(wsIdB));
    expect(resB.status).toBe(200);
    const bodyB = await resB.json() as { query: string }[];
    expect(bodyB.map(k => k.query)).toContain('shared keyword label');
  });

  it('broadcasts from workspace A are scoped only to workspace A', async () => {
    await postJson(kwUrl(wsId), { query: 'isolation broadcast keyword' });

    const broadcastsForA = rankTrackingBroadcasts(wsId);
    const broadcastsForB = rankTrackingBroadcasts(wsIdB);
    expect(broadcastsForA).toHaveLength(1);
    expect(broadcastsForB).toHaveLength(0);
  });
});

// ─── Multiple keywords ────────────────────────────────────────────────────────

describe('Admin keyword mutations — multiple keyword scenarios', () => {
  it('can add multiple distinct keywords and all appear in the list', async () => {
    await postJson(kwUrl(wsId), { query: 'kw alpha' });
    await postJson(kwUrl(wsId), { query: 'kw beta' });
    await postJson(kwUrl(wsId), { query: 'kw gamma' });

    const res = await api(kwUrl(wsId));
    const body = await res.json() as { query: string }[];
    const queries = body.map(k => k.query);
    expect(queries).toContain('kw alpha');
    expect(queries).toContain('kw beta');
    expect(queries).toContain('kw gamma');
  });

  it('deleting one keyword leaves other keywords intact', async () => {
    await postJson(kwUrl(wsId), { query: 'keep one' });
    await postJson(kwUrl(wsId), { query: 'remove one' });
    await postJson(kwUrl(wsId), { query: 'keep two' });

    await del(kwUrl(wsId, 'remove one'));

    const remaining = getTrackedKeywords(wsId).map(k => k.query);
    expect(remaining).toContain('keep one');
    expect(remaining).toContain('keep two');
    expect(remaining).not.toContain('remove one');
  });
});

// ─── Rank history endpoint ────────────────────────────────────────────────────

describe('GET /api/rank-tracking/:workspaceId/history — edge cases', () => {
  it('negative limit returns 400', async () => {
    const res = await api(`/api/rank-tracking/${wsId}/history?limit=-5`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('limit must be a positive integer');
  });

  it('float limit returns 400', async () => {
    const res = await api(`/api/rank-tracking/${wsId}/history?limit=3.7`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('limit must be a positive integer');
  });

  it('valid integer limit returns 200', async () => {
    const res = await api(`/api/rank-tracking/${wsId}/history?limit=30`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('no limit param uses default (90 days) and returns 200', async () => {
    const res = await api(`/api/rank-tracking/${wsId}/history`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('?queries= filter parameter returns 200', async () => {
    const res = await api(
      `/api/rank-tracking/${wsId}/history?queries=${encodeURIComponent('kw alpha,kw beta')}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('repeated ?query= filters preserve keywords containing commas', async () => {
    storeRankSnapshot(wsId, '2026-06-01', [
      { query: 'dentist, chicago', position: 3.2, clicks: 12, impressions: 100, ctr: 0.12 },
      { query: 'orthodontist chicago', position: 8.4, clicks: 5, impressions: 60, ctr: 0.0833 },
    ]);

    const res = await api(
      `/api/rank-tracking/${wsId}/history?query=${encodeURIComponent('dentist, chicago')}&query=${encodeURIComponent('orthodontist chicago')}`,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ date: string; positions: Record<string, number> }>;
    expect(body).toEqual([
      {
        date: '2026-06-01',
        positions: {
          'dentist, chicago': 3.2,
          'orthodontist chicago': 8.4,
        },
      },
    ]);
    expect(body[0].positions).not.toHaveProperty('dentist');
    expect(body[0].positions).not.toHaveProperty('chicago');
  });
});

// ─── Public endpoints — basic guard ──────────────────────────────────────────

describe('Public rank-tracking endpoints — basic contract', () => {
  // Behavior change 2026-05-27 (sprint-platform-health-wave8 Plan A Task 1):
  // both endpoints now require authenticated portal access. Auth runs before
  // request validation, so even a 400-shaped request (negative limit) hits
  // the 401 first. Full 200/401/cross-workspace coverage with a real session
  // lives in tests/integration/public-endpoint-auth.test.ts.
  it('GET /api/public/rank-tracking/:workspaceId/history without portal session returns 401', async () => {
    const res = await api(`/api/public/rank-tracking/${wsId}/history`);
    expect(res.status).toBe(401);
  });

  it('GET /api/public/rank-tracking/:workspaceId/latest without portal session returns 401', async () => {
    const res = await api(`/api/public/rank-tracking/${wsId}/latest`);
    expect(res.status).toBe(401);
  });

  it('GET /api/public/rank-tracking/:workspaceId/history without portal session also 401s on invalid limit (auth runs first)', async () => {
    const res = await api(`/api/public/rank-tracking/${wsId}/history?limit=-1`);
    expect(res.status).toBe(401);
  });
});
