import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();

  return {
    randomUUID: vi.fn(() => 'uuid-fixed-1234'),
    info,
    warn,
    error,
    child: vi.fn(() => ({ info, warn, error })),
    recordOperationTrace: vi.fn(),
    recordSlowRouteTelemetry: vi.fn(),
  };
});

vi.mock('crypto', () => ({ randomUUID: mocks.randomUUID }));
vi.mock('../../server/logger.js', () => ({
  default: {
    child: mocks.child,
  },
}));
vi.mock('../../server/platform-observability.js', () => ({
  recordOperationTrace: mocks.recordOperationTrace,
  recordSlowRouteTelemetry: mocks.recordSlowRouteTelemetry,
}));

import { requestLogger } from '../../server/middleware/request-logger.js';

type RequestWithId = Request & { requestId?: string };

function createReq(overrides: Partial<Request> = {}): RequestWithId {
  return {
    headers: {},
    method: 'GET',
    originalUrl: '/api/test',
    path: '/api/test',
    baseUrl: '',
    params: {},
    query: {},
    body: {},
    route: undefined,
    ...overrides,
  } as unknown as RequestWithId;
}

function createRes(statusCode = 200): { res: Response; emitFinish: () => void; setHeader: ReturnType<typeof vi.fn> } {
  let finishHandler: (() => void) | null = null;
  const setHeader = vi.fn();

  const res = {
    statusCode,
    setHeader,
    on: vi.fn((event: string, cb: () => void) => {
      if (event === 'finish') finishHandler = cb;
      return res;
    }),
  } as unknown as Response;

  return {
    res,
    emitFinish: () => {
      if (finishHandler) finishHandler();
    },
    setHeader,
  };
}

describe('requestLogger middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets requestId on req and x-request-id on response', () => {
    const req = createReq();
    const { res, setHeader } = createRes(200);
    const next = vi.fn() as NextFunction;

    requestLogger(req, res, next);

    expect(mocks.randomUUID).toHaveBeenCalledOnce();
    expect(req.requestId).toBe('uuid-fixed-1234');
    expect(setHeader).toHaveBeenCalledWith('x-request-id', 'uuid-fixed-1234');
    expect(next).toHaveBeenCalledOnce();
  });

  it('logs at info level for 2xx responses on finish', () => {
    const req = createReq({ method: 'GET', originalUrl: '/healthz' });
    const { res, emitFinish } = createRes(204);
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(1_000).mockReturnValueOnce(1_250);

    requestLogger(req, res, vi.fn() as NextFunction);
    emitFinish();

    expect(mocks.info).toHaveBeenCalledOnce();
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('logs at warn level for 4xx responses on finish', () => {
    const req = createReq({ method: 'POST', originalUrl: '/api/input' });
    const { res, emitFinish } = createRes(404);
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(2_000).mockReturnValueOnce(2_300);

    requestLogger(req, res, vi.fn() as NextFunction);
    emitFinish();

    expect(mocks.warn).toHaveBeenCalledOnce();
    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('logs at error level for 5xx responses on finish', () => {
    const req = createReq({ method: 'DELETE', originalUrl: '/api/item/1' });
    const { res, emitFinish } = createRes(500);
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(3_000).mockReturnValueOnce(3_400);

    requestLogger(req, res, vi.fn() as NextFunction);
    emitFinish();

    expect(mocks.error).toHaveBeenCalledOnce();
    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it('records slow-route telemetry and operation trace with route/baseUrl/workspace extraction', () => {
    const req = createReq({
      method: 'PUT',
      originalUrl: '/api/workspaces/ws-99/summary',
      path: '/summary',
      baseUrl: '/api/workspaces',
      route: { path: '/:workspaceId/summary' } as Request['route'],
      params: { workspaceId: 'ws-99' } as Request['params'],
    });
    const { res, emitFinish } = createRes(200);
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(10_000).mockReturnValueOnce(11_600);

    requestLogger(req, res, vi.fn() as NextFunction);
    emitFinish();

    expect(mocks.recordSlowRouteTelemetry).toHaveBeenCalledWith({
      method: 'PUT',
      path: '/api/workspaces/:workspaceId/summary',
      statusCode: 200,
      durationMs: 1_600,
      workspaceId: 'ws-99',
    });

    expect(mocks.recordOperationTrace).toHaveBeenCalledWith({
      source: 'http',
      operation: 'PUT /api/workspaces/:workspaceId/summary',
      status: 'warning',
      durationMs: 1_600,
      workspaceId: 'ws-99',
      message: 'Slow route (1600ms)',
    });
  });
});
