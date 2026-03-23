/**
 * Integration tests for client portal authentication API endpoints.
 *
 * Tests:
 * - GET /api/public/auth-mode/:id
 * - POST /api/public/auth/:id (shared password login)
 * - POST /api/public/client-login/:id (individual login)
 * - GET /api/public/client-me/:id
 * - POST /api/public/client-logout/:id
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13205);
const { api, postJson, clearCookies } = ctx;

let testWsId = '';

beforeAll(async () => {
  await ctx.startServer();
  // Create a test workspace for client auth tests
  const ws = createWorkspace('Client Auth Test WS');
  testWsId = ws.id;
}, 25_000);

afterAll(() => {
  deleteWorkspace(testWsId);
  ctx.stopServer();
});

describe('Client portal auth — auth-mode', () => {
  it('GET /api/public/auth-mode/:id returns auth mode info', async () => {
    const res = await api(`/api/public/auth-mode/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('hasSharedPassword');
    expect(body).toHaveProperty('hasClientUsers');
    // Fresh workspace has no password and no client users
    expect(body.hasSharedPassword).toBe(false);
    expect(body.hasClientUsers).toBe(false);
  });

  it('GET /api/public/auth-mode/:id with bad id returns 404', async () => {
    const res = await api('/api/public/auth-mode/ws_nonexistent_999');
    expect(res.status).toBe(404);
  });
});

describe('Client portal auth — shared password', () => {
  it('POST /api/public/auth/:id without password set returns ok', async () => {
    // Workspace has no password, so any request should pass
    const res = await postJson(`/api/public/auth/${testWsId}`, { password: '' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('POST /api/public/auth/:id with bad workspace returns 404', async () => {
    const res = await postJson('/api/public/auth/ws_nonexistent_999', { password: 'test' });
    expect(res.status).toBe(404);
  });
});

describe('Client portal auth — individual login', () => {
  it('POST /api/public/client-login/:id with missing fields returns 400', async () => {
    const res = await postJson(`/api/public/client-login/${testWsId}`, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.toLowerCase()).toContain('required');
  });

  it('POST /api/public/client-login/:id with wrong credentials returns 401', async () => {
    const res = await postJson(`/api/public/client-login/${testWsId}`, {
      email: 'noone@test.com',
      password: 'wrongpassword',
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/public/client-login/:id with bad workspace returns 404', async () => {
    const res = await postJson('/api/public/client-login/ws_nonexistent_999', {
      email: 'test@test.com',
      password: 'password123',
    });
    expect(res.status).toBe(404);
  });
});

describe('Client portal auth — client-me', () => {
  it('GET /api/public/client-me/:id without token returns null user', async () => {
    clearCookies();
    const res = await api(`/api/public/client-me/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toBeNull();
  });
});

describe('Client portal auth — logout', () => {
  it('POST /api/public/client-logout/:id returns ok', async () => {
    const res = await postJson(`/api/public/client-logout/${testWsId}`, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
