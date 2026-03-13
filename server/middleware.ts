/**
 * Shared middleware and auth helpers extracted from server/index.ts.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type express from 'express';
import multer from 'multer';
import { listWorkspaces } from './workspaces.js';
import { getUploadRoot } from './data-dir.js';
import { verifyClientToken, getSafeClientUser } from './client-users.js';

// ── Rate Limiting ──

/** In-memory rate limiter (per IP). Returns Express middleware.
 *  Adds standard rate-limit headers to every response. */
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(windowMs: number, maxRequests: number) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${ip}:${req.path}`;
    const now = Date.now();
    let bucket = rateLimitBuckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 1, resetAt: now + windowMs };
      rateLimitBuckets.set(key, bucket);
    } else {
      bucket.count++;
    }
    // Set standard rate-limit headers
    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, maxRequests - bucket.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > maxRequests) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    next();
  };
}

// Clean up stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitBuckets) {
    if (now > bucket.resetAt) rateLimitBuckets.delete(key);
  }
}, 5 * 60 * 1000);

// Pre-built rate limiters
export const loginLimiter = rateLimit(60 * 1000, 5); // 5 attempts per minute
export const publicApiLimiter = rateLimit(60 * 1000, 60);
export const publicWriteLimiter = rateLimit(60 * 1000, 10);
export const checkoutLimiter = rateLimit(60 * 1000, 5);
export const clientLoginLimiter = rateLimit(60 * 1000, 5); // 5 attempts per minute per IP
export const aiLimiter = rateLimit(60 * 1000, 3); // 3 AI requests per minute per IP
export const globalPublicLimiter = rateLimit(60 * 1000, 200); // 200 requests per minute per IP across all public routes

// ── Credential Stuffing Protection ──

interface LoginAttempt {
  failures: number;
  lastFailure: number;
  lockedUntil: number;
}

const loginAttemptsByEmail = new Map<string, LoginAttempt>();

const LOGIN_MAX_FAILURES = 5;
const LOGIN_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

/** Check if an email is currently locked out due to too many failed login attempts. */
export function checkLoginLockout(email: string): { locked: boolean; retryAfterMs?: number } {
  const key = email.toLowerCase().trim();
  const attempt = loginAttemptsByEmail.get(key);
  if (!attempt) return { locked: false };
  const now = Date.now();
  if (attempt.lockedUntil > now) {
    return { locked: true, retryAfterMs: attempt.lockedUntil - now };
  }
  // Cooldown expired — reset
  if (attempt.failures >= LOGIN_MAX_FAILURES && attempt.lockedUntil <= now) {
    loginAttemptsByEmail.delete(key);
  }
  return { locked: false };
}

/** Record a failed login attempt for an email. Returns true if the account is now locked. */
export function recordLoginFailure(email: string): boolean {
  const key = email.toLowerCase().trim();
  const now = Date.now();
  const attempt = loginAttemptsByEmail.get(key) || { failures: 0, lastFailure: 0, lockedUntil: 0 };
  attempt.failures++;
  attempt.lastFailure = now;
  if (attempt.failures >= LOGIN_MAX_FAILURES) {
    attempt.lockedUntil = now + LOGIN_COOLDOWN_MS;
  }
  loginAttemptsByEmail.set(key, attempt);
  return attempt.failures >= LOGIN_MAX_FAILURES;
}

/** Clear login failure tracking for an email (on successful login). */
export function clearLoginFailures(email: string): void {
  loginAttemptsByEmail.delete(email.toLowerCase().trim());
}

// Clean up expired login lockouts every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, attempt] of loginAttemptsByEmail) {
    if (attempt.lockedUntil > 0 && attempt.lockedUntil <= now) loginAttemptsByEmail.delete(key);
    else if (now - attempt.lastFailure > LOGIN_COOLDOWN_MS) loginAttemptsByEmail.delete(key);
  }
}, 10 * 60 * 1000);

// ── Session Signing ──

const SESSION_SECRET = process.env.SESSION_SECRET || process.env.APP_PASSWORD || crypto.randomBytes(32).toString('hex');

export function signClientSession(workspaceId: string): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update(`client:${workspaceId}`).digest('hex');
}

export function verifyClientSession(workspaceId: string, token: string): boolean {
  const expected = signClientSession(workspaceId);
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token || ''.padEnd(expected.length))); }
  catch { return false; }
}

// Admin auth token (HMAC instead of raw password)
export function signAdminToken(): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update('admin').digest('hex');
}

export function verifyAdminToken(token: string): boolean {
  const expected = signAdminToken();
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token || '')); }
  catch { return false; }
}

// ── Client Actor Helper ──

/** Extract client user actor info from request cookies (for activity attribution) */
export function getClientActor(req: express.Request, workspaceId: string): { id?: string; name?: string } | undefined {
  const clientToken = req.cookies?.[`client_user_token_${workspaceId}`];
  if (!clientToken) return undefined;
  const payload = verifyClientToken(clientToken);
  if (!payload || payload.workspaceId !== workspaceId) return undefined;
  const user = getSafeClientUser(payload.clientUserId);
  return user ? { id: user.id, name: user.name } : undefined;
}

// ── File Upload ──

const tmpDir = path.join(getUploadRoot(), '.tmp');
fs.mkdirSync(tmpDir, { recursive: true });
export const upload = multer({ dest: tmpDir });

export function moveUploadedFiles(
  files: Express.Multer.File[],
  workspaceId: string,
  isMeta: boolean
): string[] {
  const workspaces = listWorkspaces();
  const ws = workspaces.find(w => w.id === workspaceId || w.folder === workspaceId);

  let dest: string;
  if (ws) {
    dest = isMeta
      ? path.join(getUploadRoot(), ws.folder, 'meta')
      : path.join(getUploadRoot(), ws.folder);
  } else {
    dest = path.join(getUploadRoot(), '_unsorted');
  }
  fs.mkdirSync(dest, { recursive: true });

  const paths: string[] = [];
  for (const f of files) {
    const safeName = path.basename(f.originalname);
    const target = path.join(dest, safeName);
    fs.renameSync(f.path, target);
    paths.push(target);
  }
  return paths;
}

// ── Constants ──

export const IS_PROD = process.env.NODE_ENV === 'production';
export const APP_PASSWORD = process.env.APP_PASSWORD;
