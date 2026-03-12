/**
 * Unit tests for server/auth.ts — JWT token generation, verification, and middleware.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signToken, verifyToken, requireAuth, requireRole, requireWorkspaceAccess, optionalAuth } from '../../server/auth.js';
import type { Request, Response, NextFunction } from 'express';

// ── Token helpers ──

describe('signToken / verifyToken', () => {
  const payload = { userId: 'usr_1', email: 'test@example.com', role: 'owner' };

  it('signToken returns a non-empty string', () => {
    const token = signToken(payload);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  it('verifyToken decodes a valid token', () => {
    const token = signToken(payload);
    const decoded = verifyToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded!.userId).toBe('usr_1');
    expect(decoded!.email).toBe('test@example.com');
    expect(decoded!.role).toBe('owner');
  });

  it('verifyToken returns null for invalid token', () => {
    expect(verifyToken('invalid.jwt.token')).toBeNull();
  });

  it('verifyToken returns null for empty string', () => {
    expect(verifyToken('')).toBeNull();
  });

  it('round-trips payload fields correctly', () => {
    const p = { userId: 'usr_abc', email: 'admin@hmpsn.studio', role: 'admin' };
    const token = signToken(p);
    const decoded = verifyToken(token);
    expect(decoded?.userId).toBe(p.userId);
    expect(decoded?.email).toBe(p.email);
    expect(decoded?.role).toBe(p.role);
  });
});

// ── Middleware helpers ──

function mockReq(overrides: Record<string, unknown> = {}): Request {
  return {
    headers: {},
    cookies: {},
    params: {},
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

// ── requireAuth middleware ──

describe('requireAuth', () => {
  it('returns 401 when no token is present', () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();
    requireAuth(req, res, next as unknown as NextFunction);
    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for invalid token in Authorization header', () => {
    const req = mockReq({ headers: { authorization: 'Bearer bad.token' } });
    const res = mockRes();
    const next = vi.fn();
    requireAuth(req, res, next as unknown as NextFunction);
    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for invalid token in cookie', () => {
    const req = mockReq({ cookies: { token: 'bad.cookie.token' } });
    const res = mockRes();
    const next = vi.fn();
    requireAuth(req, res, next as unknown as NextFunction);
    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});

// ── requireRole middleware ──

describe('requireRole', () => {
  it('returns 401 when req.user is not set', () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();
    const middleware = requireRole('owner', 'admin');
    middleware(req, res, next as unknown as NextFunction);
    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when user role is not in allowed list', () => {
    const req = mockReq();
    (req as Record<string, unknown>).user = { role: 'member' };
    const res = mockRes();
    const next = vi.fn();
    const middleware = requireRole('owner', 'admin');
    middleware(req, res, next as unknown as NextFunction);
    expect(res._status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next when user role is allowed', () => {
    const req = mockReq();
    (req as Record<string, unknown>).user = { role: 'admin' };
    const res = mockRes();
    const next = vi.fn();
    const middleware = requireRole('owner', 'admin');
    middleware(req, res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalled();
  });
});

// ── requireWorkspaceAccess middleware ──

describe('requireWorkspaceAccess', () => {
  it('passes through when no JWT user is set (legacy auth)', () => {
    const req = mockReq({ params: { id: 'ws_1' } });
    const res = mockRes();
    const next = vi.fn();
    const middleware = requireWorkspaceAccess();
    middleware(req, res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalled();
  });

  it('passes through for owner role (bypasses workspace check)', () => {
    const req = mockReq({ params: { id: 'ws_any' } });
    (req as Record<string, unknown>).user = { role: 'owner', workspaceIds: [] };
    const res = mockRes();
    const next = vi.fn();
    const middleware = requireWorkspaceAccess();
    middleware(req, res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalled();
  });

  it('returns 403 when user does not have access to workspace', () => {
    const req = mockReq({ params: { id: 'ws_forbidden' } });
    (req as Record<string, unknown>).user = { role: 'member', workspaceIds: ['ws_other'] };
    const res = mockRes();
    const next = vi.fn();
    const middleware = requireWorkspaceAccess();
    middleware(req, res, next as unknown as NextFunction);
    expect(res._status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('passes through when user has workspace in their list', () => {
    const req = mockReq({ params: { id: 'ws_allowed' } });
    (req as Record<string, unknown>).user = { role: 'member', workspaceIds: ['ws_allowed', 'ws_other'] };
    const res = mockRes();
    const next = vi.fn();
    const middleware = requireWorkspaceAccess();
    middleware(req, res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalled();
  });

  it('supports custom param name', () => {
    const req = mockReq({ params: { workspaceId: 'ws_custom' } });
    (req as Record<string, unknown>).user = { role: 'member', workspaceIds: ['ws_custom'] };
    const res = mockRes();
    const next = vi.fn();
    const middleware = requireWorkspaceAccess('workspaceId');
    middleware(req, res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalled();
  });

  it('passes through when no workspace param in route', () => {
    const req = mockReq({ params: {} });
    (req as Record<string, unknown>).user = { role: 'member', workspaceIds: ['ws_1'] };
    const res = mockRes();
    const next = vi.fn();
    const middleware = requireWorkspaceAccess();
    middleware(req, res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalled();
  });
});

// ── optionalAuth middleware ──

describe('optionalAuth', () => {
  it('calls next even with no token', () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();
    optionalAuth(req, res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalled();
    expect((req as Record<string, unknown>).user).toBeUndefined();
  });

  it('does not set user for invalid token', () => {
    const req = mockReq({ cookies: { token: 'invalid' } });
    const res = mockRes();
    const next = vi.fn();
    optionalAuth(req, res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalled();
    expect((req as Record<string, unknown>).user).toBeUndefined();
  });
});
