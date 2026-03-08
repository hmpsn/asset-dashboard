/**
 * Auth — JWT token generation, verification, and Express middleware.
 */

import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { getUserById, type SafeUser } from './users.js';

const JWT_SECRET = process.env.JWT_SECRET || 'hmpsn-studio-dev-secret-change-in-prod';
const JWT_EXPIRES_IN = '7d';

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
}

// Extend Express Request to include authenticated user
declare global {
  // eslint-disable-next-line no-restricted-syntax
  namespace Express {
    interface Request {
      user?: SafeUser;
      jwtPayload?: JwtPayload;
    }
  }
}

// ── Token helpers ──

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

// ── Middleware ──

/**
 * Requires a valid JWT in Authorization header or `token` cookie.
 * Populates req.user and req.jwtPayload on success.
 * Returns 401 on failure.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  const user = getUserById(payload.userId);
  if (!user) {
    res.status(401).json({ error: 'User not found' });
    return;
  }

  const { passwordHash: _pw, ...safe } = user;
  void _pw;
  req.user = safe;
  req.jwtPayload = payload;
  next();
}

/**
 * Requires the authenticated user to have one of the specified roles.
 * Must be used AFTER requireAuth.
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

/**
 * Requires the authenticated user to have access to the workspace
 * identified by :id or :workspaceId in the route params.
 * Owners always have access to all workspaces.
 * Must be used AFTER requireAuth.
 */
export function requireWorkspaceAccess(paramName: string = 'id') {
  return (req: Request, res: Response, next: NextFunction): void => {
    // If no JWT user is set, pass through (legacy APP_PASSWORD auth handles access)
    if (!req.user) {
      next();
      return;
    }
    // Owners bypass workspace checks
    if (req.user.role === 'owner') {
      next();
      return;
    }
    const wsId = req.params[paramName];
    if (!wsId) {
      next();
      return;
    }
    if (!req.user.workspaceIds || !req.user.workspaceIds.includes(wsId)) {
      res.status(403).json({ error: 'You do not have access to this workspace' });
      return;
    }
    next();
  };
}

/**
 * Optional auth — populates req.user if a valid token is present,
 * but does not reject the request if missing.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      const user = getUserById(payload.userId);
      if (user) {
        const { passwordHash: _pw, ...safe } = user;
        void _pw;
        req.user = safe;
        req.jwtPayload = payload;
      }
    }
  }
  next();
}

// ── Helpers ──

function extractToken(req: Request): string | null {
  // 1. Authorization: Bearer <token>
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  // 2. Cookie
  if (req.cookies?.token) {
    return req.cookies.token;
  }
  return null;
}
