/**
 * Unit tests for server/middleware.ts — rate limiting, session signing, admin tokens.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  rateLimit,
  signClientSession,
  verifyClientSession,
  signAdminToken,
  verifyAdminToken,
} from '../../server/middleware.js';
import type { Request, Response, NextFunction } from 'express';

// ── Helpers ──

function mockReq(overrides: Record<string, unknown> = {}): Request {
  return {
    ip: '127.0.0.1',
    path: '/test',
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response & { _status: number; _json: unknown } {
  const res = {
    _status: 0,
    _json: null as unknown,
    status(code: number) { res._status = code; return res; },
    json(data: unknown) { res._json = data; return res; },
  };
  return res as unknown as Response & { _status: number; _json: unknown };
}

// ── Rate Limiting ──

describe('rateLimit', () => {
  it('allows requests under the limit', () => {
    const limiter = rateLimit(60_000, 3);
    const req = mockReq({ ip: '10.0.0.1', path: '/rate-test-allow' });
    const res = mockRes();
    const next = vi.fn();

    limiter(req, res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);

    limiter(req, res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledTimes(2);

    limiter(req, res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledTimes(3);
  });

  it('blocks requests over the limit with 429', () => {
    const limiter = rateLimit(60_000, 2);
    const req = mockReq({ ip: '10.0.0.2', path: '/rate-test-block' });
    const res = mockRes();
    const next = vi.fn();

    limiter(req, res, next as unknown as NextFunction); // 1
    limiter(req, res, next as unknown as NextFunction); // 2
    limiter(req, res, next as unknown as NextFunction); // 3 — over limit

    expect(next).toHaveBeenCalledTimes(2);
    expect(res._status).toBe(429);
  });

  it('resets after the time window expires', () => {
    const limiter = rateLimit(100, 1); // 100ms window
    const req = mockReq({ ip: '10.0.0.3', path: '/rate-test-reset' });
    const res = mockRes();
    const next = vi.fn();

    limiter(req, res, next as unknown as NextFunction); // 1 — allowed
    limiter(req, res, next as unknown as NextFunction); // 2 — blocked

    expect(next).toHaveBeenCalledTimes(1);

    // Wait for window to expire
    return new Promise<void>(resolve => {
      setTimeout(() => {
        const res2 = mockRes();
        const next2 = vi.fn();
        limiter(req, res2, next2 as unknown as NextFunction);
        expect(next2).toHaveBeenCalledTimes(1);
        resolve();
      }, 150);
    });
  });

  it('uses separate buckets per IP+path', () => {
    const limiter = rateLimit(60_000, 1);

    const reqA = mockReq({ ip: '10.0.0.4', path: '/path-a-unique' });
    const reqB = mockReq({ ip: '10.0.0.4', path: '/path-b-unique' });
    const resA = mockRes();
    const resB = mockRes();
    const nextA = vi.fn();
    const nextB = vi.fn();

    limiter(reqA, resA, nextA as unknown as NextFunction);
    limiter(reqB, resB, nextB as unknown as NextFunction);

    expect(nextA).toHaveBeenCalledTimes(1);
    expect(nextB).toHaveBeenCalledTimes(1);
  });
});

// ── Session Signing ──

describe('signClientSession / verifyClientSession', () => {
  it('produces a hex string', () => {
    const sig = signClientSession('ws_test');
    expect(typeof sig).toBe('string');
    expect(sig).toMatch(/^[a-f0-9]+$/);
  });

  it('verifies correctly with matching workspaceId', () => {
    const sig = signClientSession('ws_verify');
    expect(verifyClientSession('ws_verify', sig)).toBe(true);
  });

  it('rejects mismatched workspaceId', () => {
    const sig = signClientSession('ws_a');
    expect(verifyClientSession('ws_b', sig)).toBe(false);
  });

  it('rejects empty token', () => {
    expect(verifyClientSession('ws_test', '')).toBe(false);
  });

  it('rejects garbage token', () => {
    expect(verifyClientSession('ws_test', 'not-a-real-token')).toBe(false);
  });

  it('produces consistent signatures for the same workspace', () => {
    const a = signClientSession('ws_consistent');
    const b = signClientSession('ws_consistent');
    expect(a).toBe(b);
  });
});

// ── Admin Token ──

describe('signAdminToken / verifyAdminToken', () => {
  it('produces a hex string', () => {
    const token = signAdminToken();
    expect(typeof token).toBe('string');
    expect(token).toMatch(/^[a-f0-9]+$/);
  });

  it('verifies correctly', () => {
    const token = signAdminToken();
    expect(verifyAdminToken(token)).toBe(true);
  });

  it('rejects empty token', () => {
    expect(verifyAdminToken('')).toBe(false);
  });

  it('rejects garbage token', () => {
    expect(verifyAdminToken('definitely-wrong')).toBe(false);
  });

  it('produces consistent tokens', () => {
    const a = signAdminToken();
    const b = signAdminToken();
    expect(a).toBe(b);
  });
});
