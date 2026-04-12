/**
 * Integration tests: Public portal endpoint authentication enforcement.
 *
 * The app.ts session enforcement middleware (lines 245–268) gates ALL
 * /api/public/ paths — except the auth bootstrapping paths listed below —
 * when the workspace has a clientPassword set:
 *
 *   Exempt (no auth required regardless of clientPassword):
 *     /api/public/auth/:id           — shared-password login
 *     /api/public/workspace/:id      — workspace info
 *     /api/public/client-login/:id   — client user login
 *     /api/public/client-logout/:id  — client logout
 *     /api/public/client-me/:id      — session check
 *     /api/public/auth-mode/:id      — auth mode info
 *     /api/public/forgot-password/:id — password reset request
 *     /api/public/reset-password     — complete password reset
 *
 *   Gated (401 without valid client JWT or session cookie):
 *     /api/public/seo-strategy/:workspaceId
 *     /api/public/content-requests/:workspaceId
 *     /api/public/insights/:workspaceId
 *     /api/public/search-overview/:workspaceId
 *     /api/public/tracked-keywords/:workspaceId
 *     /api/public/requests/:workspaceId
 *     /api/public/content-performance/:workspaceId
 *
 * Auth mechanisms tested:
 *   - Client user JWT via cookie: client_user_token_{workspaceId}
 *   - Expired JWT → 401
 *   - Malformed JWT → 401
 *   - Cross-workspace JWT (valid token for wrong workspace) → 401
 *   - Passwordless workspace (no clientPassword) → accessible without auth
 *
 * NOTE: Rate limiters (10 writes/min, 60 reads/min per IP) constrain
 * how many requests we can make per path. Each endpoint group uses a
 * unique workspaceId so path-keyed buckets don't collide.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { createTestContext } from './helpers.js';
import {
  createClientUser,
  deleteClientUser,
  signClientToken,
} from '../../server/client-users.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { JWT_SECRET } from '../../server/jwt-config.js';

// ── Unique port (no other test file uses 13304) ────────────────────────────
const ctx = createTestContext(13304);

// ── State ──────────────────────────────────────────────────────────────────

/**
 * Primary workspace — has a clientPassword set so the auth gate activates.
 */
let protectedWsId = '';
let clientUserId = '';
/** Valid client JWT for protectedWsId — sent via cookie. */
let validClientToken = '';

/**
 * Secondary workspace — for cross-workspace rejection tests.
 */
let otherWsId = '';
let otherClientUserId = '';
/** Valid client JWT for otherWsId — must be rejected when used for protectedWsId. */
let otherClientToken = '';

/**
 * Passwordless workspace — no clientPassword, accessible without any auth.
 */
let openWsId = '';

// ── Setup / Teardown ───────────────────────────────────────────────────────

beforeAll(async () => {
  await ctx.startServer();

  // — Protected workspace (clientPassword set) —
  const protectedWs = createWorkspace('Portal Auth Test — Protected');
  protectedWsId = protectedWs.id;
  const hashed = await bcrypt.hash('test-shared-pw', 12);
  updateWorkspace(protectedWsId, { clientPassword: hashed });

  const clientUser = await createClientUser(
    'portal-auth-client@test.local',
    'ClientPass1!',
    'Portal Auth Client',
    protectedWsId,
    'client_member',
  );
  clientUserId = clientUser.id;
  validClientToken = signClientToken(clientUser);

  // — Other workspace (for cross-workspace isolation) —
  const otherWs = createWorkspace('Portal Auth Test — Other');
  otherWsId = otherWs.id;
  const otherHashed = await bcrypt.hash('other-shared-pw', 12);
  updateWorkspace(otherWsId, { clientPassword: otherHashed });

  const otherClientUser = await createClientUser(
    'portal-auth-other@test.local',
    'OtherPass1!',
    'Portal Auth Other Client',
    otherWsId,
    'client_member',
  );
  otherClientUserId = otherClientUser.id;
  otherClientToken = signClientToken(otherClientUser);

  // — Open (passwordless) workspace —
  const openWs = createWorkspace('Portal Auth Test — Open');
  openWsId = openWs.id;
  // Deliberately no clientPassword → auth gate does NOT activate
}, 30_000);

afterAll(() => {
  deleteClientUser(clientUserId, protectedWsId);
  deleteClientUser(otherClientUserId, otherWsId);
  deleteWorkspace(protectedWsId);
  deleteWorkspace(otherWsId);
  deleteWorkspace(openWsId);
  ctx.stopServer();
});

// ── Helpers ────────────────────────────────────────────────────────────────

/** Build a cookie header carrying the client user JWT for a given workspace. */
function clientCookieHeader(workspaceId: string, token: string): string {
  return `client_user_token_${workspaceId}=${token}`;
}

/** GET request without any auth cookies. */
async function getNoAuth(path: string): Promise<Response> {
  ctx.clearCookies();
  return ctx.api(path);
}

/** GET request with a valid client JWT cookie for the protected workspace. */
async function getWithValidClientToken(path: string): Promise<Response> {
  ctx.clearCookies();
  return ctx.api(path, {
    headers: { Cookie: clientCookieHeader(protectedWsId, validClientToken) },
  });
}

/** GET request with an arbitrary cookie header string. */
async function getWithCookie(path: string, cookie: string): Promise<Response> {
  ctx.clearCookies();
  return ctx.api(path, { headers: { Cookie: cookie } });
}

/** POST request without any auth cookies. */
async function postNoAuth(path: string, body: unknown = {}): Promise<Response> {
  ctx.clearCookies();
  return ctx.api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** POST request with a valid client JWT cookie for the protected workspace. */
async function postWithValidClientToken(path: string, body: unknown = {}): Promise<Response> {
  ctx.clearCookies();
  return ctx.api(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: clientCookieHeader(protectedWsId, validClientToken),
    },
    body: JSON.stringify(body),
  });
}

// ── Helpers: expired and malformed tokens ──────────────────────────────────

function makeExpiredToken(workspaceId: string): string {
  return jwt.sign(
    { clientUserId: 'cu_fake_expired', email: 'expired@test.local', role: 'client_member', workspaceId },
    JWT_SECRET,
    { expiresIn: -1 }, // already expired
  );
}

function makeMalformedToken(): string {
  return 'this.is.not.a.real.jwt';
}

function makeWrongSecretToken(workspaceId: string): string {
  return jwt.sign(
    { clientUserId: 'cu_fake_wrong', email: 'wrong@test.local', role: 'client_member', workspaceId },
    'totally-wrong-secret',
    { expiresIn: '1h' },
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// EXEMPT ENDPOINTS — must return 200 (or non-401) regardless of auth
// ══════════════════════════════════════════════════════════════════════════════

describe('Exempt endpoints: no auth required even with clientPassword set', () => {
  it('GET /api/public/workspace/:id — returns workspace info without auth', async () => {
    const res = await getNoAuth(`/api/public/workspace/${protectedWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.id).toBe(protectedWsId);
    // requiresPassword must be true so client knows to show login
    expect(body.requiresPassword).toBe(true);
  });

  it('GET /api/public/auth-mode/:id — returns auth mode without auth', async () => {
    const res = await getNoAuth(`/api/public/auth-mode/${protectedWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.hasSharedPassword).toBe(true);
  });

  it('GET /api/public/client-me/:id — returns null user without auth (no 401)', async () => {
    const res = await getNoAuth(`/api/public/client-me/${protectedWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.user).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GATED ENDPOINTS — 401 without auth, 200 with valid client JWT
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/public/seo-strategy/:workspaceId — auth enforcement', () => {
  const path = () => `/api/public/seo-strategy/${protectedWsId}`;

  it('no auth → 401', async () => {
    const res = await getNoAuth(path());
    expect(res.status).toBe(401);
  });

  it('expired JWT → 401', async () => {
    const token = makeExpiredToken(protectedWsId);
    const res = await getWithCookie(path(), clientCookieHeader(protectedWsId, token));
    expect(res.status).toBe(401);
  });

  it('malformed JWT → 401', async () => {
    const res = await getWithCookie(path(), clientCookieHeader(protectedWsId, makeMalformedToken()));
    expect(res.status).toBe(401);
  });

  it('JWT signed with wrong secret → 401', async () => {
    const token = makeWrongSecretToken(protectedWsId);
    const res = await getWithCookie(path(), clientCookieHeader(protectedWsId, token));
    expect(res.status).toBe(401);
  });

  it('valid client JWT → not 401 (workspace has no strategy → 200 or 403)', async () => {
    const res = await getWithValidClientToken(path());
    // Auth passed — seoClientView may not be enabled on the test workspace,
    // which returns 403. Either way, the auth gate itself must NOT return 401.
    expect(res.status).not.toBe(401);
  });

  it('cross-workspace JWT (token for otherWsId used on protectedWsId) → 401', async () => {
    // otherClientToken is valid but for a different workspace
    const res = await getWithCookie(path(), clientCookieHeader(protectedWsId, otherClientToken));
    expect(res.status).toBe(401);
  });
});

describe('GET /api/public/content-requests/:workspaceId — auth enforcement', () => {
  const path = () => `/api/public/content-requests/${protectedWsId}`;

  it('no auth → 401', async () => {
    const res = await getNoAuth(path());
    expect(res.status).toBe(401);
  });

  it('expired JWT → 401', async () => {
    const token = makeExpiredToken(protectedWsId);
    const res = await getWithCookie(path(), clientCookieHeader(protectedWsId, token));
    expect(res.status).toBe(401);
  });

  it('malformed JWT → 401', async () => {
    const res = await getWithCookie(path(), clientCookieHeader(protectedWsId, makeMalformedToken()));
    expect(res.status).toBe(401);
  });

  it('valid client JWT → 200 (empty array for new workspace)', async () => {
    const res = await getWithValidClientToken(path());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('cross-workspace JWT → 401', async () => {
    const res = await getWithCookie(path(), clientCookieHeader(protectedWsId, otherClientToken));
    expect(res.status).toBe(401);
  });
});

describe('GET /api/public/insights/:workspaceId — auth enforcement', () => {
  const path = () => `/api/public/insights/${protectedWsId}`;

  it('no auth → 401', async () => {
    const res = await getNoAuth(path());
    expect(res.status).toBe(401);
  });

  it('expired JWT → 401', async () => {
    const token = makeExpiredToken(protectedWsId);
    const res = await getWithCookie(path(), clientCookieHeader(protectedWsId, token));
    expect(res.status).toBe(401);
  });

  it('malformed JWT → 401', async () => {
    const res = await getWithCookie(path(), clientCookieHeader(protectedWsId, makeMalformedToken()));
    expect(res.status).toBe(401);
  });

  it('valid client JWT → 200 (empty insights for new workspace)', async () => {
    const res = await getWithValidClientToken(path());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('cross-workspace JWT → 401', async () => {
    const res = await getWithCookie(path(), clientCookieHeader(protectedWsId, otherClientToken));
    expect(res.status).toBe(401);
  });
});

describe('GET /api/public/tracked-keywords/:workspaceId — auth enforcement', () => {
  const path = () => `/api/public/tracked-keywords/${protectedWsId}`;

  it('no auth → 401', async () => {
    const res = await getNoAuth(path());
    expect(res.status).toBe(401);
  });

  it('expired JWT → 401', async () => {
    const token = makeExpiredToken(protectedWsId);
    const res = await getWithCookie(path(), clientCookieHeader(protectedWsId, token));
    expect(res.status).toBe(401);
  });

  it('valid client JWT → 200 with keywords array', async () => {
    const res = await getWithValidClientToken(path());
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(Array.isArray(body.keywords)).toBe(true);
  });

  it('cross-workspace JWT → 401', async () => {
    const res = await getWithCookie(path(), clientCookieHeader(protectedWsId, otherClientToken));
    expect(res.status).toBe(401);
  });
});

describe('GET /api/public/requests/:workspaceId — auth enforcement', () => {
  const path = () => `/api/public/requests/${protectedWsId}`;

  it('no auth → 401', async () => {
    const res = await getNoAuth(path());
    expect(res.status).toBe(401);
  });

  it('expired JWT → 401', async () => {
    const token = makeExpiredToken(protectedWsId);
    const res = await getWithCookie(path(), clientCookieHeader(protectedWsId, token));
    expect(res.status).toBe(401);
  });

  it('malformed JWT → 401', async () => {
    const res = await getWithCookie(path(), clientCookieHeader(protectedWsId, makeMalformedToken()));
    expect(res.status).toBe(401);
  });

  it('valid client JWT → 200 (empty array for new workspace)', async () => {
    const res = await getWithValidClientToken(path());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('cross-workspace JWT → 401', async () => {
    const res = await getWithCookie(path(), clientCookieHeader(protectedWsId, otherClientToken));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/public/content-request/:workspaceId — auth enforcement', () => {
  const path = () => `/api/public/content-request/${protectedWsId}`;
  const validBody = { topic: 'Auth test topic', targetKeyword: 'auth test keyword' };

  it('no auth → 401', async () => {
    const res = await postNoAuth(path(), validBody);
    expect(res.status).toBe(401);
  });

  it('expired JWT → 401', async () => {
    const token = makeExpiredToken(protectedWsId);
    const res = await ctx.api(path(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: clientCookieHeader(protectedWsId, token),
      },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(401);
  });

  it('malformed JWT → 401', async () => {
    const res = await ctx.api(path(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: clientCookieHeader(protectedWsId, makeMalformedToken()),
      },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(401);
  });

  it('valid client JWT → 200 (request created)', async () => {
    const res = await postWithValidClientToken(path(), validBody);
    // Auth passed — may get 200 (created) or 400 if validation fails for other reasons
    expect(res.status).not.toBe(401);
  });

  it('cross-workspace JWT → 401', async () => {
    const res = await ctx.api(path(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: clientCookieHeader(protectedWsId, otherClientToken),
      },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/public/content-performance/:workspaceId — auth enforcement', () => {
  const path = () => `/api/public/content-performance/${protectedWsId}`;

  it('no auth → 401', async () => {
    const res = await getNoAuth(path());
    expect(res.status).toBe(401);
  });

  it('expired JWT → 401', async () => {
    const token = makeExpiredToken(protectedWsId);
    const res = await getWithCookie(path(), clientCookieHeader(protectedWsId, token));
    expect(res.status).toBe(401);
  });

  it('valid client JWT → not 401 (auth passed, business logic response varies)', async () => {
    const res = await getWithValidClientToken(path());
    expect(res.status).not.toBe(401);
  });

  it('cross-workspace JWT → 401', async () => {
    const res = await getWithCookie(path(), clientCookieHeader(protectedWsId, otherClientToken));
    expect(res.status).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PASSWORDLESS WORKSPACE — auth gate must NOT activate (no clientPassword)
// ══════════════════════════════════════════════════════════════════════════════

describe('Passwordless workspace — gated endpoints accessible without auth', () => {
  it('GET /api/public/content-requests/:id — no auth → 200 for passwordless workspace', async () => {
    const res = await getNoAuth(`/api/public/content-requests/${openWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/public/tracked-keywords/:id — no auth → 200 for passwordless workspace', async () => {
    const res = await getNoAuth(`/api/public/tracked-keywords/${openWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(Array.isArray(body.keywords)).toBe(true);
  });

  it('GET /api/public/requests/:id — no auth → 200 for passwordless workspace', async () => {
    const res = await getNoAuth(`/api/public/requests/${openWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/public/insights/:id — no auth → 200 for passwordless workspace', async () => {
    const res = await getNoAuth(`/api/public/insights/${openWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// CROSS-WORKSPACE SCOPING — JWT valid for WS-A must not unlock WS-B data
// ══════════════════════════════════════════════════════════════════════════════

describe('Cross-workspace JWT rejection — WS-A token cannot access WS-B endpoints', () => {
  it('GET /api/public/content-requests/:wsBId with wsA token → 401', async () => {
    // validClientToken is for protectedWsId, used against otherWsId
    const res = await getWithCookie(
      `/api/public/content-requests/${otherWsId}`,
      clientCookieHeader(otherWsId, validClientToken),
    );
    expect(res.status).toBe(401);
  });

  it('GET /api/public/tracked-keywords/:wsBId with wsA token → 401', async () => {
    const res = await getWithCookie(
      `/api/public/tracked-keywords/${otherWsId}`,
      clientCookieHeader(otherWsId, validClientToken),
    );
    expect(res.status).toBe(401);
  });

  it('GET /api/public/requests/:wsBId with wsA token → 401', async () => {
    const res = await getWithCookie(
      `/api/public/requests/${otherWsId}`,
      clientCookieHeader(otherWsId, validClientToken),
    );
    expect(res.status).toBe(401);
  });

  it('GET /api/public/insights/:wsBId with wsA token → 401', async () => {
    const res = await getWithCookie(
      `/api/public/insights/${otherWsId}`,
      clientCookieHeader(otherWsId, validClientToken),
    );
    expect(res.status).toBe(401);
  });

  it('own workspace token works correctly for the workspace it belongs to', async () => {
    // Sanity check: otherClientToken works for otherWsId
    const res = await getWithCookie(
      `/api/public/content-requests/${otherWsId}`,
      clientCookieHeader(otherWsId, otherClientToken),
    );
    expect(res.status).toBe(200);
  });
});
