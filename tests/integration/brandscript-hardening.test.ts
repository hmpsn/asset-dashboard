/**
 * Integration tests for brandscript route hardening (roadmap #586 Task 4).
 *
 * Covers three improvements:
 *  I10 – PUT sections addActivity: updating sections calls addActivity with
 *         type 'brandscript_sections_updated'.
 *  I13 – Tier gate: free-tier workspace is blocked with 429 + code:'usage_limit'
 *         before any AI work begins on /complete, and the usage counter is NOT
 *         incremented.
 *  I14 – aiLimiter burst: the 4th POST to the same /complete path within 60 s
 *         is blocked by the per-IP burst limiter (3 req/min).
 *
 * Port: 13323 (unique — verified free; 13320-13322 are taken by keyword-strategy
 *        and stripe-admin-auth tests that use const PORT, not createTestContext).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { getUsageCount } from '../../server/usage-tracking.js';
import { listActivity } from '../../server/activity-log.js';
import { createBrandscript } from '../../server/brandscript.js';

const ctx = createTestContext(13323); // port-ok: 13201-13322 fully allocated; extending range
const { postJson, api } = ctx;

let freeWsId = '';
let growthWsId = '';
let cleanupFree: () => void;
let cleanupGrowth: () => void;

// A brandscript ID created for I10 test
let bsId = '';
let bsWsId = '';
let cleanupBsWs: () => void;

beforeAll(async () => {
  await ctx.startServer();

  // Workspace for I10 test — any tier, sections update doesn't require AI
  const bsWs = seedWorkspace({ tier: 'growth' });
  bsWsId = bsWs.workspaceId;
  cleanupBsWs = bsWs.cleanup;

  // Create a brandscript in that workspace to PUT sections against
  const bs = createBrandscript(bsWsId, 'Test Brandscript', 'storybrand', []);
  bsId = bs.id;

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
  cleanupBsWs?.();
  cleanupFree?.();
  cleanupGrowth?.();
});

// ─────────────────────────────────────────────────────────────────────────────
// I10 — PUT sections calls addActivity with type 'brandscript_sections_updated'
// ─────────────────────────────────────────────────────────────────────────────

describe('I10 – PUT sections records activity', () => {
  it('returns 200 and records a brandscript_sections_updated activity', async () => {
    const res = await api(`/api/brandscripts/${bsWsId}/${bsId}/sections`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sections: [
          { title: 'The Hero', content: 'Our customer is a small business owner.' },
        ],
      }),
    });
    expect(res.status).toBe(200);

    const activities = listActivity(bsWsId, 100);
    const found = activities.some(
      (a) => a.type === 'brandscript_sections_updated',
    );
    expect(found).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I13 — Tier gate: free-tier is blocked before AI call on /complete
// ─────────────────────────────────────────────────────────────────────────────

describe('I13 – tier gate on /api/brandscripts/:workspaceId/:id/complete', () => {
  it('returns 429 with code:usage_limit for a free-tier workspace', async () => {
    const res = await postJson(`/api/brandscripts/${freeWsId}/fake-bs-id/complete`, {});
    expect(res.status).toBe(429);
    const body = await res.json() as { error: string; code?: string };
    expect(body.code).toBe('usage_limit');
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  it('does NOT increment the usage counter when the tier gate fires', async () => {
    const ws = seedWorkspace({ tier: 'free' });
    try {
      const before = getUsageCount(ws.workspaceId, 'brandscript_generations');
      expect(before).toBe(0);

      const res = await postJson(`/api/brandscripts/${ws.workspaceId}/fake-bs-id/complete`, {});
      expect(res.status).toBe(429);

      const after = getUsageCount(ws.workspaceId, 'brandscript_generations');
      expect(after).toBe(0); // counter must not have moved
    } finally {
      ws.cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I14 — aiLimiter burst: 4th request from same IP in 60 s is blocked
//
// Strategy: use a fresh growth-tier workspace per test invocation so the
// aiLimiter rate-limiter key (which includes req.path / workspaceId) is unique
// and does not bleed from other tests.
// Requests 1–3 reach the handler and get 429 from the tier gate OR 404/500
// from missing AI keys — either is fine as long as it's not a 429 from the
// aiLimiter. The 4th request with the same path must be 429 from the limiter.
// ─────────────────────────────────────────────────────────────────────────────

describe('I14 – aiLimiter burst cap on /api/brandscripts/:workspaceId/:id/complete', () => {
  it('allows the first 3 requests and blocks the 4th with 429', async () => {
    const ws = seedWorkspace({ tier: 'growth' });
    const fakeBsId = 'fake-limiter-test-id';
    try {
      for (let i = 0; i < 3; i++) {
        const res = await postJson(
          `/api/brandscripts/${ws.workspaceId}/${fakeBsId}/complete`,
          {},
        );
        // Each request should either be 404 (bs not found after decrement) or
        // 500 (AI keys missing). It must NOT be 429 from aiLimiter yet.
        expect(res.status).not.toBe(429);
      }
      // The 4th request must be blocked by aiLimiter
      const blocked = await postJson(
        `/api/brandscripts/${ws.workspaceId}/${fakeBsId}/complete`,
        {},
      );
      expect(blocked.status).toBe(429);
    } finally {
      ws.cleanup();
    }
  });
});
