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

/** In-memory rate limiter (per IP). Returns Express middleware. */
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(windowMs: number, maxRequests: number) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${ip}:${req.path}`;
    const now = Date.now();
    const bucket = rateLimitBuckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    bucket.count++;
    if (bucket.count > maxRequests) {
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

// ── Session Signing ──

const SESSION_SECRET = process.env.SESSION_SECRET || process.env.APP_PASSWORD || crypto.randomBytes(32).toString('hex');

export function signClientSession(workspaceId: string): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update(`client:${workspaceId}`).digest('hex');
}

export function verifyClientSession(workspaceId: string, token: string): boolean {
  const expected = signClientSession(workspaceId);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token || ''.padEnd(expected.length)));
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
    const target = path.join(dest, f.originalname);
    fs.renameSync(f.path, target);
    paths.push(target);
  }
  return paths;
}

// ── Constants ──

export const IS_PROD = process.env.NODE_ENV === 'production';
export const APP_PASSWORD = process.env.APP_PASSWORD;
