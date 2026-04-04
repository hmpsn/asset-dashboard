/**
 * Integration tests for rate limiting on POST /api/public/signal/:workspaceId.
 *
 * Verifies that the publicWriteLimiter (10 req/min per-path per-IP) correctly:
 * - Allows up to 10 requests within a 60-second window
 * - Blocks the 11th request with HTTP 429
 * - Returns a Retry-After header on 429 responses
 * - Returns X-RateLimit-* headers on successful responses
 *
 * Two workspace IDs are used so that each it() that exercises the limit
 * operates against a fresh rate-limit bucket (path is scoped to workspaceId).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13300);
const { postJson } = ctx;

/** workspace used for the 10-then-11 limit tests */
let rlWsId = '';
/** workspace used for the header-presence test (fresh bucket) */
let headerWsId = '';

const VALID_BODY = {
  type: 'service_interest' as const,
  triggerMessage: 'test',
  chatContext: [] as { role: 'user' | 'assistant'; content: string }[],
};

beforeAll(async () => {
  await ctx.startServer();
  rlWsId = createWorkspace('Rate Limit RL Workspace').id;
  headerWsId = createWorkspace('Rate Limit Header Workspace').id;
}, 25_000);

afterAll(() => {
  deleteWorkspace(rlWsId);
  deleteWorkspace(headerWsId);
  ctx.stopServer();
});

describe('Rate limiting on POST /api/public/signal', () => {
  it('allows up to 10 requests per minute', async () => {
    const results: Response[] = [];
    for (let i = 0; i < 10; i++) {
      results.push(await postJson(`/api/public/signal/${rlWsId}`, VALID_BODY));
    }
    expect(results.length).toBe(10);
    for (const res of results) {
      expect(res.status).toBe(200);
    }
  });

  it('blocks the 11th request with 429', async () => {
    // The previous test consumed all 10 slots on rlWsId — the 11th must be rejected.
    const res = await postJson(`/api/public/signal/${rlWsId}`, VALID_BODY);
    expect(res.status).toBe(429);
  });

  it('includes Retry-After header on 429 response', async () => {
    // rlWsId bucket is already exhausted from the two prior tests.
    const res = await postJson(`/api/public/signal/${rlWsId}`, VALID_BODY);
    expect(res.status).toBe(429);
    const retryAfter = res.headers.get('Retry-After');
    expect(retryAfter).toBeTruthy();
    // Retry-After must be a non-negative integer string (seconds until reset).
    expect(Number(retryAfter)).toBeGreaterThanOrEqual(0);
  });

  it('includes X-RateLimit-* headers on all responses', async () => {
    // Use headerWsId (fresh bucket) so this test is independent of rlWsId exhaustion.
    const res = await postJson(`/api/public/signal/${headerWsId}`, VALID_BODY);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Limit')).toBeTruthy();
    expect(res.headers.get('X-RateLimit-Remaining')).toBeTruthy();
    expect(res.headers.get('X-RateLimit-Reset')).toBeTruthy();
  });
});
