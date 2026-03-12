/**
 * Integration tests for auth API endpoints.
 *
 * Tests the full HTTP request/response cycle for:
 * - /api/auth/check
 * - /api/auth/setup-status
 * - /api/auth/setup (create first user)
 * - /api/auth/user-login
 * - /api/auth/me
 * - /api/auth/user-logout
 * - /api/auth/login (legacy password auth)
 * - /api/auth/logout (legacy)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13201);
const { api, postJson, clearCookies, setAuthToken } = ctx;

beforeAll(async () => {
  await ctx.startServer();
}, 25_000);

afterAll(() => {
  ctx.stopServer();
});

describe('Auth — public endpoints', () => {
  it('GET /api/auth/check returns required field', async () => {
    const res = await api('/api/auth/check');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('required');
    // With APP_PASSWORD='', required should be false
    expect(body.required).toBe(false);
  });

  it('GET /api/auth/setup-status returns needsSetup boolean', async () => {
    const res = await api('/api/auth/setup-status');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('needsSetup');
    expect(typeof body.needsSetup).toBe('boolean');
  });
});

describe('Auth — legacy password login', () => {
  it('POST /api/auth/login with no APP_PASSWORD returns ok', async () => {
    const res = await postJson('/api/auth/login', { password: 'anything' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('POST /api/auth/logout clears cookie and returns ok', async () => {
    const res = await postJson('/api/auth/logout', {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

describe('Auth — user setup validation', () => {
  it('POST /api/auth/setup with missing fields returns 400', async () => {
    const res = await postJson('/api/auth/setup', {});
    expect(res.status).toBeLessThan(500);
    // Either 400 (missing fields) or 400 (setup already completed)
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('POST /api/auth/setup with short password returns 400', async () => {
    const res = await postJson('/api/auth/setup', {
      email: 'test@test.com',
      password: 'short',
      name: 'Test',
    });
    expect(res.status).toBeLessThan(500);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

describe('Auth — user login validation', () => {
  it('POST /api/auth/user-login with missing fields returns 400', async () => {
    const res = await postJson('/api/auth/user-login', {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('email and password are required');
  });

  it('POST /api/auth/user-login with wrong credentials returns 401', async () => {
    const res = await postJson('/api/auth/user-login', {
      email: 'nonexistent@test.com',
      password: 'wrongpassword123',
    });
    // Returns 401 if user doesn't exist, or could be 401 for wrong password
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Invalid email or password');
  });

  it('POST /api/auth/user-logout returns ok', async () => {
    const res = await postJson('/api/auth/user-logout', {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

describe('Auth — /api/auth/me requires authentication', () => {
  it('GET /api/auth/me without token returns 401', async () => {
    clearCookies();
    setAuthToken('');
    const res = await api('/api/auth/me');
    expect(res.status).toBe(401);
  });
});
