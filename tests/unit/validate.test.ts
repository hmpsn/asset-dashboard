import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const mocks = vi.hoisted(() => ({
  warn: vi.fn(),
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ warn: mocks.warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { validate, z } from '../../server/middleware/validate.js';

function makeRes() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { status, json };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('validate middleware', () => {
  it('calls next and replaces req.body with parsed data on success', () => {
    const schema = z.object({
      name: z.string(),
      count: z.number().default(1),
    }).strip();
    const middleware = validate(schema);
    const req = { body: { name: 'Acme', extra: true }, path: '/api/test' } as unknown as Request;
    const res = makeRes() as unknown as Response;
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((req as { body: unknown }).body).toEqual({ name: 'Acme', count: 1 });
    expect((res as unknown as { status: ReturnType<typeof vi.fn> }).status).not.toHaveBeenCalled();
  });

  it('returns 400 with normalized issues on validation failure and does not call next', () => {
    const schema = z.object({
      user: z.object({ email: z.string().email() }),
    });
    const middleware = validate(schema);
    const req = { body: { user: { email: 'not-an-email' } }, path: '/api/users' } as unknown as Request;
    const res = makeRes() as unknown as Response;
    const next = vi.fn();

    middleware(req, res, next);

    const status = res.status as unknown as ReturnType<typeof vi.fn>;
    const json = (status.mock.results[0]?.value as { json: ReturnType<typeof vi.fn> }).json;
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      error: expect.any(String),
      errors: expect.arrayContaining([
        expect.objectContaining({ path: 'user.email', message: expect.any(String) }),
      ]),
    });
    expect(next).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith(
      {
        path: '/api/users',
        issues: expect.arrayContaining([expect.objectContaining({ path: 'user.email' })]),
      },
      'Request body validation failed',
    );
  });
});
