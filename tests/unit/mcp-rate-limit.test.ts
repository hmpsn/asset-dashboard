/**
 * mcpLimiter — the shared per-IP rate limit applied directly to every POST-only
 * MCP transport route.
 *
 * /mcp was previously unthrottled (the three public limiters only cover
 * /api/public/), so a runaway agent loop or a leaked Bearer key could hammer it.
 * This pins the limit (120 req/min/IP) and the 429-on-exceed behavior.
 */
import { describe, it, expect, vi } from 'vitest';
import { mcpLimiter, globalPublicLimiter } from '../../server/middleware.js';

function makeRes() {
  const res = {
    setHeader: vi.fn(),
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  } as unknown as { setHeader: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
  return res;
}

describe('mcpLimiter', () => {
  it('allows up to 120 requests/min per IP, then returns 429', () => {
    // Unique IP isolates this test's bucket from the shared rateLimitBuckets map.
    const ip = '203.0.113.91';
    const req = { ip, path: '/mcp', socket: { remoteAddress: ip } };

    let allowed = 0;
    let blocked = 0;
    for (let i = 0; i < 130; i++) {
      const res = makeRes();
      const next = vi.fn();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mcpLimiter(req as any, res as any, next);
      if (next.mock.calls.length > 0) {
        allowed++;
      } else {
        blocked++;
        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
      }
    }

    expect(allowed).toBe(120);
    expect(blocked).toBe(10);
  });

  it('keys per IP — a different IP gets its own fresh budget', () => {
    const ip = '203.0.113.92';
    const req = { ip, path: '/mcp', socket: { remoteAddress: ip } };
    const next = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mcpLimiter(req as any, makeRes() as any, next);
    expect(next).toHaveBeenCalledTimes(1); // first request from a new IP always passes
  });

  it('uses a bucket SEPARATE from globalPublicLimiter (no /api/public ↔ /mcp cross-contamination)', () => {
    // Regression guard: mcpLimiter must NOT share globalPublicLimiter's `global:${ip}`
    // bucket. Exhaust the public global limiter (200/min) for an IP...
    const ip = '203.0.113.94';
    for (let i = 0; i < 210; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      globalPublicLimiter({ ip, path: '/api/public/x', socket: { remoteAddress: ip } } as any, makeRes() as any, vi.fn());
    }
    // ...the same IP must still have a fresh /mcp budget.
    const next = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mcpLimiter({ ip, path: '/mcp', socket: { remoteAddress: ip } } as any, makeRes() as any, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('shares one budget across full, operator, and client transport paths', () => {
    const ip = '203.0.113.95';
    const paths = ['/mcp', '/mcp/operator', '/mcp/client'];

    for (let i = 0; i < 120; i++) {
      const next = vi.fn();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mcpLimiter({ ip, path: paths[i % paths.length], socket: { remoteAddress: ip } } as any, makeRes() as any, next);
      expect(next).toHaveBeenCalledTimes(1);
    }

    const blockedRes = makeRes();
    const blockedNext = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mcpLimiter({ ip, path: '/mcp/client', socket: { remoteAddress: ip } } as any, blockedRes as any, blockedNext);
    expect(blockedNext).not.toHaveBeenCalled();
    expect(blockedRes.status).toHaveBeenCalledWith(429);
  });
});
