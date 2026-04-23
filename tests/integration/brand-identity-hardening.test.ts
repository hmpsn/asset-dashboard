/**
 * Integration tests for brand-identity route hardening (roadmap #586 Task 3).
 *
 * Covers three security / reliability improvements:
 *  I13 – Tier gate: free-tier workspace is blocked with 429 + code:'usage_limit'
 *         before any AI work begins, and the usage counter is NOT incremented.
 *  I14 – aiLimiter: the 4th POST to the same generate path within 60 s is blocked
 *         by the per-IP burst limiter (3 req/min).
 *  I16 – sanitizeErrorMessage: forced AI/internal errors return a 5xx whose body
 *         does NOT contain raw SQLITE_ codes or stack-frame-looking content.
 *
 * Port: 13226 (unique — no other file uses this port).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { getUsageCount } from '../../server/usage-tracking.js';

// Dedicated port — no other test file uses 13226
const ctx = createTestContext(13226);
const { postJson } = ctx;

let freeWsId = '';
let growthWsId = '';
let cleanupFree: () => void;
let cleanupGrowth: () => void;

beforeAll(async () => {
  await ctx.startServer();

  // Free-tier workspace: brandscript_generations limit = 0
  const free = seedWorkspace({ tier: 'free' });
  freeWsId = free.workspaceId;
  cleanupFree = free.cleanup;

  // Growth-tier workspace: brandscript_generations limit = 5
  const growth = seedWorkspace({ tier: 'growth' });
  growthWsId = growth.workspaceId;
  cleanupGrowth = growth.cleanup;
}, 30_000);

afterAll(() => {
  ctx.stopServer();
  cleanupFree?.();
  cleanupGrowth?.();
});

// ─────────────────────────────────────────────────────────────────────────────
// I13 — Tier gate: free-tier is blocked before AI call
// ─────────────────────────────────────────────────────────────────────────────

describe('I13 – tier gate on /api/brand-identity/:workspaceId/generate', () => {
  it('returns 429 with code:usage_limit for a free-tier workspace', async () => {
    const res = await postJson(`/api/brand-identity/${freeWsId}/generate`, {
      deliverableType: 'mission',
    });
    expect(res.status).toBe(429);
    const body = await res.json() as { error: string; code?: string };
    expect(body.code).toBe('usage_limit');
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  it('does NOT increment the usage counter when the tier gate fires', async () => {
    // Make a fresh free-tier workspace so counter starts at 0
    const ws = seedWorkspace({ tier: 'free' });
    try {
      const before = getUsageCount(ws.workspaceId, 'brandscript_generations');
      expect(before).toBe(0);

      const res = await postJson(`/api/brand-identity/${ws.workspaceId}/generate`, {
        deliverableType: 'vision',
      });
      expect(res.status).toBe(429);

      const after = getUsageCount(ws.workspaceId, 'brandscript_generations');
      expect(after).toBe(0); // counter must not have moved
    } finally {
      ws.cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I13 — Tier gate on /api/brand-identity/:workspaceId/:id/refine
// ─────────────────────────────────────────────────────────────────────────────

describe('I13 – tier gate on /api/brand-identity/:workspaceId/:id/refine', () => {
  it('returns 429 with code:usage_limit on refine for a free-tier workspace', async () => {
    const res = await postJson(`/api/brand-identity/${freeWsId}/fake-id/refine`, {
      direction: 'Make it more concise',
    });
    expect(res.status).toBe(429);
    const body = await res.json() as { error: string; code?: string };
    expect(body.code).toBe('usage_limit');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I14 — aiLimiter burst: 4th request from same IP in 60 s is blocked
//
// Strategy: use the growth-tier workspaceId (same URL path for all requests).
// The aiLimiter allows 3 req/60 s per IP per path. Requests 1–3 reach the
// handler (and get 500 because OPENAI/ANTHROPIC keys are not set in test env),
// but the 4th is blocked with 429 before even entering the handler.
//
// Test isolation: the rate-limiter keys by `${ip}:${req.path}` (see
// server/middleware.ts:23). `req.path` includes the workspaceId URL param, so
// a fresh workspace in each test = a fresh bucket. I13 and I16 tests therefore
// cannot leak burst-counter state into this I14 test.
// ─────────────────────────────────────────────────────────────────────────────

describe('I14 – aiLimiter burst cap on /api/brand-identity/:workspaceId/generate', () => {
  it('allows the first 3 requests and blocks the 4th with 429', async () => {
    // Use a fresh workspace so its usage counter is clean and we don't
    // interfere with other tests. This workspace needs enough limit (growth=5).
    const ws = seedWorkspace({ tier: 'growth' });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 3; i++) {
        const res = await postJson(`/api/brand-identity/${ws.workspaceId}/generate`, {
          deliverableType: 'mission',
        });
        // Each request either hits 500 (AI keys not set in test env) or succeeds.
        // It must NOT be 429 from the aiLimiter (budget not exhausted yet).
        expect(res.status).not.toBe(429);
        statuses.push(res.status);
      }
      // The 4th request must be blocked by aiLimiter
      const blocked = await postJson(`/api/brand-identity/${ws.workspaceId}/generate`, {
        deliverableType: 'vision',
      });
      expect(blocked.status).toBe(429);
    } finally {
      ws.cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I16 — sanitizeErrorMessage: 500 bodies must not leak internal details
//
// The AI call always throws in test env (no OPENAI/ANTHROPIC keys configured).
// We verify the 500 response body does not contain SQLITE_ codes, stack frames
// (e.g. "at /path/to/file:42"), or other internal noise.
// ─────────────────────────────────────────────────────────────────────────────

describe('I16 – sanitizeErrorMessage on 500 errors from generate', () => {
  it('500 body does not contain SQLITE_ codes', async () => {
    const res = await postJson(`/api/brand-identity/${growthWsId}/generate`, {
      deliverableType: 'tagline',
    });
    // growthWsId has a clean aiLimiter bucket here (I14 used a fresh workspace).
    // All 3 I16 requests are within the 3-req budget, so only 500 is expected.
    expect([500, 503]).toContain(res.status);
    const body = await res.text();
    expect(body).not.toMatch(/SQLITE_/i);
  });

  it('500 body does not contain stack-frame-looking content', async () => {
    const res = await postJson(`/api/brand-identity/${growthWsId}/generate`, {
      deliverableType: 'values',
    });
    expect([500, 503]).toContain(res.status);
    const body = await res.text();
    // Stack frames look like: "at SomeFn (/path/to/file.ts:42:10)"
    expect(body).not.toMatch(/at\s+\S+:\d+/);
  });

  it('500 body does not contain database-internal content', async () => {
    const res = await postJson(`/api/brand-identity/${growthWsId}/generate`, {
      deliverableType: 'vision',
    });
    expect([500, 503]).toContain(res.status);
    const body = await res.text();
    expect(body).not.toMatch(/no such table|no such column|constraint failed/i);
  });
});
