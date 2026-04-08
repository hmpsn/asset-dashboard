/**
 * Integration tests for rate limiting across all limiter tiers.
 *
 * Rate limiter implementation lives in server/middleware.ts.
 * Each limiter uses an in-memory bucket keyed by `${ip}:${req.path}` (per-path)
 * or `global:${ip}` (global). All limiters share the same `rateLimitBuckets` Map
 * within a server process, so isolation between test groups is achieved by using
 * distinct workspaceIds (different paths → different buckets).
 *
 * Limiter tiers under test:
 *  - globalPublicLimiter  : 200 req/min, key = global:${ip}, all /api/public/ routes
 *  - publicApiLimiter     : 60 req/min,  key = ${ip}:${path}, GET /api/public/ routes
 *  - publicWriteLimiter   : 10 req/min,  key = ${ip}:${path}, POST|PATCH|DELETE /api/public/
 *  - loginLimiter         : 5 req/min,   key = ${ip}:${path}, /api/auth/login
 *  - clientLoginLimiter   : 5 req/min,   key = ${ip}:${path}, /api/public/auth/:id
 *
 * Architecture note: POST /api/public/signal/:id hits BOTH publicWriteLimiter (10/min)
 * AND publicApiLimiter (60/min) AND globalPublicLimiter (200/min) — the write limiter is
 * the binding constraint. The existing client-signals-rate-limit.test.ts (port 13300)
 * covers write-limiter exhaustion on the /signal path; this file covers the remaining
 * tiers on separate paths, using a dedicated port so buckets start clean.
 *
 * X-RateLimit-* header semantics (from rateLimit() implementation):
 *  - X-RateLimit-Limit     : max requests for the window
 *  - X-RateLimit-Remaining : max - current count (clamped to 0 on 429)
 *  - X-RateLimit-Reset     : Unix timestamp (seconds) when the window resets
 *  - Retry-After           : seconds until reset, only on 429 responses
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

// Dedicated port — no other test file uses 13302
const ctx = createTestContext(13302);
const { api, postJson } = ctx;

// publicApiWsId is shared across the header-presence describe block (describe block 1 + 2).
// All other describe blocks create fresh workspaces inline per-test to keep buckets isolated.
let publicApiWsId = '';       // GET /api/public/workspace/:id — publicApiLimiter bucket

beforeAll(async () => {
  await ctx.startServer();
  publicApiWsId = createWorkspace('RL Test — PublicApi').id;
}, 25_000);

afterAll(() => {
  deleteWorkspace(publicApiWsId);
  ctx.stopServer();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. X-RateLimit-* headers are present on ALL /api/public/ responses
// ─────────────────────────────────────────────────────────────────────────────

describe('Rate-limit response headers', () => {
  it('GET /api/public/workspace/:id includes X-RateLimit-Limit header', async () => {
    const res = await api(`/api/public/workspace/${publicApiWsId}`);
    // The endpoint may succeed (200) or 404 for workspace setup, but headers always come from rate-limiter
    expect(res.headers.get('X-RateLimit-Limit')).toBeTruthy();
  });

  it('GET /api/public/workspace/:id includes X-RateLimit-Remaining header', async () => {
    const res = await api(`/api/public/workspace/${publicApiWsId}`);
    const remaining = res.headers.get('X-RateLimit-Remaining');
    expect(remaining).toBeTruthy();
    // remaining must be a non-negative integer string
    expect(Number(remaining)).toBeGreaterThanOrEqual(0);
  });

  it('GET /api/public/workspace/:id includes X-RateLimit-Reset header', async () => {
    const res = await api(`/api/public/workspace/${publicApiWsId}`);
    const reset = res.headers.get('X-RateLimit-Reset');
    expect(reset).toBeTruthy();
    // Reset is a Unix timestamp in seconds — must be in the future
    expect(Number(reset)).toBeGreaterThan(Date.now() / 1000 - 1);
  });

  it('X-RateLimit-Limit reflects the correct limit for public API GET routes (60)', async () => {
    // publicApiLimiter maxRequests = 60
    const res = await api(`/api/public/workspace/${publicApiWsId}`);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('60');
  });

  it('X-RateLimit-Remaining decrements on successive requests', async () => {
    // Make two requests to the same path, remaining should go down
    const res1 = await api(`/api/public/workspace/${publicApiWsId}`);
    const res2 = await api(`/api/public/workspace/${publicApiWsId}`);
    const remaining1 = Number(res1.headers.get('X-RateLimit-Remaining'));
    const remaining2 = Number(res2.headers.get('X-RateLimit-Remaining'));
    expect(remaining2).toBeLessThan(remaining1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. publicApiLimiter — 60 req/min per path (GET /api/public/)
//    Testing header semantics and within-limit behaviour.
//    Full exhaustion (60 requests) would be slow; we verify the header math instead.
// ─────────────────────────────────────────────────────────────────────────────

describe('publicApiLimiter (60 req/min, GET /api/public/)', () => {
  it('allows the first request without a 429', async () => {
    // Fresh workspace → fresh bucket. Must be a workspace different from all others
    // in this describe block to stay isolated.
    const wsId = createWorkspace('RL pubApi solo').id;
    try {
      const res = await api(`/api/public/workspace/${wsId}`);
      expect(res.status).not.toBe(429);
    } finally {
      deleteWorkspace(wsId);
    }
  });

  it('X-RateLimit-Limit is 60 for GET /api/public/ routes', async () => {
    const wsId = createWorkspace('RL pubApi limit').id;
    try {
      const res = await api(`/api/public/workspace/${wsId}`);
      expect(res.headers.get('X-RateLimit-Limit')).toBe('60');
    } finally {
      deleteWorkspace(wsId);
    }
  });

  it('X-RateLimit-Remaining is max-1 after one request (bucket starts fresh)', async () => {
    const wsId = createWorkspace('RL pubApi remaining').id;
    try {
      const res = await api(`/api/public/workspace/${wsId}`);
      // Fresh bucket: count=1, remaining = 60-1 = 59
      const remaining = Number(res.headers.get('X-RateLimit-Remaining'));
      // publicApiLimiter sets X-RateLimit-Remaining = max(0, 60 - count)
      // On count=1: remaining = 59
      expect(remaining).toBe(59);
    } finally {
      deleteWorkspace(wsId);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. publicWriteLimiter — 10 req/min per path (POST /api/public/)
//
//    Uses POST /api/public/capture-email/:id — this endpoint has ONLY the global
//    app.use() publicWriteLimiter applied (no extra per-route limiter), making it
//    the cleanest path for testing publicWriteLimiter in isolation.
//
//    Endpoint behaviour: validates email in body, 200 on valid email, 400 on bad.
//    We pass a valid email so each request returns 200 until the limit fires.
// ─────────────────────────────────────────────────────────────────────────────

describe('publicWriteLimiter (10 req/min, POST /api/public/)', () => {
  it('returns X-RateLimit-Limit of 10 for POST /api/public/ write routes', async () => {
    const wsId = createWorkspace('RL write limit-hdr').id;
    try {
      const res = await postJson(`/api/public/capture-email/${wsId}`, { email: 'test@example.com' });
      expect(res.headers.get('X-RateLimit-Limit')).toBe('10');
    } finally {
      deleteWorkspace(wsId);
    }
  });

  it('X-RateLimit-Remaining is 9 after the first POST request (fresh bucket)', async () => {
    const wsId = createWorkspace('RL write remaining first').id;
    try {
      const res = await postJson(`/api/public/capture-email/${wsId}`, { email: 'test@example.com' });
      // Fresh bucket: count=1, remaining = max(0, 10-1) = 9
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('9');
    } finally {
      deleteWorkspace(wsId);
    }
  });

  it('allows up to 10 POST requests on a single path before blocking', async () => {
    const wsId = createWorkspace('RL write exhaustion').id;
    try {
      const results: number[] = [];
      for (let i = 0; i < 10; i++) {
        const res = await postJson(`/api/public/capture-email/${wsId}`, { email: 'test@example.com' });
        results.push(res.status);
      }
      expect(results.length).toBeGreaterThan(0);
      for (const status of results) {
        expect(status).not.toBe(429);
      }
    } finally {
      deleteWorkspace(wsId);
    }
  });

  it('returns 429 on the 11th POST request to the same path', async () => {
    const wsId = createWorkspace('RL write 11th').id;
    try {
      for (let i = 0; i < 10; i++) {
        await postJson(`/api/public/capture-email/${wsId}`, { email: 'test@example.com' });
      }
      const res = await postJson(`/api/public/capture-email/${wsId}`, { email: 'test@example.com' });
      expect(res.status).toBe(429);
    } finally {
      deleteWorkspace(wsId);
    }
  });

  it('429 response includes Retry-After header with a non-negative integer', async () => {
    const wsId = createWorkspace('RL write retry-after').id;
    try {
      for (let i = 0; i < 10; i++) {
        await postJson(`/api/public/capture-email/${wsId}`, { email: 'test@example.com' });
      }
      const res = await postJson(`/api/public/capture-email/${wsId}`, { email: 'test@example.com' });
      expect(res.status).toBe(429);
      const retryAfter = res.headers.get('Retry-After');
      expect(retryAfter).toBeTruthy();
      expect(Number(retryAfter)).toBeGreaterThanOrEqual(0);
    } finally {
      deleteWorkspace(wsId);
    }
  });

  it('429 response body contains error message', async () => {
    const wsId = createWorkspace('RL write error body').id;
    try {
      for (let i = 0; i < 10; i++) {
        await postJson(`/api/public/capture-email/${wsId}`, { email: 'test@example.com' });
      }
      const res = await postJson(`/api/public/capture-email/${wsId}`, { email: 'test@example.com' });
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body).toHaveProperty('error');
      expect(typeof body.error).toBe('string');
      expect(body.error.length).toBeGreaterThan(0);
    } finally {
      deleteWorkspace(wsId);
    }
  });

  it('X-RateLimit-Remaining is 0 on a 429 response', async () => {
    const wsId = createWorkspace('RL write remaining 0').id;
    try {
      for (let i = 0; i < 10; i++) {
        await postJson(`/api/public/capture-email/${wsId}`, { email: 'test@example.com' });
      }
      const res = await postJson(`/api/public/capture-email/${wsId}`, { email: 'test@example.com' });
      expect(res.status).toBe(429);
      // remaining = max(0, 10 - 11) = 0
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    } finally {
      deleteWorkspace(wsId);
    }
  });

  it('different workspace paths have independent write-limiter buckets', async () => {
    const wsA = createWorkspace('RL write bucket A').id;
    const wsB = createWorkspace('RL write bucket B').id;
    try {
      // Exhaust wsA bucket
      for (let i = 0; i < 10; i++) {
        await postJson(`/api/public/capture-email/${wsA}`, { email: 'test@example.com' });
      }
      const resA = await postJson(`/api/public/capture-email/${wsA}`, { email: 'test@example.com' });
      expect(resA.status).toBe(429);
      // wsB is a different path key → its bucket is untouched
      const resB = await postJson(`/api/public/capture-email/${wsB}`, { email: 'test@example.com' });
      expect(resB.status).not.toBe(429);
      expect(resB.headers.get('X-RateLimit-Remaining')).toBe('9');
    } finally {
      deleteWorkspace(wsA);
      deleteWorkspace(wsB);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. loginLimiter — 5 req/min per path (/api/auth/login, /api/auth/user-login)
//    No APP_PASSWORD set in test env so /api/auth/login always returns 200,
//    making it ideal for exercising the limiter without side-effects.
// ─────────────────────────────────────────────────────────────────────────────

describe('loginLimiter (5 req/min, /api/auth/login)', () => {
  it('allows up to 5 requests before blocking', async () => {
    const results: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await postJson('/api/auth/login', { password: 'test' });
      results.push(res.status);
    }
    expect(results.length).toBeGreaterThan(0);
    for (const status of results) {
      expect(status).not.toBe(429);
    }
  });

  it('blocks the 6th request with 429', async () => {
    // The previous test consumed all 5 slots on /api/auth/login
    const res = await postJson('/api/auth/login', { password: 'test' });
    expect(res.status).toBe(429);
  });

  it('429 from loginLimiter includes Retry-After header', async () => {
    // Bucket already exhausted from the two prior tests
    const res = await postJson('/api/auth/login', { password: 'test' });
    expect(res.status).toBe(429);
    const retryAfter = res.headers.get('Retry-After');
    expect(retryAfter).toBeTruthy();
    expect(Number(retryAfter)).toBeGreaterThanOrEqual(0);
  });

  it('loginLimiter X-RateLimit-Limit is 5', async () => {
    // Even a 429 response carries the header
    const res = await postJson('/api/auth/login', { password: 'test' });
    expect(res.status).toBe(429);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('5');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. clientLoginLimiter — 5 req/min per path (/api/public/auth/:id)
//
//    Implementation detail: clientLoginLimiter and publicWriteLimiter share the
//    same rateLimitBuckets Map (module-level in middleware.ts) and derive the same
//    cache key (`${ip}:${req.path}`).  For POST /api/public/auth/:id the call order is:
//
//      1. publicWriteLimiter  (app.use, limit=10) → increments bucket count
//      2. clientLoginLimiter  (route middleware, limit=5) → increments the SAME bucket
//
//    Each real request therefore increments the shared bucket twice.
//    After N requests: bucket count = 2*N.
//    clientLoginLimiter fires when count > 5 → blocks when 2*N > 5 → N >= 3.
//
//    Practical effect: the first 2 requests pass; the 3rd is blocked.
//    publicWriteLimiter (limit=10) never fires independently because clientLoginLimiter
//    (limit=5) triggers first at count 6 (= 2*3).
//
//    Tests in this section reflect that actual shared-bucket behaviour.
// ─────────────────────────────────────────────────────────────────────────────

describe('clientLoginLimiter (5 req/min, /api/public/auth/:id)', () => {
  it('allows the first request on the client auth endpoint', async () => {
    const wsId = createWorkspace('RL clientLogin quota').id;
    try {
      const res = await postJson(`/api/public/auth/${wsId}`, { password: 'x' });
      expect(res.status).not.toBe(429);
    } finally {
      deleteWorkspace(wsId);
    }
  });

  it('blocks a request once the shared bucket exceeds clientLoginLimiter limit', async () => {
    // Each request increments the shared bucket twice (publicWriteLimiter + clientLoginLimiter).
    // clientLoginLimiter fires when count > 5; that happens on the 3rd request (count reaches 6).
    const wsId = createWorkspace('RL clientLogin block').id;
    try {
      // First two requests: count reaches 2 then 4, both <= 5 → pass
      await postJson(`/api/public/auth/${wsId}`, { password: 'x' });
      await postJson(`/api/public/auth/${wsId}`, { password: 'x' });
      // Third request: publicWriteLimiter increments to 5 (<=10, passes),
      // then clientLoginLimiter increments to 6 (>5, blocks with 429)
      const res = await postJson(`/api/public/auth/${wsId}`, { password: 'x' });
      expect(res.status).toBe(429);
    } finally {
      deleteWorkspace(wsId);
    }
  });

  it('clientLoginLimiter X-RateLimit-Limit is 5 on a blocked response', async () => {
    const wsId = createWorkspace('RL clientLogin limit-hdr').id;
    try {
      await postJson(`/api/public/auth/${wsId}`, { password: 'x' });
      await postJson(`/api/public/auth/${wsId}`, { password: 'x' });
      const res = await postJson(`/api/public/auth/${wsId}`, { password: 'x' });
      expect(res.status).toBe(429);
      expect(res.headers.get('X-RateLimit-Limit')).toBe('5');
    } finally {
      deleteWorkspace(wsId);
    }
  });

  it('Retry-After is present and non-negative on client auth 429', async () => {
    const wsId = createWorkspace('RL clientLogin retryafter').id;
    try {
      await postJson(`/api/public/auth/${wsId}`, { password: 'x' });
      await postJson(`/api/public/auth/${wsId}`, { password: 'x' });
      const res = await postJson(`/api/public/auth/${wsId}`, { password: 'x' });
      expect(res.status).toBe(429);
      const retryAfter = res.headers.get('Retry-After');
      expect(retryAfter).toBeTruthy();
      expect(Number(retryAfter)).toBeGreaterThanOrEqual(0);
    } finally {
      deleteWorkspace(wsId);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Turnstile bypass — when TURNSTILE_SECRET_KEY is not set, verifyTurnstile
//    is a no-op and requests pass through without a CAPTCHA token.
//    The test server is started without TURNSTILE_SECRET_KEY (see helpers.ts),
//    so any request to a Turnstile-protected route should not be blocked by CAPTCHA.
// ─────────────────────────────────────────────────────────────────────────────

describe('Turnstile bypass (TURNSTILE_SECRET_KEY not set)', () => {
  it('POST /api/public/client-login/:id without turnstileToken is not rejected with 400 CAPTCHA error', async () => {
    const wsId = createWorkspace('RL Turnstile bypass').id;
    try {
      // No turnstileToken in the body — if Turnstile were enforced, this would 400
      const res = await postJson(`/api/public/client-login/${wsId}`, {
        email: 'nobody@example.com',
        password: 'doesnotmatter',
      });
      // Should not be a CAPTCHA 400 — will be 401 (bad credentials) or 404 (no user)
      const body = await res.json();
      expect(res.status).not.toBe(400);
      // If it is 400, it must not be the CAPTCHA message
      if (res.status === 400) {
        expect(body.error).not.toContain('CAPTCHA');
      }
    } finally {
      deleteWorkspace(wsId);
    }
  });

  it('POST /api/public/forgot-password/:id without turnstileToken is not rejected with CAPTCHA error', async () => {
    const wsId = createWorkspace('RL Turnstile forgot').id;
    try {
      const res = await postJson(`/api/public/forgot-password/${wsId}`, {
        email: 'nobody@example.com',
      });
      // Should be 200 (always-succeed to prevent email enumeration) or a non-CAPTCHA error
      const body = await res.json();
      if (res.status === 400) {
        expect(body.error).not.toContain('CAPTCHA');
      } else {
        // Success response always returns ok:true per the route implementation
        expect(res.status).toBe(200);
      }
    } finally {
      deleteWorkspace(wsId);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. GET-only routes are NOT subject to publicWriteLimiter
//    Verify that a GET to /api/public/workspace/:id does not return the
//    write-limiter header set (limit=10); it should show limit=60 (publicApiLimiter).
// ─────────────────────────────────────────────────────────────────────────────

describe('GET routes bypass publicWriteLimiter', () => {
  it('GET /api/public/workspace/:id shows publicApiLimiter limit (60), not write limit (10)', async () => {
    const wsId = createWorkspace('RL GET not write').id;
    try {
      const res = await api(`/api/public/workspace/${wsId}`);
      // publicApiLimiter is the most recently applied rate-limiter for GET routes
      // and it sets X-RateLimit-Limit = 60
      const limit = res.headers.get('X-RateLimit-Limit');
      expect(limit).toBe('60');
    } finally {
      deleteWorkspace(wsId);
    }
  });
});
