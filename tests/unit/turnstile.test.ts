import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const loggerMocks = {
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock('../../server/logger.js', () => ({
  createLogger: vi.fn(() => loggerMocks),
}));

function mockReq(overrides: Record<string, unknown> = {}): Request {
  return {
    ip: '198.51.100.8',
    socket: { remoteAddress: '198.51.100.8' },
    body: { turnstileToken: 'token-123' },
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

async function loadMiddleware() {
  const mod = await import('../../server/middleware/turnstile.js');
  return mod.verifyTurnstile;
}

describe('verifyTurnstile', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.TURNSTILE_SECRET_KEY;
    vi.stubGlobal('fetch', vi.fn());
  });

  it('is a no-op when TURNSTILE_SECRET_KEY is missing', async () => {
    const verifyTurnstile = await loadMiddleware();
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    verifyTurnstile(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(res._status).toBe(0);
  });

  it('returns 400 when turnstile token is missing', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    const verifyTurnstile = await loadMiddleware();
    const req = mockReq({ body: {} });
    const res = mockRes();
    const next = vi.fn();

    verifyTurnstile(req, res, next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
    expect(res._json).toEqual({ error: 'CAPTCHA verification required' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('calls next on successful verification', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: true }),
    }));

    const verifyTurnstile = await loadMiddleware();
    const req = mockReq({ body: { turnstileToken: 'token-ok' } });
    const res = mockRes();
    const next = vi.fn();

    verifyTurnstile(req, res, next as unknown as NextFunction);

    await vi.waitFor(() => {
      expect(next).toHaveBeenCalledTimes(1);
    });

    expect(res._status).toBe(0);
    expect(loggerMocks.warn).not.toHaveBeenCalled();
    expect(loggerMocks.error).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns 403 when verification fails', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: false, 'error-codes': ['invalid-input-response'] }),
    }));

    const verifyTurnstile = await loadMiddleware();
    const req = mockReq({ body: { turnstileToken: 'token-bad' }, fingerprint: 'abc123def4567890' });
    const res = mockRes();
    const next = vi.fn();

    verifyTurnstile(req, res, next as unknown as NextFunction);

    await vi.waitFor(() => {
      expect(res._status).toBe(403);
    });

    expect(res._json).toEqual({ error: 'CAPTCHA verification failed. Please try again.' });
    expect(next).not.toHaveBeenCalled();
    expect(loggerMocks.warn).toHaveBeenCalledTimes(1);
    expect(loggerMocks.error).not.toHaveBeenCalled();
  });

  it('fails open and calls next when fetch throws', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const verifyTurnstile = await loadMiddleware();
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    verifyTurnstile(req, res, next as unknown as NextFunction);

    await vi.waitFor(() => {
      expect(next).toHaveBeenCalledTimes(1);
    });

    expect(res._status).toBe(0);
    expect(loggerMocks.error).toHaveBeenCalledTimes(1);
  });
});
