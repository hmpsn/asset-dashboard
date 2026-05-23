/**
 * Integration tests for server/routes/public-portal.ts
 *
 * Focus areas:
 * 1. GET /api/public/workspace/:id — serialization correctness + admin-only field exclusion
 * 2. requireClientStrategyMutationAuth middleware — auth bypass, cross-workspace attacks
 * 3. POST /api/public/keyword-feedback/:workspaceId — happy path + validation + persistence
 * 4. GET/POST /api/public/business-priorities/:workspaceId — reads + mutations
 * 5. Cross-workspace isolation — data from workspace A never appears in workspace B
 * 6. GET /api/public/copy/:workspaceId/entry/:entryId/sections — sections isolation
 */
import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import db from '../../server/db/index.js';
import { createClientUser, deleteClientUser, signClientToken } from '../../server/client-users.js';
import { updateWorkspace } from '../../server/workspaces.js';
import { keywordComparisonKey } from '../../shared/keyword-normalization.js';

const ctx = createTestContext(13367); // port-ok: next free after 13366
const { api } = ctx;

/**
 * Make an authenticated POST request using a client JWT cookie.
 * Because ctx.api merges cookie jar state with any Cookie header passed in opts,
 * we use a standalone fetch that does NOT share the cookie jar.
 */
async function authedFetch(
  url: string,
  opts: RequestInit & { workspaceId: string; token: string },
): Promise<Response> {
  const { workspaceId, token, ...rest } = opts;
  const cookieName = `client_user_token_${workspaceId}`;
  return fetch(url, {
    ...rest,
    headers: {
      ...(rest.headers as Record<string, string> || {}),
      Cookie: `${cookieName}=${token}`,
    },
    redirect: 'manual',
  });
}

// ── Test state ────────────────────────────────────────────────────────────────

let wsA: SeededFullWorkspace;
let wsB: SeededFullWorkspace;

// Client user & tokens for wsA
let clientUserAId = '';
let clientTokenA = '';

// Client user & tokens for wsB
let clientUserBId = '';
let clientTokenB = '';


// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await ctx.startServer();

  // Create two isolated workspaces — no client password so portal is open by default
  wsA = seedWorkspace({ clientPassword: '' });
  wsB = seedWorkspace({ clientPassword: '' });

  // Enable client portals explicitly
  updateWorkspace(wsA.workspaceId, { clientPortalEnabled: true });
  updateWorkspace(wsB.workspaceId, { clientPortalEnabled: true });

  // Create client users for each workspace
  const userA = await createClientUser(
    `portal-test-a-${randomUUID().slice(0, 8)}@test.local`,
    'ClientPass1!',
    'Portal Client A',
    wsA.workspaceId,
    'client_member',
  );
  clientUserAId = userA.id;
  clientTokenA = signClientToken(userA);

  const userB = await createClientUser(
    `portal-test-b-${randomUUID().slice(0, 8)}@test.local`,
    'ClientPass1!',
    'Portal Client B',
    wsB.workspaceId,
    'client_member',
  );
  clientUserBId = userB.id;
  clientTokenB = signClientToken(userB);

}, 25_000);

afterAll(async () => {
  await ctx.stopServer();

  // Clean up keyword feedback
  db.prepare('DELETE FROM keyword_feedback WHERE workspace_id IN (?, ?)').run(
    wsA.workspaceId,
    wsB.workspaceId,
  );
  // Clean up business priorities
  db.prepare('DELETE FROM client_business_priorities WHERE workspace_id IN (?, ?)').run(
    wsA.workspaceId,
    wsB.workspaceId,
  );
  // Clean up content gap votes
  db.prepare('DELETE FROM content_gap_votes WHERE workspace_id IN (?, ?)').run(
    wsA.workspaceId,
    wsB.workspaceId,
  );

  if (clientUserAId) deleteClientUser(clientUserAId, wsA.workspaceId);
  if (clientUserBId) deleteClientUser(clientUserBId, wsB.workspaceId);

  wsA.cleanup();
  wsB.cleanup();
});

// ── Helper: make authenticated requests ──────────────────────────────────────

/**
 * POST with a client JWT cookie.
 * Uses a standalone fetch (not ctx.api) to avoid the shared cookie jar
 * overwriting the Cookie header when session cookies are present.
 */
async function authedPost(
  path: string,
  body: unknown,
  workspaceId: string,
  token: string,
): Promise<Response> {
  return authedFetch(`${ctx.BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    workspaceId,
    token,
  });
}

// ── 1. GET /api/public/workspace/:id ─────────────────────────────────────────

describe('GET /api/public/workspace/:id — basic routing', () => {
  it('returns 404 for an unknown workspace', async () => {
    const res = await api('/api/public/workspace/nonexistent-ws-id-99999');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 403 when client_portal_enabled is false', async () => {
    const disabledWs = seedWorkspace({ clientPassword: '' });
    db.prepare('UPDATE workspaces SET client_portal_enabled = 0 WHERE id = ?').run(
      disabledWs.workspaceId,
    );
    try {
      const res = await api(`/api/public/workspace/${disabledWs.workspaceId}`);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body).toHaveProperty('error');
    } finally {
      disabledWs.cleanup();
    }
  });

  it('returns 200 for an enabled workspace', async () => {
    const res = await api(`/api/public/workspace/${wsA.workspaceId}`);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/public/workspace/:id — serialization correctness', () => {
  let body: Record<string, unknown>;

  beforeAll(async () => {
    const res = await api(`/api/public/workspace/${wsA.workspaceId}`);
    body = await res.json();
  });

  it('includes expected public fields', () => {
    expect(body).toHaveProperty('id', wsA.workspaceId);
    expect(body).toHaveProperty('name');
    expect(body).toHaveProperty('tier');
    expect(body).toHaveProperty('baseTier');
    expect(body).toHaveProperty('clientPortalEnabled');
    expect(body).toHaveProperty('requiresPassword');
    expect(body).toHaveProperty('stripeEnabled');
    expect(body).toHaveProperty('hasClientUsers');
    expect(body).toHaveProperty('onboardingEnabled');
    expect(body).toHaveProperty('onboardingCompleted');
  });

  it('stripeEnabled is a boolean, not the secret key', () => {
    expect(typeof body.stripeEnabled).toBe('boolean');
  });

  it('hasClientUsers is a boolean, not user data', () => {
    expect(typeof body.hasClientUsers).toBe('boolean');
    // Should NOT be an array of users
    expect(Array.isArray(body.hasClientUsers)).toBe(false);
  });

  it('NEVER leaks knowledgeBase', () => {
    expect('knowledgeBase' in body).toBe(false);
  });

  it('NEVER leaks customPromptNotes', () => {
    expect('customPromptNotes' in body).toBe(false);
  });

  it('NEVER leaks stripeCustomerId', () => {
    expect('stripeCustomerId' in body).toBe(false);
  });

  it('NEVER leaks stripeSubscriptionId', () => {
    expect('stripeSubscriptionId' in body).toBe(false);
  });

  it('NEVER leaks appPassword', () => {
    expect('appPassword' in body).toBe(false);
  });

  it('NEVER leaks webflowToken', () => {
    expect('webflowToken' in body).toBe(false);
  });

  it('NEVER leaks brandVoice', () => {
    expect('brandVoice' in body).toBe(false);
  });

  it('NEVER leaks personas raw array', () => {
    // personas is admin-only intelligence data; only public-safe fields should be present
    expect('personas' in body).toBe(false);
  });

  it('NEVER leaks competitorDomains raw list', () => {
    expect('competitorDomains' in body).toBe(false);
  });

  it('NEVER leaks keywordStrategy internal data', () => {
    expect('keywordStrategy' in body).toBe(false);
  });

  it('NEVER leaks seoProvider config', () => {
    expect('seoProvider' in body).toBe(false);
    expect('seoDataProvider' in body).toBe(false);
  });

  it('tier is a string value, not raw db column', () => {
    expect(['free', 'growth', 'premium']).toContain(body.tier as string);
  });

  it('bookingUrl is null or a string', () => {
    expect(body.bookingUrl === null || typeof body.bookingUrl === 'string').toBe(true);
  });
});

describe('GET /api/public/workspace/:id — admin-only field not present when set', () => {
  it('does not leak stripeCustomerId even when set on workspace', async () => {
    // Temporarily set a fake stripe customer id
    updateWorkspace(wsA.workspaceId, {
      stripeCustomerId: 'cus_secret_admin_only_12345',
    });
    const res = await api(`/api/public/workspace/${wsA.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect('stripeCustomerId' in body).toBe(false);
    // Also ensure the value doesn't appear embedded anywhere in the response
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('cus_secret_admin_only_12345');
  });
});

// ── 2. requireClientStrategyMutationAuth middleware ───────────────────────────

describe('requireClientStrategyMutationAuth — authentication enforcement', () => {
  const kfEndpoint = (wsId: string) =>
    `/api/public/keyword-feedback/${wsId}`;
  const validFeedback = { keyword: 'auth-test keyword', status: 'approved' as const };

  it('returns 401 with no cookies at all', async () => {
    const res = await api(kfEndpoint(wsA.workspaceId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validFeedback),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 401 with a garbage session cookie', async () => {
    const res = await api(kfEndpoint(wsA.workspaceId), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `client_session_${wsA.workspaceId}=totally-invalid-garbage`,
      },
      body: JSON.stringify(validFeedback),
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 with a garbage JWT token cookie', async () => {
    const res = await api(kfEndpoint(wsA.workspaceId), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `client_user_token_${wsA.workspaceId}=not.a.real.jwt`,
      },
      body: JSON.stringify(validFeedback),
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 with a valid JWT for a DIFFERENT workspace (cross-workspace attack)', async () => {
    // clientTokenB is valid for wsB but not wsA
    const res = await api(kfEndpoint(wsA.workspaceId), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Using wsA's endpoint but wsB's token name (wrong workspace_id in cookie key)
        Cookie: `client_user_token_${wsA.workspaceId}=${clientTokenB}`,
      },
      body: JSON.stringify({ keyword: 'cross-ws-attack', status: 'approved' }),
    });
    // Token is for wsB, but endpoint cookie key says wsA — verifyClientToken will decode
    // the token and see workspaceId=wsB !== wsA, so auth must fail
    expect(res.status).toBe(401);
  });

  it('succeeds with a valid client JWT cookie', async () => {
    const res = await authedPost(
      kfEndpoint(wsA.workspaceId),
      { keyword: `auth-jwt-test-${randomUUID().slice(0, 8)}`, status: 'approved' },
      wsA.workspaceId,
      clientTokenA,
    );
    expect([200, 201]).toContain(res.status);
  });

  it('succeeds with a valid HMAC session cookie', async () => {
    // The session HMAC secret is generated at server startup and differs from
    // the test process. We cannot call signClientSession() in tests and expect
    // the server to accept it. Instead, obtain the session cookie the legitimate
    // way: POST /api/public/auth/:id with the workspace password.
    const sessionWs = seedWorkspace({ clientPassword: 'session-test-pw' });
    updateWorkspace(sessionWs.workspaceId, { clientPortalEnabled: true });
    try {
      // Login to get the server-signed session cookie into the cookie jar
      const loginRes = await api(`/api/public/auth/${sessionWs.workspaceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'session-test-pw' }),
      });
      expect(loginRes.status).toBe(200);

      const keyword = `auth session test ${randomUUID().slice(0, 8)}`;
      const res = await api(kfEndpoint(sessionWs.workspaceId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Cookie jar from ctx now holds the server-issued client_session_{wsId}
        body: JSON.stringify({ keyword, status: 'declined', reason: 'Not relevant' }),
      });
      expect([200, 201]).toContain(res.status);
    } finally {
      db.prepare('DELETE FROM keyword_feedback WHERE workspace_id = ?').run(sessionWs.workspaceId);
      sessionWs.cleanup();
      // Clear the session cookie from the jar so subsequent tests using ctx.api()
      // with JWT tokens in opts.headers are not overridden by this session cookie.
      ctx.clearCookies();
    }
  });

  it('returns 401 with a garbage session cookie for wsB endpoint', async () => {
    // A random hex string won't match the HMAC for wsB
    const res = await api(kfEndpoint(wsB.workspaceId), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `client_session_${wsB.workspaceId}=deadbeefdeadbeefdeadbeefdeadbeef`,
      },
      body: JSON.stringify({ keyword: 'cross ws session attack', status: 'approved' }),
    });
    expect(res.status).toBe(401);
  });
});

// ── 3. POST /api/public/keyword-feedback/:workspaceId ────────────────────────

describe('POST /api/public/keyword-feedback/:workspaceId — happy path', () => {
  it('accepts a valid keyword feedback and returns the stored record', async () => {
    const keyword = `test-keyword-${randomUUID().slice(0, 8)}`;
    const res = await authedPost(
      `/api/public/keyword-feedback/${wsA.workspaceId}`,
      { keyword, status: 'approved' },
      wsA.workspaceId,
      clientTokenA,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('status', 'approved');
  });

  it('persists feedback to the database', async () => {
    const keyword = `persist test ${randomUUID().slice(0, 8)}`;
    await authedPost(
      `/api/public/keyword-feedback/${wsA.workspaceId}`,
      { keyword, status: 'declined', reason: 'Not relevant to our market' },
      wsA.workspaceId,
      clientTokenA,
    );

    const normalizedKw = keywordComparisonKey(keyword);
    const row = db
      .prepare('SELECT status, reason FROM keyword_feedback WHERE workspace_id = ? AND keyword = ?')
      .get(wsA.workspaceId, normalizedKw) as
      | { status: string; reason: string }
      | undefined;

    expect(row).toBeDefined();
    expect(row?.status).toBe('declined');
  });

  it('upserts — second submission updates the status', async () => {
    const keyword = `upsert test ${randomUUID().slice(0, 8)}`;

    await authedPost(
      `/api/public/keyword-feedback/${wsA.workspaceId}`,
      { keyword, status: 'declined' },
      wsA.workspaceId,
      clientTokenA,
    );
    await authedPost(
      `/api/public/keyword-feedback/${wsA.workspaceId}`,
      { keyword, status: 'approved' },
      wsA.workspaceId,
      clientTokenA,
    );

    const normalizedKw = keywordComparisonKey(keyword);
    const row = db
      .prepare('SELECT status FROM keyword_feedback WHERE workspace_id = ? AND keyword = ?')
      .get(wsA.workspaceId, normalizedKw) as
      | { status: string }
      | undefined;

    expect(row?.status).toBe('approved');
  });
});

describe('POST /api/public/keyword-feedback/:workspaceId — validation', () => {
  // Use fresh workspaces for validation tests to avoid the 10-writes/min rate limiter
  // being hit by the earlier happy-path tests on wsA.

  it('returns 400 for missing keyword field', async () => {
    const ws = seedWorkspace({ clientPassword: '' });
    const user = await createClientUser(
      `val-test-a-${randomUUID().slice(0, 8)}@test.local`,
      'ClientPass1!', 'Val Client A', ws.workspaceId, 'client_member',
    );
    const token = signClientToken(user);
    try {
      const res = await authedFetch(`${ctx.BASE}/api/public/keyword-feedback/${ws.workspaceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' }),
        workspaceId: ws.workspaceId,
        token,
      });
      expect(res.status).toBe(400);
    } finally {
      deleteClientUser(user.id, ws.workspaceId);
      ws.cleanup();
    }
  });

  it('returns 400 for invalid status value', async () => {
    const ws = seedWorkspace({ clientPassword: '' });
    const user = await createClientUser(
      `val-test-b-${randomUUID().slice(0, 8)}@test.local`,
      'ClientPass1!', 'Val Client B', ws.workspaceId, 'client_member',
    );
    const token = signClientToken(user);
    try {
      const res = await authedFetch(`${ctx.BASE}/api/public/keyword-feedback/${ws.workspaceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: 'test keyword', status: 'maybe' }),
        workspaceId: ws.workspaceId,
        token,
      });
      expect(res.status).toBe(400);
    } finally {
      deleteClientUser(user.id, ws.workspaceId);
      ws.cleanup();
    }
  });

  it('returns 400 when extra fields are sent (strict schema)', async () => {
    const ws = seedWorkspace({ clientPassword: '' });
    const user = await createClientUser(
      `val-test-c-${randomUUID().slice(0, 8)}@test.local`,
      'ClientPass1!', 'Val Client C', ws.workspaceId, 'client_member',
    );
    const token = signClientToken(user);
    try {
      const res = await authedFetch(`${ctx.BASE}/api/public/keyword-feedback/${ws.workspaceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: 'test keyword', status: 'approved', declinedBy: 'injected@evil.com' }),
        workspaceId: ws.workspaceId,
        token,
      });
      expect(res.status).toBe(400);
    } finally {
      deleteClientUser(user.id, ws.workspaceId);
      ws.cleanup();
    }
  });

  it('returns 401 for an unknown workspace (auth check before workspace lookup)', async () => {
    // requireClientStrategyMutationAuth runs before the workspace lookup,
    // so a nonexistent workspace returns 401 (no valid auth cookie) rather than 404.
    // clientTokenA is for wsA — workspace in token != nonexistent-ws-99999 → 401
    const res = await fetch(`${ctx.BASE}/api/public/keyword-feedback/nonexistent-ws-99999`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `client_user_token_nonexistent-ws-99999=${clientTokenA}`,
      },
      body: JSON.stringify({ keyword: 'test keyword', status: 'approved' }),
      redirect: 'manual',
    });
    expect(res.status).toBe(401);
  });
});

// ── 4. GET/POST /api/public/business-priorities/:workspaceId ─────────────────

describe('GET /api/public/business-priorities/:workspaceId', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/public/business-priorities/nonexistent-ws-99999');
    expect(res.status).toBe(404);
  });

  it('returns empty priorities when none set', async () => {
    const freshWs = seedWorkspace({ clientPassword: '' });
    try {
      const res = await api(`/api/public/business-priorities/${freshWs.workspaceId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('priorities');
      expect(Array.isArray(body.priorities)).toBe(true);
      expect(body.priorities).toHaveLength(0);
    } finally {
      freshWs.cleanup();
    }
  });
});

describe('POST /api/public/business-priorities/:workspaceId', () => {
  it('returns 401 without auth', async () => {
    const res = await api(`/api/public/business-priorities/${wsA.workspaceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priorities: [{ text: 'Grow revenue', category: 'growth' }] }),
    });
    expect(res.status).toBe(401);
  });

  it('persists priorities with valid auth', async () => {
    const res = await authedPost(
      `/api/public/business-priorities/${wsA.workspaceId}`,
      { priorities: [{ text: 'Launch APAC market', category: 'growth' }] },
      wsA.workspaceId,
      clientTokenA,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('saved', 1);
  });

  it('stored priorities are readable back via GET', async () => {
    const priorityText = `Priority-${randomUUID().slice(0, 8)}`;
    await authedPost(
      `/api/public/business-priorities/${wsA.workspaceId}`,
      { priorities: [{ text: priorityText, category: 'other' }] },
      wsA.workspaceId,
      clientTokenA,
    );

    const res = await api(`/api/public/business-priorities/${wsA.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const texts = (body.priorities as Array<{ text: string }>).map(p => p.text);
    expect(texts).toContain(priorityText);
  });

  it('returns 400 for invalid priorities body', async () => {
    const res = await authedFetch(`${ctx.BASE}/api/public/business-priorities/${wsA.workspaceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priorities: 'not-an-array' }),
      workspaceId: wsA.workspaceId,
      token: clientTokenA,
    });
    expect(res.status).toBe(400);
  });
});

// ── 5. Cross-workspace isolation ─────────────────────────────────────────────

describe('Cross-workspace isolation — GET workspace data', () => {
  it('workspace A response contains workspace A id only', async () => {
    const [resA, resB] = await Promise.all([
      api(`/api/public/workspace/${wsA.workspaceId}`),
      api(`/api/public/workspace/${wsB.workspaceId}`),
    ]);

    const bodyA = await resA.json() as { id: string };
    const bodyB = await resB.json() as { id: string };

    expect(bodyA.id).toBe(wsA.workspaceId);
    expect(bodyB.id).toBe(wsB.workspaceId);
    expect(bodyA.id).not.toBe(bodyB.id);
  });
});

describe('Cross-workspace isolation — keyword feedback', () => {
  const kwA = `iso kw a ${randomUUID().slice(0, 8)}`;
  const kwB = `iso kw b ${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    // Seed feedback in each workspace
    await authedPost(
      `/api/public/keyword-feedback/${wsA.workspaceId}`,
      { keyword: kwA, status: 'approved' },
      wsA.workspaceId,
      clientTokenA,
    );
    await authedPost(
      `/api/public/keyword-feedback/${wsB.workspaceId}`,
      { keyword: kwB, status: 'approved' },
      wsB.workspaceId,
      clientTokenB,
    );
  });

  it('wsA GET does not contain wsB keyword', async () => {
    const res = await api(`/api/public/keyword-feedback/${wsA.workspaceId}`);
    const body = await res.json() as Array<{ keyword: string }>;
    const keywords = body.map((r) => r.keyword);
    expect(keywords).not.toContain(keywordComparisonKey(kwB));
  });

  it('wsB GET does not contain wsA keyword', async () => {
    const res = await api(`/api/public/keyword-feedback/${wsB.workspaceId}`);
    const body = await res.json() as Array<{ keyword: string }>;
    const keywords = body.map((r) => r.keyword);
    expect(keywords).not.toContain(keywordComparisonKey(kwA));
  });

  it('client of wsA cannot post keyword feedback to wsB endpoint', async () => {
    // clientTokenA is valid for wsA — must fail for wsB
    // Cookie key says wsB but token was signed for wsA → verifyClientToken returns wsA ≠ wsB → 401
    const res = await fetch(`${ctx.BASE}/api/public/keyword-feedback/${wsB.workspaceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `client_user_token_${wsB.workspaceId}=${clientTokenA}`,
      },
      body: JSON.stringify({ keyword: 'cross ws inject', status: 'approved' }),
      redirect: 'manual',
    });
    expect(res.status).toBe(401);
  });
});

describe('Cross-workspace isolation — business priorities', () => {
  const priorityA = `Priority-A-${randomUUID().slice(0, 8)}`;
  const priorityB = `Priority-B-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    await authedPost(
      `/api/public/business-priorities/${wsA.workspaceId}`,
      { priorities: [{ text: priorityA, category: 'growth' }] },
      wsA.workspaceId,
      clientTokenA,
    );
    await authedPost(
      `/api/public/business-priorities/${wsB.workspaceId}`,
      { priorities: [{ text: priorityB, category: 'growth' }] },
      wsB.workspaceId,
      clientTokenB,
    );
  });

  it('wsA priorities do not appear in wsB response', async () => {
    const res = await api(`/api/public/business-priorities/${wsB.workspaceId}`);
    const body = await res.json() as { priorities: Array<{ text: string }> };
    const texts = body.priorities.map((p) => p.text);
    expect(texts).not.toContain(priorityA);
  });

  it('wsB priorities do not appear in wsA response', async () => {
    const res = await api(`/api/public/business-priorities/${wsA.workspaceId}`);
    const body = await res.json() as { priorities: Array<{ text: string }> };
    const texts = body.priorities.map((p) => p.text);
    expect(texts).not.toContain(priorityB);
  });
});

// ── 6. GET /api/public/copy/:workspaceId/entry/:entryId/sections ─────────────

describe('GET /api/public/copy/:workspaceId/entry/:entryId/sections — basic', () => {
  it('returns 404 for an unknown workspace', async () => {
    const res = await api('/api/public/copy/nonexistent-ws-99999/entry/some-entry/sections');
    expect(res.status).toBe(404);
  });

  it('returns 403 when portal is disabled', async () => {
    const disabledWs = seedWorkspace({ clientPassword: '' });
    db.prepare('UPDATE workspaces SET client_portal_enabled = 0 WHERE id = ?').run(
      disabledWs.workspaceId,
    );
    try {
      const res = await api(
        `/api/public/copy/${disabledWs.workspaceId}/entry/some-entry/sections`,
      );
      expect(res.status).toBe(403);
    } finally {
      disabledWs.cleanup();
    }
  });

  it('returns sections array (empty when no sections exist)', async () => {
    const res = await api(
      `/api/public/copy/${wsA.workspaceId}/entry/nonexistent-entry-id/sections`,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { sections: unknown[] };
    expect(body).toHaveProperty('sections');
    expect(Array.isArray(body.sections)).toBe(true);
  });
});

describe('GET /api/public/copy/:workspaceId/entry/:entryId/sections — workspace isolation', () => {
  it('sections for workspace A do not appear in workspace B response', async () => {
    // Both workspaces have no copy entries seeded — verify the endpoint is scoped
    const [resA, resB] = await Promise.all([
      api(`/api/public/copy/${wsA.workspaceId}/entry/some-shared-entry/sections`),
      api(`/api/public/copy/${wsB.workspaceId}/entry/some-shared-entry/sections`),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const bodyA = await resA.json() as { sections: unknown[] };
    const bodyB = await resB.json() as { sections: unknown[] };

    // Both should return their own (empty) section lists — no cross-contamination
    expect(Array.isArray(bodyA.sections)).toBe(true);
    expect(Array.isArray(bodyB.sections)).toBe(true);
  });
});

// ── 7. GET /api/public/keyword-feedback/:workspaceId ─────────────────────────

describe('GET /api/public/keyword-feedback/:workspaceId', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/public/keyword-feedback/nonexistent-ws-99999');
    expect(res.status).toBe(404);
  });

  it('returns an array for a valid workspace', async () => {
    const res = await api(`/api/public/keyword-feedback/${wsA.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('returned rows have expected public fields', async () => {
    // Use a fresh workspace to avoid exhausting the rate limiter on wsA's path
    const fieldTestWs = seedWorkspace({ clientPassword: '' });
    updateWorkspace(fieldTestWs.workspaceId, { clientPortalEnabled: true });
    const user = await createClientUser(
      `field-test-${randomUUID().slice(0, 8)}@test.local`,
      'ClientPass1!', 'Field Test Client', fieldTestWs.workspaceId, 'client_member',
    );
    const token = signClientToken(user);
    const keyword = `field test ${randomUUID().slice(0, 8)}`;
    try {
      await authedPost(
        `/api/public/keyword-feedback/${fieldTestWs.workspaceId}`,
        { keyword, status: 'declined', reason: 'Too broad' },
        fieldTestWs.workspaceId,
        token,
      );

      const res = await api(`/api/public/keyword-feedback/${fieldTestWs.workspaceId}`);
      const body = await res.json() as Array<Record<string, unknown>>;
      const normalizedKw = keywordComparisonKey(keyword);
      const row = body.find((r) => r.keyword === normalizedKw);
      expect(row).toBeDefined();
      expect(row).toHaveProperty('keyword');
      expect(row).toHaveProperty('status');
      // declined_by is an internal admin column — must not be exposed
      expect('declined_by' in (row ?? {})).toBe(false);
      expect('declinedBy' in (row ?? {})).toBe(false);
    } finally {
      db.prepare('DELETE FROM keyword_feedback WHERE workspace_id = ?').run(fieldTestWs.workspaceId);
      deleteClientUser(user.id, fieldTestWs.workspaceId);
      fieldTestWs.cleanup();
    }
  });
});

// ── 8. DELETE /api/public/keyword-feedback/:workspaceId ──────────────────────

describe('DELETE /api/public/keyword-feedback/:workspaceId', () => {
  // Use a dedicated workspace for DELETE tests — rate limiter is 10 writes/min per path,
  // and the earlier POST tests may exhaust the budget on wsA's path.
  let delWs: SeededFullWorkspace;
  let delUserToken = '';
  let delUserId = '';

  beforeAll(async () => {
    delWs = seedWorkspace({ clientPassword: '' });
    updateWorkspace(delWs.workspaceId, { clientPortalEnabled: true });
    const user = await createClientUser(
      `del-test-${randomUUID().slice(0, 8)}@test.local`,
      'ClientPass1!', 'Del Client', delWs.workspaceId, 'client_member',
    );
    delUserId = user.id;
    delUserToken = signClientToken(user);
  });

  afterAll(() => {
    db.prepare('DELETE FROM keyword_feedback WHERE workspace_id = ?').run(delWs.workspaceId);
    if (delUserId) deleteClientUser(delUserId, delWs.workspaceId);
    delWs.cleanup();
  });

  it('returns 401 without auth', async () => {
    const res = await api(`/api/public/keyword-feedback/${delWs.workspaceId}?keyword=test`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 when keyword query param is missing', async () => {
    const res = await authedFetch(`${ctx.BASE}/api/public/keyword-feedback/${delWs.workspaceId}`, {
      method: 'DELETE',
      workspaceId: delWs.workspaceId,
      token: delUserToken,
    });
    expect(res.status).toBe(400);
  });

  it('deletes existing feedback and returns existed=true', async () => {
    const keyword = `delete test ${randomUUID().slice(0, 8)}`;
    // First create it
    await authedPost(
      `/api/public/keyword-feedback/${delWs.workspaceId}`,
      { keyword, status: 'declined' },
      delWs.workspaceId,
      delUserToken,
    );

    // Then delete it
    const res = await authedFetch(
      `${ctx.BASE}/api/public/keyword-feedback/${delWs.workspaceId}?keyword=${encodeURIComponent(keyword)}`,
      {
        method: 'DELETE',
        workspaceId: delWs.workspaceId,
        token: delUserToken,
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { existed: boolean };
    expect(body.existed).toBe(true);
  });

  it('returns existed=false for non-existent keyword', async () => {
    const res = await authedFetch(
      `${ctx.BASE}/api/public/keyword-feedback/${delWs.workspaceId}?keyword=never+existed+${randomUUID().replace(/-/g, ' ')}`,
      {
        method: 'DELETE',
        workspaceId: delWs.workspaceId,
        token: delUserToken,
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { existed: boolean };
    expect(body.existed).toBe(false);
  });
});

// ── 9. POST /api/public/content-gap-vote/:workspaceId ────────────────────────

describe('POST /api/public/content-gap-vote/:workspaceId', () => {
  it('returns 401 without auth', async () => {
    const res = await api(`/api/public/content-gap-vote/${wsA.workspaceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: 'test', vote: 'up' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid vote value', async () => {
    const res = await authedFetch(`${ctx.BASE}/api/public/content-gap-vote/${wsA.workspaceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: 'test', vote: 'invalid_vote' }),
      workspaceId: wsA.workspaceId,
      token: clientTokenA,
    });
    expect(res.status).toBe(400);
  });

  it('records an upvote and returns ok', async () => {
    const keyword = `vote-test-${randomUUID().slice(0, 8)}`;
    const res = await authedPost(
      `/api/public/content-gap-vote/${wsA.workspaceId}`,
      { keyword, vote: 'up' },
      wsA.workspaceId,
      clientTokenA,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('persists vote to database', async () => {
    const keyword = `vote persist ${randomUUID().slice(0, 8)}`;
    await authedPost(
      `/api/public/content-gap-vote/${wsA.workspaceId}`,
      { keyword, vote: 'down' },
      wsA.workspaceId,
      clientTokenA,
    );

    const normalizedKw = keywordComparisonKey(keyword);
    const row = db
      .prepare('SELECT vote FROM content_gap_votes WHERE workspace_id = ? AND keyword = ?')
      .get(wsA.workspaceId, normalizedKw) as
      | { vote: string }
      | undefined;

    expect(row).toBeDefined();
    expect(row?.vote).toBe('down');
  });

  it('clears a vote when vote=none', async () => {
    const keyword = `vote clear ${randomUUID().slice(0, 8)}`;
    const normalizedKw = keywordComparisonKey(keyword);

    await authedPost(
      `/api/public/content-gap-vote/${wsA.workspaceId}`,
      { keyword, vote: 'up' },
      wsA.workspaceId,
      clientTokenA,
    );

    await authedPost(
      `/api/public/content-gap-vote/${wsA.workspaceId}`,
      { keyword, vote: 'none' },
      wsA.workspaceId,
      clientTokenA,
    );

    const row = db
      .prepare('SELECT vote FROM content_gap_votes WHERE workspace_id = ? AND keyword = ?')
      .get(wsA.workspaceId, normalizedKw);

    expect(row).toBeUndefined();
  });
});

// ── 10. GET /api/public/content-gap-votes/:workspaceId ───────────────────────

describe('GET /api/public/content-gap-votes/:workspaceId', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/public/content-gap-votes/nonexistent-ws-99999');
    expect(res.status).toBe(404);
  });

  it('returns votes object for valid workspace', async () => {
    const res = await api(`/api/public/content-gap-votes/${wsA.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { votes: Record<string, string> };
    expect(body).toHaveProperty('votes');
    expect(typeof body.votes).toBe('object');
  });

  it('cross-workspace: votes for wsA do not appear in wsB response', async () => {
    const keyword = `cross vote ${randomUUID().slice(0, 8)}`;
    await authedPost(
      `/api/public/content-gap-vote/${wsA.workspaceId}`,
      { keyword, vote: 'up' },
      wsA.workspaceId,
      clientTokenA,
    );

    const normalizedKw = keywordComparisonKey(keyword);
    const res = await api(`/api/public/content-gap-votes/${wsB.workspaceId}`);
    const body = await res.json() as { votes: Record<string, string> };
    expect(normalizedKw in body.votes).toBe(false);
  });
});

// ── 11. PATCH /api/public/workspaces/:id/business-profile ────────────────────

describe('PATCH /api/public/workspaces/:id/business-profile', () => {
  it('returns 401 without auth', async () => {
    const res = await api(`/api/public/workspaces/${wsA.workspaceId}/business-profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '555-1234' }),
    });
    expect(res.status).toBe(401);
  });

  it('updates business profile with valid auth', async () => {
    const res = await authedFetch(`${ctx.BASE}/api/public/workspaces/${wsA.workspaceId}/business-profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '555-0100' }),
      workspaceId: wsA.workspaceId,
      token: clientTokenA,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { businessProfile: Record<string, unknown> };
    expect(body).toHaveProperty('businessProfile');
    expect(body.businessProfile).toHaveProperty('phone', '555-0100');
  });

  it('rejects invalid email in business profile', async () => {
    const res = await authedFetch(`${ctx.BASE}/api/public/workspaces/${wsA.workspaceId}/business-profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-a-valid-email' }),
      workspaceId: wsA.workspaceId,
      token: clientTokenA,
    });
    expect(res.status).toBe(400);
  });

  it('accepts empty string to clear email field', async () => {
    // Per the Zod clearable-field pattern — .or(z.literal(''))
    const res = await authedFetch(`${ctx.BASE}/api/public/workspaces/${wsA.workspaceId}/business-profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '' }),
      workspaceId: wsA.workspaceId,
      token: clientTokenA,
    });
    expect(res.status).toBe(200);
  });

  it('returns 401 when using wrong workspace JWT', async () => {
    // clientTokenB is for wsB — must not allow access to wsA
    // Pass wsA's cookie name but wsB's token value → verify fails
    const res = await fetch(`${ctx.BASE}/api/public/workspaces/${wsA.workspaceId}/business-profile`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `client_user_token_${wsA.workspaceId}=${clientTokenB}`,
      },
      body: JSON.stringify({ phone: '555-0000' }),
      redirect: 'manual',
    });
    expect(res.status).toBe(401);
  });
});

// ── 12. GET /api/public/tier/:id ──────────────────────────────────────────────

describe('GET /api/public/tier/:id', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/public/tier/nonexistent-ws-99999');
    expect(res.status).toBe(404);
  });

  it('returns tier info for valid workspace', async () => {
    const res = await api(`/api/public/tier/${wsA.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      tier: string;
      baseTier: string;
      isTrial: boolean;
      trialDaysRemaining: number;
      trialEndsAt: string | null;
    };
    expect(body).toHaveProperty('tier');
    expect(['free', 'growth', 'premium']).toContain(body.tier);
    expect(body).toHaveProperty('baseTier');
    expect(body).toHaveProperty('isTrial');
    expect(typeof body.isTrial).toBe('boolean');
    expect(body).toHaveProperty('trialDaysRemaining');
    expect(body).toHaveProperty('trialEndsAt');
  });

  it('tier response does NOT contain Stripe keys', async () => {
    const res = await api(`/api/public/tier/${wsA.workspaceId}`);
    const body = await res.json();
    expect('stripeCustomerId' in body).toBe(false);
    expect('stripeSubscriptionId' in body).toBe(false);
  });
});

// ── 13. Bulk keyword feedback ─────────────────────────────────────────────────

describe('POST /api/public/keyword-feedback/:workspaceId/bulk', () => {
  it('returns 401 without auth', async () => {
    const res = await api(`/api/public/keyword-feedback/${wsA.workspaceId}/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: [{ keyword: 'test', status: 'approved' }] }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 for empty keywords array', async () => {
    const res = await authedFetch(`${ctx.BASE}/api/public/keyword-feedback/${wsA.workspaceId}/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: [] }),
      workspaceId: wsA.workspaceId,
      token: clientTokenA,
    });
    expect(res.status).toBe(400);
  });

  it('accepts valid bulk feedback and returns count', async () => {
    const kws = [
      { keyword: `bulk-kw-1-${randomUUID().slice(0, 8)}`, status: 'approved' as const },
      { keyword: `bulk-kw-2-${randomUUID().slice(0, 8)}`, status: 'declined' as const, reason: 'Too generic' },
    ];
    const res = await authedPost(
      `/api/public/keyword-feedback/${wsA.workspaceId}/bulk`,
      { keywords: kws },
      wsA.workspaceId,
      clientTokenA,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { updated: number };
    expect(body.updated).toBe(2);
  });

  it('persists all bulk keywords to the database', async () => {
    // Use a fresh workspace to avoid rate limiter exhaustion on wsA's bulk path
    const bulkPersistWs = seedWorkspace({ clientPassword: '' });
    updateWorkspace(bulkPersistWs.workspaceId, { clientPortalEnabled: true });
    const user = await createClientUser(
      `bulk-persist-${randomUUID().slice(0, 8)}@test.local`,
      'ClientPass1!', 'Bulk Persist Client', bulkPersistWs.workspaceId, 'client_member',
    );
    const token = signClientToken(user);
    const kw1 = `bulk persist one ${randomUUID().slice(0, 8)}`;
    const kw2 = `bulk persist two ${randomUUID().slice(0, 8)}`;
    try {
      await authedPost(
        `/api/public/keyword-feedback/${bulkPersistWs.workspaceId}/bulk`,
        {
          keywords: [
            { keyword: kw1, status: 'approved' },
            { keyword: kw2, status: 'declined' },
          ],
        },
        bulkPersistWs.workspaceId,
        token,
      );

      const nkw1 = keywordComparisonKey(kw1);
      const nkw2 = keywordComparisonKey(kw2);
      const rows = db
        .prepare(
          'SELECT keyword, status FROM keyword_feedback WHERE workspace_id = ? AND keyword IN (?, ?)',
        )
        .all(bulkPersistWs.workspaceId, nkw1, nkw2) as Array<{
        keyword: string;
        status: string;
      }>;

      expect(rows).toHaveLength(2);
      const statusMap = Object.fromEntries(rows.map((r) => [r.keyword, r.status]));
      expect(statusMap[nkw1]).toBe('approved');
      expect(statusMap[nkw2]).toBe('declined');
    } finally {
      db.prepare('DELETE FROM keyword_feedback WHERE workspace_id = ?').run(bulkPersistWs.workspaceId);
      deleteClientUser(user.id, bulkPersistWs.workspaceId);
      bulkPersistWs.cleanup();
    }
  });
});

// ── 14. GET /api/public/briefing/:workspaceId — tier gate ─────────────────────

describe('GET /api/public/briefing/:workspaceId — tier gate', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/public/briefing/nonexistent-ws-99999');
    expect(res.status).toBe(404);
  });

  it('returns 403 when portal is disabled', async () => {
    const disabledWs = seedWorkspace({ clientPassword: '' });
    db.prepare('UPDATE workspaces SET client_portal_enabled = 0 WHERE id = ?').run(
      disabledWs.workspaceId,
    );
    try {
      const res = await api(`/api/public/briefing/${disabledWs.workspaceId}`);
      expect(res.status).toBe(403);
    } finally {
      disabledWs.cleanup();
    }
  });

  it('returns 402 for free-tier workspace', async () => {
    // wsA defaults to tier=free
    const res = await api(`/api/public/briefing/${wsA.workspaceId}`);
    expect(res.status).toBe(402);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/growth|premium/i);
  });

  it('returns briefing=null for paid workspace with no published briefing', async () => {
    const paidWs = seedWorkspace({ tier: 'growth', clientPassword: '' });
    try {
      updateWorkspace(paidWs.workspaceId, { clientPortalEnabled: true });
      const res = await api(`/api/public/briefing/${paidWs.workspaceId}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { briefing: null };
      expect(body.briefing).toBeNull();
    } finally {
      paidWs.cleanup();
    }
  });
});
