/**
 * Integration tests: full lifecycle for the public keyword feedback endpoints.
 *
 * Port: 13855
 *
 * Covers:
 * - GET  /api/public/keyword-feedback/:workspaceId     — empty and populated
 * - POST /api/public/keyword-feedback/:workspaceId     — positive/negative/update/validation
 * - POST /api/public/keyword-feedback/:workspaceId/bulk — multi-keyword, empty array
 * - DELETE /api/public/keyword-feedback/:workspaceId   — delete, not-found idempotency
 * - Broadcast payload verification after each mutation
 * - Workspace isolation
 *
 * Each describe block uses its own workspace so write requests stay within the
 * publicWriteLimiter (10/min per path) that app.ts applies to all POST/DELETE
 * requests under /api/public/.
 *
 * Auth: workspaces use a client JWT cookie signed via signClientToken().
 * The DELETE endpoint reads the keyword from req.body.keyword.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';

// ── Hoisted broadcast state ───────────────────────────────────────────────────

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

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import db from '../../server/db/index.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createClientUser, deleteClientUser, signClientToken } from '../../server/client-users.js';
import type { SafeClientUser } from '../../server/client-users.js';
import { keywordComparisonKey } from '../../shared/keyword-normalization.js';
import { withPublicTestAuth } from './public-auth-test-helpers.js';

// ── Server setup ──────────────────────────────────────────────────────────────

let baseUrl = '';
let server: http.Server | undefined;

const originalAppPassword = process.env.APP_PASSWORD;

async function startTestServer(): Promise<void> {
  // Ensure APP_PASSWORD is empty so the server skips the HMAC auth gate.
  // Must be set before createApp() so the middleware reads the updated env.
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

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, withPublicTestAuth(path, opts));
}

async function authedPostJson(
  path: string,
  body: unknown,
  token: string,
  workspaceId: string,
): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `client_user_token_${workspaceId}=${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function authedDeleteJson(
  path: string,
  body: unknown,
  token: string,
  workspaceId: string,
): Promise<Response> {
  return api(path, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `client_user_token_${workspaceId}=${token}`,
    },
    body: JSON.stringify(body),
  });
}

// ── Workspace factory ─────────────────────────────────────────────────────────
// Each describe block gets its own workspace so write requests stay within the
// publicWriteLimiter bucket of 10/min per path (keyed on IP + req.path).

interface TestWorkspace {
  wsId: string;
  clientUserId: string;
  token: string;
  cleanup: () => void;
}

async function makeTestWorkspace(label: string): Promise<TestWorkspace> {
  const suffix = randomUUID().slice(0, 8);
  const ws = createWorkspace(`KwFeedback-${label}-${suffix}`);
  const user: SafeClientUser = await createClientUser(
    `kw-feedback-${suffix}@test.local`,
    'TestPass1!',
    `KW Feedback ${label}`,
    ws.id,
    'client_member',
  );
  const token = signClientToken(user);
  return {
    wsId: ws.id,
    clientUserId: user.id,
    token,
    cleanup() {
      db.prepare('DELETE FROM keyword_feedback WHERE workspace_id = ?').run(ws.id);
      db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(ws.id);
      deleteClientUser(user.id, ws.id);
      deleteWorkspace(ws.id);
    },
  };
}

// ── Global lifecycle ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await startTestServer();
}, 30_000);

afterAll(async () => {
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
});

beforeEach(() => {
  broadcastState.calls = [];
});

// ── GET /api/public/keyword-feedback/:workspaceId ─────────────────────────────

describe('GET /api/public/keyword-feedback/:workspaceId', () => {
  let ws: TestWorkspace;

  beforeAll(async () => {
    ws = await makeTestWorkspace('GET');
  });

  afterAll(() => ws.cleanup());

  it('returns empty array for a fresh workspace', async () => {
    const freshWs = createWorkspace(`KwFeedback-Fresh-${randomUUID().slice(0, 8)}`);
    try {
      const res = await api(`/api/public/keyword-feedback/${freshWs.id}`);
      expect(res.status).toBe(200);
      const body = await res.json() as unknown[];
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(0);
    } finally {
      deleteWorkspace(freshWs.id);
    }
  });

  it('returns feedback after it has been set', async () => {
    // Seed a row directly so this GET test does not depend on POST
    const storedKw = keywordComparisonKey('get test keyword');
    db.prepare(`
      INSERT OR REPLACE INTO keyword_feedback (workspace_id, keyword, status, source, declined_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(ws.wsId, storedKw, 'approved', 'content_gap', 'client');

    const res = await api(`/api/public/keyword-feedback/${ws.wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ keyword: string; status: string }>;
    const found = body.find(r => r.keyword === storedKw);
    expect(found).toBeDefined();
    expect(found!.status).toBe('approved');

    // Cleanup seeded row
    db.prepare('DELETE FROM keyword_feedback WHERE workspace_id = ? AND keyword = ?').run(ws.wsId, storedKw);
  });
});

// ── POST /api/public/keyword-feedback/:workspaceId — single update ────────────

describe("POST /api/public/keyword-feedback/:workspaceId — single update", () => {
  let ws: TestWorkspace;

  beforeAll(async () => {
    ws = await makeTestWorkspace('Single');
  });

  afterAll(() => ws.cleanup());

  it("sets 'approved' status for a keyword and returns the stored record", async () => {
    const keyword = `positive kw ${randomUUID().slice(0, 8)}`;
    const res = await authedPostJson(
      `/api/public/keyword-feedback/${ws.wsId}`,
      { keyword, status: 'approved' },
      ws.token,
      ws.wsId,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { keyword: string; status: string };
    expect(body.status).toBe('approved');
  });

  it("sets 'declined' status for a keyword", async () => {
    const keyword = `negative kw ${randomUUID().slice(0, 8)}`;
    const res = await authedPostJson(
      `/api/public/keyword-feedback/${ws.wsId}`,
      { keyword, status: 'declined', reason: 'Not relevant' },
      ws.token,
      ws.wsId,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { keyword: string; status: string; reason: string | null };
    expect(body.status).toBe('declined');
    expect(body.reason).toBe('Not relevant');
  });

  it('updates existing keyword from approved to declined (overwrites)', async () => {
    const keyword = `overwrite kw ${randomUUID().slice(0, 8)}`;
    const normalizedKw = keywordComparisonKey(keyword);

    // First: set approved
    await authedPostJson(
      `/api/public/keyword-feedback/${ws.wsId}`,
      { keyword, status: 'approved' },
      ws.token,
      ws.wsId,
    );

    // Then: overwrite with declined
    const res = await authedPostJson(
      `/api/public/keyword-feedback/${ws.wsId}`,
      { keyword, status: 'declined', reason: 'Changed mind' },
      ws.token,
      ws.wsId,
    );
    expect(res.status).toBe(200);

    // Verify DB row reflects the updated status
    const row = db
      .prepare('SELECT status FROM keyword_feedback WHERE workspace_id = ? AND keyword = ?')
      .get(ws.wsId, normalizedKw) as { status: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.status).toBe('declined');
  });

  it('fires INTELLIGENCE_SIGNALS_UPDATED and STRATEGY_UPDATED broadcasts', async () => {
    const keyword = `broadcast single ${randomUUID().slice(0, 8)}`;
    await authedPostJson(
      `/api/public/keyword-feedback/${ws.wsId}`,
      { keyword, status: 'declined' },
      ws.token,
      ws.wsId,
    );

    const events = broadcastState.calls.map(c => c.event);
    expect(events).toContain(WS_EVENTS.INTELLIGENCE_SIGNALS_UPDATED);
    expect(events).toContain(WS_EVENTS.STRATEGY_UPDATED);

    // All broadcast calls should target the correct workspace
    for (const call of broadcastState.calls) {
      expect(call.workspaceId).toBe(ws.wsId);
    }
  });

  it('returns 400 for missing keyword field', async () => {
    const res = await authedPostJson(
      `/api/public/keyword-feedback/${ws.wsId}`,
      { status: 'approved' },
      ws.token,
      ws.wsId,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });

  it('returns 400 for invalid status value', async () => {
    const res = await authedPostJson(
      `/api/public/keyword-feedback/${ws.wsId}`,
      { keyword: 'some keyword', status: 'invalid_status' },
      ws.token,
      ws.wsId,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });
});

// ── POST /api/public/keyword-feedback/:workspaceId/bulk ───────────────────────

describe('POST /api/public/keyword-feedback/:workspaceId/bulk', () => {
  let ws: TestWorkspace;

  beforeAll(async () => {
    ws = await makeTestWorkspace('Bulk');
  });

  afterAll(() => ws.cleanup());

  it('sets feedback for multiple keywords in one call and returns updated count', async () => {
    const kwA = `bulk kw a ${randomUUID().slice(0, 8)}`;
    const kwB = `bulk kw b ${randomUUID().slice(0, 8)}`;

    const res = await authedPostJson(
      `/api/public/keyword-feedback/${ws.wsId}/bulk`,
      {
        keywords: [
          { keyword: kwA, status: 'approved' },
          { keyword: kwB, status: 'declined', reason: 'Not a fit' },
        ],
      },
      ws.token,
      ws.wsId,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { updated: number };
    expect(body.updated).toBe(2);
  });

  it('persists all bulk changes and they appear in subsequent GET', async () => {
    const kwC = `bulk persist c ${randomUUID().slice(0, 8)}`;
    const kwD = `bulk persist d ${randomUUID().slice(0, 8)}`;

    await authedPostJson(
      `/api/public/keyword-feedback/${ws.wsId}/bulk`,
      {
        keywords: [
          { keyword: kwC, status: 'approved' },
          { keyword: kwD, status: 'declined' },
        ],
      },
      ws.token,
      ws.wsId,
    );

    const res = await api(`/api/public/keyword-feedback/${ws.wsId}`);
    const body = await res.json() as Array<{ keyword: string; status: string }>;

    const normalizedC = keywordComparisonKey(kwC);
    const normalizedD = keywordComparisonKey(kwD);
    const rowC = body.find(r => r.keyword === normalizedC);
    const rowD = body.find(r => r.keyword === normalizedD);
    expect(rowC).toBeDefined();
    expect(rowC!.status).toBe('approved');
    expect(rowD).toBeDefined();
    expect(rowD!.status).toBe('declined');
  });

  it('fires INTELLIGENCE_SIGNALS_UPDATED and STRATEGY_UPDATED broadcasts for bulk update', async () => {
    const kw = `bulk broadcast ${randomUUID().slice(0, 8)}`;

    await authedPostJson(
      `/api/public/keyword-feedback/${ws.wsId}/bulk`,
      { keywords: [{ keyword: kw, status: 'declined' }] },
      ws.token,
      ws.wsId,
    );

    const events = broadcastState.calls.map(c => c.event);
    expect(events).toContain(WS_EVENTS.INTELLIGENCE_SIGNALS_UPDATED);
    expect(events).toContain(WS_EVENTS.STRATEGY_UPDATED);
  });

  it('returns 400 for an empty keywords array (schema requires min 1)', async () => {
    const res = await authedPostJson(
      `/api/public/keyword-feedback/${ws.wsId}/bulk`,
      { keywords: [] },
      ws.token,
      ws.wsId,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });
});

// ── DELETE /api/public/keyword-feedback/:workspaceId ─────────────────────────

describe('DELETE /api/public/keyword-feedback/:workspaceId', () => {
  let ws: TestWorkspace;

  beforeAll(async () => {
    ws = await makeTestWorkspace('Delete');
  });

  afterAll(() => ws.cleanup());

  it('deletes feedback for specified keyword and returns { deleted, existed: true }', async () => {
    const keyword = `delete kw ${randomUUID().slice(0, 8)}`;
    // Seed the row via DB directly to stay within rate limit
    db.prepare(`
      INSERT OR REPLACE INTO keyword_feedback (workspace_id, keyword, status, source, declined_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(ws.wsId, keywordComparisonKey(keyword), 'declined', 'content_gap', 'client');

    const res = await authedDeleteJson(
      `/api/public/keyword-feedback/${ws.wsId}`,
      { keyword },
      ws.token,
      ws.wsId,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { deleted: string; existed: boolean };
    expect(body.existed).toBe(true);
    expect(typeof body.deleted).toBe('string');
  });

  it('keyword is no longer present in subsequent GET after deletion', async () => {
    const keyword = `gone after delete ${randomUUID().slice(0, 8)}`;
    // Seed via DB directly
    db.prepare(`
      INSERT OR REPLACE INTO keyword_feedback (workspace_id, keyword, status, source, declined_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(ws.wsId, keywordComparisonKey(keyword), 'approved', 'content_gap', 'client');

    await authedDeleteJson(
      `/api/public/keyword-feedback/${ws.wsId}`,
      { keyword },
      ws.token,
      ws.wsId,
    );

    const res = await api(`/api/public/keyword-feedback/${ws.wsId}`);
    const body = await res.json() as Array<{ keyword: string }>;
    const normalized = keywordComparisonKey(keyword);
    const found = body.find(r => r.keyword === normalized);
    expect(found).toBeUndefined();
  });

  it('returns 200 with existed: false if keyword does not exist (idempotent)', async () => {
    const keyword = `never existed ${randomUUID().slice(0, 8)}`;
    const res = await authedDeleteJson(
      `/api/public/keyword-feedback/${ws.wsId}`,
      { keyword },
      ws.token,
      ws.wsId,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { deleted: string; existed: boolean };
    expect(body.existed).toBe(false);
  });

  it('fires INTELLIGENCE_SIGNALS_UPDATED and STRATEGY_UPDATED broadcasts after deletion', async () => {
    const keyword = `delete broadcast ${randomUUID().slice(0, 8)}`;
    // Seed via DB directly, then delete via API to observe broadcasts
    db.prepare(`
      INSERT OR REPLACE INTO keyword_feedback (workspace_id, keyword, status, source, declined_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(ws.wsId, keywordComparisonKey(keyword), 'declined', 'content_gap', 'client');

    broadcastState.calls = [];

    await authedDeleteJson(
      `/api/public/keyword-feedback/${ws.wsId}`,
      { keyword },
      ws.token,
      ws.wsId,
    );

    const events = broadcastState.calls.map(c => c.event);
    expect(events).toContain(WS_EVENTS.INTELLIGENCE_SIGNALS_UPDATED);
    expect(events).toContain(WS_EVENTS.STRATEGY_UPDATED);
  });
});

// ── Workspace isolation ───────────────────────────────────────────────────────

describe('Workspace isolation', () => {
  let wsA: TestWorkspace;
  let wsB: TestWorkspace;

  beforeAll(async () => {
    [wsA, wsB] = await Promise.all([
      makeTestWorkspace('IsoA'),
      makeTestWorkspace('IsoB'),
    ]);
  });

  afterAll(() => {
    wsA.cleanup();
    wsB.cleanup();
  });

  it('GET returns only feedback for the requested workspace, not another', async () => {
    const kwA = `isolation ws a ${randomUUID().slice(0, 8)}`;
    const kwB = `isolation ws b ${randomUUID().slice(0, 8)}`;

    // Seed via DB directly to keep writes to each path under the rate limit
    db.prepare(`
      INSERT OR REPLACE INTO keyword_feedback (workspace_id, keyword, status, source, declined_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(wsA.wsId, keywordComparisonKey(kwA), 'approved', 'content_gap', 'client');

    db.prepare(`
      INSERT OR REPLACE INTO keyword_feedback (workspace_id, keyword, status, source, declined_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(wsB.wsId, keywordComparisonKey(kwB), 'declined', 'content_gap', 'client');

    const normalizedA = keywordComparisonKey(kwA);
    const normalizedB = keywordComparisonKey(kwB);

    // Fetch wsA — should contain kwA but NOT kwB
    const resA = await api(`/api/public/keyword-feedback/${wsA.wsId}`);
    const bodyA = await resA.json() as Array<{ keyword: string }>;
    expect(bodyA.some(r => r.keyword === normalizedA)).toBe(true);
    expect(bodyA.some(r => r.keyword === normalizedB)).toBe(false);

    // Fetch wsB — should contain kwB but NOT kwA
    const resB = await api(`/api/public/keyword-feedback/${wsB.wsId}`);
    const bodyB = await resB.json() as Array<{ keyword: string }>;
    expect(bodyB.some(r => r.keyword === normalizedB)).toBe(true);
    expect(bodyB.some(r => r.keyword === normalizedA)).toBe(false);
  });
});
