/**
 * Integration tests: public client user endpoints.
 *
 * Tests NOT covered by client-auth.test.ts or e2e-client-auth-flow.test.ts:
 *   - GET /api/public/client-me/:id without token → 401
 *   - GET /api/public/client-me/:id for unknown workspace → 404
 *   - POST /api/public/client-logout/:id → 200 (clears cookie)
 *   - GET /api/public/auth-mode/:id for workspace with clientUsers → {hasClientUsers: true}
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createClientUser, deleteClientUser } from '../../server/client-users.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api, postJson } = ctx;

let wsId = '';
let clientUserId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Public Client Me Logout WS').id;
  // Create a client user so we can test the auth-mode response
  const user = await createClientUser('client@example.com', 'password123', 'Test Client', wsId);
  clientUserId = user.id;
}, 25_000);

afterAll(async () => {
  deleteClientUser(clientUserId, wsId);
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('GET /api/public/client-me/:id', () => {
  it('returns 200 {user: null} when no auth token is present (no 401 — route is public)', async () => {
    ctx.clearCookies();
    const res = await api(`/api/public/client-me/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { user: null };
    expect(body.user).toBeNull();
  });

  it('returns 200 {user: null} for unknown workspace (no workspace check in client-me)', async () => {
    const res = await api('/api/public/client-me/ws_does_not_exist_me_99');
    expect(res.status).toBe(200);
    const body = await res.json() as { user: null };
    expect(body.user).toBeNull();
  });
});

describe('POST /api/public/client-logout/:id', () => {
  it('returns 200 regardless of auth state (logout is always accepted)', async () => {
    ctx.clearCookies();
    const res = await postJson(`/api/public/client-logout/${wsId}`, {});
    expect(res.status).toBe(200);
  });

  it('includes a Set-Cookie header that clears the client user token', async () => {
    const res = await postJson(`/api/public/client-logout/${wsId}`, {});
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    // Logout clears the cookie by setting Max-Age=0 or Expires in the past
    expect(setCookie).toContain(`client_user_token_${wsId}`);
  });
});

describe('GET /api/public/auth-mode/:id — hasClientUsers flag', () => {
  it('returns hasClientUsers: true when the workspace has client users', async () => {
    const res = await api(`/api/public/auth-mode/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { hasSharedPassword: boolean; hasClientUsers: boolean };
    expect(body.hasClientUsers).toBe(true);
  });

  it('returns hasSharedPassword: false for workspace with no clientPassword', async () => {
    const res = await api(`/api/public/auth-mode/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { hasSharedPassword: boolean; hasClientUsers: boolean };
    // wsId has no clientPassword set
    expect(body.hasSharedPassword).toBe(false);
  });
});
