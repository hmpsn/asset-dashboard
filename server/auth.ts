/**
 * Auth — JWT token generation, verification, and Express middleware.
 */

import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { getUserById, type SafeUser } from './users.js';
import { getWorkspace } from './workspaces.js';
import { JWT_SECRET } from './jwt-config.js';
import { isProgrammingError } from './errors.js';
import { createLogger } from './logger.js';

const log = createLogger('auth');
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
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err }, 'auth/verifyToken: programming error');
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
    const wsId = req.params[paramName];
    if (!wsId || requestUserCanAccessWorkspace(req, wsId)) {
      next();
      return;
    }
    sendWorkspaceAccessDenied(res);
  };
}

/**
 * Requires the authenticated user to have access to the workspace
 * identified by a query parameter (e.g. ?workspaceId=...).
 * Used for routes keyed by siteId where workspaceId is passed as a query param.
 * Owners always have access to all workspaces.
 * Must be used AFTER requireAuth.
 */
export function requireWorkspaceAccessFromQuery(queryParam: string = 'workspaceId') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const raw = req.query[queryParam];
    const wsId = Array.isArray(raw) ? raw[0] : raw;
    if (!wsId || typeof wsId !== 'string') {
      if (requestUserCanOmitWorkspaceScope(req)) {
        next();
        return;
      }
      sendWorkspaceAccessDenied(res);
      return;
    }
    if (requestUserCanAccessWorkspace(req, wsId)) {
      next();
      return;
    }
    sendWorkspaceAccessDenied(res);
  };
}

/**
 * Requires the authenticated user to have access to the workspace
 * identified by a request body field.
 * Owners always have access to all workspaces.
 * Must be used AFTER requireAuth.
 */
export function requireWorkspaceAccessFromBody(bodyParam: string = 'workspaceId') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const body = req.body as Record<string, unknown> | undefined;
    const wsId = body?.[bodyParam];
    if (typeof wsId !== 'string') {
      if (requestUserCanOmitWorkspaceScope(req)) {
        next();
        return;
      }
      sendWorkspaceAccessDenied(res);
      return;
    }
    if (requestUserCanAccessWorkspace(req, wsId)) {
      next();
      return;
    }
    sendWorkspaceAccessDenied(res);
  };
}

type RequestFieldSource = 'params' | 'query' | 'body';

interface RequestFieldRef {
  source: RequestFieldSource;
  name: string;
}

interface WorkspaceSiteAccessOptions {
  workspace: RequestFieldRef;
  site: RequestFieldRef;
}

/**
 * Requires the authenticated user to access the requested workspace AND proves
 * that workspace owns the requested Webflow site before route code can look up
 * a site token or mutate a Webflow resource.
 */
export function requireWorkspaceSiteAccess(options: WorkspaceSiteAccessOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const wsId = readRequestField(req, options.workspace);
    const siteId = readRequestField(req, options.site);

    if (!wsId || !siteId) {
      if (requestUserCanOmitWorkspaceScope(req)) {
        next();
        return;
      }
      sendWorkspaceAccessDenied(res);
      return;
    }

    if (!requestUserCanAccessWorkspace(req, wsId) || !workspaceOwnsWebflowSite(wsId, siteId)) {
      sendWorkspaceAccessDenied(res);
      return;
    }

    next();
  };
}

export function requireWorkspaceSiteAccessFromQuery(
  siteParam: string = 'siteId',
  workspaceQueryParam: string = 'workspaceId',
) {
  return requireWorkspaceSiteAccess({
    workspace: { source: 'query', name: workspaceQueryParam },
    site: { source: 'params', name: siteParam },
  });
}

export function requireWorkspaceSiteAccessFromBody(
  siteParam: string = 'siteId',
  workspaceBodyParam: string = 'workspaceId',
) {
  return requireWorkspaceSiteAccess({
    workspace: { source: 'body', name: workspaceBodyParam },
    site: { source: 'params', name: siteParam },
  });
}

export function workspaceOwnsWebflowSite(workspaceId: string, siteId: string): boolean {
  const workspace = getWorkspace(workspaceId);
  return workspace?.webflowSiteId === siteId;
}

export function requestUserCanAccessWorkspace(req: Request, workspaceId: string): boolean {
  // If no JWT user is set, pass through (legacy APP_PASSWORD auth handles access).
  if (!req.user) return true;
  if (req.user.role === 'owner') return true;
  return !!req.user.workspaceIds?.includes(workspaceId);
}

function requestUserCanOmitWorkspaceScope(req: Request): boolean {
  return !req.user || req.user.role === 'owner';
}

export function sendWorkspaceAccessDenied(res: Response): void {
  res.status(403).json({ error: 'You do not have access to this workspace' });
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

function readRequestField(req: Request, field: RequestFieldRef): string | undefined {
  if (field.source === 'params') {
    return req.params[field.name];
  }

  if (field.source === 'query') {
    const raw = req.query[field.name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === 'string' ? value : undefined;
  }

  const body = req.body as Record<string, unknown> | undefined;
  const value = body?.[field.name];
  return typeof value === 'string' ? value : undefined;
}
