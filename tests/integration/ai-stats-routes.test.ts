/**
 * Integration tests for AI stats API routes
 * Source: server/routes/ai-stats.ts
 *
 * Covers:
 *  - GET /api/ai-stats/deduplication — deduplication stats shape + numeric invariants
 *  - GET /api/ai-stats/usage         — token usage, optional ?workspaceId= and ?since= params
 *  - GET /api/ai-stats/summary       — combined summary + efficiency metric invariants
 *  - Auth guard: 403 without valid admin token
 *
 * These are smoke/shape tests — the stats depend on actual AI call history, so
 * we focus on response shape and numeric invariants rather than exact values.
 * No endpoint should ever return 500.
 *
 * Auth: the /api/ai-stats routes have an inline admin guard that calls verifyAdminToken().
 * We pin SESSION_SECRET so the HMAC token is deterministic across this process
 * and the spawned server process.
 */

import crypto from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';

// ── Pin SESSION_SECRET before createTestContext() so both this process and the
// spawned server derive the same HMAC token.
const TEST_SESSION_SECRET = 'test-ai-stats-routes-session-secret-13565';
process.env.SESSION_SECRET = TEST_SESSION_SECRET;

const ctx = createTestContext(13565);
const { api, startServer, stopServer } = ctx;

// ── Admin HMAC token — mirrors server/middleware.ts: signAdminToken() ─────────
const ADMIN_HMAC_TOKEN = crypto
  .createHmac('sha256', TEST_SESSION_SECRET)
  .update('admin')
  .digest('hex');

/** Wrap api() with the admin x-auth-token header. */
async function adminApi(urlPath: string, opts: RequestInit = {}): Promise<Response> {
  return api(urlPath, {
    ...opts,
    headers: {
      ...(opts.headers as Record<string, string> | undefined ?? {}),
      'x-auth-token': ADMIN_HMAC_TOKEN,
    },
  });
}

beforeAll(async () => {
  await startServer();
}, 30_000);

afterAll(async () => {
  await stopServer();
  // Remove the pinned secret so parallel test files aren't affected
  delete process.env.SESSION_SECRET;
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/ai-stats/deduplication
// ════════════════════════════════════════════════════════════════════════════════

describe('GET /api/ai-stats/deduplication', () => {
  it('returns 200 with expected response shape', async () => {
    const res = await adminApi('/api/ai-stats/deduplication');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('pendingRequests');
    expect(body).toHaveProperty('cacheSize');
    expect(body).toHaveProperty('oldestPendingAge');
    expect(body).toHaveProperty('oldestCacheAge');
    expect(body).toHaveProperty('timestamp');
  });

  it('numeric fields are non-negative numbers', async () => {
    const res = await adminApi('/api/ai-stats/deduplication');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      pendingRequests: number;
      cacheSize: number;
      oldestPendingAge: number | null;
      oldestCacheAge: number | null;
    };
    expect(typeof body.pendingRequests).toBe('number');
    expect(body.pendingRequests).toBeGreaterThanOrEqual(0);
    expect(typeof body.cacheSize).toBe('number');
    expect(body.cacheSize).toBeGreaterThanOrEqual(0);
    // oldestPendingAge and oldestCacheAge can be null when nothing is pending/cached,
    // or a non-negative number (age in ms) when entries exist.
    if (body.oldestPendingAge !== null) {
      expect(typeof body.oldestPendingAge).toBe('number');
      expect(body.oldestPendingAge).toBeGreaterThanOrEqual(0);
    }
    if (body.oldestCacheAge !== null) {
      expect(typeof body.oldestCacheAge).toBe('number');
      expect(body.oldestCacheAge).toBeGreaterThanOrEqual(0);
    }
  });

  it('timestamp is a valid ISO 8601 string', async () => {
    const res = await adminApi('/api/ai-stats/deduplication');
    expect(res.status).toBe(200);
    const body = await res.json() as { timestamp: string };
    expect(typeof body.timestamp).toBe('string');
    const parsed = Date.parse(body.timestamp);
    expect(Number.isNaN(parsed)).toBe(false);
    // Should be a recent timestamp (within the last minute)
    expect(Date.now() - parsed).toBeLessThan(60_000);
  });

  it('returns 403 without an admin token', async () => {
    const res = await api('/api/ai-stats/deduplication');
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Admin access required');
  });

  it('returns 403 with an invalid admin token', async () => {
    const res = await api('/api/ai-stats/deduplication', {
      headers: { 'x-auth-token': 'not-a-valid-hmac-token' },
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Admin access required');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/ai-stats/usage
// ════════════════════════════════════════════════════════════════════════════════

describe('GET /api/ai-stats/usage', () => {
  it('returns 200 with expected response shape (no params)', async () => {
    const res = await adminApi('/api/ai-stats/usage');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('totalTokens');
    expect(body).toHaveProperty('entries');
    expect(body).toHaveProperty('estimatedCost');
    expect(body).toHaveProperty('workspaceId');
    expect(body).toHaveProperty('period');
    expect(body).toHaveProperty('timestamp');
  });

  it('workspaceId defaults to "all" when not supplied', async () => {
    const res = await adminApi('/api/ai-stats/usage');
    expect(res.status).toBe(200);
    const body = await res.json() as { workspaceId: string };
    expect(body.workspaceId).toBe('all');
  });

  it('numeric fields are non-negative', async () => {
    const res = await adminApi('/api/ai-stats/usage');
    expect(res.status).toBe(200);
    const body = await res.json() as { totalTokens: number; estimatedCost: number; entries: unknown[] };
    expect(typeof body.totalTokens).toBe('number');
    expect(body.totalTokens).toBeGreaterThanOrEqual(0);
    expect(typeof body.estimatedCost).toBe('number');
    expect(body.estimatedCost).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(body.entries)).toBe(true);
  });

  it('timestamp is a valid ISO 8601 string', async () => {
    const res = await adminApi('/api/ai-stats/usage');
    expect(res.status).toBe(200);
    const body = await res.json() as { timestamp: string };
    const parsed = Date.parse(body.timestamp);
    expect(Number.isNaN(parsed)).toBe(false);
    expect(Date.now() - parsed).toBeLessThan(60_000);
  });

  it('accepts ?workspaceId= and propagates it in the response', async () => {
    const res = await adminApi('/api/ai-stats/usage?workspaceId=test-ws');
    expect(res.status).toBe(200);
    const body = await res.json() as { workspaceId: string };
    expect(body.workspaceId).toBe('test-ws');
  });

  it('accepts ?since= and reflects it in the period field', async () => {
    const sinceDate = '2020-01-01';
    const res = await adminApi(`/api/ai-stats/usage?since=${encodeURIComponent(sinceDate)}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { period: string };
    expect(body.period).toContain('since');
    expect(body.period).toContain(sinceDate);
  });

  it('accepts ?since= as a full ISO timestamp', async () => {
    const sinceISO = '2020-01-01T00:00:00.000Z';
    const res = await adminApi(`/api/ai-stats/usage?since=${encodeURIComponent(sinceISO)}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { period: string };
    expect(body.period).toContain('since');
  });

  it('defaults period to "last N days" when since is absent', async () => {
    const res = await adminApi('/api/ai-stats/usage');
    expect(res.status).toBe(200);
    const body = await res.json() as { period: string };
    expect(body.period).toMatch(/last \d+ days/);
  });

  it('returns 403 without an admin token', async () => {
    const res = await api('/api/ai-stats/usage');
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Admin access required');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/ai-stats/summary
// ════════════════════════════════════════════════════════════════════════════════

describe('GET /api/ai-stats/summary', () => {
  it('returns 200 with expected top-level shape', async () => {
    const res = await adminApi('/api/ai-stats/summary');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('deduplication');
    expect(body).toHaveProperty('usage');
    expect(body).toHaveProperty('period');
    expect(body).toHaveProperty('workspaceId');
    expect(body).toHaveProperty('timestamp');
  });

  it('deduplication sub-object contains expected fields', async () => {
    const res = await adminApi('/api/ai-stats/summary');
    expect(res.status).toBe(200);
    const body = await res.json() as { deduplication: Record<string, unknown> };
    const dedup = body.deduplication;
    expect(dedup).toHaveProperty('cacheHitRate');
    expect(dedup).toHaveProperty('pendingRequests');
    expect(dedup).toHaveProperty('cacheSize');
  });

  it('usage sub-object contains expected fields', async () => {
    const res = await adminApi('/api/ai-stats/summary');
    expect(res.status).toBe(200);
    const body = await res.json() as { usage: Record<string, unknown> };
    const usage = body.usage;
    expect(usage).toHaveProperty('totalTokens');
    expect(usage).toHaveProperty('totalCalls');
    expect(usage).toHaveProperty('estimatedCost');
    expect(usage).toHaveProperty('avgTokensPerCall');
  });

  it('deduplication.cacheHitRate is a number between 0 and 1 inclusive', async () => {
    const res = await adminApi('/api/ai-stats/summary');
    expect(res.status).toBe(200);
    const body = await res.json() as { deduplication: { cacheHitRate: number } };
    const rate = body.deduplication.cacheHitRate;
    expect(typeof rate).toBe('number');
    expect(rate).toBeGreaterThanOrEqual(0);
    expect(rate).toBeLessThanOrEqual(1);
  });

  it('usage.avgTokensPerCall is a non-negative integer', async () => {
    const res = await adminApi('/api/ai-stats/summary');
    expect(res.status).toBe(200);
    const body = await res.json() as { usage: { avgTokensPerCall: number } };
    const avg = body.usage.avgTokensPerCall;
    expect(typeof avg).toBe('number');
    expect(avg).toBeGreaterThanOrEqual(0);
    // avgTokensPerCall is Math.round()-ed in the route — must be an integer
    expect(Number.isInteger(avg)).toBe(true);
  });

  it('period defaults to "last 7 days"', async () => {
    const res = await adminApi('/api/ai-stats/summary');
    expect(res.status).toBe(200);
    const body = await res.json() as { period: string };
    expect(body.period).toBe('last 7 days');
  });

  it('workspaceId defaults to "all" when not supplied', async () => {
    const res = await adminApi('/api/ai-stats/summary');
    expect(res.status).toBe(200);
    const body = await res.json() as { workspaceId: string };
    expect(body.workspaceId).toBe('all');
  });

  it('accepts ?workspaceId= and propagates it in the response', async () => {
    const res = await adminApi('/api/ai-stats/summary?workspaceId=test-ws');
    expect(res.status).toBe(200);
    const body = await res.json() as { workspaceId: string };
    expect(body.workspaceId).toBe('test-ws');
  });

  it('timestamp is a valid ISO 8601 string', async () => {
    const res = await adminApi('/api/ai-stats/summary');
    expect(res.status).toBe(200);
    const body = await res.json() as { timestamp: string };
    const parsed = Date.parse(body.timestamp);
    expect(Number.isNaN(parsed)).toBe(false);
    expect(Date.now() - parsed).toBeLessThan(60_000);
  });

  it('returns 403 without an admin token', async () => {
    const res = await api('/api/ai-stats/summary');
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Admin access required');
  });
});
