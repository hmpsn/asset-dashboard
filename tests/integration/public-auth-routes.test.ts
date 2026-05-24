/**
 * Integration tests for server/routes/public-auth.ts
 *
 * Covers:
 * - POST /api/public/auth/:id — shared-password auth
 * - POST /api/public/client-login/:id — client user login (Zod validated)
 * - GET /api/public/auth-mode/:id — workspace auth info
 * - POST /api/public/capture-email/:id — portal email capture
 * - POST /api/public/forgot-password/:id — password reset request
 * - POST /api/public/reset-password — complete password reset (Zod validated)
 *
 * Rate-limit note: clientLoginLimiter allows 5 requests/min per IP per path.
 * The path includes the workspace ID, so each workspace gets its own bucket.
 * Tests that call the same endpoint multiple times use distinct workspace IDs
 * or are aware that the 6th+ call may return 429.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';

const PORT = 13500;
const ctx = createTestContext(PORT);
const { api, postJson } = ctx;

// Each describe block that calls rate-limited endpoints gets its own workspace
// so different rate-limit buckets are used (key = ip:path, path includes wsId).
let wsOpen = '';           // workspace with no password
let wsProtected = '';      // workspace with shared password
let wsLoginTests = '';     // workspace for client-login tests
let wsCaptureEmail = '';   // workspace for capture-email tests
let wsForgot = '';         // workspace for forgot-password tests

beforeAll(async () => {
  await ctx.startServer();
  wsOpen = createWorkspace('PublicAuth-13500-Open').id;
  wsProtected = createWorkspace('PublicAuth-13500-Protected').id;
  wsLoginTests = createWorkspace('PublicAuth-13500-Login').id;
  wsCaptureEmail = createWorkspace('PublicAuth-13500-Capture').id;
  wsForgot = createWorkspace('PublicAuth-13500-Forgot').id;
  // Set a plaintext password (the route supports legacy plaintext)
  updateWorkspace(wsProtected, { clientPassword: 'test-portal-pw-13500' });
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsOpen);
  deleteWorkspace(wsProtected);
  deleteWorkspace(wsLoginTests);
  deleteWorkspace(wsCaptureEmail);
  deleteWorkspace(wsForgot);
  await ctx.stopServer();
});

// ── POST /api/public/auth/:id ──────────────────────────────────────────────────

describe('POST /api/public/auth/:id — shared-password auth', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await postJson('/api/public/auth/nonexistent-ws-id-13500', { password: 'anything' });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBeTruthy();
  });

  it('returns ok:true for workspace with no password (passwordless)', async () => {
    const res = await postJson(`/api/public/auth/${wsOpen}`, {});
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('returns 401 for wrong password', async () => {
    const res = await postJson(`/api/public/auth/${wsProtected}`, { password: 'wrong-pw' });
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/incorrect password/i);
  });

  it('returns ok:true for correct shared password', async () => {
    // Use a new workspace so this is the 1st hit on a fresh rate-limit bucket
    const wsAuth = createWorkspace('PublicAuth-13500-Correct').id;
    try {
      updateWorkspace(wsAuth, { clientPassword: 'correct-pw-13500' });
      const res = await postJson(`/api/public/auth/${wsAuth}`, { password: 'correct-pw-13500' });
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean };
      expect(body.ok).toBe(true);
    } finally {
      deleteWorkspace(wsAuth);
    }
  });

  it('sets a client session cookie on successful auth', async () => {
    // Use a dedicated workspace to get a clean rate-limit bucket
    const wsCookie = createWorkspace('PublicAuth-13500-Cookie').id;
    try {
      updateWorkspace(wsCookie, { clientPassword: 'cookie-test-pw-13500' });
      const res = await postJson(`/api/public/auth/${wsCookie}`, { password: 'cookie-test-pw-13500' });
      expect(res.status).toBe(200);
      const cookies = res.headers.getSetCookie?.() ?? [];
      const sessionCookie = cookies.find(c => c.startsWith(`client_session_${wsCookie}`));
      expect(sessionCookie).toBeDefined();
    } finally {
      deleteWorkspace(wsCookie);
    }
  });
});

// ── POST /api/public/client-login/:id ─────────────────────────────────────────
// clientLoginLimiter allows 5/min per ip:path.
// Each test below uses a separate workspace to avoid sharing buckets.

describe('POST /api/public/client-login/:id — client user login', () => {
  it('returns 400 for missing email (Zod validation)', async () => {
    const ws = createWorkspace('PublicAuth-13500-Login-1').id;
    try {
      const res = await postJson(`/api/public/client-login/${ws}`, { password: 'somepass' });
      expect(res.status).toBe(400);
    } finally { deleteWorkspace(ws); }
  });

  it('returns 400 for missing password (Zod validation)', async () => {
    const ws = createWorkspace('PublicAuth-13500-Login-2').id;
    try {
      const res = await postJson(`/api/public/client-login/${ws}`, { email: 'test@example.com' });
      expect(res.status).toBe(400);
    } finally { deleteWorkspace(ws); }
  });

  it('returns 400 for invalid email format (Zod validation)', async () => {
    const ws = createWorkspace('PublicAuth-13500-Login-3').id;
    try {
      const res = await postJson(`/api/public/client-login/${ws}`, { email: 'not-an-email', password: 'pass' });
      expect(res.status).toBe(400);
    } finally { deleteWorkspace(ws); }
  });

  it('returns 404 for unknown workspace with valid body', async () => {
    const res = await postJson('/api/public/client-login/no-such-ws-13500', {
      email: 'user@example.com',
      password: 'somepassword',
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBeTruthy();
  });

  it('returns 401 for non-existent client user credentials', async () => {
    const ws = createWorkspace('PublicAuth-13500-Login-5').id;
    try {
      const res = await postJson(`/api/public/client-login/${ws}`, {
        email: 'nobody@example.com',
        password: 'wrongpassword',
      });
      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toBeTruthy();
    } finally { deleteWorkspace(ws); }
  });

  it('returns 400 for empty password string (Zod min(1))', async () => {
    const ws = createWorkspace('PublicAuth-13500-Login-6').id;
    try {
      const res = await postJson(`/api/public/client-login/${ws}`, {
        email: 'user@example.com',
        password: '',
      });
      expect(res.status).toBe(400);
    } finally { deleteWorkspace(ws); }
  });
});

// ── GET /api/public/auth-mode/:id ─────────────────────────────────────────────
// This endpoint does not have rate limiting.

describe('GET /api/public/auth-mode/:id — workspace auth mode info', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/public/auth-mode/unknown-ws-13500');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBeTruthy();
  });

  it('returns hasSharedPassword:false and hasClientUsers:false for fresh workspace', async () => {
    const res = await api(`/api/public/auth-mode/${wsOpen}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { hasSharedPassword: boolean; hasClientUsers: boolean };
    expect(body.hasSharedPassword).toBe(false);
    expect(body.hasClientUsers).toBe(false);
  });

  it('returns hasSharedPassword:true for workspace with a password set', async () => {
    const res = await api(`/api/public/auth-mode/${wsProtected}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { hasSharedPassword: boolean; hasClientUsers: boolean };
    expect(body.hasSharedPassword).toBe(true);
  });
});

// ── POST /api/public/capture-email/:id ────────────────────────────────────────
// This endpoint does not have rate limiting (not wrapped in clientLoginLimiter).

describe('POST /api/public/capture-email/:id — portal email capture', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await postJson('/api/public/capture-email/no-ws-13500', { email: 'user@example.com' });
    expect(res.status).toBe(404);
  });

  it('returns 400 for missing email', async () => {
    const res = await postJson(`/api/public/capture-email/${wsCaptureEmail}`, { name: 'No Email' });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/email/i);
  });

  it('returns 400 for invalid email format', async () => {
    const res = await postJson(`/api/public/capture-email/${wsCaptureEmail}`, { email: 'not-an-email' });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/email/i);
  });

  it('returns ok:true for valid email on open workspace', async () => {
    const res = await postJson(`/api/public/capture-email/${wsCaptureEmail}`, {
      email: 'visitor@example.com',
      name: 'Visitor Name',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('does not error on duplicate email capture (idempotent)', async () => {
    const res1 = await postJson(`/api/public/capture-email/${wsCaptureEmail}`, { email: 'dup@example.com' });
    expect(res1.status).toBe(200);
    const res2 = await postJson(`/api/public/capture-email/${wsCaptureEmail}`, { email: 'dup@example.com', name: 'Updated Name' });
    expect(res2.status).toBe(200);
  });
});

// ── POST /api/public/forgot-password/:id ──────────────────────────────────────
// Has clientLoginLimiter — use distinct workspaces per test.

describe('POST /api/public/forgot-password/:id — password reset request', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await postJson('/api/public/forgot-password/no-ws-13500', { email: 'user@example.com' });
    expect(res.status).toBe(404);
  });

  it('returns 400 for missing email', async () => {
    const res = await postJson(`/api/public/forgot-password/${wsForgot}`, {});
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/email/i);
  });

  it('returns ok:true for non-existent email (prevents enumeration)', async () => {
    // Use a distinct workspace to get a fresh rate-limit bucket
    const wsForgot2 = createWorkspace('PublicAuth-13500-Forgot2').id;
    try {
      const res = await postJson(`/api/public/forgot-password/${wsForgot2}`, { email: 'nobody@example.com' });
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; message: string };
      expect(body.ok).toBe(true);
      expect(body.message).toBeTruthy();
    } finally { deleteWorkspace(wsForgot2); }
  });
});

// ── POST /api/public/reset-password ───────────────────────────────────────────
// No rate limiting on this route — safe to call multiple times.

describe('POST /api/public/reset-password — complete password reset', () => {
  it('returns 400 for missing token (Zod validation)', async () => {
    const res = await postJson('/api/public/reset-password', { newPassword: 'NewPass123!' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing newPassword (Zod validation)', async () => {
    const res = await postJson('/api/public/reset-password', { token: 'some-token' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for password shorter than 8 characters (Zod min)', async () => {
    const res = await postJson('/api/public/reset-password', { token: 'some-token', newPassword: 'short' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty token (Zod min(1))', async () => {
    const res = await postJson('/api/public/reset-password', { token: '', newPassword: 'ValidPass123!' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid/expired reset token', async () => {
    const res = await postJson('/api/public/reset-password', {
      token: 'invalid-token-that-does-not-exist',
      newPassword: 'ValidPass123!',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBeTruthy();
  });
});
