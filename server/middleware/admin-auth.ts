/**
 * Admin-only authentication middleware.
 *
 * The global APP_PASSWORD gate in `server/app.ts` accepts three kinds of
 * credentials as equivalent for /api/ access:
 *   1. The raw APP_PASSWORD string in `x-auth-token` (legacy admin)
 *   2. A valid HMAC token via `verifyAdminToken()` (current admin)
 *   3. Any valid JWT user token via `verifyJwtToken()`  ← includes client-portal users
 *
 * For the vast majority of admin routes that's fine because every valid JWT
 * user (today) is a workspace member and downstream `requireWorkspaceAccess`
 * checks keep them scoped. But a handful of endpoints — Stripe key
 * configuration in particular — manage SYSTEM-level secrets that no JWT user
 * (even a valid one) should be able to touch.
 *
 * `requireAdminAuth` tightens the gate for exactly those endpoints: it accepts
 * ONLY the raw APP_PASSWORD or a verified HMAC admin token. JWT tokens are
 * rejected even when they are valid.
 *
 * Usage:
 *   import { requireAdminAuth } from '../middleware/admin-auth.js';
 *   router.post('/api/stripe/config/keys', requireAdminAuth, handler);
 *
 * See CLAUDE.md "Auth Conventions" — `requireAuth` is JWT-only and cannot be
 * used on admin routes; `requireAdminAuth` is the admin-only counterpart.
 */
import { type RequestHandler } from 'express';
import { verifyAdminToken } from '../middleware.js';

/**
 * Reject the request with 401 unless the caller presents a raw APP_PASSWORD
 * or a verified HMAC admin token. JWT user tokens do NOT pass.
 *
 * When APP_PASSWORD is unset (dev default), admin auth is not enforceable —
 * no raw password to compare against, and signAdminToken() derives from the
 * SESSION_SECRET fallback. In that mode this middleware passes through so
 * local development is not blocked. Production deployments always set
 * APP_PASSWORD.
 */
export const requireAdminAuth: RequestHandler = (req, res, next) => {
  const APP_PASSWORD = process.env.APP_PASSWORD;
  // If no APP_PASSWORD is configured, the admin gate is disabled everywhere
  // (dev default). Mirror that so this middleware does not block local work.
  if (!APP_PASSWORD) return next();

  const token = (req.headers['x-auth-token'] || req.cookies?.auth_token || '') as string;
  if (token && (token === APP_PASSWORD || verifyAdminToken(token))) {
    return next();
  }

  return res.status(401).json({ error: 'Admin authentication required' });
};
