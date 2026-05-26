import { describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { fingerprintMiddleware } from '../../server/middleware/fingerprint.js';

function mockReq(overrides: Record<string, unknown> = {}): Request {
  return {
    ip: '203.0.113.10',
    socket: { remoteAddress: '203.0.113.10' },
    headers: {
      'user-agent': 'UnitTestAgent/1.0',
      'accept-language': 'en-US',
    },
    ...overrides,
  } as unknown as Request;
}

describe('fingerprintMiddleware', () => {
  it('sets req.fingerprint and calls next', () => {
    const req = mockReq();
    const next = vi.fn();

    fingerprintMiddleware(req, {} as Response, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.fingerprint).toMatch(/^[a-f0-9]{16}$/);
  });

  it('is deterministic for the same input and changes when headers/IP change', () => {
    const nextA = vi.fn();
    const nextB = vi.fn();
    const nextC = vi.fn();

    const reqA = mockReq();
    const reqB = mockReq();
    const reqC = mockReq({
      headers: {
        'user-agent': 'DifferentAgent/2.0',
        'accept-language': 'en-US',
      },
    });

    fingerprintMiddleware(reqA, {} as Response, nextA as unknown as NextFunction);
    fingerprintMiddleware(reqB, {} as Response, nextB as unknown as NextFunction);
    fingerprintMiddleware(reqC, {} as Response, nextC as unknown as NextFunction);

    expect(reqA.fingerprint).toBe(reqB.fingerprint);
    expect(reqA.fingerprint).not.toBe(reqC.fingerprint);
    expect(nextA).toHaveBeenCalledTimes(1);
    expect(nextB).toHaveBeenCalledTimes(1);
    expect(nextC).toHaveBeenCalledTimes(1);
  });
});
