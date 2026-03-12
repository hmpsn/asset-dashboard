/**
 * Integration tests for user management API endpoints.
 *
 * Tests:
 * - GET /api/users (requires auth — owner/admin only)
 * - POST /api/users (requires auth — create user)
 * - GET /api/users/:id (requires auth)
 * - PATCH /api/users/:id (requires auth)
 * - POST /api/users/:id/password (requires auth)
 * - DELETE /api/users/:id (requires auth — owner only)
 *
 * Since these endpoints require JWT auth, we test both the auth
 * enforcement (401 without token) and the happy path using a
 * setup token if no users exist yet.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13208);
const { api, postJson, clearCookies, setAuthToken, authApi, authPostJson, authPatchJson, authDel } = ctx;

beforeAll(async () => {
  await ctx.startServer();
}, 25_000);

afterAll(() => {
  clearCookies();
  setAuthToken('');
  ctx.stopServer();
});

describe('User Management — auth enforcement', () => {
  it('GET /api/users without auth returns 401', async () => {
    clearCookies();
    setAuthToken('');
    const res = await api('/api/users');
    expect(res.status).toBe(401);
  });

  it('POST /api/users without auth returns 401', async () => {
    clearCookies();
    setAuthToken('');
    const res = await postJson('/api/users', {
      email: 'new@test.com',
      password: 'password123',
      name: 'Test User',
    });
    expect(res.status).toBe(401);
  });

  it('DELETE /api/users/:id without auth returns 401', async () => {
    clearCookies();
    setAuthToken('');
    const res = await api('/api/users/usr_test', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });
});

describe('User Management — setup flow', () => {
  let setupToken = '';
  let setupUserId = '';

  it('GET /api/auth/setup-status returns needsSetup boolean', async () => {
    const res = await api('/api/auth/setup-status');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.needsSetup).toBe('boolean');

    // If setup is already done, skip the rest of this describe block
    if (!body.needsSetup) {
      console.log('[users-api] Setup already completed, skipping setup flow tests');
    }
  });

  it('POST /api/auth/setup creates owner or returns already-completed', async () => {
    const res = await postJson('/api/auth/setup', {
      email: `integ_owner_${Date.now()}@test.com`,
      password: 'securepassword123',
      name: 'Integration Owner',
    });
    const body = await res.json();

    if (res.status === 200 && body.token) {
      // Setup succeeded — we created the first user
      setupToken = body.token;
      setupUserId = body.user.id;
      setAuthToken(setupToken);
      expect(body.user.role).toBe('owner');
      expect(body.user.email).toContain('integ_owner_');
    } else {
      // Setup already completed
      expect(res.status).toBe(400);
      expect(body.error).toContain('Setup already completed');
    }
  });

  it('GET /api/auth/me returns user when authenticated', async () => {
    if (!setupToken) return; // Skip if setup wasn't done in this test run

    setAuthToken(setupToken);
    const res = await authApi('/api/auth/me');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toHaveProperty('id');
    expect(body.user).toHaveProperty('email');
    expect(body.user).toHaveProperty('role');
  });

  it('GET /api/users returns user list when authenticated', async () => {
    if (!setupToken) return;

    setAuthToken(setupToken);
    const res = await authApi('/api/users');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    // All users should have safe fields (no passwordHash)
    for (const u of body) {
      expect(u).not.toHaveProperty('passwordHash');
      expect(u).toHaveProperty('id');
      expect(u).toHaveProperty('email');
      expect(u).toHaveProperty('role');
    }
  });

  // Create, update, and delete a user via authenticated API
  let createdUserId = '';

  it('POST /api/users creates a new user', async () => {
    if (!setupToken) return;

    setAuthToken(setupToken);
    const res = await authPostJson('/api/users', {
      email: `integ_member_${Date.now()}@test.com`,
      password: 'memberpass123',
      name: 'Integration Member',
      role: 'member',
      workspaceIds: [],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body.role).toBe('member');
    createdUserId = body.id;
  });

  it('GET /api/users/:id returns the created user', async () => {
    if (!setupToken || !createdUserId) return;

    setAuthToken(setupToken);
    const res = await authApi(`/api/users/${createdUserId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(createdUserId);
    expect(body.name).toBe('Integration Member');
  });

  it('PATCH /api/users/:id updates user fields', async () => {
    if (!setupToken || !createdUserId) return;

    setAuthToken(setupToken);
    const res = await authPatchJson(`/api/users/${createdUserId}`, {
      name: 'Updated Member',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Updated Member');
  });

  it('POST /api/users/:id/password changes password', async () => {
    if (!setupToken || !createdUserId) return;

    setAuthToken(setupToken);
    const res = await authPostJson(`/api/users/${createdUserId}/password`, {
      password: 'newpassword123',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('POST /api/users/:id/password with short password returns 400', async () => {
    if (!setupToken || !createdUserId) return;

    setAuthToken(setupToken);
    const res = await authPostJson(`/api/users/${createdUserId}/password`, {
      password: 'short',
    });
    expect(res.status).toBe(400);
  });

  it('DELETE /api/users/:id removes the user', async () => {
    if (!setupToken || !createdUserId) return;

    setAuthToken(setupToken);
    const res = await authDel(`/api/users/${createdUserId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  // Clean up the setup user too
  afterAll(async () => {
    if (setupToken && setupUserId) {
      // We can't delete ourselves via the API (it blocks self-deletion).
      // Just leave it — unit tests handle cleanup for users.json.
    }
    clearCookies();
    setAuthToken('');
  });
});
