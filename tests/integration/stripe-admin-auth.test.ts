/**
 * Integration test — Stripe config endpoints require admin-only auth.
 *
 * Security concern: the global APP_PASSWORD gate in server/app.ts accepts
 * three credential types as equivalent:
 *   1. Raw APP_PASSWORD in x-auth-token
 *   2. Verified HMAC admin token
 *   3. Any valid JWT user token (including client-portal users)
 *
 * Stripe config endpoints manage SYSTEM-level secrets (secret key, webhook
 * secret, price mappings). JWT user tokens must NOT be able to reach them —
 * a client user with a valid JWT would otherwise be able to overwrite the
 * admin system's Stripe secret key.
 *
 * The four protected endpoints:
 *   GET    /api/stripe/config
 *   POST   /api/stripe/config/keys
 *   POST   /api/stripe/config/products
 *   DELETE /api/stripe/config
 *
 * These tests spawn a gated server (APP_PASSWORD set) and verify:
 *   - JWT Bearer token → 401 (the hole this PR closes)
 *   - No auth          → 401
 *   - HMAC admin token → not 401 (passes through the admin gate)
 *   - Raw APP_PASSWORD → not 401 (legacy compat)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

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
      // regardless of whether the host env has SESSION_SECRET set. Without this,
      // signAdminToken() would use whatever SESSION_SECRET is in the host env
      // (production-like CI, another dev's shell) and the HMAC pass-through test
      // would fail because the test's local derivation uses TEST_APP_PASSWORD.
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
// signAdminToken() uses SESSION_SECRET which falls back to APP_PASSWORD when unset.
const EXPECTED_HMAC_TOKEN = crypto
  .createHmac('sha256', TEST_APP_PASSWORD)
  .update('admin')
  .digest('hex');

// A JWT signed with the server's JWT_SECRET — mimics what a client-portal
// user receives from /api/auth/user-login. Its signature is valid, so the
// global APP_PASSWORD gate's JWT branch accepts it. Our new admin-auth
// middleware must still reject it.
const VALID_CLIENT_JWT = jwt.sign(
  { userId: 'usr_client_attacker', email: 'client@attacker.test', role: 'member' },
  TEST_JWT_SECRET,
  { expiresIn: '7d' },
);

describe('Integration — Stripe config endpoints require admin auth', () => {
  beforeAll(async () => {
    await startGatedServer();
  }, 25_000);

  afterAll(() => {
    stopGatedServer();
  });

  // ── The four protected endpoints, as [method, path, body?] tuples ──
  const endpoints: Array<{ method: 'GET' | 'POST' | 'DELETE'; path: string; body?: unknown }> = [
    { method: 'GET', path: '/api/stripe/config' },
    { method: 'POST', path: '/api/stripe/config/keys', body: { publishableKey: 'pk_test_hacker' } },
    { method: 'POST', path: '/api/stripe/config/products', body: { products: [] } },
    { method: 'DELETE', path: '/api/stripe/config' },
  ];

  // ─────────────────────────────────────────────────────────────
  // The hole this PR closes: JWT user token must NOT pass
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
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/[Aa]dmin|[Uu]nauthorized|[Aa]uthentication/);
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
  // Baselines: no auth is blocked, admin creds pass
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

    it(`${ep.method} ${ep.path} accepts a valid HMAC admin token (not 401)`, async () => {
      const res = await gatedFetch(ep.path, {
        method: ep.method,
        headers: ep.body ? { 'Content-Type': 'application/json' } : undefined,
        body: ep.body ? JSON.stringify(ep.body) : undefined,
        extraHeaders: { 'x-auth-token': EXPECTED_HMAC_TOKEN },
      });
      // Downstream may return 200/204 or 400 for empty bodies — but NOT 401.
      expect(res.status, `${ep.method} ${ep.path} must accept HMAC admin token`).not.toBe(401);
    });

    it(`${ep.method} ${ep.path} accepts the raw APP_PASSWORD (not 401)`, async () => {
      const res = await gatedFetch(ep.path, {
        method: ep.method,
        headers: ep.body ? { 'Content-Type': 'application/json' } : undefined,
        body: ep.body ? JSON.stringify(ep.body) : undefined,
        extraHeaders: { 'x-auth-token': TEST_APP_PASSWORD },
      });
      expect(res.status, `${ep.method} ${ep.path} must accept raw APP_PASSWORD`).not.toBe(401);
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Adjacent endpoints that must remain open to JWT users / public
  // (prove we only tightened the four config endpoints, not the whole router)
  // ─────────────────────────────────────────────────────────────

  it('GET /api/stripe/publishable-key remains reachable (not gated by admin auth)', async () => {
    // This endpoint is used by client Stripe Elements — it must work under the
    // same conditions as before (APP_PASSWORD gate with JWT allowed).
    const res = await gatedFetch('/api/stripe/publishable-key', {
      extraHeaders: { Authorization: `Bearer ${VALID_CLIENT_JWT}` },
    });
    // Passes the global gate via JWT; returns 200 with a JSON body.
    expect(res.status).toBe(200);
  });
});
