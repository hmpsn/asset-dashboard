/**
 * Integration test — Stripe config endpoints require HMAC admin auth.
 *
 * These four endpoints manage SYSTEM-level Stripe secrets and are restricted
 * to HMAC admin token holders via `requireAdminAuth`:
 *
 *   GET    /api/stripe/config
 *   POST   /api/stripe/config/keys
 *   POST   /api/stripe/config/products
 *   DELETE /api/stripe/config
 *
 * Auth model: the global APP_PASSWORD gate in server/app.ts allows requests
 * with a valid HMAC token or valid JWT through to routes. These four routes
 * then apply `requireAdminAuth` which accepts ONLY HMAC admin tokens and
 * rejects JWT user tokens.
 *
 * These tests spawn a gated server (APP_PASSWORD set) and verify:
 *   - JWT member token   → 401 (requireAdminAuth rejects JWT)
 *   - HMAC admin token   → not 401/403 (primary accepted credential)
 *   - Raw APP_PASSWORD   → 401 (global gate no longer accepts raw password)
 *   - No auth            → 401 (global gate rejects)
 *   - JWT owner token + HMAC → not 401/403 (HMAC passes through)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { createUser, getUserByEmail, deleteUser } from '../../server/users.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const TEST_APP_PASSWORD = 'test-stripe-admin-pw-54321';
const TEST_JWT_SECRET = 'test-stripe-admin-jwt-secret-abcdef';

const GATED_PORT = 13320;
const GATED_BASE = `http://localhost:${GATED_PORT}`;

let gatedProc: ChildProcess | null = null;

async function startGatedServer(): Promise<void> {
  if (gatedProc) return;

  gatedProc = spawn('node', ['--import', 'tsx', 'server/index.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(GATED_PORT),
      NODE_ENV: 'test',
      APP_PASSWORD: TEST_APP_PASSWORD,
      // Pin SESSION_SECRET so EXPECTED_HMAC_TOKEN derivation stays deterministic
      SESSION_SECRET: TEST_APP_PASSWORD,
      JWT_SECRET: TEST_JWT_SECRET,
    },
    stdio: 'pipe',
  });

  gatedProc.stderr?.on('data', (d: Buffer) => process.stderr.write(d));

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Gated server did not start within 20 seconds'));
    }, 20_000);

    gatedProc!.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      if (text.includes('running on')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    gatedProc!.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    gatedProc!.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== null && code !== 0) {
        reject(new Error(`Gated server exited with code ${code}`));
      }
    });
  });
}

function stopGatedServer(): void {
  gatedProc?.kill('SIGTERM');
  gatedProc = null;
}

async function gatedFetch(
  urlPath: string,
  opts: RequestInit & { extraHeaders?: Record<string, string> } = {},
): Promise<Response> {
  const { extraHeaders, ...rest } = opts;
  return fetch(`${GATED_BASE}${urlPath}`, {
    ...rest,
    headers: {
      ...(rest.headers as Record<string, string> | undefined ?? {}),
      ...(extraHeaders ?? {}),
    },
    redirect: 'manual',
  });
}

// Admin HMAC token derived the same way the server derives it.
const EXPECTED_HMAC_TOKEN = crypto
  .createHmac('sha256', TEST_APP_PASSWORD)
  .update('admin')
  .digest('hex');

// A JWT signed with the server's JWT_SECRET — mimics what a client-portal
// user receives from /api/auth/user-login. Its signature is valid, but the
// userId doesn't exist in the DB, so requireAuth returns 401 "User not found".
const VALID_CLIENT_JWT = jwt.sign(
  { userId: 'usr_client_attacker', email: 'client@attacker.test', role: 'member' },
  TEST_JWT_SECRET,
  { expiresIn: '7d' },
);

// Owner JWT — created via direct DB insert + signed with the gated server's JWT_SECRET
const TEST_OWNER_EMAIL = 'stripe_admin_owner@test.local';
let ownerJwt = '';
let testUserId = '';

describe('Integration — Stripe config endpoints require HMAC admin auth', () => {
  beforeAll(async () => {
    // Create the user in the shared DB so requireAuth's getUserById() finds them.
    let user = getUserByEmail(TEST_OWNER_EMAIL);
    if (!user) {
      user = await createUser(TEST_OWNER_EMAIL, 'testpassword123', 'Stripe Admin Test Owner', 'owner');
    }
    testUserId = user.id;
    // Sign JWT with the gated server's JWT_SECRET (not the default dev secret)
    ownerJwt = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      TEST_JWT_SECRET,
      { expiresIn: '7d' },
    );
    await startGatedServer();
  }, 25_000);

  afterAll(() => {
    stopGatedServer();
    if (testUserId) deleteUser(testUserId);
  });

  // ── The four protected endpoints, as [method, path, body?] tuples ──
  const endpoints: Array<{ method: 'GET' | 'POST' | 'DELETE'; path: string; body?: unknown }> = [
    { method: 'GET', path: '/api/stripe/config' },
    { method: 'POST', path: '/api/stripe/config/keys', body: { publishableKey: 'pk_test_hacker' } },
    { method: 'POST', path: '/api/stripe/config/products', body: { products: [] } },
    { method: 'DELETE', path: '/api/stripe/config' },
  ];

  // ─────────────────────────────────────────────────────────────
  // JWT member token — user not in DB → requireAuth returns 401
  // ─────────────────────────────────────────────────────────────

  for (const ep of endpoints) {
    it(`${ep.method} ${ep.path} rejects a valid JWT user token (401)`, async () => {
      const res = await gatedFetch(ep.path, {
        method: ep.method,
        headers: ep.body ? { 'Content-Type': 'application/json' } : undefined,
        body: ep.body ? JSON.stringify(ep.body) : undefined,
        extraHeaders: { Authorization: `Bearer ${VALID_CLIENT_JWT}` },
      });
      expect(res.status, `${ep.method} ${ep.path} must reject valid client JWT`).toBe(401);
    });

    it(`${ep.method} ${ep.path} rejects a JWT in the token cookie (401)`, async () => {
      const res = await gatedFetch(ep.path, {
        method: ep.method,
        headers: ep.body ? { 'Content-Type': 'application/json' } : undefined,
        body: ep.body ? JSON.stringify(ep.body) : undefined,
        extraHeaders: { Cookie: `token=${VALID_CLIENT_JWT}` },
      });
      expect(res.status, `${ep.method} ${ep.path} must reject JWT cookie`).toBe(401);
    });
  }

  // ─────────────────────────────────────────────────────────────
  // No auth / raw password — rejected; HMAC admin — accepted
  // ─────────────────────────────────────────────────────────────

  for (const ep of endpoints) {
    it(`${ep.method} ${ep.path} rejects a request with no auth (401)`, async () => {
      const res = await gatedFetch(ep.path, {
        method: ep.method,
        headers: ep.body ? { 'Content-Type': 'application/json' } : undefined,
        body: ep.body ? JSON.stringify(ep.body) : undefined,
      });
      expect(res.status).toBe(401);
    });

    it(`${ep.method} ${ep.path} accepts HMAC admin token (not 401/403)`, async () => {
      const res = await gatedFetch(ep.path, {
        method: ep.method,
        headers: ep.body ? { 'Content-Type': 'application/json' } : undefined,
        body: ep.body ? JSON.stringify(ep.body) : undefined,
        extraHeaders: { 'x-auth-token': EXPECTED_HMAC_TOKEN },
      });
      // HMAC passes both the global gate and requireAdminAuth
      expect(res.status, `${ep.method} ${ep.path} must accept HMAC admin token`).not.toBe(401);
      expect(res.status, `${ep.method} ${ep.path} must accept HMAC admin token`).not.toBe(403);
    });

    it(`${ep.method} ${ep.path} rejects raw APP_PASSWORD (401)`, async () => {
      const res = await gatedFetch(ep.path, {
        method: ep.method,
        headers: ep.body ? { 'Content-Type': 'application/json' } : undefined,
        body: ep.body ? JSON.stringify(ep.body) : undefined,
        extraHeaders: { 'x-auth-token': TEST_APP_PASSWORD },
      });
      // Raw APP_PASSWORD is no longer accepted by the global gate or requireAdminAuth
      expect(res.status, `${ep.method} ${ep.path} must reject raw APP_PASSWORD`).toBe(401);
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Positive: JWT owner token passes through
  // ─────────────────────────────────────────────────────────────

  for (const ep of endpoints) {
    it(`${ep.method} ${ep.path} accepts a JWT owner token (not 401/403)`, async () => {
      expect(ownerJwt, 'Owner JWT must be set from /api/auth/setup').toBeTruthy();
      const res = await gatedFetch(ep.path, {
        method: ep.method,
        headers: ep.body ? { 'Content-Type': 'application/json' } : undefined,
        body: ep.body ? JSON.stringify(ep.body) : undefined,
        extraHeaders: {
          'x-auth-token': EXPECTED_HMAC_TOKEN,
          Authorization: `Bearer ${ownerJwt}`,
        },
      });
      // Should pass auth — downstream may return 200/204 or 400 for empty bodies, but not 401/403.
      expect(res.status, `${ep.method} ${ep.path} must accept JWT owner token`).not.toBe(401);
      expect(res.status, `${ep.method} ${ep.path} must accept JWT owner token`).not.toBe(403);
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Adjacent endpoints that must remain open to JWT users / public
  // ─────────────────────────────────────────────────────────────

  it('GET /api/stripe/publishable-key remains reachable (not gated by admin auth)', async () => {
    const res = await gatedFetch('/api/stripe/publishable-key', {
      extraHeaders: { Authorization: `Bearer ${VALID_CLIENT_JWT}` },
    });
    // Passes the global gate via JWT; returns 200 with a JSON body.
    expect(res.status).toBe(200);
  });
});
