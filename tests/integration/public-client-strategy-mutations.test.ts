/**
 * Integration tests for client portal strategy mutation endpoints.
 *
 * Covers:
 * - POST /api/public/business-priorities/:workspaceId
 * - GET  /api/public/business-priorities/:workspaceId
 * - POST /api/public/content-gap-vote/:workspaceId
 * - GET  /api/public/content-gap-votes/:workspaceId
 * - PATCH /api/public/workspaces/:id/business-profile
 *
 * Uses an in-process server (dynamic port) so vi.mock interception works for
 * broadcast and email.
 *
 * Port: dynamic (server.listen(0, ...))
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import { getKeywordStrategyGenerationState } from '../../server/keyword-strategy-generation-store.js';

// ── Hoisted mock state ────────────────────────────────────────────────────────

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

// Bypass rate limiting — tests issue many writes in rapid succession and would
// otherwise exhaust the 10 req/min publicWriteLimiter or 60 req/min publicApiLimiter.
// The rate-limiter module is already covered by its own dedicated tests.
// noopMiddleware is inlined inside the factory (not a module-level const) to
// avoid TDZ: vi.mock factories are hoisted above all module declarations, so any
// const defined at module scope is uninitialized when the factory runs.
vi.mock('../../server/middleware.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/middleware.js')>();
  const noop = (_req: unknown, _res: unknown, next: () => void) => next();
  return {
    ...original,
    publicWriteLimiter: noop,
    publicApiLimiter: noop,
    globalPublicLimiter: noop,
  };
});

// ── Imports after mocks ───────────────────────────────────────────────────────

import db from '../../server/db/index.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createClientUser, deleteClientUser, signClientToken } from '../../server/client-users.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { withPublicTestAuth } from './public-auth-test-helpers.js';

// ── In-process server setup ───────────────────────────────────────────────────

let baseUrl = '';
let server: http.Server | undefined;

let wsId = '';
let otherWsId = '';
let clientUserId = '';
let clientToken = '';
let otherClientUserId = '';
let otherClientToken = '';

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
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

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function withClientAuth(workspaceId: string, token: string): Record<string, string> {
  return {
    Cookie: `client_user_token_${workspaceId}=${token}`,
    'Content-Type': 'application/json',
  };
}

async function clientPostJson(path: string, body: unknown, workspaceId = wsId, token = clientToken): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: withClientAuth(workspaceId, token),
    body: JSON.stringify(body),
  });
}

async function clientPatchJson(path: string, body: unknown, workspaceId = wsId, token = clientToken): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: withClientAuth(workspaceId, token),
    body: JSON.stringify(body),
  });
}

async function getJson(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, withPublicTestAuth(path));
}

// ── DB helpers ────────────────────────────────────────────────────────────────

function getStoredVotes(workspaceId: string): Array<{ keyword: string; vote: string }> {
  return db
    .prepare('SELECT keyword, vote FROM content_gap_votes WHERE workspace_id = ?')
    .all(workspaceId) as Array<{ keyword: string; vote: string }>;
}

function getStoredPriorities(workspaceId: string): unknown[] | null {
  const row = db
    .prepare('SELECT priorities FROM client_business_priorities WHERE workspace_id = ?')
    .get(workspaceId) as { priorities: string } | undefined;
  return row ? (JSON.parse(row.priorities) as unknown[]) : null;
}

function clearBroadcastCalls(): void {
  broadcastState.calls.length = 0;
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await startTestServer();

  const wsA = createWorkspace('StrategyMutation-WsA');
  const wsB = createWorkspace('StrategyMutation-WsB');
  wsId = wsA.id;
  otherWsId = wsB.id;

  const user = await createClientUser(
    `strat-mut-${randomUUID().slice(0, 8)}@test.local`,
    'ClientPass1!',
    'Strategy Client',
    wsId,
    'client_member',
  );
  clientUserId = user.id;
  clientToken = signClientToken(user);

  const otherUser = await createClientUser(
    `strat-mut-other-${randomUUID().slice(0, 8)}@test.local`,
    'ClientPass1!',
    'Other Strategy Client',
    otherWsId,
    'client_member',
  );
  otherClientUserId = otherUser.id;
  otherClientToken = signClientToken(otherUser);
}, 30_000);

afterAll(async () => {
  db.prepare('DELETE FROM content_gap_votes WHERE workspace_id IN (?, ?)').run(wsId, otherWsId);
  db.prepare('DELETE FROM client_business_priorities WHERE workspace_id IN (?, ?)').run(wsId, otherWsId);
  db.prepare('DELETE FROM activity_log WHERE workspace_id IN (?, ?)').run(wsId, otherWsId);

  if (clientUserId) deleteClientUser(clientUserId, wsId);
  if (otherClientUserId) deleteClientUser(otherClientUserId, otherWsId);

  deleteWorkspace(wsId);
  deleteWorkspace(otherWsId);

  await stopTestServer();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/public/business-priorities/:workspaceId', () => {
  it('sets business priorities and returns saved count', async () => {
    const res = await clientPostJson(`/api/public/business-priorities/${wsId}`, {
      priorities: [
        { text: 'Grow enterprise pipeline', category: 'growth' },
        { text: 'Clarify brand positioning', category: 'brand' },
      ],
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { saved: number; priorities: unknown[]; updatedAt: string };
    expect(body.saved).toBe(2);
    expect(body.priorities).toHaveLength(2);
    expect(body.updatedAt).toEqual(expect.any(String));
  });

  it('priorities persist and appear in subsequent GET', async () => {
    await clientPostJson(`/api/public/business-priorities/${wsId}`, {
      priorities: [{ text: 'Expand audience reach', category: 'audience' }],
    });

    const stored = getStoredPriorities(wsId);
    expect(stored).toEqual([{ text: 'Expand audience reach', category: 'audience' }]);
  });

  it('returns 401 without auth cookie', async () => {
    const res = await fetch(`${baseUrl}/api/public/business-priorities/${wsId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priorities: [{ text: 'Sneaky write', category: 'growth' }] }),
    });

    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/auth/i);
  });

  it('returns 400 for invalid schema (null priority item)', async () => {
    const res = await clientPostJson(`/api/public/business-priorities/${wsId}`, {
      priorities: [null],
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 when priorities field is missing entirely', async () => {
    const res = await clientPostJson(`/api/public/business-priorities/${wsId}`, {});

    expect(res.status).toBe(400);
  });

  it('rejects a token from another workspace', async () => {
    const res = await clientPostJson(
      `/api/public/business-priorities/${wsId}`,
      { priorities: [{ text: 'Cross-workspace write', category: 'growth' }] },
      wsId,
      otherClientToken,
    );

    expect(res.status).toBe(401);
  });
});

describe('GET /api/public/business-priorities/:workspaceId', () => {
  it('returns current priorities for workspace after a save', async () => {
    // Seed some priorities
    await clientPostJson(`/api/public/business-priorities/${wsId}`, {
      priorities: [
        { text: 'Drive organic traffic', category: 'growth' },
        { text: 'Improve brand recall', category: 'brand' },
      ],
    });

    const res = await getJson(`/api/public/business-priorities/${wsId}`);
    expect(res.status).toBe(200);

    const body = await res.json() as { priorities: Array<{ text: string; category: string }>; updatedAt: string | null };
    expect(Array.isArray(body.priorities)).toBe(true);
    expect(body.priorities.length).toBe(2);
    expect(body.priorities[0]).toMatchObject({ text: 'Drive organic traffic', category: 'growth' });
    expect(body.priorities[1]).toMatchObject({ text: 'Improve brand recall', category: 'brand' });
    expect(body.updatedAt).toBeTruthy();
  });

  it('returns empty priorities for a fresh workspace with no prior saves', async () => {
    const freshWs = createWorkspace('StrategyMutation-Fresh');
    try {
      const res = await getJson(`/api/public/business-priorities/${freshWs.id}`);
      expect(res.status).toBe(200);

      const body = await res.json() as { priorities: unknown[]; updatedAt: null };
      expect(body.priorities).toEqual([]);
      expect(body.updatedAt).toBeNull();
    } finally {
      deleteWorkspace(freshWs.id);
    }
  });
});

describe('POST /api/public/content-gap-vote/:workspaceId', () => {
  it('creates a vote and returns { ok: true }', async () => {
    const revisionBefore = getKeywordStrategyGenerationState(wsId).revision;
    const res = await clientPostJson(`/api/public/content-gap-vote/${wsId}`, {
      keyword: 'seo audit software',
      vote: 'up',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(getKeywordStrategyGenerationState(wsId).revision).toBe(revisionBefore + 1);
  });

  it('stores the vote with the correct keyword (normalized) and vote value', async () => {
    // Keyword with mixed case and hyphens — normalization lowercases and replaces hyphens with spaces
    await clientPostJson(`/api/public/content-gap-vote/${wsId}`, {
      keyword: 'Keyword-Research Tools',
      vote: 'up',
    });

    const rows = getStoredVotes(wsId);
    // After normalization: 'Keyword-Research Tools' → 'keyword research tools'
    const hit = rows.find(r => r.keyword === 'keyword research tools');
    expect(hit).toBeDefined();
    expect(hit!.vote).toBe('up');
  });

  it('subsequent vote for same keyword overwrites (upsert behavior)', async () => {
    // Keywords are normalized: hyphens become spaces, lowercased
    const keyword = 'upsert test kw alpha';
    const normalizedKw = keyword; // already normalized (no special chars)

    await clientPostJson(`/api/public/content-gap-vote/${wsId}`, { keyword, vote: 'up' });
    await clientPostJson(`/api/public/content-gap-vote/${wsId}`, { keyword, vote: 'down' });

    const rows = getStoredVotes(wsId);
    const hits = rows.filter(r => r.keyword === normalizedKw);
    expect(hits).toHaveLength(1);
    expect(hits[0].vote).toBe('down');
  });

  it('vote=none removes the existing vote row', async () => {
    // Use a simple normalized keyword (no special chars so normalization is identity)
    const keyword = 'clear test kw beta';

    await clientPostJson(`/api/public/content-gap-vote/${wsId}`, { keyword, vote: 'up' });
    const beforeRows = getStoredVotes(wsId).filter(r => r.keyword === keyword);
    expect(beforeRows).toHaveLength(1);

    await clientPostJson(`/api/public/content-gap-vote/${wsId}`, { keyword, vote: 'none' });
    const afterRows = getStoredVotes(wsId).filter(r => r.keyword === keyword);
    expect(afterRows).toHaveLength(0);
  });

  it('does not invalidate, broadcast, or log an unchanged clear', async () => {
    const keyword = `never voted ${randomUUID()}`;
    const revisionBefore = getKeywordStrategyGenerationState(wsId).revision;
    const activityBefore = (db.prepare(`
      SELECT COUNT(*) AS count FROM activity_log
      WHERE workspace_id = ? AND type = 'client_content_gap_vote'
    `).get(wsId) as { count: number }).count;
    clearBroadcastCalls();

    const res = await clientPostJson(`/api/public/content-gap-vote/${wsId}`, { keyword, vote: 'none' });

    expect(res.status).toBe(200);
    expect(getKeywordStrategyGenerationState(wsId).revision).toBe(revisionBefore);
    expect(broadcastState.calls).toHaveLength(0);
    expect((db.prepare(`
      SELECT COUNT(*) AS count FROM activity_log
      WHERE workspace_id = ? AND type = 'client_content_gap_vote'
    `).get(wsId) as { count: number }).count).toBe(activityBefore);
  });

  it('rejects punctuation-only keywords without changing revision', async () => {
    const revisionBefore = getKeywordStrategyGenerationState(wsId).revision;
    const res = await clientPostJson(`/api/public/content-gap-vote/${wsId}`, {
      keyword: '!!!',
      vote: 'up',
    });

    expect(res.status).toBe(400);
    expect(getKeywordStrategyGenerationState(wsId).revision).toBe(revisionBefore);
  });

  it('rolls back the vote when generation revision invalidation fails', async () => {
    const keyword = `rollback vote ${randomUUID()}`;
    db.exec(`
      CREATE TEMP TRIGGER fail_content_gap_vote_revision
      BEFORE UPDATE OF keyword_strategy_generation_revision ON workspaces
      BEGIN
        SELECT RAISE(ABORT, 'forced vote revision failure');
      END;
    `);
    try {
      const res = await clientPostJson(`/api/public/content-gap-vote/${wsId}`, { keyword, vote: 'up' });
      expect(res.status).toBe(500);
      expect(db.prepare(`
        SELECT 1 FROM content_gap_votes_v2_compat
        WHERE workspace_id = ? AND raw_keyword = ?
      `).get(wsId, keyword)).toBeUndefined();
    } finally {
      db.exec('DROP TRIGGER IF EXISTS fail_content_gap_vote_revision');
    }
  });

  it('returns 401 without auth cookie', async () => {
    const res = await fetch(`${baseUrl}/api/public/content-gap-vote/${wsId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: 'unauthorized vote', vote: 'up' }),
    });

    expect(res.status).toBe(401);
  });

  it('returns 400 for missing keyword', async () => {
    const res = await clientPostJson(`/api/public/content-gap-vote/${wsId}`, {
      vote: 'up',
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 for missing vote field', async () => {
    const res = await clientPostJson(`/api/public/content-gap-vote/${wsId}`, {
      keyword: 'some keyword',
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid vote value', async () => {
    const res = await clientPostJson(`/api/public/content-gap-vote/${wsId}`, {
      keyword: 'some keyword',
      vote: 'maybe',
    });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/public/content-gap-votes/:workspaceId', () => {
  it('returns meaning-distinct raw Unicode vote keys and clears them exactly', async () => {
    await clientPostJson(`/api/public/content-gap-vote/${wsId}`, { keyword: 'C', vote: 'down' });
    await clientPostJson(`/api/public/content-gap-vote/${wsId}`, { keyword: 'C#', vote: 'up' });
    await clientPostJson(`/api/public/content-gap-vote/${wsId}`, { keyword: '東京', vote: 'up' });
    await clientPostJson(`/api/public/content-gap-vote/${wsId}`, { keyword: '__proto__', vote: 'down' });

    const before = await getJson(`/api/public/content-gap-votes/${wsId}`);
    expect(await before.json()).toEqual(expect.objectContaining({
      votes: expect.objectContaining({ C: 'down', 'C#': 'up', '東京': 'up', __proto__: 'down' }),
    }));
    const beforeBody = await (await getJson(`/api/public/content-gap-votes/${wsId}`)).json() as {
      votes: Record<string, string>;
    };
    expect(Object.prototype.hasOwnProperty.call(beforeBody.votes, '__proto__')).toBe(true);

    await clientPostJson(`/api/public/content-gap-vote/${wsId}`, { keyword: 'C#', vote: 'none' });
    const after = await getJson(`/api/public/content-gap-votes/${wsId}`);
    const body = await after.json() as { votes: Record<string, string> };
    expect(body.votes.C).toBe('down');
    expect(body.votes['C#']).toBeUndefined();
    expect(body.votes['東京']).toBe('up');
  });

  it('returns votes map after seeding votes', async () => {
    // Use keywords without special chars so normalization is identity
    const kwAlpha = 'vote get test alpha unique';
    const kwBeta = 'vote get test beta unique';

    const r1 = await clientPostJson(`/api/public/content-gap-vote/${wsId}`, {
      keyword: kwAlpha,
      vote: 'up',
    });
    expect(r1.status).toBe(200);

    const r2 = await clientPostJson(`/api/public/content-gap-vote/${wsId}`, {
      keyword: kwBeta,
      vote: 'down',
    });
    expect(r2.status).toBe(200);

    const res = await getJson(`/api/public/content-gap-votes/${wsId}`);
    expect(res.status).toBe(200);

    const body = await res.json() as { votes: Record<string, string> };
    expect(typeof body.votes).toBe('object');
    // The stored/returned key is the normalized form (lowercased, special chars → space)
    expect(body.votes[kwAlpha]).toBe('up');
    expect(body.votes[kwBeta]).toBe('down');
  });

  it('returns empty votes object for a fresh workspace', async () => {
    const freshWs = createWorkspace('StrategyMutation-VoteFresh');
    try {
      const res = await getJson(`/api/public/content-gap-votes/${freshWs.id}`);
      expect(res.status).toBe(200);

      const body = await res.json() as { votes: Record<string, string> };
      expect(body.votes).toEqual({});
    } finally {
      deleteWorkspace(freshWs.id);
    }
  });
});

describe('Broadcasts after mutations', () => {
  it('POST business-priorities broadcasts STRATEGY_UPDATED event', async () => {
    clearBroadcastCalls();

    await clientPostJson(`/api/public/business-priorities/${wsId}`, {
      priorities: [{ text: 'Broadcast test priority', category: 'growth' }],
    });

    const match = broadcastState.calls.find(
      c => c.workspaceId === wsId && c.event === WS_EVENTS.STRATEGY_UPDATED,
    );
    expect(match).toBeDefined();
    const payload = match!.payload as { businessPriorities: unknown[] };
    expect(Array.isArray(payload.businessPriorities)).toBe(true);
    expect(payload.businessPriorities).toHaveLength(1);
  });

  it('POST content-gap-vote broadcasts STRATEGY_UPDATED event', async () => {
    clearBroadcastCalls();

    await clientPostJson(`/api/public/content-gap-vote/${wsId}`, {
      keyword: 'broadcast vote test kw',
      vote: 'up',
    });

    const match = broadcastState.calls.find(
      c => c.workspaceId === wsId && c.event === WS_EVENTS.STRATEGY_UPDATED,
    );
    expect(match).toBeDefined();
    const payload = match!.payload as { keyword: string; vote: string };
    expect(payload.vote).toBe('up');
    expect(broadcastState.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        workspaceId: wsId,
        event: WS_EVENTS.INTELLIGENCE_SIGNALS_UPDATED,
        payload: expect.objectContaining({ reason: 'content_gap_vote' }),
      }),
    ]));
  });
});

describe('Workspace isolation', () => {
  it('content gap votes from workspace A do not appear in workspace B GET', async () => {
    // Use normalized keywords (no hyphens so normalization is identity)
    const kwA = 'isolation vote ws a unique';
    const kwB = 'isolation vote ws b unique';

    await clientPostJson(`/api/public/content-gap-vote/${wsId}`, {
      keyword: kwA,
      vote: 'up',
    });
    await clientPostJson(
      `/api/public/content-gap-vote/${otherWsId}`,
      { keyword: kwB, vote: 'down' },
      otherWsId,
      otherClientToken,
    );

    const resA = await getJson(`/api/public/content-gap-votes/${wsId}`);
    const resB = await getJson(`/api/public/content-gap-votes/${otherWsId}`);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const bodyA = await resA.json() as { votes: Record<string, string> };
    const bodyB = await resB.json() as { votes: Record<string, string> };

    expect(kwB in bodyA.votes).toBe(false);
    expect(kwA in bodyB.votes).toBe(false);
  });

  it('business priorities from workspace A do not appear in workspace B GET', async () => {
    await clientPostJson(`/api/public/business-priorities/${wsId}`, {
      priorities: [{ text: 'WsA isolation priority', category: 'growth' }],
    });
    await clientPostJson(
      `/api/public/business-priorities/${otherWsId}`,
      { priorities: [{ text: 'WsB isolation priority', category: 'brand' }] },
      otherWsId,
      otherClientToken,
    );

    const resA = await getJson(`/api/public/business-priorities/${wsId}`);
    const resB = await getJson(`/api/public/business-priorities/${otherWsId}`);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const bodyA = await resA.json() as { priorities: Array<{ text: string }> };
    const bodyB = await resB.json() as { priorities: Array<{ text: string }> };

    const textsA = bodyA.priorities.map(p => p.text);
    const textsB = bodyB.priorities.map(p => p.text);

    expect(textsA).not.toContain('WsB isolation priority');
    expect(textsB).not.toContain('WsA isolation priority');
  });
});

describe('PATCH /api/public/workspaces/:id/business-profile', () => {
  it('updates business profile and returns merged profile', async () => {
    const res = await clientPatchJson(
      `/api/public/workspaces/${wsId}/business-profile`,
      {
        phone: '+1-555-0100',
        email: 'contact@example.com',
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { businessProfile: { phone?: string; email?: string } };
    expect(body.businessProfile).toBeDefined();
    expect(body.businessProfile.phone).toBe('+1-555-0100');
    expect(body.businessProfile.email).toBe('contact@example.com');
  });

  it('PATCH broadcasts WORKSPACE_UPDATED event', async () => {
    clearBroadcastCalls();

    await clientPatchJson(
      `/api/public/workspaces/${wsId}/business-profile`,
      { phone: '+1-555-0200' },
    );

    const match = broadcastState.calls.find(
      c => c.workspaceId === wsId && c.event === WS_EVENTS.WORKSPACE_UPDATED,
    );
    expect(match).toBeDefined();
  });

  it('returns 404 for unknown workspace', async () => {
    const fakeWsId = `nonexistent-ws-${randomUUID().slice(0, 8)}`;

    // Use a token from wsId but target a nonexistent workspace — auth check
    // uses the :id param, so we craft a token for the nonexistent workspace directly
    // by creating a temporary user... instead just hit it without auth since 404
    // is returned before auth is checked for a nonexistent workspace.
    // Actually the route checks auth before workspace lookup — so expect 401.
    const res = await fetch(`${baseUrl}/api/public/workspaces/${fakeWsId}/business-profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '+1-555-0999' }),
    });

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth cookie', async () => {
    const res = await fetch(`${baseUrl}/api/public/workspaces/${wsId}/business-profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '+1-555-0300' }),
    });

    expect(res.status).toBe(401);
  });
});
